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

// ObjectCategory says what a polygon is.
type ObjectCategory string

// EnvPointType says which route point an EnvPoint is.
type EnvPointType string

// PlanObject is one polygon of an environment: a zone to mow or an obstacle.
type PlanObject struct {
	// Unique within its environment.
	ID       int64          `json:"id"`
	Category ObjectCategory `json:"category"`
	// "", "offline" or "online".
	Type string `json:"type"`
	// Vertices in draw order: zones clockwise, obstacles counter-clockwise (screen coordinates, y down).
	Vertices []Point `json:"vertices"`
}

// EnvPoint is the start, end, or combined start/end point of a route. An
// environment has at most one of each type.
type EnvPoint struct {
	Type  EnvPointType `json:"type"`
	Point Point        `json:"point"`
}

// LayerSetting is one style value of a canvas layer, for one environment.
type LayerSetting struct {
	// The setting's id within its layer (the client's layer registry).
	ID      int64  `json:"id"`
	LayerID int64  `json:"layer_id"`
	Value   string `json:"value"`
}

// EnvironmentDoc is the content of an environment: everything the web app
// draws and configures in it. It is saved and loaded as a whole.
type EnvironmentDoc struct {
	// "polygon" or "grid".
	Format string `json:"format"`
	// "offline", "online", "any_offline" or "any_online".
	Type string `json:"type"`
	// "Cartesian" or "Geographic".
	CoordSystem     string `json:"coord_system"`
	HeadlandEnabled bool   `json:"headland_enabled"`
	// Headland width as the user typed it, in the unit of measure of the UI.
	HeadlandWidth string         `json:"headland_width"`
	Objects       []PlanObject   `json:"objects"`
	Points        []EnvPoint     `json:"points"`
	LayerSettings []LayerSetting `json:"layer_settings"`
	// Null when the environment is not placed on the map.
	GeoAnchor *GeoAnchor `json:"geo_anchor"`
}

// EnvironmentSummary is one entry of GET /app/api/environments.
type EnvironmentSummary struct {
	ID       int64  `json:"id"`
	Name     string `json:"name"`
	Revision int64  `json:"revision"`
	// Counted from the document's objects.
	ZoneCount     int       `json:"zone_count"`
	ObstacleCount int       `json:"obstacle_count"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// EnvironmentList is the body of GET /app/api/environments, newest change first.
type EnvironmentList struct {
	Environments []EnvironmentSummary `json:"environments"`
}

// Environment is one environment with its content: the answer to GET, POST
// and PUT on /app/api/environments.
type Environment struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
	// Increases by one with every save. A PUT must name the revision it read.
	Revision  int64          `json:"revision"`
	UpdatedAt time.Time      `json:"updated_at"`
	Doc       EnvironmentDoc `json:"doc"`
}

// EnvironmentCreate is the body of POST /app/api/environments.
type EnvironmentCreate struct {
	// 1 to 100 characters, surrounding spaces removed.
	Name string         `json:"name"`
	Doc  EnvironmentDoc `json:"doc"`
}

// EnvironmentUpdate is the body of PUT /app/api/environments/{id}. A
// revision other than the stored one is refused with 409 (code "conflict"):
// someone else saved in between.
type EnvironmentUpdate struct {
	Name     string         `json:"name"`
	Revision int64          `json:"revision"`
	Doc      EnvironmentDoc `json:"doc"`
}

// Setting is one per-user setting of the web app. Value is any JSON value.
type Setting struct {
	Key   string          `json:"key"`
	Value json.RawMessage `json:"value"`
}

// SettingList is the body of GET /app/api/settings.
type SettingList struct {
	Settings []Setting `json:"settings"`
}

// SettingValue is the body of PUT /app/api/settings/{key}.
type SettingValue struct {
	Value json.RawMessage `json:"value"`
}
