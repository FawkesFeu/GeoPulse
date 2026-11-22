import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchNearbySensors,
  fetchSensorDetail,
  fetchSensorsGeoJSON,
  sendTelemetry,
  uploadGeoJSON,
} from "./api";
import { type MapFocusTarget, SensorMap } from "./components/SensorMap";
import type {
  GeoJSONImportResult,
  NearbySensor,
  SensorDetail,
  SensorFeatureCollection,
  TelemetryEvent,
} from "./types";
import { estimateAirQualityIDW } from "./utils/idw";

const EMPTY_GEOJSON: SensorFeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

function getWebSocketURL(): string {
  if (import.meta.env.VITE_WS_URL) {
    return import.meta.env.VITE_WS_URL;
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString();
}

export function App() {
  const [geojson, setGeojson] = useState<SensorFeatureCollection>(EMPTY_GEOJSON);
  const [wsConnected, setWsConnected] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [selectedSensorId, setSelectedSensorId] = useState<number | null>(null);
  const [selectedSensor, setSelectedSensor] = useState<SensorDetail | null>(null);
  const selectedSensorIdRef = useRef<number | null>(null);
  selectedSensorIdRef.current = selectedSensorId;

  const [nearbyMode, setNearbyMode] = useState(false);
  const [nearbyRadius, setNearbyRadius] = useState(2000);
  const [nearbyCenter, setNearbyCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [nearbySensors, setNearbySensors] = useState<NearbySensor[]>([]);

  const [liveEvents, setLiveEvents] = useState<TelemetryEvent[]>([]);
  const [sendingTest, setSendingTest] = useState(false);
  const [importingGeoJSON, setImportingGeoJSON] = useState(false);
  const [importResult, setImportResult] = useState<GeoJSONImportResult | null>(null);
  const [focusTarget, setFocusTarget] = useState<MapFocusTarget | null>(null);

  const nearbyEstimate = useMemo(
    () => estimateAirQualityIDW(nearbySensors),
    [nearbySensors]
  );

  const clearNearbySelection = useCallback(() => {
    setNearbyCenter(null);
    setNearbySensors([]);
    setNearbyMode(false);
  }, []);

  const focusCity = useCallback((lng: number, lat: number, zoom = 11) => {
    setFocusTarget({ lng, lat, zoom, seq: Date.now() });
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        clearNearbySelection();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [clearNearbySelection]);

  const loadGeoJSON = useCallback(async () => {
    try {
      setErrorMsg(null);
      const data = await fetchSensorsGeoJSON();
      setGeojson(data);
    } catch (err) {
      setErrorMsg(`Sensör verileri alınamadı: ${(err as Error).message}`);
    }
  }, []);

  useEffect(() => {
    void loadGeoJSON();
  }, [loadGeoJSON]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      ws = new WebSocket(getWebSocketURL());

      ws.onopen = () => {
        setWsConnected(true);
      };

      ws.onclose = () => {
        setWsConnected(false);
        if (!disposed) {
          reconnectTimer = window.setTimeout(connect, 3000);
        }
      };

      ws.onerror = () => {
        setWsConnected(false);
      };

      ws.onmessage = (msg) => {
        try {
          const event = JSON.parse(msg.data) as TelemetryEvent;

          setGeojson((prev) => {
            let found = false;
            const updatedFeatures = prev.features.map((feature) => {
              if (feature.properties.id !== event.sensor_id) return feature;
              found = true;
              return {
                ...feature,
                properties: {
                  ...feature.properties,
                  pm25: event.pm25,
                  pm10: event.pm10,
                  temperature: event.temperature,
                  humidity: event.humidity,
                  recorded_at: event.recorded_at,
                },
              };
            });

            if (!found && event.lat != null && event.lng != null) {
              updatedFeatures.push({
                type: "Feature",
                id: event.sensor_id,
                geometry: {
                  type: "Point",
                  coordinates: [event.lng, event.lat],
                },
                properties: {
                  id: event.sensor_id,
                  code: event.sensor_code,
                  name: event.name || event.sensor_code,
                  district: event.district || "",
                  is_active: true,
                  pm25: event.pm25,
                  pm10: event.pm10,
                  temperature: event.temperature,
                  humidity: event.humidity,
                  recorded_at: event.recorded_at,
                },
              });
            }

            return { type: "FeatureCollection", features: updatedFeatures };
          });

          setLiveEvents((prev) => [event, ...prev].slice(0, 6));

          setNearbySensors((prev) =>
            prev.map((sensor) =>
              sensor.id === event.sensor_id
                ? {
                    ...sensor,
                    latest_telemetry: {
                      id: event.id,
                      sensor: event.sensor_id,
                      pm25: event.pm25,
                      pm10: event.pm10,
                      temperature: event.temperature,
                      humidity: event.humidity,
                      recorded_at: event.recorded_at,
                    },
                  }
                : sensor
            )
          );

          if (selectedSensorIdRef.current === event.sensor_id) {
            const newReading = {
              id: event.id,
              sensor: event.sensor_id,
              pm25: event.pm25,
              pm10: event.pm10,
              temperature: event.temperature,
              humidity: event.humidity,
              recorded_at: event.recorded_at,
            };
            setSelectedSensor((prev) => {
              if (!prev || prev.id !== event.sensor_id) return prev;
              const deduped = [
                newReading,
                ...prev.telemetry.filter((item) => item.id !== newReading.id),
              ].slice(0, 20);
              return {
                ...prev,
                latest_telemetry: newReading,
                telemetry: deduped,
              };
            });
          }
        } catch {
          // Ignore malformed WS payloads
        }
      };
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer !== undefined) {
        window.clearTimeout(reconnectTimer);
      }
      ws?.close();
    };
  }, []);

  const handleSelectSensor = useCallback(async (sensorId: number) => {
    setSelectedSensorId(sensorId);
    try {
      setErrorMsg(null);
      const detail = await fetchSensorDetail(sensorId);
      setSelectedSensor(detail);
    } catch (err) {
      setErrorMsg(`Sensör detayı yüklenemedi: ${(err as Error).message}`);
    }
  }, []);

  const runNearbyQuery = useCallback(
    async (lat: number, lng: number, radius: number) => {
      setNearbyCenter({ lat, lng });
      try {
        setErrorMsg(null);
        const results = await fetchNearbySensors(lat, lng, radius);
        setNearbySensors(results);
      } catch (err) {
        setErrorMsg(`Yakınlık sorgusu başarısız: ${(err as Error).message}`);
      }
    },
    []
  );

  const handleMapClickNearby = useCallback(
    (lat: number, lng: number) => {
      void runNearbyQuery(lat, lng, nearbyRadius);
    },
    [nearbyRadius, runNearbyQuery]
  );

  const handleRadiusChange = (newRadius: number) => {
    setNearbyRadius(newRadius);
    if (nearbyCenter) {
      void runNearbyQuery(nearbyCenter.lat, nearbyCenter.lng, newRadius);
    }
  };

  const handleSendTestReading = async () => {
    if (!selectedSensor) return;
    setSendingTest(true);
    try {
      setErrorMsg(null);
      const pm25 = Number((10 + Math.random() * 32).toFixed(1));
      const pm10 = Number((pm25 * 1.6 + Math.random() * 8).toFixed(1));
      await sendTelemetry({
        sensor_code: selectedSensor.code,
        pm25,
        pm10,
        temperature: Number((11 + Math.random() * 7).toFixed(1)),
        humidity: Number((40 + Math.random() * 25).toFixed(1)),
      });
    } catch (err) {
      setErrorMsg(`Test verisi gönderilemedi: ${(err as Error).message}`);
    } finally {
      setSendingTest(false);
    }
  };

  const handleGeoJSONUpload = async (file: File | undefined) => {
    if (!file) return;
    setImportingGeoJSON(true);
    try {
      setErrorMsg(null);
      const summary = await uploadGeoJSON(file);
      setImportResult(summary);
      await loadGeoJSON();
    } catch (err) {
      setErrorMsg(`GeoJSON içe aktarma başarısız: ${(err as Error).message}`);
    } finally {
      setImportingGeoJSON(false);
    }
  };

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="header">
          <div>
            <h1>GeoPulse Mini</h1>
            <p className="subtitle">
              Ankara &amp; İstanbul Hava Kalitesi ({geojson.features.length} sensör)
            </p>
          </div>
          <span className={`badge ${wsConnected ? "badge-ok" : "badge-warn"}`}>
            {wsConnected ? "WS Canlı" : "WS Bağlanıyor"}
          </span>
        </div>

        <div className="row">
          <button
            type="button"
            className="btn"
            onClick={() => focusCity(32.8541, 39.9208, 11)}
          >
            Ankara
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => focusCity(29.01, 41.03, 11)}
          >
            İstanbul
          </button>
        </div>

        {errorMsg && <div className="error-banner">{errorMsg}</div>}

        <section className="card">
          <h2>PostGIS Yakınlık Sorgusu (ST_DWithin)</h2>
          <div className="row">
            <button
              type="button"
              className={`btn ${nearbyMode ? "btn-active" : ""}`}
              onClick={() => setNearbyMode((v) => !v)}
            >
              {nearbyMode ? "Seçim Modu Açık" : "Haritadan Nokta Seç"}
            </button>
            <select
              className="select"
              value={nearbyRadius}
              onChange={(e) => handleRadiusChange(Number(e.target.value))}
            >
              <option value={1000}>1 km</option>
              <option value={2000}>2 km</option>
              <option value={3000}>3 km</option>
              <option value={5000}>5 km</option>
            </select>
            {nearbyCenter && (
              <button
                type="button"
                className="btn btn-clear"
                onClick={clearNearbySelection}
                title="Seçili noktayı kaldır (Esc)"
              >
                Temizle
              </button>
            )}
          </div>

          {nearbyMode && (
            <p className="hint">
              Haritada bir noktaya tıklayın (Çıkmak için Esc).
            </p>
          )}

          {nearbyCenter ? (
            <>
              <p className="hint">
                Merkez: {nearbyCenter.lat.toFixed(4)}, {nearbyCenter.lng.toFixed(4)} —{" "}
                <strong>{nearbySensors.length}</strong> sensör
              </p>

              {nearbyEstimate ? (
                <div className="estimate-box">
                  <div className="estimate-header">
                    <span>Seçili Nokta IDW Tahmini ({nearbyEstimate.sensorCount} sensör)</span>
                    <span
                      className="estimate-badge"
                      style={{ background: nearbyEstimate.color }}
                    >
                      {nearbyEstimate.category}
                    </span>
                  </div>
                  <div className="estimate-metrics">
                    <span>PM2.5: <strong>{nearbyEstimate.pm25}</strong></span>
                    <span>PM10: <strong>{nearbyEstimate.pm10}</strong></span>
                    <span>Sıcaklık: <strong>{nearbyEstimate.temperature}°C</strong></span>
                    <span>Nem: <strong>{nearbyEstimate.humidity}%</strong></span>
                  </div>
                </div>
              ) : (
                <p className="hint">
                  Bu yarıçap içinde tahmin hesaplanacak sensör bulunamadı.
                </p>
              )}

              <ul className="list">
                {nearbySensors.map((s) => (
                  <li
                    key={s.id}
                    className="list-item"
                    onClick={() => void handleSelectSensor(s.id)}
                  >
                    <span>
                      <strong>{s.code}</strong> ({s.district})
                    </span>
                    <span>{s.distance_m != null ? `${Math.round(s.distance_m)} m` : "-"}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="hint">
              Butona tıklayıp harita üzerinde bir nokta seçerek yarıçaptaki sensörleri ve IDW hava kalitesi tahminini görün.
            </p>
          )}
        </section>

        <section className="card">
          <h2>Sensör Detayı</h2>
          {selectedSensor ? (
            <>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div>
                  <strong>{selectedSensor.name}</strong>
                  <div className="subtitle">
                    {selectedSensor.code} · {selectedSensor.district}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn"
                  disabled={sendingTest}
                  onClick={() => void handleSendTestReading()}
                >
                  {sendingTest ? "Gönderiliyor..." : "Test Verisi Gönder"}
                </button>
              </div>

              <div className="metrics-grid">
                <div className="metric-box">
                  <span className="metric-label">PM2.5 (µg/m³)</span>
                  <span className="metric-value">
                    {selectedSensor.latest_telemetry?.pm25 ?? "-"}
                  </span>
                </div>
                <div className="metric-box">
                  <span className="metric-label">PM10 (µg/m³)</span>
                  <span className="metric-value">
                    {selectedSensor.latest_telemetry?.pm10 ?? "-"}
                  </span>
                </div>
                <div className="metric-box">
                  <span className="metric-label">Sıcaklık (°C)</span>
                  <span className="metric-value">
                    {selectedSensor.latest_telemetry?.temperature ?? "-"}
                  </span>
                </div>
                <div className="metric-box">
                  <span className="metric-label">Nem (%)</span>
                  <span className="metric-value">
                    {selectedSensor.latest_telemetry?.humidity ?? "-"}
                  </span>
                </div>
              </div>

              <table className="history-table">
                <thead>
                  <tr>
                    <th>Saat</th>
                    <th>PM2.5</th>
                    <th>PM10</th>
                    <th>Sıcaklık</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedSensor.telemetry.slice(0, 6).map((t) => (
                    <tr key={t.id}>
                      <td>{formatTime(t.recorded_at)}</td>
                      <td>{t.pm25}</td>
                      <td>{t.pm10}</td>
                      <td>{t.temperature}°C</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <p className="hint">Detayları görmek için haritadan bir sensör noktasına tıklayın.</p>
          )}
        </section>

        <section className="card">
          <h2>Canlı WebSocket Akışı</h2>
          {liveEvents.length === 0 ? (
            <p className="hint">Henüz canlı telemetri gelmedi. Simülatör veya test butonuyla veri gönderin.</p>
          ) : (
            <ul className="list">
              {liveEvents.map((ev) => (
                <li
                  key={`${ev.id}-${ev.recorded_at}`}
                  className="list-item"
                  onClick={() => void handleSelectSensor(ev.sensor_id)}
                >
                  <span>
                    <strong>{ev.sensor_code}</strong> · PM2.5: {ev.pm25}
                  </span>
                  <span>{formatTime(ev.recorded_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <h2>GeoJSON İçe Aktar (GDAL + Shapely)</h2>
          <input
            type="file"
            accept=".geojson,.json"
            disabled={importingGeoJSON}
            onChange={(e) => {
              void handleGeoJSONUpload(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          {importingGeoJSON && <p className="hint">İşleniyor...</p>}
          {importResult && (
            <p className="hint">
              SRID {importResult.source_srid} → {importResult.target_srid} ·{" "}
              <strong>{importResult.imported}</strong> yeni,{" "}
              <strong>{importResult.updated}</strong> güncellendi,{" "}
              <strong>{importResult.skipped}</strong> atlandı.
            </p>
          )}
        </section>
      </aside>

      <main className="map-wrapper">
        <SensorMap
          geojson={geojson}
          nearbyMode={nearbyMode}
          nearbyRadius={nearbyRadius}
          nearbyCenter={nearbyCenter}
          nearbySensorIds={nearbySensors.map((s) => s.id)}
          nearbyEstimate={nearbyEstimate}
          selectedSensorId={selectedSensorId}
          focusTarget={focusTarget}
          onSelectSensor={(id) => void handleSelectSensor(id)}
          onMapClickNearby={handleMapClickNearby}
        />
        <div className="map-info-box">
          <div>
            <strong>PM2.5 / PM10 (µg/m³):</strong> İnce ve kaba hava partikül yoğunluğu
          </div>
          <div>
            <strong>°C / %:</strong> Sıcaklık ve bağıl nem
          </div>
          <div>
            <strong>Daireler:</strong> 1 km sensör kapsama alanı (PM2.5 rengine göre canlı)
          </div>
        </div>
        <div className="legend">
          <span>
            <i className="dot" style={{ background: "#22c55e" }} />
            &lt;15 İyi
          </span>
          <span>
            <i className="dot" style={{ background: "#eab308" }} />
            15–25 Orta
          </span>
          <span>
            <i className="dot" style={{ background: "#f97316" }} />
            25–35 Hassas
          </span>
          <span>
            <i className="dot" style={{ background: "#ef4444" }} />
            &gt;35 Yüksek
          </span>
        </div>
      </main>
    </div>
  );
}

export default App;
