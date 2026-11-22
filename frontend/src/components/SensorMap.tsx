import { useEffect, useRef, useState } from "react";
import maplibregl, {
  type ExpressionSpecification,
  type FilterSpecification,
  type GeoJSONSource,
  type StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { SensorFeatureCollection } from "../types";

interface SensorMapProps {
  geojson: SensorFeatureCollection;
  nearbyMode: boolean;
  nearbyRadius: number;
  nearbyCenter: { lat: number; lng: number } | null;
  nearbySensorIds: number[];
  selectedSensorId: number | null;
  onSelectSensor: (sensorId: number) => void;
  onMapClickNearby: (lat: number, lng: number) => void;
}

const ANKARA_CENTER: [number, number] = [32.8541, 39.9208];
const SENSOR_COVERAGE_RADIUS_M = 1000;
const EARTH_RADIUS_M = 6378137;

const PM25_COLOR_EXPR: ExpressionSpecification = [
  "step",
  ["coalesce", ["get", "pm25"], 0],
  "#22c55e",
  15,
  "#eab308",
  25,
  "#f97316",
  35,
  "#ef4444",
];

const BASE_STYLE: StyleSpecification = {
  version: 8,
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "&copy; OpenStreetMap contributors",
    },
  },
  layers: [
    {
      id: "osm-tiles",
      type: "raster",
      source: "osm",
    },
  ],
};

function emptyCollection<G extends GeoJSON.Geometry>(): GeoJSON.FeatureCollection<G> {
  return { type: "FeatureCollection", features: [] };
}

function createCirclePolygon(
  lng: number,
  lat: number,
  radiusMeters: number,
  properties: Record<string, unknown> = {},
  steps = 64
): GeoJSON.Feature<GeoJSON.Polygon> {
  const latRad = (lat * Math.PI) / 180;
  const lngRad = (lng * Math.PI) / 180;
  const angularDist = radiusMeters / EARTH_RADIUS_M;
  const ring: [number, number][] = [];

  for (let i = 0; i <= steps; i++) {
    const bearing = (2 * Math.PI * i) / steps;
    const pLat = Math.asin(
      Math.sin(latRad) * Math.cos(angularDist) +
        Math.cos(latRad) * Math.sin(angularDist) * Math.cos(bearing)
    );
    const pLng =
      lngRad +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angularDist) * Math.cos(latRad),
        Math.cos(angularDist) - Math.sin(latRad) * Math.sin(pLat)
      );
    ring.push([(pLng * 180) / Math.PI, (pLat * 180) / Math.PI]);
  }

  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [ring],
    },
    properties,
  };
}

function buildCoverageCollection(
  fc: SensorFeatureCollection
): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  return {
    type: "FeatureCollection",
    features: fc.features.map((f) =>
      createCirclePolygon(
        f.geometry.coordinates[0],
        f.geometry.coordinates[1],
        SENSOR_COVERAGE_RADIUS_M,
        {
          id: f.properties.id,
          code: f.properties.code,
          pm25: f.properties.pm25,
        }
      )
    ),
  };
}

function buildNearbyHighlightFilter(ids: number[]): FilterSpecification {
  return [
    "all",
    ["!", ["has", "point_count"]],
    ["in", ["get", "id"], ["literal", ids]],
  ];
}

function buildPopupDOM(props: Record<string, unknown>): HTMLElement {
  const wrap = document.createElement("div");
  wrap.style.color = "#0f172a";
  wrap.style.fontFamily = "Inter, system-ui, sans-serif";
  wrap.style.fontSize = "12px";
  wrap.style.lineHeight = "1.45";

  const title = document.createElement("div");
  title.style.fontWeight = "700";
  title.textContent = `${String(props.name ?? "")} (${String(props.code ?? "")})`;
  wrap.appendChild(title);

  const metrics = document.createElement("div");
  metrics.style.marginTop = "4px";
  metrics.textContent = `PM2.5: ${props.pm25 ?? "-"} | PM10: ${props.pm10 ?? "-"}`;
  wrap.appendChild(metrics);

  const env = document.createElement("div");
  env.textContent = `Sıcaklık: ${props.temperature ?? "-"}°C | Nem: ${props.humidity ?? "-"}%`;
  wrap.appendChild(env);

  return wrap;
}

export function SensorMap({
  geojson,
  nearbyMode,
  nearbyRadius,
  nearbyCenter,
  nearbySensorIds,
  selectedSensorId,
  onSelectSensor,
  onMapClickNearby,
}: SensorMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const geojsonRef = useRef(geojson);
  const nearbyModeRef = useRef(nearbyMode);
  const nearbyRadiusRef = useRef(nearbyRadius);
  const nearbyCenterRef = useRef(nearbyCenter);
  const nearbySensorIdsRef = useRef(nearbySensorIds);
  const onSelectSensorRef = useRef(onSelectSensor);
  const onMapClickNearbyRef = useRef(onMapClickNearby);

  geojsonRef.current = geojson;
  nearbyModeRef.current = nearbyMode;
  nearbyRadiusRef.current = nearbyRadius;
  nearbyCenterRef.current = nearbyCenter;
  nearbySensorIdsRef.current = nearbySensorIds;
  onSelectSensorRef.current = onSelectSensor;
  onMapClickNearbyRef.current = onMapClickNearby;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASE_STYLE,
      center: ANKARA_CENTER,
      zoom: 11,
    });

    map.addControl(new maplibregl.NavigationControl(), "top-right");

    map.on("load", () => {
      // 1. Sensor 1km coverage zones
      map.addSource("sensor-coverage", {
        type: "geojson",
        data: buildCoverageCollection(geojsonRef.current),
      });

      map.addLayer({
        id: "sensor-coverage-fill",
        type: "fill",
        source: "sensor-coverage",
        paint: {
          "fill-color": PM25_COLOR_EXPR,
          "fill-opacity": 0.18,
        },
      });

      map.addLayer({
        id: "sensor-coverage-outline",
        type: "line",
        source: "sensor-coverage",
        paint: {
          "line-color": PM25_COLOR_EXPR,
          "line-width": 1.5,
          "line-opacity": 0.65,
        },
      });

      // 2. Nearby query search radius circle & center pin
      const initialCenter = nearbyCenterRef.current;
      map.addSource("nearby-radius", {
        type: "geojson",
        data: initialCenter
          ? {
              type: "FeatureCollection",
              features: [
                createCirclePolygon(
                  initialCenter.lng,
                  initialCenter.lat,
                  nearbyRadiusRef.current
                ),
              ],
            }
          : emptyCollection<GeoJSON.Polygon>(),
      });

      map.addLayer({
        id: "nearby-radius-fill",
        type: "fill",
        source: "nearby-radius",
        paint: {
          "fill-color": "#38bdf8",
          "fill-opacity": 0.16,
        },
      });

      map.addLayer({
        id: "nearby-radius-outline",
        type: "line",
        source: "nearby-radius",
        paint: {
          "line-color": "#38bdf8",
          "line-width": 2.5,
          "line-dasharray": [3, 2],
        },
      });

      map.addSource("nearby-point", {
        type: "geojson",
        data: initialCenter
          ? {
              type: "FeatureCollection",
              features: [
                {
                  type: "Feature",
                  geometry: {
                    type: "Point",
                    coordinates: [initialCenter.lng, initialCenter.lat],
                  },
                  properties: {},
                },
              ],
            }
          : emptyCollection<GeoJSON.Point>(),
      });

      map.addLayer({
        id: "nearby-marker",
        type: "circle",
        source: "nearby-point",
        paint: {
          "circle-color": "#38bdf8",
          "circle-radius": 8,
          "circle-stroke-width": 3,
          "circle-stroke-color": "#0f172a",
        },
      });

      // 3. Clustered sensor markers & labels
      map.addSource("sensors", {
        type: "geojson",
        data: geojsonRef.current as unknown as GeoJSON.FeatureCollection,
        cluster: true,
        clusterMaxZoom: 12,
        clusterRadius: 40,
      });

      map.addLayer({
        id: "clusters",
        type: "circle",
        source: "sensors",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": [
            "step",
            ["get", "point_count"],
            "#38bdf8",
            4,
            "#6366f1",
            8,
            "#a855f7",
          ],
          "circle-radius": ["step", ["get", "point_count"], 18, 4, 24, 8, 30],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#0f172a",
        },
      });

      map.addLayer({
        id: "cluster-count",
        type: "symbol",
        source: "sensors",
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-font": ["Open Sans Semibold"],
          "text-size": 12,
        },
        paint: {
          "text-color": "#ffffff",
        },
      });

      map.addLayer({
        id: "nearby-highlight",
        type: "circle",
        source: "sensors",
        filter: buildNearbyHighlightFilter(nearbySensorIdsRef.current),
        paint: {
          "circle-color": "transparent",
          "circle-radius": 15,
          "circle-stroke-width": 3,
          "circle-stroke-color": "#38bdf8",
        },
      });

      map.addLayer({
        id: "unclustered-point",
        type: "circle",
        source: "sensors",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": PM25_COLOR_EXPR,
          "circle-radius": 10,
          "circle-stroke-width": 2.5,
          "circle-stroke-color": "#ffffff",
        },
      });

      map.addLayer({
        id: "unclustered-label",
        type: "symbol",
        source: "sensors",
        filter: ["!", ["has", "point_count"]],
        layout: {
          "text-field": ["get", "code"],
          "text-font": ["Open Sans Semibold"],
          "text-size": 11,
          "text-offset": [0, 1.5],
          "text-anchor": "top",
        },
        paint: {
          "text-color": "#0f172a",
          "text-halo-color": "#ffffff",
          "text-halo-width": 1.5,
        },
      });

      map.on("click", "clusters", (e) => {
        if (nearbyModeRef.current) return;
        const features = map.queryRenderedFeatures(e.point, { layers: ["clusters"] });
        const cluster = features[0];
        if (!cluster || cluster.geometry.type !== "Point") return;
        const clusterId = Number(cluster.properties?.cluster_id);
        const source = map.getSource("sensors") as GeoJSONSource | undefined;
        if (!source || Number.isNaN(clusterId)) return;

        const coords = cluster.geometry.coordinates as [number, number];
        void source.getClusterExpansionZoom(clusterId).then((zoom) => {
          map.easeTo({ center: coords, zoom });
        });
      });

      map.on("click", "unclustered-point", (e) => {
        if (nearbyModeRef.current) return;
        const feature = e.features?.[0];
        if (!feature || feature.geometry.type !== "Point") return;
        const props = (feature.properties ?? {}) as Record<string, unknown>;
        const sensorId = Number(props.id);
        const coords = feature.geometry.coordinates as [number, number];

        popupRef.current?.remove();
        popupRef.current = new maplibregl.Popup({ offset: 14 })
          .setLngLat(coords)
          .setDOMContent(buildPopupDOM(props))
          .addTo(map);

        if (!Number.isNaN(sensorId)) {
          onSelectSensorRef.current(sensorId);
        }
      });

      map.on("click", (e) => {
        if (nearbyModeRef.current) {
          popupRef.current?.remove();
          onMapClickNearbyRef.current(e.lngLat.lat, e.lngLat.lng);
        }
      });

      for (const layerId of ["clusters", "unclustered-point"]) {
        map.on("mouseenter", layerId, () => {
          if (!nearbyModeRef.current) {
            map.getCanvas().style.cursor = "pointer";
          }
        });
        map.on("mouseleave", layerId, () => {
          map.getCanvas().style.cursor = nearbyModeRef.current ? "crosshair" : "";
        });
      }

      setMapReady(true);
    });

    mapRef.current = map;

    return () => {
      popupRef.current?.remove();
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, []);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const sensorSource = mapRef.current.getSource("sensors") as GeoJSONSource | undefined;
    sensorSource?.setData(geojson as unknown as GeoJSON.FeatureCollection);

    const coverageSource = mapRef.current.getSource("sensor-coverage") as
      | GeoJSONSource
      | undefined;
    coverageSource?.setData(buildCoverageCollection(geojson));
  }, [geojson, mapReady]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    mapRef.current.getCanvas().style.cursor = nearbyMode ? "crosshair" : "";
  }, [nearbyMode, mapReady]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const pointSource = mapRef.current.getSource("nearby-point") as GeoJSONSource | undefined;
    const radiusSource = mapRef.current.getSource("nearby-radius") as GeoJSONSource | undefined;
    if (!pointSource || !radiusSource) return;

    if (!nearbyCenter) {
      pointSource.setData(emptyCollection<GeoJSON.Point>());
      radiusSource.setData(emptyCollection<GeoJSON.Polygon>());
      return;
    }

    pointSource.setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [nearbyCenter.lng, nearbyCenter.lat],
          },
          properties: {},
        },
      ],
    });
    radiusSource.setData({
      type: "FeatureCollection",
      features: [createCirclePolygon(nearbyCenter.lng, nearbyCenter.lat, nearbyRadius)],
    });
  }, [nearbyCenter, nearbyRadius, mapReady]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    mapRef.current.setFilter("nearby-highlight", buildNearbyHighlightFilter(nearbySensorIds));
  }, [nearbySensorIds, mapReady]);

  useEffect(() => {
    if (!mapReady || !mapRef.current || selectedSensorId == null) return;
    const target = geojson.features.find((f) => f.properties.id === selectedSensorId);
    if (!target) return;
    mapRef.current.easeTo({
      center: target.geometry.coordinates,
      zoom: Math.max(mapRef.current.getZoom(), 12.5),
      duration: 500,
    });
  }, [selectedSensorId, mapReady]);

  return <div ref={containerRef} className="map-canvas" />;
}
