//go:build integration

// The planning domain: environments and settings over REST, per user.

package integration

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/rmx-lt/rmx-server-app/internal/api"
	"github.com/rmx-lt/rmx-server-app/internal/auth"
)

func planDoc() api.EnvironmentDoc {
	return api.EnvironmentDoc{
		Format: "polygon", Type: "any_offline", CoordSystem: "Cartesian",
		HeadlandEnabled: true, HeadlandWidth: "10",
		Objects: []api.PlanObject{
			{ID: 1, Category: "zone", Vertices: []api.Point{{X: 0, Y: 0}, {X: 10, Y: 0}, {X: 10, Y: 10}}},
			{ID: 2, Category: "zone", Vertices: []api.Point{{X: 20, Y: 0}, {X: 30, Y: 0}, {X: 30, Y: 10}}},
			{ID: 3, Category: "obstacle", Type: "offline", Vertices: []api.Point{{X: 1, Y: 1}, {X: 2, Y: 2}, {X: 1, Y: 2}}},
		},
		Points:        []api.EnvPoint{{Type: "start_end", Point: api.Point{X: 5, Y: 5}}},
		LayerSettings: []api.LayerSetting{{ID: 1, LayerID: 2, Value: "#00ff00"}},
		GeoAnchor:     &api.GeoAnchor{Lat: 54.68, Lon: 25.28},
	}
}

func TestEnvironmentLifecycle(t *testing.T) {
	app := startApp(t, newDatabase(t))

	// Nobody has anything yet; the list is an empty array, not null.
	status, _, body := app.req(app.http, "GET", "/api/environments", nil)
	eq(t, status, 200)
	eq(t, strings.TrimSpace(string(body)), `{"environments":[]}`)

	// Create.
	status, _, body = app.req(app.http, "POST", "/api/environments", api.EnvironmentCreate{Name: " Garden ", Doc: planDoc()})
	eq(t, status, 201)
	created := decode[api.Environment](t, body)
	eq(t, created.Name, "Garden")
	eq(t, created.Revision, int64(1))
	if created.ID < 1 {
		t.Fatal(created.ID)
	}
	path := fmt.Sprintf("/api/environments/%d", created.ID)

	// Read it back: the same document.
	status, _, body = app.req(app.http, "GET", path, nil)
	eq(t, status, 200)
	got := decode[api.Environment](t, body)
	want, _ := json.Marshal(planDoc())
	have, _ := json.Marshal(got.Doc)
	eq(t, string(have), string(want))

	// The list counts zones and obstacles.
	status, _, body = app.req(app.http, "GET", "/api/environments", nil)
	eq(t, status, 200)
	list := decode[api.EnvironmentList](t, body)
	eq(t, len(list.Environments), 1)
	eq(t, list.Environments[0].ZoneCount, 2)
	eq(t, list.Environments[0].ObstacleCount, 1)

	// Update from revision 1 to 2.
	doc := planDoc()
	doc.Objects = doc.Objects[:1]
	status, _, body = app.req(app.http, "PUT", path, api.EnvironmentUpdate{Name: "Front garden", Revision: 1, Doc: doc})
	eq(t, status, 200)
	updated := decode[api.Environment](t, body)
	eq(t, updated.Revision, int64(2))
	eq(t, updated.Name, "Front garden")

	// A second save from revision 1 (another browser, still on the old copy) is a conflict.
	status, _, body = app.req(app.http, "PUT", path, api.EnvironmentUpdate{Name: "Stale", Revision: 1, Doc: planDoc()})
	eq(t, status, 409)
	eq(t, decode[api.ApiError](t, body).Code, api.CodeConflict)
	status, _, body = app.req(app.http, "GET", path, nil)
	eq(t, status, 200)
	eq(t, decode[api.Environment](t, body).Name, "Front garden")

	// Invalid input is a 400 and changes nothing.
	bad := planDoc()
	bad.Objects[0].Category = "pond"
	eq(t, app.status(app.http, "PUT", path, api.EnvironmentUpdate{Name: "x", Revision: 2, Doc: bad}), 400)
	eq(t, app.status(app.http, "POST", "/api/environments", map[string]any{"name": "no doc"}), 400)
	eq(t, app.status(app.http, "GET", "/api/environments/abc", nil), 404)
	eq(t, app.status(app.http, "GET", "/api/environments/999999", nil), 404)

	// Delete.
	eq(t, app.status(app.http, "DELETE", path, nil), 204)
	eq(t, app.status(app.http, "GET", path, nil), 404)
	eq(t, app.status(app.http, "DELETE", path, nil), 404)
}

func TestEnvironmentsArePerUser(t *testing.T) {
	pool := newDatabase(t)
	app := startApp(t, pool)
	status, _, body := app.req(app.http, "POST", "/api/environments", api.EnvironmentCreate{Name: "Mine", Doc: planDoc()})
	eq(t, status, 201)
	path := fmt.Sprintf("/api/environments/%d", decode[api.Environment](t, body).ID)

	if err := auth.CreateUser(context.Background(), pool, "other", password); err != nil {
		t.Fatal(err)
	}
	res := app.loginAs(client("", origin), "other", password)
	eq(t, res.StatusCode, 200)
	other := client(sessionCookie(t, res), origin)
	res.Body.Close()

	// The other user sees nothing, and can't read, change or delete it.
	_, _, body = app.req(other, "GET", "/api/environments", nil)
	eq(t, len(decode[api.EnvironmentList](t, body).Environments), 0)
	eq(t, app.status(other, "GET", path, nil), 404)
	eq(t, app.status(other, "PUT", path, api.EnvironmentUpdate{Name: "Theirs", Revision: 1, Doc: planDoc()}), 404)
	eq(t, app.status(other, "DELETE", path, nil), 404)
	eq(t, app.status(app.http, "GET", path, nil), 200)

	// Without a session there is nothing at all.
	eq(t, app.status(app.anon, "GET", "/api/environments", nil), 401)
	eq(t, app.status(client("", origin), "POST", "/api/environments", api.EnvironmentCreate{Name: "x", Doc: planDoc()}), 401)

	// Deleting the user deletes their environments.
	if err := auth.DeleteUser(context.Background(), pool, user); err != nil {
		t.Fatal(err)
	}
	eq(t, count(t, pool, "environments"), 0)
}

func TestSettings(t *testing.T) {
	app := startApp(t, newDatabase(t))
	status, _, body := app.req(app.http, "GET", "/api/settings", nil)
	eq(t, status, 200)
	eq(t, strings.TrimSpace(string(body)), `{"settings":[]}`)

	eq(t, app.status(app.http, "PUT", "/api/settings/ui.unitOfMeasure", api.SettingValue{Value: json.RawMessage(`"m"`)}), 204)
	eq(t, app.status(app.http, "PUT", "/api/settings/geoAnchor.default", api.SettingValue{Value: json.RawMessage(`{"lat":54.68,"lon":25.28}`)}), 204)
	eq(t, app.status(app.http, "PUT", "/api/settings/ui.unitOfMeasure", api.SettingValue{Value: json.RawMessage(`"ft"`)}), 204)

	status, _, body = app.req(app.http, "GET", "/api/settings", nil)
	eq(t, status, 200)
	settings := decode[api.SettingList](t, body).Settings
	eq(t, len(settings), 2)
	eq(t, settings[0].Key, "geoAnchor.default")
	eq(t, settings[1].Key, "ui.unitOfMeasure")
	eq(t, string(settings[1].Value), `"ft"`)

	// null, a bad key and a missing value are refused.
	eq(t, app.status(app.http, "PUT", "/api/settings/ui.x", map[string]any{"value": nil}), 400)
	eq(t, app.status(app.http, "PUT", "/api/settings/ui.x", map[string]any{}), 400)
	eq(t, app.status(app.http, "PUT", "/api/settings/.hidden", api.SettingValue{Value: json.RawMessage(`1`)}), 400)

	eq(t, app.status(app.http, "DELETE", "/api/settings/ui.unitOfMeasure", nil), 204)
	eq(t, app.status(app.http, "DELETE", "/api/settings/ui.unitOfMeasure", nil), 204)
	_, _, body = app.req(app.http, "GET", "/api/settings", nil)
	eq(t, len(decode[api.SettingList](t, body).Settings), 1)
}
