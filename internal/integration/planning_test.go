//go:build integration

// The planning domain: maps and settings over REST, per user.
//
// Covers: planning

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

func planDoc() api.MapDoc {
	return api.MapDoc{
		Zones: []api.Zone{{ID: 1, Name: "Zone 1", Areas: []api.Area{
			{ID: 1, Category: "mowing", Vertices: []api.Point{{X: 0, Y: 0}, {X: 10, Y: 0}, {X: 10, Y: 10}}},
			{ID: 2, Category: "mowing", Vertices: []api.Point{{X: 20, Y: 0}, {X: 30, Y: 0}, {X: 30, Y: 10}}},
			{ID: 3, Category: "no_go", Vertices: []api.Point{{X: 1, Y: 1}, {X: 2, Y: 2}, {X: 1, Y: 2}}},
			{ID: 4, Category: "navigation", Vertices: []api.Point{{X: 10, Y: 0}, {X: 20, Y: 0}, {X: 20, Y: 2}}},
		}}},
		GeoAnchor: &api.GeoAnchor{Lat: 54.68, Lon: 25.28},
	}
}

func TestMapLifecycle(t *testing.T) {
	t.Parallel()
	app := startApp(t, newDatabase(t))

	// Nobody has anything yet; the list is an empty array, not null.
	status, _, body := app.req(app.http, "GET", "/api/maps", nil)
	eq(t, status, 200)
	eq(t, strings.TrimSpace(string(body)), `{"maps":[]}`)

	// Create.
	status, _, body = app.req(app.http, "POST", "/api/maps", api.MapCreate{Name: " Garden ", Doc: planDoc()})
	eq(t, status, 201)
	created := decode[api.MapDetail](t, body)
	eq(t, created.Name, "Garden")
	eq(t, created.Revision, int64(1))
	if created.ID < 1 {
		t.Fatal(created.ID)
	}
	path := fmt.Sprintf("/api/maps/%d", created.ID)

	// Read it back: the same document.
	status, _, body = app.req(app.http, "GET", path, nil)
	eq(t, status, 200)
	got := decode[api.MapDetail](t, body)
	want, _ := json.Marshal(planDoc())
	have, _ := json.Marshal(got.Doc)
	eq(t, string(have), string(want))

	// The list counts the areas by category.
	status, _, body = app.req(app.http, "GET", "/api/maps", nil)
	eq(t, status, 200)
	list := decode[api.MapList](t, body)
	eq(t, len(list.Maps), 1)
	eq(t, list.Maps[0].MowingAreaCount, 2)
	eq(t, list.Maps[0].NoGoAreaCount, 1)
	eq(t, list.Maps[0].NavigationAreaCount, 1)

	// Update from revision 1 to 2.
	doc := planDoc()
	doc.Zones[0].Areas = doc.Zones[0].Areas[:1]
	status, _, body = app.req(app.http, "PUT", path, api.MapUpdate{Name: "Front garden", Revision: 1, Doc: doc})
	eq(t, status, 200)
	updated := decode[api.MapDetail](t, body)
	eq(t, updated.Revision, int64(2))
	eq(t, updated.Name, "Front garden")

	// A second save from revision 1 (another browser, still on the old copy) is a conflict.
	status, _, body = app.req(app.http, "PUT", path, api.MapUpdate{Name: "Stale", Revision: 1, Doc: planDoc()})
	eq(t, status, 409)
	eq(t, decode[api.ApiError](t, body).Code, api.CodeConflict)
	status, _, body = app.req(app.http, "GET", path, nil)
	eq(t, status, 200)
	eq(t, decode[api.MapDetail](t, body).Name, "Front garden")

	// Invalid input is a 400 and changes nothing.
	bad := planDoc()
	bad.Zones[0].Areas[0].Category = "obstacle"
	eq(t, app.status(app.http, "PUT", path, api.MapUpdate{Name: "x", Revision: 2, Doc: bad}), 400)
	eq(t, app.status(app.http, "POST", "/api/maps", map[string]any{"name": "no doc"}), 400)
	eq(t, app.status(app.http, "GET", "/api/maps/abc", nil), 404)
	eq(t, app.status(app.http, "GET", "/api/maps/999999", nil), 404)

	// Delete.
	eq(t, app.status(app.http, "DELETE", path, nil), 204)
	eq(t, app.status(app.http, "GET", path, nil), 404)
	eq(t, app.status(app.http, "DELETE", path, nil), 404)
}

func TestMapsArePerUser(t *testing.T) {
	t.Parallel()
	pool := newDatabase(t)
	app := startApp(t, pool)
	status, _, body := app.req(app.http, "POST", "/api/maps", api.MapCreate{Name: "Mine", Doc: planDoc()})
	eq(t, status, 201)
	path := fmt.Sprintf("/api/maps/%d", decode[api.MapDetail](t, body).ID)

	if err := auth.CreateUser(context.Background(), pool, "other", password); err != nil {
		t.Fatal(err)
	}
	res := app.loginAs(client("", origin), "other", password)
	eq(t, res.StatusCode, 200)
	other := client(sessionCookie(t, res), origin)
	res.Body.Close()

	// The other user sees nothing, and can't read, change or delete it.
	_, _, body = app.req(other, "GET", "/api/maps", nil)
	eq(t, len(decode[api.MapList](t, body).Maps), 0)
	eq(t, app.status(other, "GET", path, nil), 404)
	eq(t, app.status(other, "PUT", path, api.MapUpdate{Name: "Theirs", Revision: 1, Doc: planDoc()}), 404)
	eq(t, app.status(other, "DELETE", path, nil), 404)
	eq(t, app.status(app.http, "GET", path, nil), 200)

	// Without a session there is nothing at all.
	eq(t, app.status(app.anon, "GET", "/api/maps", nil), 401)
	eq(t, app.status(client("", origin), "POST", "/api/maps", api.MapCreate{Name: "x", Doc: planDoc()}), 401)

	// Deleting the user deletes their maps.
	if err := auth.DeleteUser(context.Background(), pool, user); err != nil {
		t.Fatal(err)
	}
	eq(t, count(t, pool, "maps"), 0)
}

func TestSettings(t *testing.T) {
	t.Parallel()
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
