from django.urls import path

from .views import (
    GeoJSONImportView,
    RasterMetadataView,
    SensorBBoxView,
    SensorDetailView,
    SensorGeoJSONView,
    SensorListCreateView,
    SensorNearbyView,
)

urlpatterns = [
    path("sensors/", SensorListCreateView.as_view(), name="sensor-list-create"),
    path("sensors/geojson/", SensorGeoJSONView.as_view(), name="sensor-geojson"),
    path("sensors/nearby/", SensorNearbyView.as_view(), name="sensor-nearby"),
    path("sensors/bbox/", SensorBBoxView.as_view(), name="sensor-bbox"),
    path("sensors/<int:pk>/", SensorDetailView.as_view(), name="sensor-detail"),
    path("gis/import-geojson/", GeoJSONImportView.as_view(), name="gis-import-geojson"),
    path("gis/raster-metadata/", RasterMetadataView.as_view(), name="gis-raster-metadata"),
]
