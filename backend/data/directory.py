"""Address book of every building we know about, for address search.

Two tiers, both from fixtures (works offline):
  ready    hero buildings in fixtures/buildings.json: full briefing (CoStar + Vexcel + Matterport cached)
  scanned  fixtures/hero_candidates.json: CoStar properties with a Matterport scan; facts only until
           someone adds them to buildings.json and runs scripts.fetch_fixtures
Addresses we don't know are geocoded (OpenStreetMap Nominatim, no key) and answered with the nearest
known buildings. Geocoder responses are cached in fixtures/geocode/ like every other external call.
"""
import hashlib
import math
import re
from difflib import SequenceMatcher
from functools import lru_cache

import httpx

from . import cache

NOMINATIM = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "Scanferno/0.1 (HackPrinceton 2026 fire pre-plan demo)"
MIN_SCORE = 0.6
GOOD_SCORE = 0.75

# Canonical short forms so "8866 Gulf Freeway" matches "8866 Gulf Fwy"
ABBREV = {
    "street": "st", "road": "rd", "freeway": "fwy", "avenue": "ave", "av": "ave", "boulevard": "blvd",
    "drive": "dr", "lane": "ln", "parkway": "pkwy", "pky": "pkwy", "highway": "hwy", "court": "ct",
    "place": "pl", "circle": "cir", "suite": "ste", "north": "n", "south": "s", "east": "e", "west": "w",
    "texas": "tx", "california": "ca", "building": "bldg", "center": "ctr", "centre": "ctr", "mount": "mt",
}


def tokens(text: str) -> list[str]:
    words = re.findall(r"[a-z0-9]+", (text or "").lower())
    return [ABBREV.get(w, w) for w in words]


def _entry(row: dict, status: str, building_id: str | None) -> dict:
    pid = row.get("costar_property_id")
    scan = row.get("scan") or {}
    return {
        "id": building_id or f"costar-{pid}",
        "costar_property_id": pid,
        "name": row.get("name"),
        "address": row.get("address"),
        "lat": row.get("lat"),
        "lon": row.get("lon"),
        "property_type": row.get("type") or row.get("property_type"),
        "stories": row.get("stories"),
        "tenants": row.get("current_tenants", row.get("tenants")),
        "status": status,
        "building_id": building_id,
        "scan": {k: scan.get(k) for k in ("model_id", "rooms", "doorways")} if scan else None,
    }


@lru_cache
def entries() -> tuple[dict, ...]:
    candidates = {c["costar_property_id"]: c for c in cache.load_json("hero_candidates.json") or []}
    out, seen = [], set()
    for b in cache.buildings():
        pid = b.get("costar_property_id")
        cand = candidates.get(pid, {})
        costar = cache.load_json(b["id"], "costar.json") or {}
        row = {**cand, **b, "type": costar.get("property_type") or cand.get("type"),
               "stories": costar.get("stories") or cand.get("stories"),
               "current_tenants": costar.get("current_tenant_count", cand.get("current_tenants"))}
        out.append(_entry(row, "ready", b["id"]))
        seen.add(pid)
    for pid, c in candidates.items():
        if pid not in seen:
            out.append(_entry(c, "scanned", None))
    for e in out:
        e["_name"] = tokens(e["name"] or "")
        e["_addr"] = tokens(e["address"] or "")
    return tuple(out)


def public(e: dict, **extra) -> dict:
    return {**{k: v for k, v in e.items() if not k.startswith("_")}, **extra}


def _token_score(q: str, hay: list[str]) -> float:
    if q in hay:
        return 1.0
    if len(q) >= 2 and any(h.startswith(q) for h in hay):
        return 0.85
    if len(q) >= 4 and not q.isdigit():
        best = max((SequenceMatcher(None, q, h).ratio() for h in hay), default=0)
        if best >= 0.8:
            return 0.6
    return 0.0


def score(query: str, e: dict) -> tuple[float, str]:
    """0..1 match of a free-text query against an entry, and whether the name or the address matched."""
    q = tokens(query)
    if not q:
        return 0.0, ""
    best = (0.0, "")
    for field, hay in (("address", e["_addr"]), ("name", e["_name"])):
        if not hay:
            continue
        s = sum(_token_score(t, hay) for t in q) / len(q)
        number = next((t for t in q if t.isdigit()), None)
        street = [t for t in q if t != number]
        if field == "address" and number and hay[0].isdigit():
            if number == hay[0]:
                s += 0.15
            elif street:
                # right street, wrong house number: still worth showing, never a confident match
                s = 0.7 * sum(_token_score(t, hay) for t in street) / len(street)
        if " ".join(q) in " ".join(hay):
            s += 0.1
        best = max(best, (min(1.0, round(s, 3)), field))
    return best


def distance_m(lat1, lon1, lat2, lon2) -> float:
    r = 6371000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def search(query: str, limit: int = 8) -> list[dict]:
    hits = []
    for e in entries():
        s, field = score(query, e)
        if s >= MIN_SCORE:
            hits.append((s, e["status"] == "ready", e, field))
    hits.sort(key=lambda h: (-h[0], not h[1]))
    return [public(e, score=s, match=field) for s, _, e, field in hits[:limit]]


def nearby(lat: float, lon: float, limit: int = 5, status: str | None = None) -> list[dict]:
    pool = [e for e in entries() if e["lat"] is not None and (status is None or e["status"] == status)]
    pool.sort(key=lambda e: distance_m(lat, lon, e["lat"], e["lon"]))
    return [public(e, distance_m=round(distance_m(lat, lon, e["lat"], e["lon"])), match="nearby") for e in pool[:limit]]


def browse(limit: int = 8) -> list[dict]:
    """Empty query: hero buildings first, then the scanned properties."""
    return [public(e, match="browse") for e in entries()[:limit]]


def get(key: str | int) -> dict | None:
    key = str(key)
    for e in entries():
        if key in (e["id"], str(e["costar_property_id"])):
            return e
    return None


def geocode(query: str) -> dict | None:
    """Free-text address -> {lat, lon, display_name}, or None if nothing matched. Cached per query."""
    norm = " ".join(tokens(query))
    key = hashlib.sha1(norm.encode()).hexdigest()[:16]
    hit = cache.load_json("geocode", f"{key}.json")
    if hit is not None:
        return hit.get("result")
    r = httpx.get(NOMINATIM, params={"q": query, "format": "json", "limit": 1, "countrycodes": "us"},
                  headers={"User-Agent": USER_AGENT}, timeout=6)
    r.raise_for_status()
    rows = r.json()
    result = {"lat": float(rows[0]["lat"]), "lon": float(rows[0]["lon"]), "display_name": rows[0]["display_name"]} if rows else None
    cache.save_json({"query": query, "result": result}, "geocode", f"{key}.json")
    return result
