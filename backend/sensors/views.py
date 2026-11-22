import math
import os
import tempfile

from django.contrib.gis.db.models.functions import Distance
from django.contrib.gis.geos import Point, Polygon
from django.contrib.gis.measure import D
from django.db.models import Prefetch
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from .gis_etl import import_geojson_file, read_raster_metadata
from .models import Sensor, Telemetry
from .serializers import SensorSerializer, TelemetrySerializer, build_geojson


def _telemetry_prefetch() -> Prefetch:
    return Prefetch("telemetry", queryset=Telemetry.objects.order_by("-recorded_at"))


def _parse_float(value: str | None, name: str) -> float:
    if value is None or value == "":
        raise ValueError(f"Missing required parameter '{name}'.")
    parsed = float(value)
    if not math.isfinite(parsed):
        raise ValueError(f"Parameter '{name}' must be a finite number.")
    return parsed


def _build_bbox_polygon(
    min_lng: float, min_lat: float, max_lng: float, max_lat: float
) -> Polygon:
    if not (-180.0 <= min_lng < max_lng <= 180.0):
        raise ValueError("Longitude bounds must satisfy -180 <= min_lng < max_lng <= 180.")
    if not (-90.0 <= min_lat < max_lat <= 90.0):
        raise ValueError("Latitude bounds must satisfy -90 <= min_lat < max_lat <= 90.")
    poly = Polygon.from_bbox((min_lng, min_lat, max_lng, max_lat))
    poly.srid = 4326
    return poly


class SensorListCreateView(APIView):
    def get(self, request):
        queryset = Sensor.objects.prefetch_related(_telemetry_prefetch())
        bbox_raw = request.query_params.get("bbox")
        if bbox_raw:
            try:
                parts = [float(p.strip()) for p in bbox_raw.split(",")]
                if len(parts) != 4 or not all(math.isfinite(x) for x in parts):
                    raise ValueError("bbox must contain 4 numbers: min_lng,min_lat,max_lng,max_lat.")
                bbox_poly = _build_bbox_polygon(*parts)
            except ValueError as exc:
                return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
            queryset = queryset.filter(location__intersects=bbox_poly)

        serializer = SensorSerializer(queryset, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    def post(self, request):
        serializer = SensorSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        sensor = serializer.save()
        return Response(SensorSerializer(sensor).data, status=status.HTTP_201_CREATED)


class SensorDetailView(APIView):
    def get(self, request, pk: int):
        sensor = get_object_or_404(Sensor, pk=pk)
        sensor_data = SensorSerializer(sensor).data
        recent_readings = sensor.telemetry.order_by("-recorded_at")[:20]
        sensor_data["telemetry"] = TelemetrySerializer(recent_readings, many=True).data
        return Response(sensor_data, status=status.HTTP_200_OK)


class SensorGeoJSONView(APIView):
    def get(self, request):
        sensors = Sensor.objects.filter(is_active=True).prefetch_related(_telemetry_prefetch())
        return Response(build_geojson(sensors), status=status.HTTP_200_OK)


class SensorNearbyView(APIView):
    def get(self, request):
        try:
            lat = _parse_float(request.query_params.get("lat"), "lat")
            lng = _parse_float(request.query_params.get("lng"), "lng")
            radius_raw = request.query_params.get("radius")
            radius = _parse_float(radius_raw, "radius") if radius_raw is not None else 1000.0
            if not (-90.0 <= lat <= 90.0):
                raise ValueError("Parameter 'lat' must be between -90 and 90.")
            if not (-180.0 <= lng <= 180.0):
                raise ValueError("Parameter 'lng' must be between -180 and 180.")
            if radius <= 0:
                raise ValueError("Parameter 'radius' must be greater than 0.")
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        point = Point(lng, lat, srid=4326)
        sensors = (
            Sensor.objects.filter(is_active=True, location__dwithin=(point, D(m=radius)))
            .annotate(distance=Distance("location", point))
            .prefetch_related(_telemetry_prefetch())
            .order_by("distance")
        )
        serializer = SensorSerializer(sensors, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)


class SensorBBoxView(APIView):
    def get(self, request):
        try:
            min_lng = _parse_float(request.query_params.get("min_lng"), "min_lng")
            min_lat = _parse_float(request.query_params.get("min_lat"), "min_lat")
            max_lng = _parse_float(request.query_params.get("max_lng"), "max_lng")
            max_lat = _parse_float(request.query_params.get("max_lat"), "max_lat")
            bbox_poly = _build_bbox_polygon(min_lng, min_lat, max_lng, max_lat)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        sensors = (
            Sensor.objects.filter(is_active=True, location__intersects=bbox_poly)
            .prefetch_related(_telemetry_prefetch())
        )
        serializer = SensorSerializer(sensors, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)


def _handle_gis_upload(request, suffix: str, processor):
    uploaded = request.FILES.get("file")
    if uploaded is None:
        return Response(
            {"detail": "Multipart field 'file' is required."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            for chunk in uploaded.chunks():
                tmp.write(chunk)
            tmp_path = tmp.name
        result = processor(tmp_path)
        return Response(result, status=status.HTTP_200_OK)
    except Exception as exc:
        return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)


class GeoJSONImportView(APIView):
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        return _handle_gis_upload(request, ".geojson", import_geojson_file)


class RasterMetadataView(APIView):
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        return _handle_gis_upload(request, ".tif", read_raster_metadata)
