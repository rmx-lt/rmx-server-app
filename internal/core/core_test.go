package core

import (
	"context"
	"strings"
	"testing"
)

func TestParseDeviceID(t *testing.T) {
	for _, ok := range []string{"mower-01", "a", "A_b-9", strings.Repeat("a", 64)} {
		if id, valid := ParseDeviceID(ok); !valid || string(id) != ok {
			t.Errorf("rejected %q", ok)
		}
	}
	for _, bad := range []string{"", "status", "a+b", "a/b", "a b", strings.Repeat("a", 65)} {
		if _, valid := ParseDeviceID(bad); valid {
			t.Errorf("accepted %q", bad)
		}
	}
}

func TestUserInContext(t *testing.T) {
	if _, ok := UserFrom(context.Background()); ok {
		t.Fatal("user in an empty context")
	}
	u, ok := UserFrom(WithUser(context.Background(), CurrentUser{UserID: 7, Username: "a"}))
	if !ok || u.UserID != 7 || u.Username != "a" {
		t.Fatalf("%+v %v", u, ok)
	}
}
