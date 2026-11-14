"""Address search over every building we know about (see data/directory.py)."""
from fastapi import APIRouter, HTTPException, Query

from data import directory

router = APIRouter(tags=["search"])


@router.get("/search")
def search(q: str = "", limit: int = Query(8, ge=1, le=50), geocode: bool = False,
           lat: float | None = None, lon: float | None = None):
    """Results ranked by match: `status` "ready" has a full briefing (`building_id`), "scanned" has
    CoStar facts and a Matterport scan but no cached interior. With `geocode=true` and no good match,
    the query is geocoded and `nearby` lists the closest known buildings to that point."""
    out = {"query": q, "results": [], "geocoded": None, "nearby": []}
    if lat is not None and lon is not None and not q.strip():
        out["nearby"] = directory.nearby(lat, lon, limit)
        return out
    if not q.strip():
        out["results"] = directory.browse(limit)
        return out
    out["results"] = directory.search(q, limit)
    if geocode and not any(r["score"] >= directory.GOOD_SCORE for r in out["results"]):
        try:
            g = directory.geocode(q)
        except Exception as e:
            out["geocode_error"] = f"{type(e).__name__}: {e}"
            g = None
        if g:
            out["geocoded"] = g
            out["nearby"] = directory.nearby(g["lat"], g["lon"], limit)
    return out


@router.get("/properties/{key}")
def property_detail(key: str):
    """One directory entry by building id or CoStar property id, plus the nearest buildings with a briefing."""
    e = directory.get(key)
    if e is None:
        raise HTTPException(404, f"Unknown property {key}")
    out = directory.public(e)
    if e["lat"] is not None:
        out["nearest_ready"] = [r for r in directory.nearby(e["lat"], e["lon"], 4, status="ready") if r["id"] != e["id"]][:3]
    if e["status"] != "ready":
        out["onboard_hint"] = (f"Add costar_property_id {e['costar_property_id']} (Matterport model {(e.get('scan') or {}).get('model_id')}) "
                               "to fixtures/buildings.json, then run python -m scripts.fetch_fixtures to cache its data.")
    return out
