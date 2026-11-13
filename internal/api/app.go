package api

// Health is the body of GET /app/health.
type Health struct {
	// "ok" when the database and the MQTT broker are both reachable, else "degraded".
	Status  string `json:"status"`
	DB      bool   `json:"db"`
	MQTT    bool   `json:"mqtt"`
	Version string `json:"version"`
}
