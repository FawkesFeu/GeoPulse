import { useEffect, useRef, useState } from "react";
import maplibregl, { type GeoJSONSource, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { SensorFeatureCollection } from "../types";

interface SensorMapProps {
  geojson: SensorFeatureCollection;
  nearbyMode: boolean;
  nearbyCenter: { lat: number; lng: number } | null;
  selectedSensorId: number | null;
  onSelectSensor: (sensorId: number) => void;
  onMapClickNearby: (lat: number, lng: number) => void;
}

const ANKARA_CENTER: [number, number] = [32.8541, 39.9208];

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

function emptyPoints(): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return { type: "FeatureCollection", features: [] };
}

export function SensorMap({
  geojson,
  nearbyMode,
  nearbyCenter,
  selectedSensorId,
  onSelectSensor,
  onMapClickNearby,
}: SensorMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const nearbyModeRef = useRef(nearbyMode);
  const onSelectSensorRef = useRef(onSelectSensor);
  const onMapClickNearbyRef = useRef(onMapClickNearby);

  nearbyModeRef.current = nearbyMode;
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
      map.addSource("sensors", {
        type: "geojson",
        data: emptyPoints(),
        cluster: true,
        clusterMaxZoom: 13,
        clusterRadius: 50,
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
          "text-font": ["Open Sans Regular"],
          "text-size": 12,
        },
        paint: {
          "text-color": "#ffffff",
        },
      });

      map.addLayer({
        id: "unclustered-point",
        type: "circle",
        source: "sensors",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": [
            "step",
            ["coalesce", ["get", "pm25"], 0],
            "#22c55e",
            15,
            "#eab308",
            25,
            "#f97316",
            35,
            "#ef4444",
          ],
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
          "text-font": ["Open Sans Regular"],
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

      map.addSource("nearby-point", {
        type: "geojson",
        data: emptyPoints(),
      });

      map.addLayer({
        id: "nearby-marker",
        type: "circle",
        source: "nearby-point",
        paint: {
          "circle-color": "#38bdf8",
          "circle-radius": 9,
          "circle-opacity": 0.9,
          "circle-stroke-width": 3,
          "circle-stroke-color": "#0f172a",
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
        const sensorId = Number(feature?.properties?.id);
        if (!Number.isNaN(sensorId)) {
          onSelectSensorRef.current(sensorId);
        }
      });

      map.on("click", (e) => {
        if (nearbyModeRef.current) {
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
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, []);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const source = mapRef.current.getSource("sensors") as GeoJSONSource | undefined;
    source?.setData(geojson as unknown as GeoJSON.FeatureCollection);
  }, [geojson, mapReady]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    mapRef.current.getCanvas().style.cursor = nearbyMode ? "crosshair" : "";
  }, [nearbyMode, mapReady]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const source = mapRef.current.getSource("nearby-point") as GeoJSONSource | undefined;
    if (!source) return;

    if (!nearbyCenter) {
      source.setData(emptyPoints());
      return;
    }

    source.setData({
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
  }, [nearbyCenter, mapReady]);

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
