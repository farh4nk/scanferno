"""Search catalog: every Matterport-scanned building (scripts/sync_catalog.py), plus on-demand Vexcel per building.

Files (gzipped JSON, committed so search works offline):
  fixtures/catalog/matterport_models.json.gz   raw model list from the Matterport API
  fixtures/catalog/buildings.json.gz           models grouped into buildings, joined to CoStar
  fixtures/catalog/vexcel/<id>/...             Vexcel roof/footprint and aerial, cached the first time someone opens it
"""
import gzip
import json
from functools import lru_cache

from . import cache, vexcel

DIR = cache.FIXTURES / "catalog"


def _load(name: str):
    p = DIR / name
    return json.loads(gzip.decompress(p.read_bytes()).decode("utf-8")) if p.exists() else None


def _save(data, name: str) -> None:
    DIR.mkdir(parents=True, exist_ok=True)
    (DIR / name).write_bytes(gzip.compress(json.dumps(data, separators=(",", ":"), ensure_ascii=False).encode("utf-8"), 9))


def load_models() -> list[dict] | None:
    return _load("matterport_models.json.gz")


def save_models(models: list[dict]) -> None:
    _save(models, "matterport_models.json.gz")


@lru_cache
def buildings() -> tuple[dict, ...]:
    return tuple(_load("buildings.json.gz") or [])


def save_buildings(rows: list[dict]) -> None:
    _save(rows, "buildings.json.gz")
    buildings.cache_clear()


def _summary(data: dict) -> dict:
    feats = data.get("features") or []
    p = next((f["properties"] for f in feats if (f.get("properties") or {}).get("primary-structure")),
             (feats[0].get("properties") if feats else None)) or {}
    return {
        "footprint_area_m2": round(p["footprint.area"]) if p.get("footprint.area") else None,
        "footprint_wkt": p.get("footprint.wkt"),
        "roof_material": p.get("roof-characteristics.material.class"),
        "roof_shape": p.get("roof-characteristics.shape.value"),
        "roof_condition": p.get("roof-characteristics.condition"),
        "solar": bool(p.get("roof-objects.solar.value")),
        "skylights": p.get("roof-objects.skylight.count") or 0,
        "ac_units": p.get("roof-objects.ac-unit.count") or 0,
        "ground_elevation_m": p.get("ground-elevation.value"),
        "structures": len(feats),
    }


def vexcel_summary(entry: dict, fetch: bool = True) -> dict | None:
    """Roof + footprint for a catalog building. Cached; fetched from Vexcel MCP on first use if fetch=True."""
    if entry.get("lat") is None:
        return None
    cached = [("catalog", "vexcel", entry["id"])]
    if entry.get("building_id"):
        cached.insert(0, (entry["building_id"], "vexcel"))
    for folder in cached:
        data = cache.load_json(*folder, "structure_metadata_extract.json")
        if data is not None:
            return _summary(data)
    if not fetch:
        return None
    data = vexcel.structure(entry["lat"], entry["lon"], "structure_metadata_extract")
    cache.save_json(data, "catalog", "vexcel", entry["id"], "structure_metadata_extract.json")
    return _summary(data)


def aerial(entry: dict, view: str = "nadir") -> bytes | None:
    """One Vexcel image of the building, cached. Hero buildings reuse their fixtures."""
    if entry.get("lat") is None or view not in vexcel.VIEWS:
        return None
    paths = [cache.FIXTURES / entry["building_id"] / "vexcel" / f"{view}.jpg"] if entry.get("building_id") else []
    paths.append(DIR / "vexcel" / entry["id"] / f"{view}.jpg")
    for p in paths:
        if p.exists():
            return p.read_bytes()
    img = vexcel.oriented_image(entry["lat"], entry["lon"], view)
    cache.save_bytes(img, "catalog", "vexcel", entry["id"], f"{view}.jpg")
    return img
