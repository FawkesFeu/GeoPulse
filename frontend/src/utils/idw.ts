import type { NearbySensor } from "../types";

export type AirQualityCategory = "İyi" | "Orta" | "Hassas" | "Yüksek";

export interface IDWEstimate {
  pm25: number;
  pm10: number;
  temperature: number;
  humidity: number;
  sensorCount: number;
  category: AirQualityCategory;
  color: string;
}

export function classifyPM25(pm25: number): { category: AirQualityCategory; color: string } {
  if (pm25 < 15) return { category: "İyi", color: "#22c55e" };
  if (pm25 < 25) return { category: "Orta", color: "#eab308" };
  if (pm25 < 35) return { category: "Hassas", color: "#f97316" };
  return { category: "Yüksek", color: "#ef4444" };
}

/**
 * Estimate air-quality metrics at a queried point using Inverse Distance Weighting (IDW).
 * Sensors closer to the selected point have proportionally higher weight (w = 1 / max(d, 10m)).
 */
export function estimateAirQualityIDW(sensors: NearbySensor[]): IDWEstimate | null {
  const valid = sensors.filter(
    (s) => s.latest_telemetry !== null && s.distance_m !== null
  );
  if (valid.length === 0) return null;

  let weightSum = 0;
  let pm25Sum = 0;
  let pm10Sum = 0;
  let tempSum = 0;
  let humSum = 0;

  for (const sensor of valid) {
    const distance = Math.max(sensor.distance_m ?? 10, 10);
    const weight = 1 / distance;
    const t = sensor.latest_telemetry!;

    weightSum += weight;
    pm25Sum += weight * t.pm25;
    pm10Sum += weight * t.pm10;
    tempSum += weight * t.temperature;
    humSum += weight * t.humidity;
  }

  const pm25 = Number((pm25Sum / weightSum).toFixed(1));
  const pm10 = Number((pm10Sum / weightSum).toFixed(1));
  const temperature = Number((tempSum / weightSum).toFixed(1));
  const humidity = Number((humSum / weightSum).toFixed(1));
  const { category, color } = classifyPM25(pm25);

  return {
    pm25,
    pm10,
    temperature,
    humidity,
    sensorCount: valid.length,
    category,
    color,
  };
}
