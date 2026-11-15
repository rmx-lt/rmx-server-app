package mower

import (
	"net/http"
	"strconv"
	"time"

	"github.com/rmx-lt/rmx-server-app/internal/api"
	"github.com/rmx-lt/rmx-server-app/internal/apperr"
	"github.com/rmx-lt/rmx-server-app/internal/core"
	"github.com/rmx-lt/rmx-server-app/internal/httpx"
)

// Routes registers the /api/devices routes and /api/ntrip, all protected. Every user sees
// every device: devices do not belong to users yet.
func (s *Service) Routes(r *httpx.Router) {
	p := r.Protected()
	p.HandleFunc("GET /api/devices", s.handleList)
	p.HandleFunc("GET /api/devices/{name}", s.handleGet)
	p.HandleFunc("GET /api/devices/{name}/history", s.handleHistory)
	p.HandleFunc("GET /api/devices/{name}/events", s.handleEvents)
	p.HandleFunc("POST /api/devices/{name}/commands", s.handleSendCommand)
	p.HandleFunc("GET /api/devices/{name}/commands", s.handleCommands)
	p.HandleFunc("GET /api/devices/{name}/commands/{id}", s.handleCommand)
	p.HandleFunc("GET /api/devices/{name}/monitor", s.handleMonitor)
	p.HandleFunc("GET /api/ntrip", s.handleNTRIP)
}

func (s *Service) handleList(w http.ResponseWriter, r *http.Request) {
	list, err := s.Devices(r.Context())
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, list)
}

func (s *Service) handleGet(w http.ResponseWriter, r *http.Request) {
	d, err := s.Device(r.Context(), r.PathValue("name"))
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, d)
}

// handleHistory reads ?board=&metric=&from=&to=&limit=&rate= (from and to are
// RFC 3339; board and metric are required).
func (s *Service) handleHistory(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	req := api.RequestMetricHistory{Device: r.PathValue("name"), Board: api.Board(q.Get("board")), Metric: q.Get("metric")}
	var err error
	if req.From, err = queryTime(q.Get("from"), "from"); err == nil {
		if req.To, err = queryTime(q.Get("to"), "to"); err == nil {
			if v := q.Get("limit"); v != "" {
				var n int
				if n, err = strconv.Atoi(v); err != nil {
					err = apperr.BadRequest("limit must be a whole number")
				}
				req.Limit = &n
			}
		}
	}
	if err == nil {
		if v := q.Get("rate"); v != "" {
			var b bool
			if b, err = strconv.ParseBool(v); err != nil {
				err = apperr.BadRequest("rate must be true or false")
			}
			req.Rate = &b
		}
	}
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	h, err := s.History(r.Context(), req)
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, h)
}

func queryTime(v, name string) (*time.Time, error) {
	if v == "" {
		return nil, nil
	}
	t, err := time.Parse(time.RFC3339Nano, v)
	if err != nil {
		return nil, apperr.BadRequest("%s must be an RFC 3339 time", name)
	}
	return &t, nil
}

func (s *Service) handleEvents(w http.ResponseWriter, r *http.Request) {
	limit := 0
	if v := r.URL.Query().Get("limit"); v != "" {
		var err error
		if limit, err = strconv.Atoi(v); err != nil {
			httpx.WriteError(w, apperr.BadRequest("limit must be a whole number"))
			return
		}
	}
	list, err := s.Events(r.Context(), r.PathValue("name"), limit)
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, list)
}

// handleSendCommand sends a command to one of the device's boards and answers
// 202 with the command in state "sent".
func (s *Service) handleSendCommand(w http.ResponseWriter, r *http.Request) {
	var req api.CommandRequest
	if err := httpx.ReadJSON(w, r, &req); err != nil {
		httpx.WriteError(w, err)
		return
	}
	user, _ := core.UserFrom(r.Context())
	c, err := s.SendCommand(r.Context(), user, r.PathValue("name"), req)
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusAccepted, c)
}

func (s *Service) handleCommands(w http.ResponseWriter, r *http.Request) {
	limit := 0
	if v := r.URL.Query().Get("limit"); v != "" {
		var err error
		if limit, err = strconv.Atoi(v); err != nil {
			httpx.WriteError(w, apperr.BadRequest("limit must be a whole number"))
			return
		}
	}
	list, err := s.Commands(r.Context(), r.PathValue("name"), limit)
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, list)
}

func (s *Service) handleCommand(w http.ResponseWriter, r *http.Request) {
	c, err := s.Command(r.Context(), r.PathValue("name"), r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, c)
}

func (s *Service) handleMonitor(w http.ResponseWriter, r *http.Request) {
	m, err := s.Streams(r.PathValue("name"))
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, m)
}

// handleNTRIP shows the caster settings the server sends to the gateways,
// without the password.
func (s *Service) handleNTRIP(w http.ResponseWriter, r *http.Request) {
	httpx.WriteJSON(w, http.StatusOK, s.NTRIP())
}
