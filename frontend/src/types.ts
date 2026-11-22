export interface TelemetryReading {
  id: number;
  sensor: number;
  pm25: number;
  pm10: number;
  temperature: number;
  humidity: number;
  recorded_at: string;
}

export interface TelemetryEvent {
  id: number;
  sensor_id: number;
  sensor_code: string;
  name?: string;
  district?: string;
  lat?: number;
  lng?: number;
  pm25: number;
  pm10: number;
  temperature: number;
  humidity: number;
  recorded_at: string;
}

export interface SensorDetail {
  id: number;
  code: string;
  name: string;
  district: string;
  lat: number;
  lng: number;
  is_active: boolean;
  latest_telemetry: TelemetryReading | null;
  distance_m: number | null;
  created_at: string;
  telemetry: TelemetryReading[];
}

export interface NearbySensor {
  id: number;
  code: string;
  name: string;
  district: string;
  lat: number;
  lng: number;
  is_active: boolean;
  latest_telemetry: TelemetryReading | null;
  distance_m: number | null;
}

export interface GeoJSONImportResult {
  source_srid: number;
  target_srid: number;
  imported: number;
  updated: number;
  skipped: number;
  errors: string[];
}

export interface SensorFeatureProperties {
  id: number;
  code: string;
  name: string;
  district: string;
  is_active: boolean;
  pm25: number | null;
  pm10: number | null;
  temperature: number | null;
  humidity: number | null;
  recorded_at: string | null;
}

export interface SensorFeature {
  type: "Feature";
  id: number;
  geometry: {
    type: "Point";
    coordinates: [number, number];
  };
  properties: SensorFeatureProperties;
}

export interface SensorFeatureCollection {
  type: "FeatureCollection";
  features: SensorFeature[];
}

export interface RawSensorGeoJSONResponse {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    id: number;
    geometry: {
      type: "Point";
      coordinates: [number, number];
    };
    properties: {
      id: number;
      code: string;
      name: string;
      district: string;
      is_active: boolean;
      latest_telemetry: TelemetryReading | null;
    };
  }>;
}
