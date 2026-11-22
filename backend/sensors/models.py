from django.contrib.gis.db import models as gis_models
from django.db import models


class Sensor(gis_models.Model):
    """Air-quality monitoring sensor positioned in WGS84 (EPSG:4326)."""

    code = models.CharField(max_length=64, unique=True)
    name = models.CharField(max_length=120)
    district = models.CharField(max_length=80, blank=True, default="")
    location = gis_models.PointField(srid=4326, geography=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "sensors"
        ordering = ["code"]

    @property
    def lat(self) -> float:
        return self.location.y

    @property
    def lng(self) -> float:
        return self.location.x

    def __str__(self) -> str:
        return f"{self.code} ({self.name})"


class Telemetry(models.Model):
    """Time-series air-quality reading associated with a Sensor."""

    sensor = models.ForeignKey(
        Sensor,
        on_delete=models.CASCADE,
        related_name="telemetry",
    )
    pm25 = models.FloatField()
    pm10 = models.FloatField()
    temperature = models.FloatField()
    humidity = models.FloatField()
    recorded_at = models.DateTimeField(db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "telemetry"
        ordering = ["-recorded_at"]
        indexes = [
            models.Index(fields=["sensor", "-recorded_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.sensor.code} @ {self.recorded_at.isoformat()}"
