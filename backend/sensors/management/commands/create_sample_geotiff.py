from pathlib import Path

from django.core.management.base import BaseCommand
import numpy as np
import rasterio
from rasterio.transform import from_bounds


class Command(BaseCommand):
    help = "Generate a sample 32x32 EPSG:4326 GeoTIFF file for Ankara AQI metadata testing."

    def handle(self, *args, **options):
        output_path = Path("/app/data/ankara_sample_aqi.tif")
        output_path.parent.mkdir(parents=True, exist_ok=True)

        width, height = 32, 32
        x = np.linspace(10.0, 35.0, width, dtype=np.float32)
        y = np.linspace(0.0, 10.0, height, dtype=np.float32)
        grid = y[:, None] + x[None, :]

        transform = from_bounds(32.65, 39.85, 32.95, 40.00, width, height)

        with rasterio.open(
            output_path,
            "w",
            driver="GTiff",
            height=height,
            width=width,
            count=1,
            dtype="float32",
            crs="EPSG:4326",
            transform=transform,
            nodata=-9999.0,
        ) as dst:
            dst.write(grid, 1)

        self.stdout.write(self.style.SUCCESS(f"Created sample GeoTIFF at {output_path}"))
