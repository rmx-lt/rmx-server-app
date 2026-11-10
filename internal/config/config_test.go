package config

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func base() map[string]string {
	return map[string]string{
		"DATABASE_URL":    "postgres://u:p@db/probe",
		"MQTT_HOST":       "mosquitto",
		"MQTT_USERNAME":   "probe-app",
		"MQTT_PASSWORD":   "secret",
		"ALLOWED_ORIGINS": "https://api.rmx.lt",
	}
}

func load(vars map[string]string) (*Config, error) {
	return FromLookup(func(k string) (string, bool) { v, ok := vars[k]; return v, ok })
}

func TestDefaults(t *testing.T) {
	c, err := load(base())
	if err != nil {
		t.Fatal(err)
	}
	if c.BindAddr != "0.0.0.0:8080" || c.MQTT.Port != 1883 || c.MQTT.ClientID != "probe-server" ||
		c.MQTT.TopicPrefix != "mower" || c.DBMaxConnections != 5 || c.StaticDir != "" ||
		!slices.Equal(c.AllowedOrigins, []string{"https://api.rmx.lt"}) {
		t.Fatalf("%+v", c)
	}
}

func TestAllowedOrigins(t *testing.T) {
	vars := base()
	vars["ALLOWED_ORIGINS"] = " HTTP://localhost:3000 , https://a.example,"
	c, err := load(vars)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(c.AllowedOrigins, []string{"http://localhost:3000", "https://a.example"}) {
		t.Fatal(c.AllowedOrigins)
	}
	for _, bad := range []string{"api.rmx.lt", "https://api.rmx.lt/", "https://*.rmx.lt", "ftp://x", "https://"} {
		vars["ALLOWED_ORIGINS"] = bad
		if _, err := load(vars); err == nil {
			t.Errorf("accepted %q", bad)
		}
	}
	// Required: no default that would let every origin in.
	delete(vars, "ALLOWED_ORIGINS")
	if _, err := load(vars); err == nil {
		t.Error("ALLOWED_ORIGINS is optional")
	}
}

func TestMissingRequired(t *testing.T) {
	vars := base()
	delete(vars, "MQTT_PASSWORD")
	_, err := load(vars)
	if err == nil || !strings.Contains(err.Error(), "MQTT_PASSWORD") {
		t.Fatal(err)
	}
	// An empty value counts as missing.
	vars["MQTT_PASSWORD"] = " "
	if _, err := load(vars); err == nil {
		t.Fatal("blank password accepted")
	}
}

func TestInvalidValues(t *testing.T) {
	for key, bad := range map[string]string{
		"MQTT_PORT":          "abc",
		"MQTT_TOPIC_PREFIX":  "probe/#",
		"BIND_ADDR":          "8080",
		"DB_MAX_CONNECTIONS": "-1",
	} {
		vars := base()
		vars[key] = bad
		if _, err := load(vars); err == nil {
			t.Errorf("%s=%s accepted", key, bad)
		}
	}
}

func TestLoadDotenv(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".env")
	content := "# comment\nDOTENV_A=one\nexport DOTENV_B = \"two words\"\nDOTENV_SET=from-file\n\nbad line\n"
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("DOTENV_SET", "from-env")
	t.Setenv("DOTENV_A", "") // registered with t.Setenv so it is restored
	os.Unsetenv("DOTENV_A")
	LoadDotenv(path)
	LoadDotenv(filepath.Join(t.TempDir(), "missing"))
	for k, want := range map[string]string{"DOTENV_A": "one", "DOTENV_B": "two words", "DOTENV_SET": "from-env"} {
		if got := os.Getenv(k); got != want {
			t.Errorf("%s = %q, want %q", k, got, want)
		}
	}
	os.Unsetenv("DOTENV_B")
}
