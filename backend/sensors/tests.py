import json
import tempfile

from django.contrib.gis.geos import Point
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.utils import timezone
import numpy as np
import rasterio
from rasterio.transform import from_bounds
from rest_framework import status
from rest_framework.test import APIClient

from sensors.models import Sensor, Telemetry


class SensorSpatialAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.kizilay = Sensor.objects.create(
            code="TST-KIZILAY",
            name="Test Kızılay",
            district="Çankaya",
            location=Point(32.8541, 39.9208, srid=4326),
        )
        self.ulus = Sensor.objects.create(
            code="TST-ULUS",
            name="Test Ulus",
            district="Altındağ",
            location=Point(32.8544, 39.9416, srid=4326),
        )
        self.etimesgut = Sensor.objects.create(
            code="TST-ETIMESGUT",
            name="Test Etimesgut",
            district="Etimesgut",
            location=Point(32.6716, 39.9457, srid=4326),
        )
        Telemetry.objects.create(
            sensor=self.kizilay,
            pm25=20.5,
            pm10=35.0,
            temperature=15.0,
            humidity=50.0,
            recorded_at=timezone.now(),
        )

    def test_create_sensor(self):
        payload = {
            "code": "TST-ODTU",
            "name": "Test ODTÜ",
            "district": "Çankaya",
            "lat": 39.8914,
            "lng": 32.7847,
        }
        response = self.client.post("/api/sensors/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["code"], "TST-ODTU")
        self.assertAlmostEqual(response.data["lat"], 39.8914, places=4)
        self.assertAlmostEqual(response.data["lng"], 32.7847, places=4)
        self.assertTrue(Sensor.objects.filter(code="TST-ODTU").exists())

    def test_nearby_sensors_returns_distance_and_filters_far(self):
        response = self.client.get(
            "/api/sensors/nearby/",
            {"lat": "39.9208", "lng": "32.8541", "radius": "3000"},
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        codes = [item["code"] for item in response.data]
        self.assertIn("TST-KIZILAY", codes)
        self.assertIn("TST-ULUS", codes)
        self.assertNotIn("TST-ETIMESGUT", codes)
        self.assertIsNotNone(response.data[0]["distance_m"])
        self.assertLess(response.data[0]["distance_m"], response.data[1]["distance_m"])

    def test_nearby_invalid_params_return_400(self):
        resp_missing = self.client.get("/api/sensors/nearby/", {"lat": "39.92"})
        self.assertEqual(resp_missing.status_code, status.HTTP_400_BAD_REQUEST)

        resp_bad_radius = self.client.get(
            "/api/sensors/nearby/",
            {"lat": "39.92", "lng": "32.85", "radius": "-50"},
        )
        self.assertEqual(resp_bad_radius.status_code, status.HTTP_400_BAD_REQUEST)

    def test_bbox_filters_sensors_inside_bounds(self):
        response = self.client.get(
            "/api/sensors/bbox/",
            {
                "min_lng": "32.84",
                "min_lat": "39.91",
                "max_lng": "32.87",
                "max_lat": "39.95",
            },
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        codes = [item["code"] for item in response.data]
        self.assertEqual(set(codes), {"TST-KIZILAY", "TST-ULUS"})

    def test_geojson_returns_valid_feature_collection(self):
        response = self.client.get("/api/sensors/geojson/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["type"], "FeatureCollection")
        self.assertEqual(len(response.data["features"]), 3)
        kizilay_feature = next(
            f for f in response.data["features"] if f["properties"]["code"] == "TST-KIZILAY"
        )
        self.assertEqual(kizilay_feature["geometry"]["type"], "Point")
        self.assertEqual(kizilay_feature["geometry"]["coordinates"], [32.8541, 39.9208])
        self.assertIsNotNone(kizilay_feature["properties"]["latest_telemetry"])

    def test_geojson_import_valid_and_invalid(self):
        geojson_payload = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {
                        "code": "TST-IMPORT-1",
                        "name": "Imported Point",
                        "district": "Çankaya",
                    },
                    "geometry": {"type": "Point", "coordinates": [32.85, 39.91]},
                },
                {
                    "type": "Feature",
                    "properties": {
                        "code": "TST-BAD-POLY",
                        "name": "Not a Point",
                    },
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [
                            [[32.8, 39.9], [32.81, 39.9], [32.81, 39.91], [32.8, 39.9]]
                        ],
                    },
                },
            ],
        }
        uploaded = SimpleUploadedFile(
            "test_sensors.geojson",
            json.dumps(geojson_payload).encode("utf-8"),
            content_type="application/geo+json",
        )
        response = self.client.post("/api/gis/import-geojson/", {"file": uploaded})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["imported"], 1)
        self.assertEqual(response.data["skipped"], 1)
        self.assertEqual(response.data["target_srid"], 4326)
        self.assertTrue(Sensor.objects.filter(code="TST-IMPORT-1").exists())

    def test_raster_metadata_endpoint(self):
        with tempfile.NamedTemporaryFile(suffix=".tif") as tmp:
            data = np.arange(16 * 16, dtype=np.float32).reshape((16, 16))
            transform = from_bounds(32.7, 39.8, 32.9, 40.0, 16, 16)
            with rasterio.open(
                tmp.name,
                "w",
                driver="GTiff",
                height=16,
                width=16,
                count=1,
                dtype="float32",
                crs="EPSG:4326",
                transform=transform,
            ) as dst:
                dst.write(data, 1)

            tmp.seek(0)
            uploaded = SimpleUploadedFile(
                "sample.tif", tmp.read(), content_type="image/tiff"
            )
            response = self.client.post("/api/gis/raster-metadata/", {"file": uploaded})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["driver"], "GTiff")
        self.assertEqual(response.data["width"], 16)
        self.assertEqual(response.data["height"], 16)
        self.assertEqual(response.data["crs"], "EPSG:4326")
        self.assertEqual(response.data["band1_stats"]["min"], 0.0)
        self.assertEqual(response.data["band1_stats"]["max"], 255.0)
