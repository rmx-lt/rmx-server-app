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

// AreaCategory says what the mower does in an area: "mowing" (mow it),
// "no_go" (never enter: trees, beds, ponds) or "navigation" (drive through
// without mowing: paths between lawns, the way to the dock).
type AreaCategory string

// Area is one polygon of a zone.
type Area struct {
	// Unique within its map.
	ID       int64        `json:"id"`
	Category AreaCategory `json:"category"`
	// Vertices in draw order: mowing and navigation areas clockwise, no-go
	// areas counter-clockwise (screen coordinates, y down).
	Vertices []Point `json:"vertices"`
}

// Zone is a named part of a map, such as "Front lawn". It owns the areas drawn in it.
type Zone struct {
	// Unique within its map.
	ID int64 `json:"id"`
	// 1 to 100 characters, surrounding spaces removed.
	Name  string `json:"name"`
	Areas []Area `json:"areas"`
}

// MapDoc is the content of a map: its zones and where it lies on the earth. It is saved and loaded as a whole.
type MapDoc struct {
	// At least one.
	Zones []Zone `json:"zones"`
	// Null when the map is not placed on the earth.
	GeoAnchor *GeoAnchor `json:"geo_anchor"`
}

// MapSummary is one entry of GET /api/maps.
type MapSummary struct {
	ID       int64  `json:"id"`
	Name     string `json:"name"`
	Revision int64  `json:"revision"`
	// Counted from the areas of all the document's zones, by category.
	MowingAreaCount     int       `json:"mowing_area_count"`
	NoGoAreaCount       int       `json:"no_go_area_count"`
	NavigationAreaCount int       `json:"navigation_area_count"`
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
