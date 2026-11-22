from django.contrib.gis.geos import Point
from rest_framework import serializers

from .models import Sensor, Telemetry


class TelemetrySerializer(serializers.ModelSerializer):
    class Meta:
        model = Telemetry
        fields = [
            "id",
            "sensor",
            "pm25",
            "pm10",
            "temperature",
            "humidity",
            "recorded_at",
        ]


def get_latest_telemetry_data(sensor: Sensor) -> dict | None:
    """Return serialized latest telemetry reading using prefetch cache when available."""
    prefetched = getattr(sensor, "_prefetched_objects_cache", {})
    if "telemetry" in prefetched:
        readings = sensor.telemetry.all()
        latest = readings[0] if readings else None
    else:
        latest = sensor.telemetry.first()
    if latest is None:
        return None
    return TelemetrySerializer(latest).data


class SensorSerializer(serializers.ModelSerializer):
    lat = serializers.FloatField(min_value=-90.0, max_value=90.0)
    lng = serializers.FloatField(min_value=-180.0, max_value=180.0)
    latest_telemetry = serializers.SerializerMethodField()
    distance_m = serializers.SerializerMethodField()

    class Meta:
        model = Sensor
        fields = [
            "id",
            "code",
            "name",
            "district",
            "lat",
            "lng",
            "is_active",
            "latest_telemetry",
            "distance_m",
            "created_at",
        ]
        read_only_fields = ["id", "latest_telemetry", "distance_m", "created_at"]

    def get_latest_telemetry(self, obj: Sensor) -> dict | None:
        return get_latest_telemetry_data(obj)

    def get_distance_m(self, obj: Sensor) -> float | None:
        distance = getattr(obj, "distance", None)
        if distance is None:
            return None
        return round(distance.m, 2)

    def create(self, validated_data: dict) -> Sensor:
        lat = validated_data.pop("lat")
        lng = validated_data.pop("lng")
        validated_data["location"] = Point(lng, lat, srid=4326)
        return super().create(validated_data)

    def update(self, instance: Sensor, validated_data: dict) -> Sensor:
        lat = validated_data.pop("lat", None)
        lng = validated_data.pop("lng", None)
        if lat is not None and lng is not None:
            validated_data["location"] = Point(lng, lat, srid=4326)
        return super().update(instance, validated_data)


def build_geojson(sensors) -> dict:
    """Build a GeoJSON FeatureCollection from a Sensor queryset/iterable."""
    features = []
    for sensor in sensors:
        features.append(
            {
                "type": "Feature",
                "id": sensor.id,
                "geometry": {
                    "type": "Point",
                    "coordinates": [sensor.location.x, sensor.location.y],
                },
                "properties": {
                    "id": sensor.id,
                    "code": sensor.code,
                    "name": sensor.name,
                    "district": sensor.district,
                    "is_active": sensor.is_active,
                    "latest_telemetry": get_latest_telemetry_data(sensor),
                },
            }
        )
    return {
        "type": "FeatureCollection",
        "features": features,
    }
