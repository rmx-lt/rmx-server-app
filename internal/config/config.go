// Package config reads the server's settings, only from environment variables.
// Locally, main loads a .env file first (see LoadDotenv); in a container the
// variables come from Compose.
package config

import (
	"bufio"
	"errors"
	"fmt"
	"log/slog"
	"net/netip"
	"os"
	"strconv"
	"strings"
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
	// WebSocket. On the VPS https://app.rmx.lt. Everything else gets 403 (CSRF
	// protection).
	AllowedOrigins []string
	// StaticDir is STATIC_DIR: built client files to serve at /. Empty
	// in local development, where the Bun dev server serves the client instead.
	StaticDir string
	// FirmwareDir is FIRMWARE_DIR: the firmware images served to the boards
	// over MQTT, in the subdirectories "gateway" and "autopilot". Empty means
	// no firmware is served.
	FirmwareDir string
	// JobDir is JOB_DIR: the job files (<job>.json) served to the autopilot
	// over MQTT. Empty means no job files are served.
	JobDir string
	// NTRIP is the correction caster the gateways use (NTRIP_* variables).
	// The zero value means none is configured.
	NTRIP NTRIP
}

// NTRIP holds the caster settings the server sends to every gateway with
// ntrip_set (wiki Mower-Protocol §13). The password is a secret: it is read
// only from the environment, never logged, never returned by the API.
type NTRIP struct {
	// Host is NTRIP_HOST; empty means no caster is configured.
	Host string
	// Port is NTRIP_PORT, default 2101.
	Port uint16
	// Mountpoint is NTRIP_MOUNTPOINT.
	Mountpoint string
	// User is NTRIP_USER.
	User string
	// Password is NTRIP_PASSWORD. Never logged.
	Password string
}

// Configured reports whether a caster is set.
func (n NTRIP) Configured() bool { return n.Host != "" }

// String hides the password, so a stray %v or %+v does not print it.
func (n NTRIP) String() string {
	if !n.Configured() {
		return "ntrip: none"
	}
	return fmt.Sprintf("ntrip: %s:%d/%s as %s", n.Host, n.Port, n.Mountpoint, n.User)
}

// GoString is String for %#v.
func (n NTRIP) GoString() string { return n.String() }

// LogValue keeps the password out of structured logs.
func (n NTRIP) LogValue() slog.Value { return slog.StringValue(n.String()) }

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
		StaticDir:   get("STATIC_DIR"),
		FirmwareDir: strings.TrimSpace(get("FIRMWARE_DIR")),
		JobDir:      strings.TrimSpace(get("JOB_DIR")),
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
	c.NTRIP = ntrip(get, number, &errs)
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

// ntrip reads the NTRIP_* variables: none, or all of host, mountpoint, user and
// password (the port defaults to 2101).
func ntrip(get func(string) string, number func(string, uint64, int) uint64, errs *[]error) NTRIP {
	n := NTRIP{
		Host:       strings.TrimSpace(get("NTRIP_HOST")),
		Mountpoint: strings.TrimSpace(get("NTRIP_MOUNTPOINT")),
		User:       strings.TrimSpace(get("NTRIP_USER")),
		Password:   get("NTRIP_PASSWORD"),
	}
	if n.Host == "" && n.Mountpoint == "" && n.User == "" && n.Password == "" && get("NTRIP_PORT") == "" {
		return NTRIP{}
	}
	port := number("NTRIP_PORT", 2101, 16)
	if port == 0 {
		*errs = append(*errs, errors.New("NTRIP_PORT must be 1 to 65535"))
	}
	n.Port = uint16(port)
	for _, f := range []struct{ key, value string }{
		{"NTRIP_HOST", n.Host}, {"NTRIP_MOUNTPOINT", n.Mountpoint}, {"NTRIP_USER", n.User}, {"NTRIP_PASSWORD", n.Password},
	} {
		if f.value == "" {
			*errs = append(*errs, fmt.Errorf("%s is not set (the NTRIP settings go together)", f.key))
		}
	}
	return n
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
			return nil, fmt.Errorf("ALLOWED_ORIGINS: %s must be only scheme://host[:port], like https://app.rmx.lt", o)
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
