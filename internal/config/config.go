// Package config reads the server's settings, only from environment variables.
// Locally, main loads a .env file first (see LoadDotenv); in a container the
// variables come from Compose.
package config

import (
	"bufio"
	"errors"
	"fmt"
	"net/netip"
	"os"
	"strconv"
	"strings"
)

// FIRMWARE_CHUNK_BYTES: the default and the bounds. The firmware domain
// uses the same constants; the maximum fits the uint16 length of its chunk header.
const (
	DefaultFirmwareChunkBytes = 4096
	MinFirmwareChunkBytes     = 256
	MaxFirmwareChunkBytes     = 16384
)

// Config holds every setting of the server.
type Config struct {
	// BindAddr is BIND_ADDR, default 0.0.0.0:8080.
	BindAddr string
	// DatabaseURL is DATABASE_URL, required.
	DatabaseURL string
	// DBMaxConnections is DB_MAX_CONNECTIONS, default 5.
	DBMaxConnections int32
	MQTT             MQTT
	// AllowedOrigins is ALLOWED_ORIGINS, required: comma-separated origins
	// (scheme://host[:port]) whose pages may log in, change data and open the
	// WebSocket. On the VPS https://api.rmx.lt. Everything else gets 403 (CSRF
	// protection).
	AllowedOrigins []string
	// StaticDir is STATIC_DIR: built client files to serve under /app/. Empty
	// in local development, where the Bun dev server serves the client instead.
	StaticDir string
	// FirmwareDir is FIRMWARE_DIR: a directory of *.bin images served to
	// devices over MQTT. Empty means firmware requests are not served.
	FirmwareDir string
	// FirmwareChunkBytes is FIRMWARE_CHUNK_BYTES, default 4096. Each chunk
	// except the last is this long.
	FirmwareChunkBytes int
}

// MQTT holds the broker settings.
type MQTT struct {
	// Host is MQTT_HOST, required.
	Host string
	// Port is MQTT_PORT, default 1883.
	Port uint16
	// Username is MQTT_USERNAME, required.
	Username string
	// Password is MQTT_PASSWORD, required. Never logged.
	Password string
	// ClientID is MQTT_CLIENT_ID, default rmx-server.
	ClientID string
	// TopicPrefix is MQTT_TOPIC_PREFIX, default mower.
	TopicPrefix string
}

// FromEnv reads the settings from the process environment.
func FromEnv() (*Config, error) {
	return FromLookup(os.LookupEnv)
}

// FromLookup reads the settings through get, so tests can pass a map instead
// of the real environment. An empty value counts as not set.
func FromLookup(lookup func(string) (string, bool)) (*Config, error) {
	get := func(key string) string {
		v, _ := lookup(key)
		if strings.TrimSpace(v) == "" {
			return ""
		}
		return v
	}
	var errs []error
	required := func(key string) string {
		v := get(key)
		if v == "" {
			errs = append(errs, fmt.Errorf("%s is not set", key))
		}
		return v
	}
	number := func(key string, def uint64, bits int) uint64 {
		v := get(key)
		if v == "" {
			return def
		}
		n, err := strconv.ParseUint(strings.TrimSpace(v), 10, bits)
		if err != nil {
			errs = append(errs, fmt.Errorf("%s is not a valid number: %s", key, v))
			return def
		}
		return n
	}

	c := &Config{
		BindAddr:         "0.0.0.0:8080",
		DatabaseURL:      required("DATABASE_URL"),
		DBMaxConnections: int32(number("DB_MAX_CONNECTIONS", 5, 31)),
		MQTT: MQTT{
			Host:        required("MQTT_HOST"),
			Port:        uint16(number("MQTT_PORT", 1883, 16)),
			Username:    required("MQTT_USERNAME"),
			Password:    required("MQTT_PASSWORD"),
			ClientID:    "rmx-server",
			TopicPrefix: "mower",
		},
		StaticDir:          get("STATIC_DIR"),
		FirmwareDir:        strings.TrimSpace(get("FIRMWARE_DIR")),
		FirmwareChunkBytes: DefaultFirmwareChunkBytes,
	}
	if v := get("BIND_ADDR"); v != "" {
		if _, err := netip.ParseAddrPort(strings.TrimSpace(v)); err != nil {
			errs = append(errs, errors.New("BIND_ADDR must look like 0.0.0.0:8080"))
		} else {
			c.BindAddr = strings.TrimSpace(v)
		}
	}
	if v := get("MQTT_CLIENT_ID"); v != "" {
		c.MQTT.ClientID = v
	}
	if v := get("MQTT_TOPIC_PREFIX"); v != "" {
		if strings.ContainsAny(v, "+#") || strings.HasSuffix(v, "/") {
			errs = append(errs, errors.New("MQTT_TOPIC_PREFIX must not contain + or # or end with /"))
		}
		c.MQTT.TopicPrefix = v
	}
	if v := get("FIRMWARE_CHUNK_BYTES"); v != "" {
		n := number("FIRMWARE_CHUNK_BYTES", uint64(DefaultFirmwareChunkBytes), 16)
		if n < uint64(MinFirmwareChunkBytes) || n > uint64(MaxFirmwareChunkBytes) {
			errs = append(errs, fmt.Errorf("FIRMWARE_CHUNK_BYTES must be %d to %d", MinFirmwareChunkBytes, MaxFirmwareChunkBytes))
		}
		c.FirmwareChunkBytes = int(n)
	}
	if v := required("ALLOWED_ORIGINS"); v != "" {
		origins, err := ParseOrigins(v)
		if err != nil {
			errs = append(errs, err)
		}
		c.AllowedOrigins = origins
	}
	if err := errors.Join(errs...); err != nil {
		return nil, err
	}
	return c, nil
}

// ParseOrigins reads origins as browsers send them: lower-case
// scheme://host[:port], nothing after.
func ParseOrigins(value string) ([]string, error) {
	var origins []string
	for _, o := range strings.Split(value, ",") {
		o = strings.TrimSpace(o)
		if o == "" {
			continue
		}
		lower := strings.ToLower(o)
		rest, ok := strings.CutPrefix(lower, "https://")
		if !ok {
			rest, ok = strings.CutPrefix(lower, "http://")
		}
		if !ok {
			return nil, fmt.Errorf("ALLOWED_ORIGINS: %s must start with https:// or http://", o)
		}
		if rest == "" || strings.ContainsAny(rest, "/?#@*") {
			return nil, fmt.Errorf("ALLOWED_ORIGINS: %s must be only scheme://host[:port], like https://api.rmx.lt", o)
		}
		origins = append(origins, lower)
	}
	return origins, nil
}

// LoadDotenv sets the variables of a .env file that are not set yet. A missing
// file is fine: in a container all settings come from the environment.
func LoadDotenv(path string) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		key = strings.TrimSpace(strings.TrimPrefix(key, "export "))
		if !ok || key == "" {
			continue
		}
		value = strings.TrimSpace(value)
		if n := len(value); n >= 2 && (value[0] == '"' || value[0] == '\'') && value[n-1] == value[0] {
			value = value[1 : n-1]
		}
		if _, set := os.LookupEnv(key); !set {
			_ = os.Setenv(key, value)
		}
	}
}
