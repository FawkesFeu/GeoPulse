# GeoPulse Mini — Real-Time Geospatial Sensor Monitoring

A focused, end-to-end real-time geospatial air-quality monitoring platform for **Ankara, Türkiye**. Built with **Django/GeoDjango**, **PostGIS**, **Go (pgx + goroutine worker pool + WebSockets)**, **React + TypeScript + MapLibre GL JS**, **GDAL/OGR + Shapely + Rasterio**, **Nginx**, and **Docker Compose**.

## Architecture

```text
                    +-------------------------------------+
                    |         Nginx Reverse Proxy         |
                    |            (Port 80)                |
                    +--+----------+-----------+--------+--+
                       |          |           |        |
         /api, /admin  |  /ingest |   /ws     |   /    |
                       v          v           v        v
          +----------------+   +-------------------+   +----------------------+
          | Django +       |   | Go Service        |   | React + TypeScript + |
          | GeoDjango      |   | Worker Pool +     |   | MapLibre GL JS       |
          | GDAL/Shapely/  |   | WebSocket Hub     |   | (Clustering + Live)  |
          | Rasterio       |   +---------+---------+   +----------------------+
          +-------+--------+             |
                  |                      | pgxpool
                  +----------+-----------+
                             v
                  +---------------------+
                  | PostgreSQL + PostGIS|
                  |    (EPSG:4326)      |
                  +---------------------+
```

### Service Responsibilities
* **PostgreSQL + PostGIS (`db`):** Stores `sensors` (`PointField(srid=4326, geography=True)`) and time-series `telemetry` records.
* **Django + GeoDjango (`backend`):** Owns database schema/migrations, sensor CRUD, spatial queries (`ST_DWithin`, bounding box), GeoJSON export, and GIS ETL (`GDAL/OGR`, `Shapely`, `Rasterio`).
* **Go Service (`ingest`):** Handles high-throughput telemetry ingestion (`POST /ingest/telemetry`), ICD validation, bounded goroutine worker pool writes (`pgxpool`), and real-time WebSocket fan-out (`/ws`), plus a simulated Ankara sensor CLI (`simulator`).
* **React + TypeScript + MapLibre (`frontend`):** Interactive clustered Ankara map, PM2.5 color-coded markers, PostGIS click-to-query radius panel, GeoJSON importer, and live WebSocket updates.
* **Nginx (`nginx`):** Single origin reverse proxy routing API, ingestion, WebSockets, and Vite HMR.

---

## Quick Start

1. **Create environment file:**
   ```bash
   cp .env.example .env
   ```
   > Note: `POSTGRES_HOST_PORT` defaults to `5433` on the host so it does not collide with a local PostgreSQL service on `5432`. Internal Docker services still communicate over `db:5432`.

2. **Start all 5 services:**
   ```bash
   docker compose up -d --build
   ```

3. **Run migrations, seed 8 Ankara sensors, and generate sample GeoTIFF:**
   ```bash
   docker compose exec -T backend python manage.py migrate
   docker compose exec -T backend python manage.py seed_ankara
   docker compose exec -T backend python manage.py create_sample_geotiff
   ```

4. **Open the dashboard:**
   Visit [http://localhost/](http://localhost/)

---

## Running Automated Tests

```bash
# Django + PostGIS spatial API & GIS ETL tests (7 tests)
docker compose exec -T backend python manage.py test sensors -v 2

# Go validation, worker pool & WebSocket broadcast tests
docker compose exec -T ingest go test -v ./...

# Frontend TypeScript check & Vite production build
docker compose exec -T frontend npm run build
```

CI runs all three suites automatically on push/PR via [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

---

## 5 Live Demo Scenarios

1. **Geospatial Query (PostGIS `ST_DWithin`):**
   * In the dashboard sidebar, click **Haritadan Nokta Seç**, pick a radius (`1 km` – `5 km`), and click anywhere on Ankara.
   * Or call directly:
     ```bash
     curl "http://localhost/api/sensors/nearby/?lat=39.9208&lng=32.8541&radius=3000"
     ```

2. **Real-Time Ingestion (Go Worker Pool → PostgreSQL):**
   * Run the Go sensor simulator once or continuously:
     ```bash
     docker compose exec -T ingest ./simulator -once
     # or continuous stream every 3s:
     docker compose exec -T ingest ./simulator -interval 3s
     ```
   * Verify persisted readings via Django: `curl http://localhost/api/sensors/1/`

3. **WebSocket Live Map Update:**
   * Keep [http://localhost/](http://localhost/) open and either click **Test Verisi Gönder** on a selected sensor or run `./simulator -interval 3s`. Marker colors, detail metrics, and the live event feed update without refreshing the page.

4. **GIS Data Processing (GDAL/OGR + Shapely + Rasterio):**
   * **Vector GeoJSON Import:** Upload [`data/ankara_extra_sensors.geojson`](data/ankara_extra_sensors.geojson) from the sidebar **GeoJSON İçe Aktar** card (or via `curl -F "file=@data/ankara_extra_sensors.geojson" http://localhost/api/gis/import-geojson/`). Two additional sensors (`ANK-CANKAYA-ATAKULE`, `ANK-GOLBASI-MOGAN`) appear on the map.
   * **Raster GeoTIFF Metadata:**
     ```bash
     curl -F "file=@data/ankara_sample_aqi.tif" http://localhost/api/gis/raster-metadata/
     ```

5. **Single-Command Docker Stack:**
   * `docker compose up -d --build` builds and launches PostGIS, Django, Go, React, and Nginx together with health checks.

---

## Documentation

* Interface contracts, validation bounds, and HTTP/WebSocket schemas: [`docs/ICD.md`](docs/ICD.md)
