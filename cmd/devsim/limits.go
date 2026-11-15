package main

import (
	"bytes"
	"encoding/json"
	"math"
	"slices"
	"strings"
)

// Segment types and speed limits (wiki Mower-Protocol §7.1, §8, §11).

var segmentTypes = []string{"transit", "edge", "fill"}

var limitNames = []string{"max", "transit", "edge", "fill", "manual"}

// defaultLimits are the simulator's firmware defaults, in m/s; `null` in the
// command returns a limit to them. The top speed is maxSpeed (motion.go): it is
// what "full power" means, for a type with limit 0 and `max` 0.
var defaultLimits = map[string]float64{"max": maxSpeed, "transit": 0.6, "edge": 0.3, "fill": 0.5, "manual": 0.6}

// limits returns the five limits as they are now: the ones set, then the defaults.
func (a *autopilot) limits() map[string]float64 {
	out := map[string]float64{}
	for _, n := range limitNames {
		if v, ok := a.st.SpeedLimit[n]; ok {
			out[n] = v
		} else {
			out[n] = defaultLimits[n]
		}
	}
	return out
}

// limitFor is the speed allowed for a segment type or "manual": never above
// the limit for it, never above `max`, and never above the top speed. A limit
// of 0 is no limit.
func (a *autopilot) limitFor(kind string) float64 {
	l := a.limits()
	v := maxSpeed
	for _, n := range []string{kind, "max"} {
		if l[n] > 0 {
			v = math.Min(v, l[n])
		}
	}
	return v
}

// cmdSpeedLimit sets one or more limits at once; anything not allowed changes nothing.
func (a *autopilot) cmdSpeedLimit(env cmdEnv) {
	var given map[string]json.RawMessage
	if json.Unmarshal(env.raw["limits"], &given) != nil || len(given) == 0 {
		a.recv.fail(env, "bad_request", "limits must be an object with one or more of "+strings.Join(limitNames, ", "))
		return
	}
	set := map[string]*float64{}
	for n, raw := range given {
		var v *float64
		if !slices.Contains(limitNames, n) || json.Unmarshal(bytes.TrimSpace(raw), &v) != nil ||
			(v != nil && (*v < 0 || math.IsNaN(*v) || math.IsInf(*v, 0))) {
			a.recv.fail(env, "bad_request", "a limit is a number of 0 or above or null, named one of "+strings.Join(limitNames, ", "))
			return
		}
		set[n] = v
	}
	if a.st.SpeedLimit == nil {
		a.st.SpeedLimit = map[string]float64{}
	}
	for n, v := range set {
		if v == nil {
			delete(a.st.SpeedLimit, n)
		} else {
			a.st.SpeedLimit[n] = *v
		}
	}
	a.sv.save()
	// Live driving follows the new limit now, not at the next setpoint.
	m := a.limitFor("manual")
	a.tgtV = math.Max(-m, math.Min(m, a.tgtV))
	a.recv.done(env, a.limits())
}
