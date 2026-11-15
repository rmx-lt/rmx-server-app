package config

import (
	"bytes"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func base() map[string]string {
	return map[string]string{
		"DATABASE_URL":    "postgres://u:p@db/app",
		"MQTT_HOST":       "mosquitto",
		"MQTT_USERNAME":   "app",
		"MQTT_PASSWORD":   "secret",
		"ALLOWED_ORIGINS": "https://app.rmx.lt",
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
	if c.BindAddr != "0.0.0.0:8080" || c.MQTT.Port != 1883 || c.MQTT.ClientID != "rmx-server" ||
		c.MQTT.TopicPrefix != "mower" || c.DBMaxConnections != 5 || c.StaticDir != "" ||
		c.FirmwareDir != "" || c.JobDir != "" || c.NTRIP.Configured() ||
		!slices.Equal(c.AllowedOrigins, []string{"https://app.rmx.lt"}) {
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
	for _, bad := range []string{"app.rmx.lt", "https://app.rmx.lt/", "https://*.rmx.lt", "ftp://x", "https://"} {
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
		"MQTT_TOPIC_PREFIX":  "app/#",
		"BIND_ADDR":          "8080",
		"DB_MAX_CONNECTIONS": "-1",
		"NTRIP_HOST":         "caster.example", // the other NTRIP settings are missing
	} {
		vars := base()
		vars[key] = bad
		if _, err := load(vars); err == nil {
			t.Errorf("%s=%s accepted", key, bad)
		}
	}
}

func TestTransferDirectories(t *testing.T) {
	vars := base()
	vars["FIRMWARE_DIR"] = "  /firmware  "
	vars["JOB_DIR"] = "/jobs"
	c, err := load(vars)
	if err != nil {
		t.Fatal(err)
	}
	if c.FirmwareDir != "/firmware" || c.JobDir != "/jobs" {
		t.Fatalf("%+v", c)
	}
}

func TestNTRIPSettings(t *testing.T) {
	vars := base()
	vars["NTRIP_HOST"] = "caster.example"
	vars["NTRIP_MOUNTPOINT"] = "MOUNT"
	vars["NTRIP_USER"] = "me"
	vars["NTRIP_PASSWORD"] = "hunter2-not-real"
	c, err := load(vars)
	if err != nil {
		t.Fatal(err)
	}
	n := c.NTRIP
	if !n.Configured() || n.Host != "caster.example" || n.Port != 2101 || n.Mountpoint != "MOUNT" || n.User != "me" || n.Password != "hunter2-not-real" {
		t.Fatalf("%+v", n)
	}
	// The password never shows in a formatted config or in a log line.
	for _, out := range []string{fmt.Sprintf("%v", n), fmt.Sprintf("%+v", c), fmt.Sprintf("%#v", n), fmt.Sprint(c.NTRIP)} {
		if strings.Contains(out, "hunter2") {
			t.Fatalf("the password was formatted: %s", out)
		}
	}
	var buf bytes.Buffer
	slog.New(slog.NewTextHandler(&buf, nil)).Info("config", "ntrip", n)
	if strings.Contains(buf.String(), "hunter2") {
		t.Fatalf("the password was logged: %s", buf.String())
	}
	vars["NTRIP_PORT"] = "0"
	if _, err := load(vars); err == nil {
		t.Fatal("port 0 accepted")
	}
	delete(vars, "NTRIP_PASSWORD")
	vars["NTRIP_PORT"] = "2102"
	if _, err := load(vars); err == nil || !strings.Contains(err.Error(), "NTRIP_PASSWORD") {
		t.Fatalf("a missing password: %v", err)
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
