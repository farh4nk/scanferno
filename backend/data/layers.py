"""One place to get every data layer for a hero building, from the cached fixtures (works offline).

    building(bid)   config row from fixtures/buildings.json
    costar(bid)     who's inside (fixtures/<bid>/costar.json)
    outside(bid)    Vexcel roof / footprint / height summary + aerial image paths
    floorplan(bid)  Matterport -> floorplan.json with maze score (written to fixtures/<bid>/floorplan.json)
    nav(bid)        NavGraph for routes;  sides(bid)  A/B/C/D helper
"""
import re
from functools import lru_cache

from geometry import egress, floorplan as fp_builder
from geometry.navgraph import NavGraph
from geometry.sides import Sides, footprint_sides

from . import cache, vexcel


def building(bid: str) -> dict:
    for b in cache.buildings():
        if b["id"] == bid:
            return b
    from ondemand import registry  # local import: ondemand depends on layers for floorplan
    row = registry.get(bid)
    if row is not None:
        return row
    raise KeyError(f"Unknown building {bid}")


@lru_cache
def costar(bid: str) -> dict:
    data = cache.load_json(bid, "costar.json")
    if data is None:
        raise FileNotFoundError(f"No CoStar fixture for {bid}; run scripts.fetch_fixtures or POST /ondemand/{{id}}")
    return data


def _props(bid: str, tool: str) -> dict:
    data = cache.load_json(bid, "vexcel", f"{tool}.json") or {}
    feats = [f for f in data.get("features") or [] if f.get("properties", {}).get("primary-structure")] or data.get("features") or []
    return (feats[0] if feats else {}).get("properties") or {}


@lru_cache
def outside(bid: str) -> dict:
    p = _props(bid, "structure_metadata_extract")
    elev = cache.load_json(bid, "vexcel", "elevation.json") or {}
    dsm = None
    if elev.get("wkt"):
        nums = re.findall(r"-?\d+(?:\.\d+)?", elev["wkt"])
        dsm = float(nums[2]) if len(nums) >= 3 else None
    ground = p.get("ground-elevation.value")
    roof_h = round(dsm - ground, 1) if dsm is not None and ground is not None else None
    b = building(bid)
    footprint = p.get("footprint.wkt")
    defects = {}
    for k, v in p.items():
        if k.startswith("roof-defects.") and k.endswith(".detected") and v:
            name = k[len("roof-defects."):-len(".detected")].replace("discoloration.types.", "")
            defects[name] = p.get(k.replace(".detected", ".percent"))
    images = {v: f"fixtures/{bid}/vexcel/{v}.jpg" for v in vexcel.VIEWS
              if cache.FIXTURES.joinpath(bid, "vexcel", f"{v}.jpg").exists()}
    return {
        "footprint_wkt": footprint,
        "footprint_area_m2": round(p["footprint.area"]) if p.get("footprint.area") else None,
        "roof_height_m": roof_h,
        "ground_elevation_m": ground,
        "roof": {
            "material": p.get("roof-characteristics.material.class"),
            "shape": p.get("roof-characteristics.shape.value"),
            "condition_rating": p.get("roof-characteristics.condition"),
            "solar": bool(p.get("roof-objects.solar.value")),
            "skylights": p.get("roof-objects.skylight.count") or 0,
            "ac_units": p.get("roof-objects.ac-unit.count") or 0,
            "vents": p.get("roof-objects.roof-vent.count") or 0,
            "defects": defects,
        },
        "imagery_date_ms": p.get("metadata.ortho-date-estimate"),
        "sides": footprint_sides(footprint, b.get("front", "S")) if footprint else {},
        "images": images,
    }


@lru_cache
def floorplan(bid: str) -> dict:
    raw = cache.load_json(bid, "matterport_vector.json")
    if raw is None:
        raise FileNotFoundError(f"No Matterport fixture for {bid}; run scripts.fetch_fixtures")
    fp = fp_builder.build(raw, building(bid))
    analysis = egress.analyze(fp, NavGraph(fp))
    fp["maze_score"] = analysis["maze_score"]
    fp["maze_detail"] = analysis["maze_detail"]
    fp["exit_routes"] = analysis["exit_routes"]
    sd = Sides(building(bid), fp)
    for d in fp["doors"]:
        if d["is_exit"]:
            d["side"] = sd.of_local(d["position"])
    for w in fp["windows"]:
        if w.get("exterior"):
            w["side"] = sd.of_local(w["position"])
    for r in fp["rooms"]:
        r["side"] = sd.of_local(r["centroid"])
        r["exterior_sides"] = sd.exterior_sides(r["polygon"])
    cache.save_json(fp, bid, "floorplan.json")
    return fp


@lru_cache
def nav(bid: str) -> NavGraph:
    return NavGraph(floorplan(bid))


@lru_cache
def sides(bid: str) -> Sides:
    return Sides(building(bid), floorplan(bid))


def room(bid: str, rid: str) -> dict:
    for r in floorplan(bid)["rooms"]:
        if r["id"] == rid:
            return r
    raise KeyError(f"Unknown room {rid}")


def clear():
    for f in (costar, outside, floorplan, nav, sides):
        f.cache_clear()
