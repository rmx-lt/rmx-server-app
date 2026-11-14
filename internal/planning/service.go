// Package planning stores what users plan in the web app: their environments
// (each one JSON document: polygons, route points, geo anchor, layer
// settings) and their per-user settings. Every call is scoped to one user;
// another user's environment answers as if it did not exist.
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
	// MaxNameLength is the longest environment name, in characters.
	MaxNameLength = 100
	// MaxEnvironmentBytes is the largest environment request body.
	MaxEnvironmentBytes = 4 << 20
	// MaxSettingBytes is the largest setting value, as JSON.
	MaxSettingBytes = 16 << 10
	// MaxSettings is the most settings one user can have.
	MaxSettings = 100
	// maxObjects, maxVertices, maxLayerSettings and maxValueLength bound one document.
	maxObjects       = 5000
	maxVertices      = 100_000
	maxLayerSettings = 1000
	maxValueLength   = 4096
)

var settingKey = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`)

// Service is the planning domain.
type Service struct {
	pool *db.Pool
}

// New returns the service on pool.
func New(pool *db.Pool) *Service { return &Service{pool: pool} }

// ListEnvironments returns the user's environments, newest change first.
func (s *Service) ListEnvironments(ctx context.Context, userID core.UserID) ([]api.EnvironmentSummary, error) {
	list, err := listEnvironments(ctx, s.pool, userID)
	if err != nil {
		return nil, apperr.DB(err)
	}
	if list == nil {
		list = []api.EnvironmentSummary{}
	}
	return list, nil
}

// GetEnvironment returns one of the user's environments.
func (s *Service) GetEnvironment(ctx context.Context, userID core.UserID, id int64) (api.Environment, error) {
	env, err := getEnvironment(ctx, s.pool, userID, id)
	if err != nil {
		return env, storeError(err)
	}
	normalize(&env.Doc)
	return env, nil
}

// CreateEnvironment stores a new environment for the user, at revision 1.
func (s *Service) CreateEnvironment(ctx context.Context, userID core.UserID, req api.EnvironmentCreate) (api.Environment, error) {
	name, doc, err := checkEnvironment(req.Name, req.Doc)
	if err != nil {
		return api.Environment{}, err
	}
	id, revision, updated, dbErr := insertEnvironment(ctx, s.pool, userID, name, doc)
	if dbErr != nil {
		return api.Environment{}, apperr.DB(dbErr)
	}
	normalize(&req.Doc)
	return api.Environment{ID: id, Name: name, Revision: revision, UpdatedAt: updated, Doc: req.Doc}, nil
}

// UpdateEnvironment saves over one of the user's environments, if req.Revision
// is still the stored revision (else a conflict).
func (s *Service) UpdateEnvironment(ctx context.Context, userID core.UserID, id int64, req api.EnvironmentUpdate) (api.Environment, error) {
	name, doc, err := checkEnvironment(req.Name, req.Doc)
	if err != nil {
		return api.Environment{}, err
	}
	revision, updated, dbErr := updateEnvironment(ctx, s.pool, userID, id, req.Revision, name, doc)
	if dbErr != nil {
		return api.Environment{}, storeError(dbErr)
	}
	normalize(&req.Doc)
	return api.Environment{ID: id, Name: name, Revision: revision, UpdatedAt: updated, Doc: req.Doc}, nil
}

// DeleteEnvironment deletes one of the user's environments.
func (s *Service) DeleteEnvironment(ctx context.Context, userID core.UserID, id int64) error {
	if err := deleteEnvironment(ctx, s.pool, userID, id); err != nil {
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
	err := db.InTx(ctx, s.pool, func(tx db.DBTX) error {
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
	return err
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
	case errors.Is(err, errNoEnvironment):
		return apperr.NotFound("environment not found")
	case errors.Is(err, errStaleRevision):
		return apperr.Conflict("the environment was changed elsewhere; reload it")
	}
	return apperr.DB(err)
}

// checkEnvironment validates a name and document and returns the trimmed
// name and the document as stored JSON.
func checkEnvironment(name string, doc api.EnvironmentDoc) (string, []byte, error) {
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

func checkDoc(doc *api.EnvironmentDoc) error {
	if len(doc.Objects) > maxObjects {
		return apperr.BadRequest("too many objects (at most %d)", maxObjects)
	}
	ids := make(map[int64]bool, len(doc.Objects))
	vertices := 0
	for _, o := range doc.Objects {
		if o.Category != "zone" && o.Category != "obstacle" {
			return apperr.BadRequest("object %d: category must be zone or obstacle", o.ID)
		}
		if ids[o.ID] {
			return apperr.BadRequest("object id %d appears twice", o.ID)
		}
		ids[o.ID] = true
		vertices += len(o.Vertices)
	}
	if vertices > maxVertices {
		return apperr.BadRequest("too many vertices (at most %d)", maxVertices)
	}
	seen := map[api.EnvPointType]bool{}
	for _, p := range doc.Points {
		switch p.Type {
		case "start", "end", "start_end":
		default:
			return apperr.BadRequest("point type must be start, end or start_end")
		}
		if seen[p.Type] {
			return apperr.BadRequest("point %s appears twice", p.Type)
		}
		seen[p.Type] = true
	}
	if len(doc.LayerSettings) > maxLayerSettings {
		return apperr.BadRequest("too many layer settings (at most %d)", maxLayerSettings)
	}
	for _, ls := range doc.LayerSettings {
		if len(ls.Value) > maxValueLength {
			return apperr.BadRequest("layer setting %d/%d: value too long", ls.LayerID, ls.ID)
		}
	}
	if a := doc.GeoAnchor; a != nil && (a.Lat < -90 || a.Lat > 90 || a.Lon < -180 || a.Lon > 180) {
		return apperr.BadRequest("geo anchor out of range")
	}
	return nil
}

// normalize turns missing lists into empty ones, so the client always gets arrays.
func normalize(doc *api.EnvironmentDoc) {
	if doc.Objects == nil {
		doc.Objects = []api.PlanObject{}
	}
	for i := range doc.Objects {
		if doc.Objects[i].Vertices == nil {
			doc.Objects[i].Vertices = []api.Point{}
		}
	}
	if doc.Points == nil {
		doc.Points = []api.EnvPoint{}
	}
	if doc.LayerSettings == nil {
		doc.LayerSettings = []api.LayerSetting{}
	}
}
