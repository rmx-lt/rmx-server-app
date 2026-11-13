package arch

import (
	"bytes"
	"encoding/json"
	"go/parser"
	"go/token"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"
)

const module = "github.com/rmx-lt/rmx-server-app"

type layer string

const (
	leaf     layer = "leaf"     // shared types; import nothing internal
	platform layer = "platform" // infrastructure; leaves and other platform packages
	domain   layer = "domain"   // features; platform and leaves, never another domain
	root     layer = "root"     // app and the integration tests: everything
	command  layer = "command"  // cmd/*: one package each, see commandImports
	meta     layer = "meta"     // this test
)

// layers maps every package (path below the module) to its layer.
var layers = map[string]layer{
	"internal/core":      leaf,
	"internal/api":       leaf,
	"internal/buildinfo": leaf,
	"migrations":         leaf,

	"internal/config":   platform,
	"internal/db":       platform,
	"internal/events":   platform,
	"internal/httpx":    platform,
	"internal/mqtt":     platform,
	"internal/ws":       platform,
	"internal/apperr":   platform,
	"internal/clientip": platform,

	"internal/auth":     domain,
	"internal/firmware": domain,

	"internal/app":         root,
	"internal/integration": root,

	"cmd/rmx-server": command,
	"cmd/gen-ts":     command,

	"internal/arch": meta,
}

// commandImports is the only internal package each command may import.
var commandImports = map[string]string{
	"cmd/rmx-server": "internal/app",
	"cmd/gen-ts":     "internal/api",
}

// allowed reports whether a package in from may import a package in to.
func allowed(fromPkg string, from, to layer, toPkg string) bool {
	switch from {
	case leaf, meta:
		return false
	case platform:
		return to == leaf || to == platform
	case domain:
		return to == leaf || to == platform
	case root:
		return to != command && to != meta
	case command:
		return toPkg == commandImports[fromPkg]
	}
	return false
}

// fences: third-party modules only some packages may import. A file may
// import a fenced module only if its package is listed, or (for pgx) if the
// file is a domain's store.go. The integration tests are exempt: they play the
// browser (WebSocket client) and the devices (MQTT client).
var fences = []struct {
	module    string
	packages  []string
	storeFile bool
}{
	{"github.com/eclipse/paho.golang", []string{"internal/mqtt"}, false},
	{"github.com/coder/websocket", []string{"internal/ws"}, false},
	{"github.com/jackc/pgx", []string{"internal/db"}, true},
	{"github.com/pressly/goose", []string{"internal/db"}, false},
}

type pkg struct {
	ImportPath     string
	Dir            string
	Imports        []string
	TestImports    []string
	XTestImports   []string
	GoFiles        []string
	TestGoFiles    []string
	XTestGoFiles   []string
	IgnoredGoFiles []string
}

// list runs go list on the whole module, with the integration tag so the
// integration tests' imports count too.
func list(t *testing.T) []pkg {
	t.Helper()
	readSources(t)
	cmd := exec.Command("go", "list", "-tags", "integration", "-json", "./...")
	cmd.Dir = filepath.Join("..", "..")
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("go list: %v\n%s", err, stderr.String())
	}
	var pkgs []pkg
	dec := json.NewDecoder(bytes.NewReader(out))
	for {
		var p pkg
		if err := dec.Decode(&p); err == io.EOF {
			break
		} else if err != nil {
			t.Fatal(err)
		}
		// A dependency of the web app can ship Go files (flatted does); after
		// bun install they show up in ./... locally. They are not ours.
		if strings.HasPrefix(p.ImportPath, module+"/web/node_modules/") {
			continue
		}
		pkgs = append(pkgs, p)
	}
	if len(pkgs) < len(layers) {
		t.Fatalf("go list found only %d packages", len(pkgs))
	}
	return pkgs
}

// readSources reads every directory and Go file of the module. go list runs
// in a child process, whose reads the test cache does not see; reading them
// here makes a cached pass invalid as soon as a package or an import changes.
func readSources(t *testing.T) {
	t.Helper()
	err := filepath.WalkDir(filepath.Join("..", ".."), func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if name := d.Name(); name == ".git" || name == "node_modules" || name == "web" {
				return filepath.SkipDir
			}
			_, err := os.ReadDir(path)
			return err
		}
		if strings.HasSuffix(path, ".go") {
			_, err := os.ReadFile(path)
			return err
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

func rel(importPath string) (string, bool) {
	if importPath == module {
		return "", true
	}
	return strings.CutPrefix(importPath, module+"/")
}

func TestImportRules(t *testing.T) {
	for _, p := range list(t) {
		name, _ := rel(p.ImportPath)
		from, ok := layers[name]
		if !ok {
			t.Errorf("%s is not in the layer table of internal/arch (add it, with the layer the wiki Server-App gives it)", name)
			continue
		}
		imports := slices.Concat(p.Imports, p.TestImports, p.XTestImports)
		slices.Sort(imports)
		for _, imp := range slices.Compact(imports) {
			toName, internal := rel(imp)
			if !internal || toName == name {
				continue
			}
			to, ok := layers[toName]
			if !ok {
				continue // reported as unlisted above
			}
			if !allowed(name, from, to, toName) {
				t.Errorf("%s (%s) must not import %s (%s)", name, from, toName, to)
			}
		}
	}
}

func TestThirdPartyFences(t *testing.T) {
	for _, p := range list(t) {
		name, _ := rel(p.ImportPath)
		if name == "internal/integration" {
			continue
		}
		files := slices.Concat(p.GoFiles, p.TestGoFiles, p.XTestGoFiles, p.IgnoredGoFiles)
		for _, file := range files {
			if !strings.HasSuffix(file, ".go") {
				continue
			}
			for _, imp := range fileImports(t, filepath.Join(p.Dir, file)) {
				for _, f := range fences {
					if imp != f.module && !strings.HasPrefix(imp, f.module+"/") {
						continue
					}
					isStore := f.storeFile && layers[name] == domain && (file == "store.go" || file == "store_test.go")
					if !slices.Contains(f.packages, name) && !isStore {
						t.Errorf("%s/%s imports %s, which only %v may import", name, file, imp, fenceOwners(f.packages, f.storeFile))
					}
				}
			}
		}
	}
}

func fenceOwners(pkgs []string, storeFile bool) []string {
	if storeFile {
		return append(slices.Clone(pkgs), "a domain's store.go")
	}
	return pkgs
}

func fileImports(t *testing.T, path string) []string {
	t.Helper()
	f, err := parser.ParseFile(token.NewFileSet(), path, nil, parser.ImportsOnly)
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	for _, spec := range f.Imports {
		p, err := strconv.Unquote(spec.Path.Value)
		if err != nil {
			t.Fatal(err)
		}
		out = append(out, p)
	}
	return out
}

// TestRulesAreCheckable checks the checker: a few edges the rules must refuse.
func TestRulesAreCheckable(t *testing.T) {
	for _, c := range []struct {
		from, to string
		want     bool
	}{
		{"internal/auth", "internal/firmware", false},
		{"internal/mqtt", "internal/firmware", false},
		{"internal/core", "internal/api", false},
		{"internal/apperr", "internal/api", true},
		{"internal/firmware", "internal/mqtt", true},
		{"internal/app", "internal/auth", true},
		{"cmd/rmx-server", "internal/auth", false},
		{"cmd/rmx-server", "internal/app", true},
		{"cmd/gen-ts", "internal/api", true},
		{"internal/auth", "internal/app", false},
	} {
		if got := allowed(c.from, layers[c.from], layers[c.to], c.to); got != c.want {
			t.Errorf("%s -> %s: allowed=%v, want %v", c.from, c.to, got, c.want)
		}
	}
}
