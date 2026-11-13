// Package auth is the login with server-side sessions.
//
//   - Users live in the users table, with an Argon2id password hash. There is
//     no sign-up: users are created on the server with
//     `rmx-server create-user <name>` (see CreateUser).
//   - Login (POST /app/api/auth/login) checks the password and creates a row
//     in sessions. The browser gets a random 256-bit token in an HttpOnly
//     cookie; the database keeps only its SHA-256.
//   - Every protected request (REST and the WebSocket handshake) sends the
//     cookie automatically; RequireSession looks the hash up and checks both
//     timeouts.
//   - Logout deletes the row, so the cookie is worthless from then on, even if
//     someone copied it. "Log out everywhere" deletes all of a user's rows.
//
// Files: service.go (this), store.go (all SQL; owns the users and sessions
// tables), http.go (routes, session middleware, Origin check), and the
// password, token and rate-limit helpers.
//
// Why sessions in a cookie, and not basic auth or a token in JavaScript:
//   - Basic auth has no logout, sends the password with every request, and iOS
//     WebKit doesn't send it on WebSocket handshakes. Cookies are sent there.
//   - A token kept by JavaScript (localStorage, e.g. a JWT) can be stolen by
//     any script that runs on the page (an XSS bug, a bad dependency). An
//     HttpOnly cookie can't be read by scripts at all.
//   - A session row in the database can be revoked at once (logout, password
//     change). A signed stateless token stays valid until it expires.
package auth

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/netip"
	"sync"
	"time"

	"github.com/rmx-lt/rmx-server-app/internal/apperr"
	"github.com/rmx-lt/rmx-server-app/internal/core"
	"github.com/rmx-lt/rmx-server-app/internal/db"
)

const (
	// IdleTimeout: a session not used for this long ends.
	IdleTimeout = 7 * 24 * time.Hour
	// AbsoluteTimeout: every session ends this long after login, however active.
	AbsoluteTimeout = 30 * 24 * time.Hour
	// touchAfter: last_seen_at is written at most this often per session, not on every request.
	touchAfter = 60 * time.Second

	// parallelHashes: password checks running at once. Each one needs 19 MiB,
	// and the app container has a 64 MB memory limit; more logins at the same moment
	// wait their turn.
	parallelHashes = 1
	// hashQueueTimeout: a login that can't start its password check within
	// this time gets 429.
	hashQueueTimeout = 10 * time.Second
)

// CurrentUser is the user behind a request (core.CurrentUser), put into the
// request context by RequireSession.
type CurrentUser = core.CurrentUser

// Service does login, session lookup and logout.
type Service struct {
	pool *db.Pool

	mu         sync.Mutex // protects the limiters
	byUsername *limiter
	byIP       *limiter

	hashing chan struct{}
}

// New returns a Service on the pool.
func New(pool *db.Pool) *Service {
	return &Service{
		pool:       pool,
		byUsername: newLimiter(perUsername),
		byIP:       newLimiter(perIP),
		hashing:    make(chan struct{}, parallelHashes),
	}
}

// Login checks the password and starts a new session.
func (s *Service) Login(ctx context.Context, username, password string, ip netip.Addr, userAgent string) (SessionToken, CurrentUser, error) {
	username = NormalizeUsername(username)
	ipKey := ip.String()
	if err := s.checkLimits(username, ipKey); err != nil {
		return "", CurrentUser{}, err
	}

	var userID core.UserID
	var phc string
	known := false
	if CheckUsername(username) == nil && len([]rune(password)) <= MaxPasswordChars {
		var err error
		if userID, phc, known, err = findLogin(ctx, s.pool, username); err != nil {
			return "", CurrentUser{}, apperr.DB(err)
		}
	}
	valid, err := s.verify(ctx, password, phc)
	if err != nil {
		return "", CurrentUser{}, err
	}
	ok := valid && known

	now := time.Now()
	s.mu.Lock()
	if ok {
		s.byUsername.success(username)
		s.byIP.success(ipKey)
	} else {
		s.byUsername.failure(username, now)
		s.byIP.failure(ipKey, now)
	}
	s.mu.Unlock()
	if !ok {
		return "", CurrentUser{}, apperr.InvalidCredentials()
	}

	token := NewToken()
	hash := token.Hash()
	var ua *string
	if userAgent != "" {
		u := truncateRunes(userAgent, 200)
		ua = &u
	}
	if err := insertSession(ctx, s.pool, hash, userID, AbsoluteTimeout, ua); err != nil {
		return "", CurrentUser{}, apperr.DB(err)
	}
	return token, CurrentUser{UserID: userID, Username: username, SessionHash: hash}, nil
}

func truncateRunes(s string, n int) string {
	if r := []rune(s); len(r) > n {
		return string(r[:n])
	}
	return s
}

func (s *Service) checkLimits(username, ipKey string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	wait := max(s.byUsername.check(username, now), s.byIP.check(ipKey, now))
	if wait <= 0 {
		return nil
	}
	secs := int(wait.Seconds())
	if time.Duration(secs)*time.Second < wait {
		secs++
	}
	return apperr.TooManyRequests(max(secs, 1))
}

// verify runs the slow Argon2 check, one at a time. Without a stored hash
// (unknown user) it checks against a dummy hash, so that takes just as long,
// and returns false.
func (s *Service) verify(ctx context.Context, password, phc string) (bool, error) {
	timer := time.NewTimer(hashQueueTimeout)
	defer timer.Stop()
	select {
	case s.hashing <- struct{}{}:
	case <-timer.C:
		return false, apperr.TooManyRequests(1)
	case <-ctx.Done():
		return false, apperr.Internal(ctx.Err())
	}
	defer func() { <-s.hashing }()
	if phc == "" {
		phc = DummyHash()
	}
	return Verify(password, phc), nil
}

// Validate returns the user of a valid session, or nil if it doesn't exist,
// has been idle too long or is past its absolute timeout. With touch, this
// counts as activity (moves the idle timeout).
func (s *Service) Validate(ctx context.Context, sessionHash []byte, touch bool) (*CurrentUser, error) {
	user, stale, err := findSession(ctx, s.pool, sessionHash, IdleTimeout, touchAfter)
	if err != nil || user == nil {
		return nil, err
	}
	if touch && stale {
		if err := touchSession(ctx, s.pool, sessionHash); err != nil {
			return nil, err
		}
	}
	return user, nil
}

// SessionValid reports whether user's session is still valid, without
// counting as activity (the WebSocket asks this with every keep-alive ping).
func (s *Service) SessionValid(ctx context.Context, user CurrentUser) bool {
	u, err := s.Validate(ctx, user.SessionHash, false)
	return err == nil && u != nil
}

// Logout ends one session.
func (s *Service) Logout(ctx context.Context, sessionHash []byte) error {
	return deleteSession(ctx, s.pool, sessionHash)
}

// LogoutEverywhere ends every session of the user (all browsers and devices).
func (s *Service) LogoutEverywhere(ctx context.Context, userID core.UserID) (int64, error) {
	return deleteUserSessions(ctx, s.pool, userID)
}

// DeleteExpired deletes sessions past either timeout. They are already
// rejected; this only keeps the table small. Runs every hour.
func (s *Service) DeleteExpired(ctx context.Context) (int64, error) {
	return deleteExpiredSessions(ctx, s.pool, IdleTimeout)
}

// DeleteExpiredHourly runs DeleteExpired once an hour until ctx ends.
func (s *Service) DeleteExpiredHourly(ctx context.Context) {
	tick := time.NewTicker(time.Hour)
	defer tick.Stop()
	for {
		select {
		case <-tick.C:
			n, err := s.DeleteExpired(ctx)
			if err != nil {
				slog.Warn("deleting expired sessions failed", "error", err)
			} else if n > 0 {
				slog.Info("deleted expired sessions", "sessions", n)
			}
		case <-ctx.Done():
			return
		}
	}
}

// ---- User management (the `rmx-server create-user` etc. commands) ---------

// CreateUser creates a user. It fails if the name is taken or the password too short.
func CreateUser(ctx context.Context, pool *db.Pool, username, password string) error {
	username = NormalizeUsername(username)
	if err := CheckUsername(username); err != nil {
		return err
	}
	if err := CheckPassword(password); err != nil {
		return err
	}
	phc, err := Hash(password)
	if err != nil {
		return err
	}
	err = insertUser(ctx, pool, username, phc)
	if errors.Is(err, errUserExists) {
		return fmt.Errorf("user %s already exists (use set-password to change the password)", username)
	}
	if err != nil {
		return fmt.Errorf("creating the user failed: %w", err)
	}
	return nil
}

// SetPassword sets a new password and ends all of the user's sessions.
func SetPassword(ctx context.Context, pool *db.Pool, username, password string) error {
	username = NormalizeUsername(username)
	if err := CheckPassword(password); err != nil {
		return err
	}
	phc, err := Hash(password)
	if err != nil {
		return err
	}
	return db.InTx(ctx, pool, func(tx db.DBTX) error {
		id, err := updatePassword(ctx, tx, username, phc)
		if errors.Is(err, errNoUser) {
			return fmt.Errorf("no user %s", username)
		}
		if err != nil {
			return err
		}
		_, err = deleteUserSessions(ctx, tx, id)
		return err
	})
}

// DeleteUser deletes a user and (by the foreign key) all their sessions.
func DeleteUser(ctx context.Context, pool *db.Pool, username string) error {
	username = NormalizeUsername(username)
	err := deleteUser(ctx, pool, username)
	if errors.Is(err, errNoUser) {
		return fmt.Errorf("no user %s", username)
	}
	return err
}
