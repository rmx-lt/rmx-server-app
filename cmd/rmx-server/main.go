// rmx-server: the backend for the browser app and the mower's devices.
// Login and sessions, a WebSocket for the browser, and firmware images for
// devices over MQTT. Everything is in internal/app; main only runs it.
package main

import (
	"os"

	"github.com/rmx-lt/rmx-server-app/internal/app"
)

func main() { os.Exit(app.Main(os.Args[1:])) }
