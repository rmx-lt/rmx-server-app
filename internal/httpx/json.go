package httpx

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/rmx-lt/rmx-server-app/internal/api"
	"github.com/rmx-lt/rmx-server-app/internal/apperr"
)

// WriteJSON writes v as a JSON response.
func WriteJSON(w http.ResponseWriter, status int, v any) {
	body, err := json.Marshal(v)
	if err != nil {
		slog.Error("encoding a response failed", "error", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(append(body, '\n'))
}

// WriteError logs the error if it is a server failure and sends it as the response.
func WriteError(w http.ResponseWriter, err error) {
	e := apperr.From(err)
	e.Log()
	if e.RetryAfter > 0 {
		w.Header().Set("Retry-After", strconv.Itoa(e.RetryAfter))
	}
	WriteJSON(w, e.Status(), e.API())
}

// maxBody is the largest request body ReadJSON reads; most bodies (a login)
// are far smaller. Routes with bigger bodies use ReadJSONLimit.
const maxBody = 64 << 10

// ReadJSON reads the request body into v (a struct pointer, see
// api.Unmarshal for what counts as a missing member), at most 64 KiB.
func ReadJSON(w http.ResponseWriter, r *http.Request, v any) *apperr.Error {
	return ReadJSONLimit(w, r, v, maxBody)
}

// ReadJSONLimit is ReadJSON with a limit of limit bytes.
func ReadJSONLimit(w http.ResponseWriter, r *http.Request, v any, limit int64) *apperr.Error {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, limit))
	if err != nil {
		return apperr.BadRequest("request body could not be read (at most %d KiB)", limit>>10)
	}
	if err := api.Unmarshal(body, v); err != nil {
		return apperr.BadRequest("invalid request body: %v", err)
	}
	return nil
}
