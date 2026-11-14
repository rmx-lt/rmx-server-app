// Package buildinfo holds what the build stamps into the binary.
package buildinfo

// Version is reported by /app/health. The release build sets it with
// -ldflags "-X github.com/rmx-lt/rmx-server-app/internal/buildinfo.Version=...".
var Version = "0.1.0"
