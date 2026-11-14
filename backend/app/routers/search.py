"""Address search over every building we know about (see data/directory.py and data/catalog.py)."""
from fastapi import APIRouter, HTTPException, Query, Response

from data import catalog, directory, vexcel

router = APIRouter(tags=["search"])


@router.get("/search")
def search(q: str = "", limit: int = Query(8, ge=1, le=50), geocode: bool = False,
           lat: float | None = None, lon: float | None = None):
    """Results ranked by match: `status` "ready" has a full briefing (`building_id`), "scanned" has a
    Matterport 3D scan (`scan.model_id`, `models_count`) and CoStar facts where linked, but no cached
    interior. `match` says what hit: name, address, or extra (a unit/scan name, tenant or room label).
    With `lat`/`lon`, equal matches go to the closer building; with no `q`, `nearby` lists the closest.
    With `geocode=true` and no good match, the query is geocoded and `nearby` lists the closest buildings."""
    out = {"query": q, "results": [], "geocoded": None, "nearby": []}
    if lat is not None and lon is not None and not q.strip():
        out["nearby"] = directory.nearby(lat, lon, limit)
        return out
    if not q.strip():
        out["results"] = directory.browse(limit)
        return out
    out["results"] = directory.search(q, limit, lat, lon)
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


@router.get("/search/stats")
def search_stats():
    """How many buildings, located buildings, CoStar links and Matterport models search covers."""
    return directory.stats()


def _entry(key: str) -> dict:
    e = directory.get(key)
    if e is None:
        raise HTTPException(404, f"Unknown property {key}")
    return e


@router.get("/properties/{key}")
def property_detail(key: str):
    """One building by building id, CoStar property id or any Matterport model id in it: every scan
    (`models`), CoStar facts (`costar`), cached Vexcel roof (`vexcel`, null until /vexcel is called),
    and the nearest buildings with a briefing."""
    e = _entry(key)
    out = directory.public(e, full=True)
    out["vexcel"] = catalog.vexcel_summary(e, fetch=False)
    if e["lat"] is not None:
        out["nearest_ready"] = [r for r in directory.nearby(e["lat"], e["lon"], 4, status="ready") if r["id"] != e["id"]][:3]
    if e["status"] != "ready":
        out["onboard_hint"] = (f"Add it to fixtures/buildings.json (id {e['id']}, Matterport model {(e.get('scan') or {}).get('model_id')}"
                               + (f", costar_property_id {e['costar_property_id']}" if e["costar_property_id"] else "")
                               + "), then run python -m scripts.fetch_fixtures to cache its data.")
    return out


@router.get("/properties/{key}/vexcel")
def property_vexcel(key: str):
    """Vexcel roof material/condition, footprint and roof objects for the building. Fetched from Vexcel
    the first time (needs VEXCEL_API_KEY), then served from fixtures/catalog/vexcel/."""
    e = _entry(key)
    if e["lat"] is None:
        raise HTTPException(404, "This scan has no location, so there's no aerial data")
    try:
        return catalog.vexcel_summary(e)
    except Exception as ex:
        raise HTTPException(503, f"Vexcel unavailable: {type(ex).__name__}: {ex}")


@router.get("/properties/{key}/aerial")
def property_aerial(key: str, view: str = "nadir"):
    """Vexcel aerial JPEG (nadir or oblique-north/east/south/west), cached after the first fetch."""
    e = _entry(key)
    if view not in vexcel.VIEWS:
        raise HTTPException(422, f"view must be one of {', '.join(vexcel.VIEWS)}")
    try:
        img = catalog.aerial(e, view)
    except Exception as ex:
        raise HTTPException(503, f"Vexcel unavailable: {type(ex).__name__}: {ex}")
    if img is None:
        raise HTTPException(404, "This scan has no location, so there's no aerial image")
    return Response(img, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=86400"})
