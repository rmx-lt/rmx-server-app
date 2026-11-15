package api

import (
	"encoding/json"
	"time"
)

// Point is a position on the canvas, in canvas units.
type Point struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// GeoAnchor binds the canvas origin (0, 0) to a WGS-84 coordinate.
type GeoAnchor struct {
	Lat float64 `json:"lat"`
	Lon float64 `json:"lon"`
}

// ZoneCategory says what the mower does in a zone: "mowing" (mow it),
// "no_go" (never enter: trees, beds, ponds) or "navigation" (drive through
// without mowing: paths between lawns, the way to the dock).
type ZoneCategory string

// Zone is one polygon of a map.
type Zone struct {
	// Unique within its map.
	ID       int64        `json:"id"`
	Category ZoneCategory `json:"category"`
	// Vertices in draw order: mowing and navigation zones clockwise, no-go
	// zones counter-clockwise (screen coordinates, y down).
	Vertices []Point `json:"vertices"`
}

// MapDoc is the content of a map: its zones and where it lies on the earth. It is saved and loaded as a whole.
type MapDoc struct {
	Zones []Zone `json:"zones"`
	// Null when the map is not placed on the earth.
	GeoAnchor *GeoAnchor `json:"geo_anchor"`
}

// MapSummary is one entry of GET /api/maps.
type MapSummary struct {
	ID       int64  `json:"id"`
	Name     string `json:"name"`
	Revision int64  `json:"revision"`
	// Counted from the document's zones, by category.
	MowingZoneCount     int       `json:"mowing_zone_count"`
	NoGoZoneCount       int       `json:"no_go_zone_count"`
	NavigationZoneCount int       `json:"navigation_zone_count"`
	UpdatedAt           time.Time `json:"updated_at"`
}

// MapList is the body of GET /api/maps, newest change first.
type MapList struct {
	Maps []MapSummary `json:"maps"`
}

// MapDetail is one map with its content: the answer to GET, POST and PUT
// on /api/maps. (Not "Map", which would shadow JavaScript's Map.)
type MapDetail struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
	// Increases by one with every save. A PUT must name the revision it read.
	Revision  int64     `json:"revision"`
	UpdatedAt time.Time `json:"updated_at"`
	Doc       MapDoc    `json:"doc"`
}

// MapCreate is the body of POST /api/maps.
type MapCreate struct {
	// 1 to 100 characters, surrounding spaces removed.
	Name string `json:"name"`
	Doc  MapDoc `json:"doc"`
}

// MapUpdate is the body of PUT /api/maps/{id}. A revision other than
// the stored one is refused with 409 (code "conflict"): someone else saved
// in between.
type MapUpdate struct {
	Name     string `json:"name"`
	Revision int64  `json:"revision"`
	Doc      MapDoc `json:"doc"`
}

// Setting is one per-user setting of the web app. Value is any JSON value.
type Setting struct {
	Key   string          `json:"key"`
	Value json.RawMessage `json:"value"`
}

// SettingList is the body of GET /api/settings.
type SettingList struct {
	Settings []Setting `json:"settings"`
}

// SettingValue is the body of PUT /api/settings/{key}.
type SettingValue struct {
	Value json.RawMessage `json:"value"`
}
