package planning

import (
	"net/http"
	"strconv"

	"github.com/rmx-lt/rmx-server-app/internal/api"
	"github.com/rmx-lt/rmx-server-app/internal/apperr"
	"github.com/rmx-lt/rmx-server-app/internal/core"
	"github.com/rmx-lt/rmx-server-app/internal/httpx"
)

// Routes registers the /app/api/environments and /app/api/settings routes,
// all of them protected: the session middleware puts the user into the context.
func (s *Service) Routes(r *httpx.Router) {
	p := r.Protected()
	p.HandleFunc("GET /app/api/environments", s.handleList)
	p.HandleFunc("POST /app/api/environments", s.handleCreate)
	p.HandleFunc("GET /app/api/environments/{id}", s.handleGet)
	p.HandleFunc("PUT /app/api/environments/{id}", s.handleUpdate)
	p.HandleFunc("DELETE /app/api/environments/{id}", s.handleDelete)
	p.HandleFunc("GET /app/api/settings", s.handleSettings)
	p.HandleFunc("PUT /app/api/settings/{key}", s.handleSetSetting)
	p.HandleFunc("DELETE /app/api/settings/{key}", s.handleDeleteSetting)
}

func userID(r *http.Request) core.UserID {
	u, _ := core.UserFrom(r.Context())
	return u.UserID
}

// envID parses the {id} path value; anything but a positive number is a 404.
func envID(r *http.Request) (int64, error) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id < 1 {
		return 0, apperr.NotFound("environment not found")
	}
	return id, nil
}

func (s *Service) handleList(w http.ResponseWriter, r *http.Request) {
	list, err := s.ListEnvironments(r.Context(), userID(r))
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, api.EnvironmentList{Environments: list})
}

func (s *Service) handleCreate(w http.ResponseWriter, r *http.Request) {
	var body api.EnvironmentCreate
	if e := httpx.ReadJSONLimit(w, r, &body, MaxEnvironmentBytes); e != nil {
		httpx.WriteError(w, e)
		return
	}
	env, err := s.CreateEnvironment(r.Context(), userID(r), body)
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, env)
}

func (s *Service) handleGet(w http.ResponseWriter, r *http.Request) {
	id, err := envID(r)
	if err == nil {
		var env api.Environment
		if env, err = s.GetEnvironment(r.Context(), userID(r), id); err == nil {
			httpx.WriteJSON(w, http.StatusOK, env)
			return
		}
	}
	httpx.WriteError(w, err)
}

func (s *Service) handleUpdate(w http.ResponseWriter, r *http.Request) {
	id, err := envID(r)
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	var body api.EnvironmentUpdate
	if e := httpx.ReadJSONLimit(w, r, &body, MaxEnvironmentBytes); e != nil {
		httpx.WriteError(w, e)
		return
	}
	env, err := s.UpdateEnvironment(r.Context(), userID(r), id, body)
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, env)
}

func (s *Service) handleDelete(w http.ResponseWriter, r *http.Request) {
	id, err := envID(r)
	if err == nil {
		err = s.DeleteEnvironment(r.Context(), userID(r), id)
	}
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Service) handleSettings(w http.ResponseWriter, r *http.Request) {
	list, err := s.Settings(r.Context(), userID(r))
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, api.SettingList{Settings: list})
}

func (s *Service) handleSetSetting(w http.ResponseWriter, r *http.Request) {
	var body api.SettingValue
	if e := httpx.ReadJSON(w, r, &body); e != nil {
		httpx.WriteError(w, e)
		return
	}
	if err := s.SetSetting(r.Context(), userID(r), r.PathValue("key"), body.Value); err != nil {
		httpx.WriteError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Service) handleDeleteSetting(w http.ResponseWriter, r *http.Request) {
	if err := s.DeleteSetting(r.Context(), userID(r), r.PathValue("key")); err != nil {
		httpx.WriteError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
