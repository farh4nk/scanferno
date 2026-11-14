"""Turn a searchable catalog building into a ready briefing building (same cache layout as heroes).

    prepare(key)  -> {building_id, status, cached, building, ...}
Fetches Matterport vector data if missing, writes a config row into the ondemand registry, builds
floorplan.json, and optionally fills CoStar / one Vexcel nadir. Idempotent: a second call is a cache hit.
"""
from data import cache, costar, directory, layers, matterport, vexcel
from geometry.floorplan import _is_void

from . import registry


class OnboardError(Exception):
    """Something we can show the user (no scan, empty rooms, Matterport down)."""


def status(key: str) -> dict | None:
    """Ready state for a catalog / CoStar / model / building id, or None if unknown."""
    e = directory.get(key)
    if e is None:
        return None
    bid = e["building_id"] or e["id"]
    row = registry.get(bid) or (e if e["status"] == "ready" else None)
    if row is None and e["status"] == "ready":
        row = {"id": bid}
    ready = bool(row) and cache.FIXTURES.joinpath(bid, "matterport_vector.json").exists()
    return {
        "key": key,
        "building_id": bid,
        "status": "ready" if ready else "scanned",
        "cached": ready,
        "name": e.get("name"),
        "address": e.get("address"),
        "scan": e.get("scan"),
        "models_count": e.get("models_count"),
    }


def prepare(key: str, refresh: bool = False, fetch_outside: bool = True) -> dict:
    """Make a catalog building ready. Raises OnboardError on failure."""
    e = directory.get(key)
    if e is None:
        raise OnboardError(f"Unknown property {key}")

    # Heroes are already ready; still ensure floorplan is built.
    if e["status"] == "ready" and e.get("building_id") and not refresh:
        bid = e["building_id"]
        layers.floorplan(bid)
        return _result(bid, cached=True, entry=e)

    mid = _best_model(e)
    if not mid:
        raise OnboardError("This property has no Matterport scan to build a floor plan from")

    bid = e["building_id"] or e["id"]
    row = _config_row(e, bid, mid)
    vector_path = cache.FIXTURES / bid / "matterport_vector.json"
    cached = vector_path.exists() and not refresh

    if not cached:
        try:
            raw = matterport.vector_data(mid)
        except Exception as ex:
            raise OnboardError(f"Matterport vector fetch failed: {type(ex).__name__}: {ex}") from ex
        rooms = [r for r in (raw.get("rooms") or []) if not _is_void(r)]
        if len(rooms) < 1:
            raise OnboardError("Scan has no usable rooms (only Void / empty)")
        cache.save_json(raw, bid, "matterport_vector.json")

    _ensure_costar(bid, e)
    if fetch_outside and e.get("lat") is not None:
        _ensure_vexcel(bid, e["lat"], e["lon"], refresh)

    registry.upsert(row)
    layers.clear()
    directory.clear()  # search list flips to ready / building_id
    try:
        layers.floorplan(bid)
    except Exception as ex:
        raise OnboardError(f"Floor plan build failed: {type(ex).__name__}: {ex}") from ex

    return _result(bid, cached=cached, entry=e)


def _best_model(e: dict) -> str | None:
    models = e.get("models") or []
    if models:
        return max(models, key=lambda m: (m.get("rooms") or 0, m.get("floors") or 0))["id"]
    scan = e.get("scan") or {}
    return scan.get("model_id")


def _config_row(e: dict, bid: str, model_id: str) -> dict:
    existing = registry.get(bid) or {}
    hero = next((b for b in cache.buildings() if b["id"] == bid), None)
    if hero:
        return {**hero}
    return {
        **existing,
        "id": bid,
        "name": e.get("name") or bid,
        "address": e.get("address"),
        "lat": e.get("lat"),
        "lon": e.get("lon"),
        "matterport_model_id": model_id,
        "costar_property_id": e.get("costar_property_id"),
        "front": existing.get("front") or "S",
        "scan_rotation_deg": existing.get("scan_rotation_deg") or 0,
        "ondemand": True,
    }


def _ensure_costar(bid: str, e: dict) -> None:
    if cache.FIXTURES.joinpath(bid, "costar.json").exists():
        return
    pid = e.get("costar_property_id")
    if pid is not None:
        try:
            costar.get({"id": bid, "costar_property_id": pid})
            return
        except Exception:
            pass
    c = e.get("costar") or {}
    cache.save_json({
        "costar_property_id": pid,
        "building_name": e.get("name"),
        "address": e.get("address"),
        "lat": e.get("lat"),
        "lon": e.get("lon"),
        "property_type": e.get("property_type") or c.get("property_type"),
        "stories": e.get("stories") or c.get("stories"),
        "current_tenant_count": e.get("tenants") or c.get("current_tenant_count"),
        "tenants": [{"name": n} for n in (c.get("tenant_names") or [])],
        "matterport_model_ids": [m["id"] for m in (e.get("models") or [])],
    }, bid, "costar.json")


def _ensure_vexcel(bid: str, lat: float, lon: float, refresh: bool) -> None:
    """One nadir + structure metadata is enough for the aerial panel; skip if already cached."""
    nadir = cache.FIXTURES / bid / "vexcel" / "nadir.jpg"
    meta = cache.FIXTURES / bid / "vexcel" / "structure_metadata_extract.json"
    try:
        if refresh or not nadir.exists():
            cache.save_bytes(vexcel.oriented_image(lat, lon, "nadir"), bid, "vexcel", "nadir.jpg")
        if refresh or not meta.exists():
            cache.save_json(vexcel.structure(lat, lon), bid, "vexcel", "structure_metadata_extract.json")
    except Exception:
        pass  # aerial is optional; floor plan still works


def _result(bid: str, cached: bool, entry: dict) -> dict:
    b = layers.building(bid)
    return {
        "building_id": bid,
        "status": "ready",
        "cached": cached,
        "building": b,
        "name": b.get("name") or entry.get("name"),
        "address": b.get("address") or entry.get("address"),
        "matterport_model_id": b.get("matterport_model_id"),
        "scan": entry.get("scan"),
    }
