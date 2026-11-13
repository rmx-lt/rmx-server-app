package auth

import (
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestHashAndVerify(t *testing.T) {
	h, err := Hash("correct horse battery")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(h, "$argon2id$v=19$m=19456,t=2,p=1$") {
		t.Fatal(h)
	}
	if !Verify("correct horse battery", h) || Verify("correct horse batterY", h) || Verify("correct horse battery", "not a hash") {
		t.Fatal("verify gave a wrong answer")
	}
	// Same password, new salt, different hash.
	if h2, _ := Hash("correct horse battery"); h == h2 {
		t.Fatal("salt is not random")
	}
	if Verify("", DummyHash()) {
		t.Fatal("dummy hash matches the empty password")
	}
}

// A hash made by another Argon2 implementation (argon2-cffi, the same
// parameters and PHC format as the Rust argon2 crate the earlier Rust version used),
// so existing users keep working.
func TestVerifiesHashesFromOtherImplementations(t *testing.T) {
	const phc = "$argon2id$v=19$m=19456,t=2,p=1$KMhcaFQ1uqiAIPzuW5DMRA$JSSEM3AjRBG1wqfeBlITkE43uPemkTOh4sYE5+pz7S4"
	if !Verify("correct horse battery", phc) {
		t.Fatal("a valid hash was refused")
	}
	if Verify("correct horse batterY", phc) {
		t.Fatal("matches the wrong password")
	}
	if Verify("x", "$argon2id$v=19$m=99999999,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$q1bb") {
		t.Fatal("accepted a hash that asks for gigabytes")
	}
}

func TestUsernameRules(t *testing.T) {
	if NormalizeUsername("  Admin ") != "admin" {
		t.Fatal()
	}
	for _, ok := range []string{"admin", "a", "user.name_1-x", strings.Repeat("a", 32)} {
		if CheckUsername(ok) != nil {
			t.Errorf("%q refused", ok)
		}
	}
	for _, bad := range []string{"", "-x", ".x", "Admin", "a b", "ž", strings.Repeat("a", 33)} {
		if CheckUsername(bad) == nil {
			t.Errorf("%q accepted", bad)
		}
	}
}

func TestPasswordRules(t *testing.T) {
	if CheckPassword("short") == nil || CheckPassword(strings.Repeat("a", 12)) != nil ||
		CheckPassword(strings.Repeat("ž", 12)) != nil || CheckPassword(strings.Repeat("a", 257)) == nil {
		t.Fatal("wrong password rules")
	}
}

func TestTokens(t *testing.T) {
	a, b := NewToken(), NewToken()
	if a == b || len(a) != 64 {
		t.Fatal(a, b)
	}
	if got, ok := ParseToken(string(a)); !ok || got != a {
		t.Fatal()
	}
	if len(a.Hash()) != 32 || strings.Contains(a.String(), string(a)) {
		t.Fatal("hash or String wrong")
	}
	for _, bad := range []string{"", strings.Repeat("a", 63), strings.Repeat("A", 64), strings.Repeat("g", 64), strings.Repeat("a", 63) + "'"} {
		if _, ok := ParseToken(bad); ok {
			t.Errorf("%q parsed", bad)
		}
	}
}

func cookies(lines ...string) http.Header {
	h := http.Header{}
	for _, l := range lines {
		h.Add("Cookie", l)
	}
	return h
}

func TestFindsTheSessionCookie(t *testing.T) {
	tok := NewToken()
	one := "other=1; " + CookieName + "=" + string(tok) + "; x=y"
	if got, st := SessionCookie(cookies(one)); st != CookieFound || got != tok {
		t.Fatal(st)
	}
	// Split over two Cookie headers (HTTP/2).
	if got, st := SessionCookie(cookies("a=b", CookieName+"="+string(tok))); st != CookieFound || got != tok {
		t.Fatal(st)
	}
	if _, st := SessionCookie(cookies()); st != CookieMissing {
		t.Fatal(st)
	}
	if _, st := SessionCookie(cookies("app_session=x")); st != CookieMissing {
		t.Fatal(st)
	}
	twice := CookieName + "=" + string(tok) + "; " + CookieName + "=" + string(tok)
	if _, st := SessionCookie(cookies(twice)); st != CookieInvalid {
		t.Fatal(st)
	}
	if _, st := SessionCookie(cookies(CookieName + "=nope")); st != CookieInvalid {
		t.Fatal(st)
	}
}

func TestCookieAttributes(t *testing.T) {
	tok := NewToken()
	set := SetCookie(tok, 60)
	if !strings.HasPrefix(set, CookieName+"="+string(tok)+";") {
		t.Fatal(set)
	}
	for _, attr := range []string{"Path=/app", "Max-Age=60", "HttpOnly", "Secure", "SameSite=Strict"} {
		if !strings.Contains(set, attr) {
			t.Errorf("%s lacks %s", set, attr)
		}
	}
	if !strings.Contains(ClearCookie(), "Max-Age=0") {
		t.Fatal(ClearCookie())
	}
}

func TestFreeFailuresThenDoublingDelay(t *testing.T) {
	const s = time.Second
	l := newLimiter(perUsername)
	t0 := time.Now()
	for range 5 {
		if l.check("u", t0) != 0 {
			t.Fatal("blocked too early")
		}
		l.failure("u", t0)
	}
	// Five failures are free.
	if l.check("u", t0) != 0 {
		t.Fatal("blocked after five failures")
	}
	l.failure("u", t0)
	if l.check("u", t0) != s || l.check("u", t0.Add(s)) != 0 {
		t.Fatal("first wait is not 1 s")
	}
	l.failure("u", t0.Add(s))
	if l.check("u", t0.Add(s)) != 2*s {
		t.Fatal("second wait is not 2 s")
	}
	l.failure("u", t0.Add(3*s))
	if l.check("u", t0.Add(3*s)) != 4*s {
		t.Fatal("third wait is not 4 s")
	}
	// Other keys are not affected.
	if l.check("other", t0) != 0 {
		t.Fatal()
	}
}

func TestDelayIsCapped(t *testing.T) {
	l := newLimiter(perUsername)
	t0 := time.Now()
	for range 100 {
		l.failure("u", t0)
	}
	if got := l.check("u", t0); got != perUsername.maxDelay {
		t.Fatal(got)
	}
}

func TestSuccessAndTimeReset(t *testing.T) {
	const s = time.Second
	l := newLimiter(perUsername)
	t0 := time.Now()
	for range 6 {
		l.failure("u", t0)
	}
	if l.check("u", t0) == 0 {
		t.Fatal()
	}
	l.success("u")
	if l.check("u", t0) != 0 {
		t.Fatal()
	}
	for range 5 {
		l.failure("v", t0)
	}
	// After forgetAfter, the count starts again: the next failure is free.
	later := t0.Add(perUsername.forgetAfter + s)
	l.failure("v", later)
	if l.check("v", later) != 0 {
		t.Fatal()
	}
}

func TestPruneDropsOnlyOldEntries(t *testing.T) {
	l := newLimiter(perUsername)
	t0 := time.Now()
	l.failure("old", t0)
	later := t0.Add(perUsername.forgetAfter + time.Second)
	l.failure("new", later)
	l.prune(later)
	if _, ok := l.entries["old"]; ok {
		t.Error("old entry kept")
	}
	if _, ok := l.entries["new"]; !ok {
		t.Error("new entry dropped")
	}
}

func TestWhichRequestsNeedAnOrigin(t *testing.T) {
	req := func(method string, hdr ...string) *http.Request {
		r, _ := http.NewRequest(method, "http://x/", nil)
		for i := 0; i+1 < len(hdr); i += 2 {
			r.Header.Set(hdr[i], hdr[i+1])
		}
		return r
	}
	for _, m := range []string{"GET", "HEAD", "OPTIONS"} {
		if needsOriginCheck(req(m)) {
			t.Errorf("%s needs an origin", m)
		}
	}
	for _, m := range []string{"POST", "PUT", "DELETE", "PATCH", "CONNECT"} {
		if !needsOriginCheck(req(m)) {
			t.Errorf("%s needs no origin", m)
		}
	}
	if !needsOriginCheck(req("GET", "Upgrade", "websocket")) {
		t.Error("a WebSocket handshake needs an origin")
	}
}

func TestOriginMustMatchExactlyOnce(t *testing.T) {
	allowed := []string{"https://api.rmx.lt"}
	hdr := func(origins ...string) http.Header {
		h := http.Header{}
		for _, o := range origins {
			h.Add("Origin", o)
		}
		return h
	}
	if !originAllowed(hdr("https://api.rmx.lt"), allowed) || !originAllowed(hdr("https://API.rmx.lt"), allowed) {
		t.Error("the allowed origin was refused")
	}
	for _, bad := range []string{
		"https://evil.example", "https://api.rmx.lt.evil.example", "http://api.rmx.lt",
		"https://rmx.lt", "https://api.rmx.lt:444", "null",
	} {
		if originAllowed(hdr(bad), allowed) {
			t.Errorf("%s accepted", bad)
		}
	}
	if originAllowed(hdr(), allowed) || originAllowed(hdr("https://api.rmx.lt", "https://api.rmx.lt"), allowed) {
		t.Error("missing or repeated Origin accepted")
	}
}
