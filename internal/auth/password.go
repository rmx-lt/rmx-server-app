package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"strings"
	"sync"
	"unicode/utf8"

	"golang.org/x/crypto/argon2"
)

// Password hashing with Argon2id, and the rules for usernames and passwords.
//
// Argon2id is the current recommendation (OWASP, RFC 9106) for storing
// passwords: it is deliberately slow and needs a lot of memory per guess, so a
// stolen hash is very expensive to brute-force, even on GPUs. New hashes use
// OWASP's minimum: 19 MiB, 2 passes, 1 lane. Each hash gets its own random
// salt, and the result is a PHC string
// ($argon2id$v=19$m=19456,t=2,p=1$salt$hash) that records the parameters, so
// they can be raised later without breaking existing hashes. The strings are
// the same format the earlier Rust version of this server wrote, so its users keep working.
const (
	MinPasswordChars = 12
	// MaxPasswordChars: longer input is refused before hashing, so nobody can
	// make us hash megabytes.
	MaxPasswordChars = 256

	memoryKiB = 19456
	passes    = 2
	lanes     = 1
	saltLen   = 16
	keyLen    = 32
)

var b64 = base64.RawStdEncoding

// Hash hashes a new password (slow: tens of milliseconds and 19 MiB of memory).
func Hash(password string) (string, error) {
	salt := make([]byte, saltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("the OS random number generator failed: %w", err)
	}
	key := argon2.IDKey([]byte(password), salt, passes, memoryKiB, lanes, keyLen)
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, memoryKiB, passes, lanes, b64.EncodeToString(salt), b64.EncodeToString(key)), nil
}

// Verify checks password against a stored PHC string. A wrong password and a
// corrupt hash are both simply false.
func Verify(password, phc string) bool {
	// $argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>
	parts := strings.Split(phc, "$")
	if len(parts) != 6 || parts[0] != "" || parts[1] != "argon2id" {
		return false
	}
	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil || version != argon2.Version {
		return false
	}
	var memory, time uint32
	var threads uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &memory, &time, &threads); err != nil {
		return false
	}
	// Refuse parameters that would let a corrupt row exhaust the server.
	if memory == 0 || memory > 1<<20 || time == 0 || time > 20 || threads == 0 {
		return false
	}
	salt, err := b64.DecodeString(parts[4])
	if err != nil {
		return false
	}
	want, err := b64.DecodeString(parts[5])
	if err != nil || len(want) == 0 {
		return false
	}
	got := argon2.IDKey([]byte(password), salt, time, memory, threads, uint32(len(want)))
	return subtle.ConstantTimeCompare(got, want) == 1
}

var (
	dummyOnce sync.Once
	dummy     string
)

// DummyHash is a hash of a random password nobody knows. Logins for unknown
// usernames are checked against it, so they take as long as real ones and the
// response time doesn't reveal which usernames exist.
func DummyHash() string {
	dummyOnce.Do(func() {
		random := make([]byte, 16)
		if _, err := rand.Read(random); err != nil {
			panic(err)
		}
		h, err := Hash(fmt.Sprintf("%x", random))
		if err != nil {
			panic(err)
		}
		dummy = h
	})
	return dummy
}

// NormalizeUsername: usernames are case-insensitive, stored and compared in lower case.
func NormalizeUsername(name string) string {
	return strings.ToLower(strings.TrimSpace(name))
}

// CheckUsername wants 1 to 32 characters: a-z, 0-9, '.', '_', '-', starting
// with a letter or digit (the same rule as the database's CHECK constraint).
func CheckUsername(name string) error {
	ok := len(name) >= 1 && len(name) <= 32 && isAlnum(name[0])
	for i := 0; ok && i < len(name); i++ {
		c := name[i]
		ok = isAlnum(c) || c == '.' || c == '_' || c == '-'
	}
	if !ok {
		return fmt.Errorf("username must be 1-32 characters: a-z, 0-9, '.', '_' or '-', starting with a letter or digit")
	}
	return nil
}

func isAlnum(c byte) bool { return c >= 'a' && c <= 'z' || c >= '0' && c <= '9' }

// CheckPassword: length is what matters most (NIST SP 800-63B): at least 12
// characters, no composition rules. Use a password manager or a few random words.
func CheckPassword(password string) error {
	n := utf8.RuneCountInString(password)
	switch {
	case n < MinPasswordChars:
		return fmt.Errorf("password must be at least %d characters", MinPasswordChars)
	case n > MaxPasswordChars:
		return fmt.Errorf("password must be at most %d characters", MaxPasswordChars)
	}
	return nil
}
