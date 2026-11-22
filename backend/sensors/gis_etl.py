import math

from django.contrib.gis.gdal import CoordTransform, DataSource, SpatialReference
from django.contrib.gis.geos import Point
import numpy as np
import rasterio
from shapely import wkt as shapely_wkt

from .models import Sensor


def _safe_feature_get(feature, field_name: str, default=None):
    if field_name not in feature.fields:
        return default
    val = feature.get(field_name)
    return default if val is None else val


def import_geojson_file(file_path: str) -> dict:
    """Read a GeoJSON file via GDAL/OGR, validate geometries with Shapely, transform to EPSG:4326, and upsert Sensors."""
    ds = DataSource(file_path)
    if len(ds) == 0:
        raise ValueError("GeoJSON file contains no layers.")

    layer = ds[0]
    source_srs = layer.srs
    source_srid = source_srs.srid if source_srs and source_srs.srid else 4326
    target_srs = SpatialReference(4326)
    coord_transform = (
        CoordTransform(source_srs, target_srs)
        if source_srs is not None and source_srid != 4326
        else None
    )

    imported = 0
    updated = 0
    skipped = 0
    errors: list[str] = []

    for idx, feature in enumerate(layer):
        try:
            ogr_geom = feature.geom
        except Exception as exc:
            skipped += 1
            errors.append(f"Feature #{idx}: missing or unreadable geometry ({exc}).")
            continue

        if coord_transform is not None:
            ogr_geom.transform(coord_transform)

        try:
            shp = shapely_wkt.loads(ogr_geom.wkt)
        except Exception as exc:
            skipped += 1
            errors.append(f"Feature #{idx}: invalid WKT geometry ({exc}).")
            continue

        if shp.is_empty or not shp.is_valid or shp.geom_type != "Point":
            skipped += 1
            errors.append(
                f"Feature #{idx}: geometry must be a valid non-empty Point (got {shp.geom_type})."
            )
            continue

        if not (
            math.isfinite(shp.x)
            and math.isfinite(shp.y)
            and -180.0 <= shp.x <= 180.0
            and -90.0 <= shp.y <= 90.0
        ):
            skipped += 1
            errors.append(f"Feature #{idx}: coordinates out of WGS84 bounds ({shp.x}, {shp.y}).")
            continue

        code = str(_safe_feature_get(feature, "code", "")).strip()
        name = str(_safe_feature_get(feature, "name", "")).strip()
        if not code or not name:
            skipped += 1
            errors.append(f"Feature #{idx}: both 'code' and 'name' properties are required.")
            continue

        district = str(_safe_feature_get(feature, "district", "")).strip()
        is_active = bool(_safe_feature_get(feature, "is_active", True))

        _, created = Sensor.objects.update_or_create(
            code=code,
            defaults={
                "name": name,
                "district": district,
                "location": Point(float(shp.x), float(shp.y), srid=4326),
                "is_active": is_active,
            },
        )
        if created:
            imported += 1
        else:
            updated += 1

    return {
        "source_srid": source_srid,
        "target_srid": 4326,
        "imported": imported,
        "updated": updated,
        "skipped": skipped,
        "errors": errors,
    }


def read_raster_metadata(file_path: str) -> dict:
    """Open a GeoTIFF via Rasterio and return spatial metadata and band-1 statistics."""
    with rasterio.open(file_path) as src:
        band1 = np.ma.masked_invalid(src.read(1, masked=True))
        if band1.count() > 0:
            stats = {
                "min": round(float(band1.min()), 4),
                "max": round(float(band1.max()), 4),
                "mean": round(float(band1.mean()), 4),
            }
        else:
            stats = None

        return {
            "driver": src.driver,
            "width": src.width,
            "height": src.height,
            "count": src.count,
            "dtypes": list(src.dtypes),
            "crs": src.crs.to_string() if src.crs else None,
            "bounds": {
                "left": round(float(src.bounds.left), 6),
                "bottom": round(float(src.bounds.bottom), 6),
                "right": round(float(src.bounds.right), 6),
                "top": round(float(src.bounds.top), 6),
            },
            "resolution": [round(float(r), 8) for r in src.res],
            "nodata": float(src.nodata) if src.nodata is not None else None,
            "band1_stats": stats,
        }
