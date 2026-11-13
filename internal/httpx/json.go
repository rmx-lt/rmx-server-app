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

// maxBody is the largest request body read; the biggest legitimate one (a
// login) is far smaller.
const maxBody = 64 << 10

// ReadJSON reads the request body into v (a struct pointer, see
// api.Unmarshal for what counts as a missing member).
func ReadJSON(w http.ResponseWriter, r *http.Request, v any) *apperr.Error {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBody))
	if err != nil {
		return apperr.BadRequest("request body could not be read (at most %d KiB)", maxBody>>10)
	}
	if err := api.Unmarshal(body, v); err != nil {
		return apperr.BadRequest("invalid request body: %v", err)
	}
	return nil
}
