import type {
  GeoJSONImportResult,
  NearbySensor,
  RawSensorGeoJSONResponse,
  SensorDetail,
  SensorFeatureCollection,
  TelemetryEvent,
} from "./types";

const API_BASE = import.meta.env.VITE_API_URL || "/api";

async function parseJSON<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchSensorsGeoJSON(): Promise<SensorFeatureCollection> {
  const res = await fetch(`${API_BASE}/sensors/geojson/`);
  const raw = await parseJSON<RawSensorGeoJSONResponse>(res);

  return {
    type: "FeatureCollection",
    features: raw.features.map((feature) => {
      const latest = feature.properties.latest_telemetry;
      return {
        type: "Feature",
        id: feature.id,
        geometry: feature.geometry,
        properties: {
          id: feature.properties.id,
          code: feature.properties.code,
          name: feature.properties.name,
          district: feature.properties.district,
          is_active: feature.properties.is_active,
          pm25: latest ? latest.pm25 : null,
          pm10: latest ? latest.pm10 : null,
          temperature: latest ? latest.temperature : null,
          humidity: latest ? latest.humidity : null,
          recorded_at: latest ? latest.recorded_at : null,
        },
      };
    }),
  };
}

export async function fetchSensorDetail(id: number): Promise<SensorDetail> {
  const res = await fetch(`${API_BASE}/sensors/${id}/`);
  return parseJSON<SensorDetail>(res);
}

export async function fetchNearbySensors(
  lat: number,
  lng: number,
  radius: number
): Promise<NearbySensor[]> {
  const params = new URLSearchParams({
    lat: lat.toFixed(6),
    lng: lng.toFixed(6),
    radius: String(radius),
  });
  const res = await fetch(`${API_BASE}/sensors/nearby/?${params.toString()}`);
  return parseJSON<NearbySensor[]>(res);
}

export async function sendTelemetry(payload: {
  sensor_code: string;
  pm25: number;
  pm10: number;
  temperature: number;
  humidity: number;
}): Promise<TelemetryEvent> {
  const res = await fetch("/ingest/telemetry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJSON<TelemetryEvent>(res);
}

export async function uploadGeoJSON(file: File): Promise<GeoJSONImportResult> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE}/gis/import-geojson/`, {
    method: "POST",
    body: form,
  });
  return parseJSON<GeoJSONImportResult>(res);
}
