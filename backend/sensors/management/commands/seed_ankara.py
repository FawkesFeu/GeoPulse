from django.contrib.gis.geos import Point
from django.core.management.base import BaseCommand
from django.utils import timezone

from sensors.models import Sensor, Telemetry

ANKARA_SENSORS = [
    {
        "code": "ANK-KIZILAY",
        "name": "Kızılay Meydanı",
        "district": "Çankaya",
        "lat": 39.9208,
        "lng": 32.8541,
        "pm25": 24.5,
        "pm10": 42.1,
        "temperature": 14.2,
        "humidity": 52.0,
    },
    {
        "code": "ANK-ULUS",
        "name": "Ulus Meydanı",
        "district": "Altındağ",
        "lat": 39.9416,
        "lng": 32.8544,
        "pm25": 31.2,
        "pm10": 54.0,
        "temperature": 13.8,
        "humidity": 55.0,
    },
    {
        "code": "ANK-TUNALI",
        "name": "Tunalı Hilmi",
        "district": "Çankaya",
        "lat": 39.9035,
        "lng": 32.8606,
        "pm25": 19.4,
        "pm10": 35.8,
        "temperature": 14.5,
        "humidity": 49.0,
    },
    {
        "code": "ANK-BAHCELIEVLER",
        "name": "Bahçelievler 7. Cadde",
        "district": "Çankaya",
        "lat": 39.9219,
        "lng": 32.8226,
        "pm25": 21.8,
        "pm10": 38.4,
        "temperature": 14.1,
        "humidity": 51.0,
    },
    {
        "code": "ANK-ODTU",
        "name": "ODTÜ Kampüsü",
        "district": "Çankaya",
        "lat": 39.8914,
        "lng": 32.7847,
        "pm25": 11.2,
        "pm10": 20.5,
        "temperature": 12.9,
        "humidity": 58.0,
    },
    {
        "code": "ANK-BATIKENT",
        "name": "Batıkent Meydanı",
        "district": "Yenimahalle",
        "lat": 39.9693,
        "lng": 32.7305,
        "pm25": 17.6,
        "pm10": 31.0,
        "temperature": 13.4,
        "humidity": 54.0,
    },
    {
        "code": "ANK-KECIOREN",
        "name": "Keçiören Şelale",
        "district": "Keçiören",
        "lat": 39.9781,
        "lng": 32.8622,
        "pm25": 27.9,
        "pm10": 48.3,
        "temperature": 13.1,
        "humidity": 56.0,
    },
    {
        "code": "ANK-ETIMESGUT",
        "name": "Etimesgut Merkez",
        "district": "Etimesgut",
        "lat": 39.9457,
        "lng": 32.6716,
        "pm25": 22.3,
        "pm10": 40.7,
        "temperature": 13.6,
        "humidity": 53.0,
    },
]


class Command(BaseCommand):
    help = "Idempotently seed 8 air-quality sensors across Ankara with initial telemetry."

    def handle(self, *args, **options):
        created_sensors = 0
        created_telemetry = 0
        now = timezone.now()

        for item in ANKARA_SENSORS:
            sensor, created = Sensor.objects.get_or_create(
                code=item["code"],
                defaults={
                    "name": item["name"],
                    "district": item["district"],
                    "location": Point(item["lng"], item["lat"], srid=4326),
                    "is_active": True,
                },
            )
            if created:
                created_sensors += 1

            if not sensor.telemetry.exists():
                Telemetry.objects.create(
                    sensor=sensor,
                    pm25=item["pm25"],
                    pm10=item["pm10"],
                    temperature=item["temperature"],
                    humidity=item["humidity"],
                    recorded_at=now,
                )
                created_telemetry += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"Ankara seed complete: {created_sensors} sensors created, "
                f"{created_telemetry} initial telemetry records created."
            )
        )
