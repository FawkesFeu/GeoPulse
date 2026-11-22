# Interface Control Document (ICD) — GeoPulse Mini

This document defines the HTTP, WebSocket, and GIS file interfaces exposed across the **GeoPulse Mini** services through the Nginx reverse proxy (`http://localhost:80`).

---

## 1. Reverse Proxy Routing (Nginx Port 80)

| Path Prefix | Upstream Service | Purpose |
| :--- | :--- | :--- |
| `/api/` | `http://backend:8000` | Django / GeoDjango REST API & GIS ETL |
| `/admin/` | `http://backend:8000` | Django Admin (GISModelAdmin) |
| `/ingest/` | `http://ingest:8080` | Go Telemetry Ingestion HTTP API |
| `/ws` | `http://ingest:8080` | Go WebSocket Telemetry Broadcast (`Upgrade: websocket`) |
| `/` | `http://frontend:5173` | React + TypeScript + MapLibre Dashboard (incl. Vite HMR) |

---

## 2. Go Telemetry Ingestion Interface

### `GET /ingest/health`
Verifies Go service and PostgreSQL connection pool readiness.
* **200 OK:** `{"status":"ok","service":"go-ingest"}`
* **503 Service Unavailable:** `{"status":"degraded","error":"..."}`

### `POST /ingest/telemetry`
Accepts air-quality telemetry for an active sensor, validates against ICD constraints, persists to PostgreSQL (`telemetry` table) via a 4-goroutine worker pool (queue capacity `100`), and broadcasts the persisted event over `/ws`.

* **Headers:** `Content-Type: application/json` (max body size: `1 MiB`)
* **Request Schema (`TelemetryPayload`):**
```json
{
  "sensor_code": "ANK-KIZILAY",
  "pm25": 24.5,
  "pm10": 42.1,
  "temperature": 14.2,
  "humidity": 52.0,
  "recorded_at": "2026-11-22T18:00:00Z"
}
```

| Field | Type | Required | Validation Constraints |
| :--- | :--- | :--- | :--- |
| `sensor_code` | `string` | Yes | Non-empty after trim, max `64` chars, must match active `sensors.code` |
| `pm25` | `number` | Yes | `0 <= pm25 <= 1000` (µg/m³) |
| `pm10` | `number` | Yes | `0 <= pm10 <= 2000` (µg/m³) |
| `temperature` | `number` | Yes | `-60 <= temperature <= 80` (°C) |
| `humidity` | `number` | Yes | `0 <= humidity <= 100` (%) |
| `recorded_at` | `string` | No | Valid `RFC3339` timestamp; defaults to current UTC time if omitted/empty |

* **Responses:**
  * **201 Created (`TelemetryEvent`):**
    ```json
    {
      "id": 9,
      "sensor_id": 1,
      "sensor_code": "ANK-KIZILAY",
      "name": "Kızılay Meydanı",
      "district": "Çankaya",
      "lat": 39.9208,
      "lng": 32.8541,
      "pm25": 24.5,
      "pm10": 42.1,
      "temperature": 14.2,
      "humidity": 52.0,
      "recorded_at": "2026-11-22T18:00:00Z"
    }
    ```
  * **400 Bad Request:** Malformed JSON or ICD field constraint violation (`{"error": "..."}`).
  * **404 Not Found:** No active sensor matching `sensor_code` (`{"error": "active sensor not found: ..."}`).
  * **405 Method Not Allowed:** Non-`POST` HTTP method.
  * **503 Service Unavailable:** Worker pool queue saturated (`{"error": "ingestion queue is full"}`).

---

## 3. Go WebSocket Broadcast Interface

### `GET /ws`
Upgrades client HTTP connections to WebSocket and streams JSON text frames whenever `POST /ingest/telemetry` persists a valid reading.

* **Heartbeat:** Server sends WebSocket `Ping` frames every `54s` and closes unresponsive connections after `60s` (`wsPongWait`).
* **Backpressure:** Per-client buffered send channel (`64` messages); stalled clients are dropped so slow consumers never block ingestion.
* **Outbound Frame Format:** Identical to the `TelemetryEvent` JSON object returned by `POST /ingest/telemetry`.

---

## 4. Django & PostGIS REST API (`/api/`)

All coordinates use **WGS84 (`EPSG:4326`)**. `Sensor.location` is stored as `PointField(srid=4326, geography=True)` so spatial distance queries operate in meters.

### `GET /api/health/`
* **200 OK:** `{"status": "ok", "service": "django-backend"}`

### `GET /api/sensors/`
Lists all sensors ordered by `code`, with `latest_telemetry`.
* **Optional Query Param:** `?bbox=min_lng,min_lat,max_lng,max_lat` filters sensors intersecting the bounding box.

### `POST /api/sensors/`
Creates a new sensor.
* **Request Body:**
```json
{
  "code": "ANK-NEW",
  "name": "Yeni İstasyon",
  "district": "Çankaya",
  "lat": 39.92,
  "lng": 32.85,
  "is_active": true
}
```
* **Constraints:** `-90 <= lat <= 90`, `-180 <= lng <= 180`, unique `code`.
* **201 Created:** Serialized `Sensor` object.

### `GET /api/sensors/<id>/`
* **200 OK:** Sensor metadata + `latest_telemetry` + `telemetry` array (up to 20 most recent readings ordered by `-recorded_at`).
* **404 Not Found:** Sensor does not exist.

### `GET /api/sensors/geojson/`
* **200 OK:** Standard GeoJSON `FeatureCollection` of active sensors (`Point` `[lng, lat]` geometries with `id`, `code`, `name`, `district`, `is_active`, and `latest_telemetry` in `properties`).

### `GET /api/sensors/nearby/?lat=<float>&lng=<float>&radius=<float>`
Executes a PostGIS `ST_DWithin` (`location__dwithin`) query and orders results by geodesic distance (`distance_m` in meters).
* **Parameters:** `lat` (required, `-90..90`), `lng` (required, `-180..180`), `radius` (optional, meters `> 0`, default `1000`).
* **400 Bad Request:** Missing/non-finite/out-of-range parameters.

### `GET /api/sensors/bbox/?min_lng=<float>&min_lat=<float>&max_lng=<float>&max_lat=<float>`
Filters active sensors intersecting a `Polygon.from_bbox` (`srid=4326`) via PostGIS `location__intersects`.
* **Constraints:** `-180 <= min_lng < max_lng <= 180` and `-90 <= min_lat < max_lat <= 90`.

---

## 5. GIS ETL Interfaces (`/api/gis/`)

### `POST /api/gis/import-geojson/`
Imports vector sensor locations from a GeoJSON file using **GDAL/OGR** and **Shapely**.
* **Content-Type:** `multipart/form-data` with file field `file`.
* **Processing Steps:**
  1. Reads layer with GDAL/OGR `DataSource`.
  2. Transforms geometries to `EPSG:4326` via `CoordTransform` if source SRID differs.
  3. Validates non-empty, `is_valid`, `Point` geometry and WGS84 coordinate bounds via Shapely.
  4. Upserts valid features into PostGIS (`Sensor.objects.update_or_create` keyed by `code`); skips invalid geometries/missing properties and logs per-feature errors.
* **200 OK:**
```json
{
  "source_srid": 4326,
  "target_srid": 4326,
  "imported": 2,
  "updated": 0,
  "skipped": 0,
  "errors": []
}
```

### `POST /api/gis/raster-metadata/`
Reads spatial metadata and band-1 statistics from a GeoTIFF using **Rasterio** + **NumPy**.
* **Content-Type:** `multipart/form-data` with file field `file`.
* **200 OK:**
```json
{
  "driver": "GTiff",
  "width": 32,
  "height": 32,
  "count": 1,
  "dtypes": ["float32"],
  "crs": "EPSG:4326",
  "bounds": {
    "left": 32.65,
    "bottom": 39.85,
    "right": 32.95,
    "top": 40.0
  },
  "resolution": [0.009375, 0.0046875],
  "nodata": -9999.0,
  "band1_stats": {
    "min": 10.0,
    "max": 45.0,
    "mean": 27.5
  }
}
```
