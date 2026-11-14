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
		Format: "polygon", Type: "any_offline", CoordSystem: "Cartesian",
		HeadlandEnabled: true, HeadlandWidth: "10",
		Zones: []api.Zone{
			{ID: 1, Category: "mowing", Vertices: []api.Point{{X: 0, Y: 0}, {X: 10, Y: 0}, {X: 10, Y: 10}}},
			{ID: 2, Category: "no_go", Type: "offline", Vertices: []api.Point{{X: 1, Y: 1}, {X: 2, Y: 2}, {X: 1, Y: 2}}},
			{ID: 3, Category: "navigation", Vertices: []api.Point{{X: 10, Y: 0}, {X: 20, Y: 0}, {X: 20, Y: 2}}},
		},
		Points:        []api.RoutePoint{{Type: "start", Point: api.Point{X: 1, Y: 1}}},
		LayerSettings: []api.LayerSetting{{ID: 1, LayerID: 2, Value: "#00ff00"}},
		GeoAnchor:     &api.GeoAnchor{Lat: 54.68, Lon: 25.28},
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
	if len(back.Zones) != 3 || back.GeoAnchor == nil || back.LayerSettings[0].Value != "#00ff00" {
		t.Errorf("round trip: %+v", back)
	}
}

func TestCheckMapNormalizesLists(t *testing.T) {
	_, stored, err := checkMap("Empty", api.MapDoc{})
	if err != nil {
		t.Fatal(err)
	}
	for _, member := range []string{`"zones":[]`, `"points":[]`, `"layer_settings":[]`, `"geo_anchor":null`} {
		if !strings.Contains(string(stored), member) {
			t.Errorf("%s lacks %s", stored, member)
		}
	}
}

func TestCheckMapRefuses(t *testing.T) {
	cases := map[string]func(*string, *api.MapDoc){
		"empty name":      func(n *string, _ *api.MapDoc) { *n = "   " },
		"long name":       func(n *string, _ *api.MapDoc) { *n = strings.Repeat("ž", MaxNameLength+1) },
		"bad category":    func(_ *string, d *api.MapDoc) { d.Zones[0].Category = "obstacle" },
		"duplicate id":    func(_ *string, d *api.MapDoc) { d.Zones[1].ID = 1 },
		"bad point type":  func(_ *string, d *api.MapDoc) { d.Points[0].Type = "middle" },
		"duplicate point": func(_ *string, d *api.MapDoc) { d.Points = append(d.Points, d.Points[0]) },
		"anchor range":    func(_ *string, d *api.MapDoc) { d.GeoAnchor.Lat = 91 },
		"long value": func(_ *string, d *api.MapDoc) {
			d.LayerSettings[0].Value = strings.Repeat("x", maxValueLength+1)
		},
		"too many vertices": func(_ *string, d *api.MapDoc) {
			d.Zones[0].Vertices = make([]api.Point, maxVertices+1)
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
	// The exact limit is fine.
	if _, _, err := checkMap(strings.Repeat("ž", MaxNameLength), validDoc()); err != nil {
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
