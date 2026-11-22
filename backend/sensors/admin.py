from django.contrib.gis import admin

from .models import Sensor, Telemetry


@admin.register(Sensor)
class SensorAdmin(admin.GISModelAdmin):
    list_display = ("code", "name", "district", "is_active", "created_at")
    search_fields = ("code", "name", "district")
    list_filter = ("is_active", "district")


@admin.register(Telemetry)
class TelemetryAdmin(admin.ModelAdmin):
    list_display = ("sensor", "pm25", "pm10", "temperature", "humidity", "recorded_at")
    list_filter = ("sensor",)
    ordering = ("-recorded_at",)
