package apperr

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/rmx-lt/rmx-backend-probe/internal/protocol"
)

func TestDBErrorsHideDetails(t *testing.T) {
	e := DB(errors.New("connection refused to 10.0.0.5"))
	if e.API().Code != protocol.CodeInternal || e.API().Message != "database error" || e.Status() != 500 {
		t.Fatalf("%+v", e.API())
	}
	if From(errors.New("secret detail")).API().Message != "internal error" {
		t.Fatal("details leaked")
	}
}

func TestStatusAndRetryAfter(t *testing.T) {
	if Unauthorized().Status() != 401 || InvalidCredentials().Status() != 401 || Forbidden("x").Status() != 403 ||
		BadRequest("x").Status() != 400 || (&Error{Code: protocol.CodeNotFound}).Status() != 404 {
		t.Fatal("wrong status")
	}
	rec := httptest.NewRecorder()
	Write(rec, TooManyRequests(4))
	if rec.Code != http.StatusTooManyRequests || rec.Header().Get("Retry-After") != "4" {
		t.Fatalf("%d %v", rec.Code, rec.Header())
	}
}
