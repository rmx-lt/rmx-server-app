// Package integration holds the integration tests: the real server against
// a real TimescaleDB and Mosquitto, driven like a browser and a device. The
// tests build only with -tags integration (see harness_test.go); this file
// keeps the package visible to `go list` and the arch test without the tag.
package integration
