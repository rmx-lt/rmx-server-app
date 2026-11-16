// Package planning stores what users plan in the web app: their maps (each
// one JSON document: zones with their mowing, no-go and navigation areas, geo anchor) and their per-user settings. Every call is scoped
// to one user; another user's map answers as if it did not exist.
package planning

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/rmx-lt/rmx-server-app/internal/api"
	"github.com/rmx-lt/rmx-server-app/internal/apperr"
	"github.com/rmx-lt/rmx-server-app/internal/core"
	"github.com/rmx-lt/rmx-server-app/internal/db"
)

// Limits on what a user can store.
const (
	// MaxNameLength is the longest map name, in characters.
	MaxNameLength = 100
	// MaxMapBytes is the largest map request body.
	MaxMapBytes = 4 << 20
	// MaxSettingBytes is the largest setting value, as JSON.
	MaxSettingBytes = 16 << 10
	// MaxSettings is the most settings one user can have.
	MaxSettings = 100
	// maxAreas and maxVertices bound one document.
	maxAreas    = 5000
	maxVertices = 100_000
)

var settingKey = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`)

// Service is the planning domain.
type Service struct {
	pool *db.Pool
}

// New returns the service on pool.
func New(pool *db.Pool) *Service { return &Service{pool: pool} }

// ListMaps returns the user's maps, newest change first.
func (s *Service) ListMaps(ctx context.Context, userID core.UserID) ([]api.MapSummary, error) {
	list, err := listMaps(ctx, s.pool, userID)
	if err != nil {
		return nil, apperr.DB(err)
	}
	if list == nil {
		list = []api.MapSummary{}
	}
	return list, nil
}

// GetMap returns one of the user's maps.
func (s *Service) GetMap(ctx context.Context, userID core.UserID, id int64) (api.MapDetail, error) {
	m, err := getMap(ctx, s.pool, userID, id)
	if err != nil {
		return m, storeError(err)
	}
	normalize(&m.Doc)
	return m, nil
}

// CreateMap stores a new map for the user, at revision 1.
func (s *Service) CreateMap(ctx context.Context, userID core.UserID, req api.MapCreate) (api.MapDetail, error) {
	name, doc, err := checkMap(req.Name, req.Doc)
	if err != nil {
		return api.MapDetail{}, err
	}
	id, revision, updated, dbErr := insertMap(ctx, s.pool, userID, name, doc)
	if dbErr != nil {
		return api.MapDetail{}, apperr.DB(dbErr)
	}
	normalize(&req.Doc)
	return api.MapDetail{ID: id, Name: name, Revision: revision, UpdatedAt: updated, Doc: req.Doc}, nil
}

// UpdateMap saves over one of the user's maps, if req.Revision is still the
// stored revision (else a conflict).
func (s *Service) UpdateMap(ctx context.Context, userID core.UserID, id int64, req api.MapUpdate) (api.MapDetail, error) {
	name, doc, err := checkMap(req.Name, req.Doc)
	if err != nil {
		return api.MapDetail{}, err
	}
	revision, updated, dbErr := updateMap(ctx, s.pool, userID, id, req.Revision, name, doc)
	if dbErr != nil {
		return api.MapDetail{}, storeError(dbErr)
	}
	normalize(&req.Doc)
	return api.MapDetail{ID: id, Name: name, Revision: revision, UpdatedAt: updated, Doc: req.Doc}, nil
}

// DeleteMap deletes one of the user's maps.
func (s *Service) DeleteMap(ctx context.Context, userID core.UserID, id int64) error {
	if err := deleteMap(ctx, s.pool, userID, id); err != nil {
		return storeError(err)
	}
	return nil
}

// Settings returns all of the user's settings, by key.
func (s *Service) Settings(ctx context.Context, userID core.UserID) ([]api.Setting, error) {
	list, err := listSettings(ctx, s.pool, userID)
	if err != nil {
		return nil, apperr.DB(err)
	}
	if list == nil {
		list = []api.Setting{}
	}
	return list, nil
}

// SetSetting stores value (any JSON value but null) under key.
func (s *Service) SetSetting(ctx context.Context, userID core.UserID, key string, value json.RawMessage) error {
	if !settingKey.MatchString(key) {
		return apperr.BadRequest("invalid setting key")
	}
	if len(value) > MaxSettingBytes {
		return apperr.BadRequest("setting value too large (at most %d KiB)", MaxSettingBytes>>10)
	}
	return db.InTx(ctx, s.pool, func(tx db.DBTX) error {
		n, err := countSettings(ctx, tx, userID, key)
		if err != nil {
			return apperr.DB(err)
		}
		if n >= MaxSettings {
			return apperr.BadRequest("too many settings (at most %d)", MaxSettings)
		}
		if err := upsertSetting(ctx, tx, userID, key, value); err != nil {
			return apperr.DB(err)
		}
		return nil
	})
}

// DeleteSetting removes key; removing a key that is not set is fine.
func (s *Service) DeleteSetting(ctx context.Context, userID core.UserID, key string) error {
	if !settingKey.MatchString(key) {
		return apperr.BadRequest("invalid setting key")
	}
	if err := deleteSetting(ctx, s.pool, userID, key); err != nil {
		return apperr.DB(err)
	}
	return nil
}

func storeError(err error) error {
	switch {
	case errors.Is(err, errNoMap):
		return apperr.NotFound("map not found")
	case errors.Is(err, errStaleRevision):
		return apperr.Conflict("the map was changed elsewhere; reload it")
	}
	return apperr.DB(err)
}

// checkMap validates a name and document and returns the trimmed name and
// the document as stored JSON.
func checkMap(name string, doc api.MapDoc) (string, []byte, error) {
	name = strings.TrimSpace(name)
	if name == "" || utf8.RuneCountInString(name) > MaxNameLength {
		return "", nil, apperr.BadRequest("name must be 1 to %d characters", MaxNameLength)
	}
	if err := checkDoc(&doc); err != nil {
		return "", nil, err
	}
	normalize(&doc)
	stored, err := json.Marshal(doc)
	if err != nil {
		return "", nil, apperr.Internal(err)
	}
	return name, stored, nil
}

func checkDoc(doc *api.MapDoc) error {
	if len(doc.Zones) == 0 {
		return apperr.BadRequest("a map needs at least one zone")
	}
	zoneIDs := make(map[int64]bool, len(doc.Zones))
	areaIDs := map[int64]bool{}
	vertices := 0
	for _, z := range doc.Zones {
		if n := strings.TrimSpace(z.Name); n == "" || utf8.RuneCountInString(n) > MaxNameLength {
			return apperr.BadRequest("zone %d: name must be 1 to %d characters", z.ID, MaxNameLength)
		}
		if zoneIDs[z.ID] {
			return apperr.BadRequest("zone id %d appears twice", z.ID)
		}
		zoneIDs[z.ID] = true
		if len(areaIDs)+len(z.Areas) > maxAreas {
			return apperr.BadRequest("too many areas (at most %d)", maxAreas)
		}
		for _, a := range z.Areas {
			switch a.Category {
			case "mowing", "no_go", "navigation":
			default:
				return apperr.BadRequest("area %d: category must be mowing, no_go or navigation", a.ID)
			}
			if areaIDs[a.ID] {
				return apperr.BadRequest("area id %d appears twice", a.ID)
			}
			areaIDs[a.ID] = true
			vertices += len(a.Vertices)
		}
	}
	if vertices > maxVertices {
		return apperr.BadRequest("too many vertices (at most %d)", maxVertices)
	}
	if a := doc.GeoAnchor; a != nil && (a.Lat < -90 || a.Lat > 90 || a.Lon < -180 || a.Lon > 180) {
		return apperr.BadRequest("geo anchor out of range")
	}
	return nil
}

// normalize turns missing lists into empty ones, so the client always gets arrays,
// and trims the zone names like the map name.
func normalize(doc *api.MapDoc) {
	for i := range doc.Zones {
		z := &doc.Zones[i]
		z.Name = strings.TrimSpace(z.Name)
		if z.Areas == nil {
			z.Areas = []api.Area{}
		}
		for j := range z.Areas {
			if z.Areas[j].Vertices == nil {
				z.Areas[j].Vertices = []api.Point{}
			}
		}
	}
}
