package mower

import (
	"context"

	"github.com/rmx-lt/rmx-server-app/internal/api"
	"github.com/rmx-lt/rmx-server-app/internal/core"
	"github.com/rmx-lt/rmx-server-app/internal/ws"
)

// RegisterWS adds the mower requests (devices, device, metric_history, drive,
// monitor_watch, monitor_unwatch) to the WebSocket. The pushes (device_changed, telemetry) go out through the Pusher
// the Service was created with, which is the same ws.Server.
func RegisterWS(s *ws.Server, svc *Service) {
	ws.Handle(s, func(ctx context.Context, _ core.CurrentUser, _ api.RequestDevices) (any, error) {
		return svc.Devices(ctx)
	})
	ws.Handle(s, func(ctx context.Context, _ core.CurrentUser, req api.RequestDevice) (any, error) {
		return svc.Device(ctx, req.Name)
	})
	ws.Handle(s, func(ctx context.Context, _ core.CurrentUser, req api.RequestMetricHistory) (any, error) {
		return svc.History(ctx, req)
	})
	// A setpoint is not answered unless it failed: at 10 Hz, an answer to each is noise.
	ws.Handle(s, func(ctx context.Context, _ core.CurrentUser, req api.RequestDrive) (any, error) {
		return ws.NoResponse, svc.Drive(ctx, req)
	})
	ws.Handle(s, func(ctx context.Context, user core.CurrentUser, req api.RequestMonitorWatch) (any, error) {
		return svc.Watch(ctx, user, req)
	})
	ws.Handle(s, func(ctx context.Context, _ core.CurrentUser, req api.RequestMonitorUnwatch) (any, error) {
		return api.RpcDone{}, svc.Unwatch(ctx, req)
	})
}
