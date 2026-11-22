package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

type mockStore struct {
	sensors map[string]int64
}

func (m *mockStore) InsertTelemetry(_ context.Context, p TelemetryPayload, recordedAt time.Time) (TelemetryEvent, error) {
	id, ok := m.sensors[p.SensorCode]
	if !ok {
		return TelemetryEvent{}, ErrSensorNotFound
	}
	return TelemetryEvent{
		ID:          42,
		SensorID:    id,
		SensorCode:  p.SensorCode,
		PM25:        p.PM25,
		PM10:        p.PM10,
		Temperature: p.Temperature,
		Humidity:    p.Humidity,
		RecordedAt:  recordedAt,
	}, nil
}

func TestTelemetryValidation(t *testing.T) {
	valid := TelemetryPayload{
		SensorCode:  "ANK-KIZILAY",
		PM25:        24.5,
		PM10:        42.0,
		Temperature: 14.2,
		Humidity:    52.0,
		RecordedAt:  "2026-11-22T18:00:00Z",
	}
	ts, err := valid.Validate()
	if err != nil {
		t.Fatalf("expected valid payload, got error: %v", err)
	}
	if ts.Year() != 2026 {
		t.Fatalf("expected parsed year 2026, got %d", ts.Year())
	}

	cases := []struct {
		name    string
		payload TelemetryPayload
	}{
		{"empty sensor_code", TelemetryPayload{SensorCode: "", PM25: 10, PM10: 20, Temperature: 10, Humidity: 50}},
		{"pm25 out of range", TelemetryPayload{SensorCode: "ANK-1", PM25: 1500, PM10: 20, Temperature: 10, Humidity: 50}},
		{"humidity out of range", TelemetryPayload{SensorCode: "ANK-1", PM25: 10, PM10: 20, Temperature: 10, Humidity: 105}},
		{"invalid timestamp", TelemetryPayload{SensorCode: "ANK-1", PM25: 10, PM10: 20, Temperature: 10, Humidity: 50, RecordedAt: "not-a-time"}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := tc.payload.Validate(); err == nil {
				t.Fatalf("expected error for %s, got nil", tc.name)
			}
		})
	}
}

func TestIngestHandlerAndWorkerPool(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	hub := NewHub()
	go hub.Run(ctx)

	store := &mockStore{sensors: map[string]int64{"ANK-KIZILAY": 1}}
	pool := NewWorkerPool(store, hub, 2, 16)
	pool.Start(ctx)

	srv := httptest.NewServer(newMux(pool, hub, nil))
	defer srv.Close()

	// Connect a WebSocket subscriber before sending telemetry.
	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"
	wsConn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("websocket dial failed: %v", err)
	}
	defer wsConn.Close()

	// Give Hub goroutine a moment to register the client.
	time.Sleep(25 * time.Millisecond)

	// 1. Valid POST -> 201 Created + WebSocket broadcast
	validBody := []byte(`{"sensor_code":"ANK-KIZILAY","pm25":26.4,"pm10":45.1,"temperature":15.0,"humidity":48.0}`)
	resp, err := http.Post(srv.URL+"/ingest/telemetry", "application/json", bytes.NewReader(validBody))
	if err != nil {
		t.Fatalf("POST failed: %v", err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201 Created, got %d", resp.StatusCode)
	}

	_ = wsConn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, msgBytes, err := wsConn.ReadMessage()
	if err != nil {
		t.Fatalf("expected WebSocket broadcast message, got error: %v", err)
	}
	var broadcastEvent TelemetryEvent
	if err := json.Unmarshal(msgBytes, &broadcastEvent); err != nil {
		t.Fatalf("invalid broadcast JSON: %v", err)
	}
	if broadcastEvent.SensorCode != "ANK-KIZILAY" || broadcastEvent.PM25 != 26.4 {
		t.Fatalf("unexpected broadcast event: %+v", broadcastEvent)
	}

	// 2. Invalid payload -> 400 Bad Request
	invalidBody := []byte(`{"sensor_code":"ANK-KIZILAY","pm25":-5,"pm10":10,"temperature":15,"humidity":50}`)
	respInvalid, err := http.Post(srv.URL+"/ingest/telemetry", "application/json", bytes.NewReader(invalidBody))
	if err != nil {
		t.Fatalf("POST invalid failed: %v", err)
	}
	_ = respInvalid.Body.Close()
	if respInvalid.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request, got %d", respInvalid.StatusCode)
	}

	// 3. Unknown sensor -> 404 Not Found
	unknownBody := []byte(`{"sensor_code":"ANK-UNKNOWN","pm25":12,"pm10":20,"temperature":15,"humidity":50}`)
	respUnknown, err := http.Post(srv.URL+"/ingest/telemetry", "application/json", bytes.NewReader(unknownBody))
	if err != nil {
		t.Fatalf("POST unknown failed: %v", err)
	}
	_ = respUnknown.Body.Close()
	if respUnknown.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404 Not Found, got %d", respUnknown.StatusCode)
	}
}
