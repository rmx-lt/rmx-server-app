package apperr

import (
	"errors"
	"net/http"
	"testing"

	"github.com/rmx-lt/rmx-server-app/internal/api"
)

func TestDBErrorsHideDetails(t *testing.T) {
	e := DB(errors.New("connection refused to 10.0.0.5"))
	if e.API().Code != api.CodeInternal || e.API().Message != "database error" || e.Status() != 500 {
		t.Fatalf("%+v", e.API())
	}
	if From(errors.New("secret detail")).API().Message != "internal error" {
		t.Fatal("details leaked")
	}
}

func TestStatus(t *testing.T) {
	if Unauthorized().Status() != 401 || InvalidCredentials().Status() != 401 || Forbidden("x").Status() != 403 ||
		BadRequest("x").Status() != 400 || (&Error{Code: api.CodeNotFound}).Status() != 404 {
		t.Fatal("wrong status")
	}
	if e := TooManyRequests(4); e.Status() != http.StatusTooManyRequests || e.RetryAfter != 4 {
		t.Fatalf("%+v", e)
	}
}
