package main

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

// TelemetryPayload defines the documented ICD JSON payload for incoming sensor readings.
type TelemetryPayload struct {
	SensorCode  string  `json:"sensor_code"`
	PM25        float64 `json:"pm25"`
	PM10        float64 `json:"pm10"`
	Temperature float64 `json:"temperature"`
	Humidity    float64 `json:"humidity"`
	RecordedAt  string  `json:"recorded_at,omitempty"`
}

// TelemetryEvent represents a persisted telemetry reading broadcast to WebSocket subscribers.
type TelemetryEvent struct {
	ID          int64     `json:"id"`
	SensorID    int64     `json:"sensor_id"`
	SensorCode  string    `json:"sensor_code"`
	Name        string    `json:"name,omitempty"`
	District    string    `json:"district,omitempty"`
	Lat         float64   `json:"lat,omitempty"`
	Lng         float64   `json:"lng,omitempty"`
	PM25        float64   `json:"pm25"`
	PM10        float64   `json:"pm10"`
	Temperature float64   `json:"temperature"`
	Humidity    float64   `json:"humidity"`
	RecordedAt  time.Time `json:"recorded_at"`
}

// Validate checks ICD constraints on a TelemetryPayload and returns the normalized timestamp.
func (p *TelemetryPayload) Validate() (time.Time, error) {
	p.SensorCode = strings.TrimSpace(p.SensorCode)
	if p.SensorCode == "" {
		return time.Time{}, errors.New("sensor_code is required")
	}
	if len(p.SensorCode) > 64 {
		return time.Time{}, errors.New("sensor_code must be at most 64 characters")
	}
	if p.PM25 < 0 || p.PM25 > 1000 {
		return time.Time{}, fmt.Errorf("pm25 must be between 0 and 1000, got %v", p.PM25)
	}
	if p.PM10 < 0 || p.PM10 > 2000 {
		return time.Time{}, fmt.Errorf("pm10 must be between 0 and 2000, got %v", p.PM10)
	}
	if p.Temperature < -60 || p.Temperature > 80 {
		return time.Time{}, fmt.Errorf("temperature must be between -60 and 80, got %v", p.Temperature)
	}
	if p.Humidity < 0 || p.Humidity > 100 {
		return time.Time{}, fmt.Errorf("humidity must be between 0 and 100, got %v", p.Humidity)
	}

	if strings.TrimSpace(p.RecordedAt) == "" {
		return time.Now().UTC(), nil
	}

	parsed, err := time.Parse(time.RFC3339, p.RecordedAt)
	if err != nil {
		return time.Time{}, fmt.Errorf("recorded_at must be valid RFC3339: %w", err)
	}
	return parsed.UTC(), nil
}
