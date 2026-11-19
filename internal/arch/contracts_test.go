package arch

// Contracts: what each domain owns and the declared links between domains
// (wiki Server-App, "Module map"). arch_test.go checks the imports; this file
// checks the links that are not imports: tables, api types, MQTT topics, and
// what the integration test files cover.

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/rmx-lt/rmx-server-app/internal/api"
	"github.com/rmx-lt/rmx-server-app/internal/config"
	"github.com/rmx-lt/rmx-server-app/internal/mower"
	"github.com/rmx-lt/rmx-server-app/internal/mqtt"
	"github.com/rmx-lt/rmx-server-app/internal/transfer"
)

// contract is what one domain owns. Anything another domain owns is off
// limits unless a link allows it.
type contract struct {
	tables  []string // the tables it creates and queries
	api     []string // its files in internal/api, besides sharedAPI
	mqttIn  []string // the suffixes and trees ("gateway/#") it registers, below <prefix>/<device>/
	mqttOut []string // the suffixes it publishes on
}

// contracts holds every domain, by its name below internal/.
var contracts = map[string]contract{
	"auth": {
		tables: []string{"users", "sessions"},
		api:    []string{"auth.go"},
	},
	"planning": {
		tables: []string{"maps", "user_settings"},
		api:    []string{"planning.go"},
	},
	"mower": {
		tables:  []string{"devices", "board_state", "catalogue_parts", "catalogues", "device_events", "metric_latest", "telemetry", "commands", "ntrip_sent"},
		api:     []string{"mower.go", "command.go"},
		mqttIn:  []string{"gateway/#", "autopilot/#"},
		mqttOut: []string{"gateway/cmd", "autopilot/cmd", "autopilot/drive"},
	},
	"transfer": {
		tables:  []string{"paths"},
		mqttIn:  []string{"gateway/fw/req", "autopilot/fw/req", "autopilot/path/req"},
		mqttOut: []string{"gateway/fw/chunk", "gateway/fw/res", "autopilot/fw/chunk", "autopilot/fw/res", "autopilot/path/chunk", "autopilot/path/res"},
	},
}

// sharedAPI are the files of internal/api every domain may use: error codes,
// the WebSocket envelope, unions, health.
var sharedAPI = []string{"api.go", "app.go", "union.go", "ws.go"}

// links are the declared ties between two domains. A link allows a foreign
// key between their tables, one's topics inside the other's trees, and an
// integration test file that covers both ("a+b").
var links = []struct{ a, b, why string }{
	{"planning", "auth", "maps and user_settings reference users"},
	{"transfer", "mower", "the chunk transfer topics sit inside mower's gateway/# and autopilot/# trees"},
}

func linked(a, b string) bool {
	for _, l := range links {
		if (l.a == a && l.b == b) || (l.a == b && l.b == a) {
			return true
		}
	}
	return false
}

// mqttRegister registers a domain's handlers, the way app does.
var mqttRegister = map[string]func(*mqtt.Client){
	"mower":    func(c *mqtt.Client) { mower.Register(c, nil) },
	"transfer": func(c *mqtt.Client) { transfer.RegisterMQTT(c, nil) },
}

// mqttPublished lists the suffixes a domain's mqtt.go builds for publishing.
// shortcut: a new topic builder in a domain's mqtt.go must be added here by
// hand; TestPublishSuffixesComeFromMQTTGo keeps every builder in that one file.
var mqttPublished = map[string]func() []string{
	"mower": func() []string {
		return []string{mower.CommandTopic(api.BoardGateway), mower.CommandTopic(api.BoardAutopilot), mower.DriveTopic}
	},
	"transfer": func() []string {
		var out []string
		for _, s := range transfer.Sets {
			out = append(out, s.Chunk(), s.Response())
		}
		return out
	},
}

func TestContractsCoverEveryDomain(t *testing.T) {
	for name, l := range layers {
		d, ok := strings.CutPrefix(name, "internal/")
		if _, has := contracts[d]; l == domain && (!ok || !has) {
			t.Errorf("domain %s has no contract in internal/arch/contracts_test.go", name)
		}
	}
	for d := range contracts {
		if layers["internal/"+d] != domain {
			t.Errorf("contract %s is not a domain in the layer table", d)
		}
	}
	for _, l := range links {
		if _, ok := contracts[l.a]; !ok {
			t.Errorf("link %s-%s: %s is not a domain", l.a, l.b, l.a)
		}
		if _, ok := contracts[l.b]; !ok {
			t.Errorf("link %s-%s: %s is not a domain", l.a, l.b, l.b)
		}
	}
}

// ---- Tables ---------------------------------------------------------------------

var (
	sqlComment  = regexp.MustCompile(`--[^\n]*`)
	createTable = regexp.MustCompile(`(?is)^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)`)
	alterTable  = regexp.MustCompile(`(?is)^\s*ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(\w+)`)
	dropTable   = regexp.MustCompile(`(?is)^\s*DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([\w\s,]+?)\s*(?:CASCADE|RESTRICT)?\s*$`)
	references  = regexp.MustCompile(`(?i)\bREFERENCES\s+(\w+)`)
	// sqlTable finds the table names in Go string literals.
	sqlTable = regexp.MustCompile(`(?i)\b(?:FROM|JOIN|INTO|UPDATE|TABLE|TRUNCATE|REFERENCES)\s+(\w+)`)
)

type foreignKey struct{ file, from, to string }

// readMigrations returns the tables that exist after every migration, and the
// foreign keys declared on the way.
func readMigrations(t *testing.T) (map[string]bool, []foreignKey) {
	t.Helper()
	files, err := filepath.Glob(filepath.Join("..", "..", "migrations", "*.sql"))
	if err != nil || len(files) == 0 {
		t.Fatalf("no migrations: %v", err)
	}
	slices.Sort(files)
	live := map[string]bool{}
	var fks []foreignKey
	for _, f := range files {
		b, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		// shortcut: splits on ';', so a function body with ';' in $$ would break
		// it; none exists, add a real tokenizer when one does.
		for _, stmt := range strings.Split(sqlComment.ReplaceAllString(string(b), ""), ";") {
			table := ""
			if m := createTable.FindStringSubmatch(stmt); m != nil {
				table = strings.ToLower(m[1])
				live[table] = true
			} else if m := alterTable.FindStringSubmatch(stmt); m != nil {
				table = strings.ToLower(m[1])
			} else if m := dropTable.FindStringSubmatch(stmt); m != nil {
				for _, name := range strings.Split(m[1], ",") {
					delete(live, strings.ToLower(strings.TrimSpace(name)))
				}
			}
			for _, m := range references.FindAllStringSubmatch(stmt, -1) {
				fks = append(fks, foreignKey{filepath.Base(f), table, strings.ToLower(m[1])})
			}
		}
	}
	return live, fks
}

func tableOwners(t *testing.T) (map[string]string, map[string]bool, []foreignKey) {
	t.Helper()
	live, fks := readMigrations(t)
	owner := map[string]string{}
	for d, c := range contracts {
		for _, table := range c.tables {
			if o, dup := owner[table]; dup {
				t.Errorf("table %s has two owners: %s and %s", table, o, d)
			}
			owner[table] = d
			if !live[table] {
				t.Errorf("%s owns table %s, which the migrations do not create", d, table)
			}
		}
	}
	return owner, live, fks
}

func TestTableOwnership(t *testing.T) {
	owner, live, fks := tableOwners(t)
	for table := range live {
		if owner[table] == "" {
			t.Errorf("table %s has no owner (add it to a contract in internal/arch)", table)
		}
	}
	for _, fk := range fks {
		a, b := owner[fk.from], owner[fk.to]
		if fk.from == "" {
			t.Errorf("%s: a REFERENCES outside CREATE TABLE / ALTER TABLE", fk.file)
		} else if a != "" && b != "" && a != b && !linked(a, b) {
			t.Errorf("%s: %s (%s) references %s (%s), and %s and %s have no declared link", fk.file, fk.from, a, fk.to, b, a, b)
		}
	}
}

// TestDomainsQueryOnlyTheirTables reads every string literal of a domain (SQL
// lives in its store.go, but anything counts) for the tables it names.
func TestDomainsQueryOnlyTheirTables(t *testing.T) {
	owner, _, _ := tableOwners(t)
	for d := range contracts {
		for name, f := range parseDomain(t, d) {
			ast.Inspect(f, func(n ast.Node) bool {
				lit, ok := n.(*ast.BasicLit)
				if !ok || lit.Kind != token.STRING {
					return true
				}
				for _, m := range sqlTable.FindAllStringSubmatch(lit.Value, -1) {
					table := strings.ToLower(m[1])
					if o := owner[table]; o != "" && o != d {
						t.Errorf("internal/%s/%s names table %s, which %s owns", d, name, table, o)
					}
				}
				return true
			})
		}
	}
}

// ---- api types ------------------------------------------------------------------

func TestDomainsUseOnlyTheirAPIFiles(t *testing.T) {
	declared := map[string]string{} // top-level name in internal/api -> its file
	apiFiles := map[string]bool{}
	for name, f := range parseDir(t, "internal/api") {
		if strings.HasSuffix(name, "_test.go") {
			continue
		}
		apiFiles[name] = true
		for _, decl := range f.Decls {
			for _, id := range declNames(decl, false) {
				declared[id] = name
			}
		}
	}
	owned := map[string]string{}
	for d, c := range contracts {
		for _, file := range c.api {
			if !apiFiles[file] {
				t.Errorf("%s owns internal/api/%s, which does not exist", d, file)
			}
			if o, dup := owned[file]; dup {
				t.Errorf("internal/api/%s has two owners: %s and %s", file, o, d)
			}
			owned[file] = d
		}
	}
	for file := range apiFiles {
		if owned[file] == "" && !slices.Contains(sharedAPI, file) {
			t.Errorf("internal/api/%s is neither shared nor owned by a domain (add it to internal/arch)", file)
		}
	}

	for d, c := range contracts {
		allowedFiles := slices.Concat(c.api, sharedAPI)
		for name, f := range parseDomain(t, d) {
			alias := importName(f, module+"/internal/api")
			if alias == "" {
				continue
			}
			ast.Inspect(f, func(n ast.Node) bool {
				sel, ok := n.(*ast.SelectorExpr)
				if !ok {
					return true
				}
				if x, ok := sel.X.(*ast.Ident); ok && x.Name == alias {
					if file := declared[sel.Sel.Name]; file != "" && !slices.Contains(allowedFiles, file) {
						t.Errorf("internal/%s/%s uses api.%s from internal/api/%s, which %s owns", d, name, sel.Sel.Name, file, owned[file])
					}
				}
				return true
			})
		}
	}
}

// ---- MQTT -----------------------------------------------------------------------

func TestMQTTTopics(t *testing.T) {
	inOwner := map[string]string{}
	outOwner := map[string]string{}
	for d, c := range contracts {
		register := mqttRegister[d]
		if register == nil {
			if len(c.mqttIn) > 0 {
				t.Errorf("%s declares MQTT topics but has no entry in mqttRegister", d)
			}
		} else {
			cl := mqtt.New(config.MQTT{})
			register(cl)
			if got, want := cl.Routes(), sorted(c.mqttIn); !slices.Equal(got, want) {
				t.Errorf("%s registers %v, its contract says %v", d, got, want)
			}
		}
		if publish := mqttPublished[d]; publish != nil {
			if got, want := sorted(publish()), sorted(c.mqttOut); !slices.Equal(got, want) {
				t.Errorf("%s publishes on %v, its contract says %v", d, got, want)
			}
		} else if len(c.mqttOut) > 0 {
			t.Errorf("%s declares MQTT topics but has no entry in mqttPublished", d)
		}
		for _, s := range c.mqttIn {
			if o, dup := inOwner[s]; dup {
				t.Errorf("MQTT %s is registered by %s and %s", s, o, d)
			}
			inOwner[s] = d
		}
		for _, s := range c.mqttOut {
			if o, dup := outOwner[s]; dup {
				t.Errorf("MQTT %s is published by %s and %s", s, o, d)
			}
			outOwner[s] = d
		}
	}
	// A suffix inside another domain's tree needs a link.
	for s, d := range inOwner {
		root, _, _ := strings.Cut(s, "/")
		if o, ok := inOwner[root+"/#"]; ok && o != d && !linked(d, o) {
			t.Errorf("MQTT %s (%s) sits in %s's tree %s/#, and they have no declared link", s, d, o, root)
		}
	}
	// A domain that imports mqtt must be registered here, or its topics go unchecked.
	for d := range contracts {
		if _, ok := mqttRegister[d]; ok {
			continue
		}
		for name, f := range parseDomain(t, d) {
			if importName(f, module+"/internal/mqtt") != "" && !strings.HasSuffix(name, "_test.go") {
				t.Errorf("internal/%s/%s imports mqtt, but %s has no entry in mqttRegister", d, name, d)
			}
		}
	}
}

// TestPublishSuffixesComeFromMQTTGo: every suffix a domain publishes on is
// built by a constant, function or method of its mqtt.go, so the topics of a
// domain are in one file and mqttPublished can list them.
func TestPublishSuffixesComeFromMQTTGo(t *testing.T) {
	for d := range contracts {
		files := parseDomain(t, d)
		inMQTTGo := map[string]bool{}
		if f := files["mqtt.go"]; f != nil {
			for _, decl := range f.Decls {
				for _, id := range declNames(decl, true) {
					inMQTTGo[id] = true
				}
			}
		}
		for name, f := range files {
			if strings.HasSuffix(name, "_test.go") {
				continue
			}
			ast.Inspect(f, func(n ast.Node) bool {
				call, ok := n.(*ast.CallExpr)
				if !ok || len(call.Args) != 4 {
					return true
				}
				sel, ok := call.Fun.(*ast.SelectorExpr)
				if !ok || (sel.Sel.Name != "Publish" && sel.Sel.Name != "PublishFast") {
					return true
				}
				if !builtIn(call.Args[2], inMQTTGo) {
					t.Errorf("internal/%s/%s: the suffix of %s is not built in its mqtt.go", d, name, sel.Sel.Name)
				}
				return true
			})
		}
	}
}

func builtIn(e ast.Expr, names map[string]bool) bool {
	switch e := e.(type) {
	case *ast.Ident:
		return names[e.Name]
	case *ast.CallExpr:
		switch fn := e.Fun.(type) {
		case *ast.Ident:
			return names[fn.Name]
		case *ast.SelectorExpr:
			return names[fn.Sel.Name]
		}
	}
	return false
}

// ---- Integration tests ----------------------------------------------------------

var coversLine = regexp.MustCompile(`(?m)^// Covers: (\S+)$`)

// TestIntegrationFilesSayWhatTheyCover: each file of internal/integration
// (but the harness) has one "// Covers: <label>" line: a domain, "app" for
// what app wires, or a linked pair "a+b".
func TestIntegrationFilesSayWhatTheyCover(t *testing.T) {
	files, err := filepath.Glob(filepath.Join("..", "integration", "*_test.go"))
	if err != nil || len(files) == 0 {
		t.Fatalf("no integration tests: %v", err)
	}
	for _, f := range files {
		name := filepath.Base(f)
		if name == "harness_test.go" {
			continue
		}
		b, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		m := coversLine.FindAllStringSubmatch(string(b), -1)
		if len(m) != 1 {
			t.Errorf("internal/integration/%s needs exactly one \"// Covers: <domain>\" line, has %d", name, len(m))
			continue
		}
		if err := validLabel(m[0][1]); err != nil {
			t.Errorf("internal/integration/%s: %v", name, err)
		}
	}
}

func validLabel(label string) error {
	if label == "app" {
		return nil
	}
	a, b, pair := strings.Cut(label, "+")
	domains := []string{a}
	if pair {
		domains = append(domains, b)
	}
	for _, d := range domains {
		if _, ok := contracts[d]; !ok {
			return fmt.Errorf("covers %q: %s is not a domain", label, d)
		}
	}
	if pair && !linked(a, b) {
		return fmt.Errorf("covers %q: %s and %s have no declared link", label, a, b)
	}
	return nil
}

func TestContractCheckerRefuses(t *testing.T) {
	for _, c := range []struct {
		label string
		ok    bool
	}{
		{"mower", true}, {"app", true}, {"mower+transfer", true}, {"transfer+mower", true},
		{"planning+mower", false}, {"nope", false}, {"mower+nope", false},
	} {
		if err := validLabel(c.label); (err == nil) != c.ok {
			t.Errorf("validLabel(%q) = %v, want ok=%v", c.label, err, c.ok)
		}
	}
	if !builtIn(&ast.Ident{Name: "DriveTopic"}, map[string]bool{"DriveTopic": true}) || builtIn(&ast.BasicLit{Kind: token.STRING, Value: `"autopilot/drive"`}, nil) {
		t.Error("builtIn accepts a literal or refuses a declared name")
	}
	if m := sqlTable.FindAllStringSubmatch("SELECT x FROM users u JOIN maps m ON true", -1); len(m) != 2 || m[0][1] != "users" || m[1][1] != "maps" {
		t.Errorf("sqlTable found %v", m)
	}
}

// ---- Helpers --------------------------------------------------------------------

// parseDomain parses every Go file of internal/<d>, tests included.
func parseDomain(t *testing.T, d string) map[string]*ast.File {
	return parseDir(t, "internal/"+d)
}

func parseDir(t *testing.T, dir string) map[string]*ast.File {
	t.Helper()
	entries, err := os.ReadDir(filepath.Join("..", "..", dir))
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]*ast.File{}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".go") {
			continue
		}
		f, err := parser.ParseFile(token.NewFileSet(), filepath.Join("..", "..", dir, e.Name()), nil, 0)
		if err != nil {
			t.Fatal(err)
		}
		out[e.Name()] = f
	}
	return out
}

// importName is the name f uses for the package path, or "" if f does not import it.
func importName(f *ast.File, path string) string {
	for _, spec := range f.Imports {
		if p, _ := strconv.Unquote(spec.Path.Value); p == path {
			if spec.Name != nil {
				return spec.Name.Name
			}
			return path[strings.LastIndex(path, "/")+1:]
		}
	}
	return ""
}

// declNames lists the top-level names a declaration introduces, and the
// method names if methods is set.
func declNames(decl ast.Decl, methods bool) []string {
	var out []string
	switch d := decl.(type) {
	case *ast.FuncDecl:
		if d.Recv == nil || methods {
			out = append(out, d.Name.Name)
		}
	case *ast.GenDecl:
		for _, spec := range d.Specs {
			switch s := spec.(type) {
			case *ast.TypeSpec:
				out = append(out, s.Name.Name)
			case *ast.ValueSpec:
				for _, n := range s.Names {
					out = append(out, n.Name)
				}
			}
		}
	}
	return out
}

func sorted(s []string) []string {
	s = slices.Clone(s)
	slices.Sort(s)
	return s
}
