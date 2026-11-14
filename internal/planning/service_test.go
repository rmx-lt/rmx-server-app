package planning

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/rmx-lt/rmx-server-app/internal/api"
	"github.com/rmx-lt/rmx-server-app/internal/apperr"
)

func validDoc() api.EnvironmentDoc {
	return api.EnvironmentDoc{
		Format: "polygon", Type: "any_offline", CoordSystem: "Cartesian",
		HeadlandEnabled: true, HeadlandWidth: "10",
		Objects: []api.PlanObject{
			{ID: 1, Category: "zone", Vertices: []api.Point{{X: 0, Y: 0}, {X: 10, Y: 0}, {X: 10, Y: 10}}},
			{ID: 2, Category: "obstacle", Type: "offline", Vertices: []api.Point{{X: 1, Y: 1}, {X: 2, Y: 2}, {X: 1, Y: 2}}},
		},
		Points:        []api.EnvPoint{{Type: "start", Point: api.Point{X: 1, Y: 1}}},
		LayerSettings: []api.LayerSetting{{ID: 1, LayerID: 2, Value: "#00ff00"}},
		GeoAnchor:     &api.GeoAnchor{Lat: 54.68, Lon: 25.28},
	}
}

func TestCheckEnvironmentAccepts(t *testing.T) {
	name, stored, err := checkEnvironment("  Garden  ", validDoc())
	if err != nil {
		t.Fatal(err)
	}
	if name != "Garden" {
		t.Errorf("name %q", name)
	}
	var back api.EnvironmentDoc
	if err := json.Unmarshal(stored, &back); err != nil {
		t.Fatal(err)
	}
	if len(back.Objects) != 2 || back.GeoAnchor == nil || back.LayerSettings[0].Value != "#00ff00" {
		t.Errorf("round trip: %+v", back)
	}
}

func TestCheckEnvironmentNormalizesLists(t *testing.T) {
	_, stored, err := checkEnvironment("Empty", api.EnvironmentDoc{})
	if err != nil {
		t.Fatal(err)
	}
	for _, member := range []string{`"objects":[]`, `"points":[]`, `"layer_settings":[]`, `"geo_anchor":null`} {
		if !strings.Contains(string(stored), member) {
			t.Errorf("%s lacks %s", stored, member)
		}
	}
}

func TestCheckEnvironmentRefuses(t *testing.T) {
	cases := map[string]func(*string, *api.EnvironmentDoc){
		"empty name":      func(n *string, _ *api.EnvironmentDoc) { *n = "   " },
		"long name":       func(n *string, _ *api.EnvironmentDoc) { *n = strings.Repeat("ž", MaxNameLength+1) },
		"bad category":    func(_ *string, d *api.EnvironmentDoc) { d.Objects[0].Category = "pond" },
		"duplicate id":    func(_ *string, d *api.EnvironmentDoc) { d.Objects[1].ID = 1 },
		"bad point type":  func(_ *string, d *api.EnvironmentDoc) { d.Points[0].Type = "middle" },
		"duplicate point": func(_ *string, d *api.EnvironmentDoc) { d.Points = append(d.Points, d.Points[0]) },
		"anchor range":    func(_ *string, d *api.EnvironmentDoc) { d.GeoAnchor.Lat = 91 },
		"long value": func(_ *string, d *api.EnvironmentDoc) {
			d.LayerSettings[0].Value = strings.Repeat("x", maxValueLength+1)
		},
		"too many vertices": func(_ *string, d *api.EnvironmentDoc) {
			d.Objects[0].Vertices = make([]api.Point, maxVertices+1)
		},
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			envName, doc := "Garden", validDoc()
			mutate(&envName, &doc)
			_, _, err := checkEnvironment(envName, doc)
			var e *apperr.Error
			if !errors.As(err, &e) || e.Code != api.CodeBadRequest {
				t.Fatalf("got %v", err)
			}
		})
	}
	// The exact limit is fine.
	if _, _, err := checkEnvironment(strings.Repeat("ž", MaxNameLength), validDoc()); err != nil {
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
		errNoEnvironment:   api.CodeNotFound,
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
