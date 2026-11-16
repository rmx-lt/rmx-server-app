package planning

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/rmx-lt/rmx-server-app/internal/api"
	"github.com/rmx-lt/rmx-server-app/internal/apperr"
)

func validDoc() api.MapDoc {
	return api.MapDoc{
		Zones: []api.Zone{{ID: 1, Name: "Zone 1", Areas: []api.Area{
			{ID: 1, Category: "mowing", Vertices: []api.Point{{X: 0, Y: 0}, {X: 10, Y: 0}, {X: 10, Y: 10}}},
			{ID: 2, Category: "no_go", Vertices: []api.Point{{X: 1, Y: 1}, {X: 2, Y: 2}, {X: 1, Y: 2}}},
			{ID: 3, Category: "navigation", Vertices: []api.Point{{X: 10, Y: 0}, {X: 20, Y: 0}, {X: 20, Y: 2}}},
		}}},
		GeoAnchor: &api.GeoAnchor{Lat: 54.68, Lon: 25.28},
	}
}

func TestCheckMapAccepts(t *testing.T) {
	name, stored, err := checkMap("  Garden  ", validDoc())
	if err != nil {
		t.Fatal(err)
	}
	if name != "Garden" {
		t.Errorf("name %q", name)
	}
	var back api.MapDoc
	if err := json.Unmarshal(stored, &back); err != nil {
		t.Fatal(err)
	}
	if len(back.Zones) != 1 || len(back.Zones[0].Areas) != 3 || back.GeoAnchor == nil || back.Zones[0].Areas[1].Category != "no_go" {
		t.Errorf("round trip: %+v", back)
	}
}

func TestCheckMapNormalizesLists(t *testing.T) {
	_, stored, err := checkMap("Empty", api.MapDoc{Zones: []api.Zone{{ID: 1, Name: " Zone 1 "}}})
	if err != nil {
		t.Fatal(err)
	}
	for _, member := range []string{`"name":"Zone 1"`, `"areas":[]`, `"geo_anchor":null`} {
		if !strings.Contains(string(stored), member) {
			t.Errorf("%s lacks %s", stored, member)
		}
	}
}

func TestCheckMapRefuses(t *testing.T) {
	cases := map[string]func(*string, *api.MapDoc){
		"empty name":        func(n *string, _ *api.MapDoc) { *n = "   " },
		"long name":         func(n *string, _ *api.MapDoc) { *n = strings.Repeat("ž", MaxNameLength+1) },
		"bad category":      func(_ *string, d *api.MapDoc) { d.Zones[0].Areas[0].Category = "obstacle" },
		"duplicate area id": func(_ *string, d *api.MapDoc) { d.Zones[0].Areas[1].ID = 1 },
		"duplicate area id across zones": func(_ *string, d *api.MapDoc) {
			d.Zones = append(d.Zones, api.Zone{ID: 2, Name: "Zone 2", Areas: []api.Area{{ID: 1, Category: "mowing"}}})
		},
		"no zones":          func(_ *string, d *api.MapDoc) { d.Zones = nil },
		"duplicate zone id": func(_ *string, d *api.MapDoc) { d.Zones = append(d.Zones, api.Zone{ID: 1, Name: "Other"}) },
		"empty zone name":   func(_ *string, d *api.MapDoc) { d.Zones[0].Name = "  " },
		"long zone name":    func(_ *string, d *api.MapDoc) { d.Zones[0].Name = strings.Repeat("ž", MaxNameLength+1) },
		"anchor range":      func(_ *string, d *api.MapDoc) { d.GeoAnchor.Lat = 91 },
		"too many vertices": func(_ *string, d *api.MapDoc) {
			d.Zones[0].Areas[0].Vertices = make([]api.Point, maxVertices+1)
		},
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			mapName, doc := "Garden", validDoc()
			mutate(&mapName, &doc)
			_, _, err := checkMap(mapName, doc)
			var e *apperr.Error
			if !errors.As(err, &e) || e.Code != api.CodeBadRequest {
				t.Fatalf("got %v", err)
			}
		})
	}
	// The exact limit is fine, for the map and for a zone.
	doc := validDoc()
	doc.Zones[0].Name = strings.Repeat("ž", MaxNameLength)
	if _, _, err := checkMap(strings.Repeat("ž", MaxNameLength), doc); err != nil {
		t.Error(err)
	}
}

func TestSettingKeys(t *testing.T) {
	for _, ok := range []string{"ui.unitOfMeasure", "floatingControl.canvas-generator", "geoAnchor.default", "a", strings.Repeat("k", 64)} {
		if !settingKey.MatchString(ok) {
			t.Errorf("refused %q", ok)
		}
	}
	for _, bad := range []string{"", ".hidden", "a b", "a/b", strings.Repeat("k", 65), "ž"} {
		if settingKey.MatchString(bad) {
			t.Errorf("accepted %q", bad)
		}
	}
}

func TestStoreErrors(t *testing.T) {
	for err, code := range map[error]api.ErrorCode{
		errNoMap:           api.CodeNotFound,
		errStaleRevision:   api.CodeConflict,
		errors.New("boom"): api.CodeInternal,
	} {
		if got := apperr.From(storeError(err)); got.Code != code {
			t.Errorf("%v: got %s, want %s", err, got.Code, code)
		}
	}
	if apperr.Conflict("x").Status() != 409 {
		t.Error("conflict is not 409")
	}
}

// A map stored before the removals still loads: members the document no
// longer has are ignored and dropped at the next save.
func TestOldDocLoads(t *testing.T) {
	old := `{"format":"polygon","type":"any_offline","coord_system":"Cartesian","headland_enabled":true,` +
		`"headland_width":"10","zones":[{"id":1,"name":"Zone 1","areas":[{"id":1,"category":"mowing","type":"offline","vertices":[]}]}],` +
		`"points":[{"type":"start","point":{"x":1,"y":1}}],"layer_settings":[{"id":1,"layer_id":2,"value":"#fff"}],"geo_anchor":null}`
	var doc api.MapDoc
	if err := json.Unmarshal([]byte(old), &doc); err != nil || len(doc.Zones) != 1 || len(doc.Zones[0].Areas) != 1 {
		t.Fatalf("%v %+v", err, doc)
	}
}
