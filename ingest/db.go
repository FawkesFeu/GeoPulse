package main

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrSensorNotFound indicates that no active sensor matched the submitted sensor_code.
var ErrSensorNotFound = errors.New("active sensor not found")

// TelemetryStore abstracts persistence so handlers and workers can be unit-tested.
type TelemetryStore interface {
	InsertTelemetry(ctx context.Context, p TelemetryPayload, recordedAt time.Time) (TelemetryEvent, error)
}

// PGStore persists telemetry rows directly into PostgreSQL using pgxpool.
type PGStore struct {
	pool *pgxpool.Pool
}

func NewPGStore(pool *pgxpool.Pool) *PGStore {
	return &PGStore{pool: pool}
}

func (s *PGStore) InsertTelemetry(ctx context.Context, p TelemetryPayload, recordedAt time.Time) (TelemetryEvent, error) {
	var (
		sensorID int64
		name     string
		district string
		lat      float64
		lng      float64
	)

	err := s.pool.QueryRow(
		ctx,
		`SELECT id, name, district, ST_Y(location::geometry), ST_X(location::geometry)
		 FROM sensors
		 WHERE code = $1 AND is_active = true`,
		p.SensorCode,
	).Scan(&sensorID, &name, &district, &lat, &lng)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return TelemetryEvent{}, fmt.Errorf("%w: %s", ErrSensorNotFound, p.SensorCode)
		}
		return TelemetryEvent{}, fmt.Errorf("lookup sensor: %w", err)
	}

	var telemetryID int64
	err = s.pool.QueryRow(
		ctx,
		`INSERT INTO telemetry (sensor_id, pm25, pm10, temperature, humidity, recorded_at, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, NOW())
		 RETURNING id`,
		sensorID, p.PM25, p.PM10, p.Temperature, p.Humidity, recordedAt,
	).Scan(&telemetryID)
	if err != nil {
		return TelemetryEvent{}, fmt.Errorf("insert telemetry: %w", err)
	}

	return TelemetryEvent{
		ID:          telemetryID,
		SensorID:    sensorID,
		SensorCode:  p.SensorCode,
		Name:        name,
		District:    district,
		Lat:         lat,
		Lng:         lng,
		PM25:        p.PM25,
		PM10:        p.PM10,
		Temperature: p.Temperature,
		Humidity:    p.Humidity,
		RecordedAt:  recordedAt,
	}, nil
}
