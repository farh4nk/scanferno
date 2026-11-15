"""Address book of every building we know about, for address search.

Two tiers, both from fixtures (works offline):
  ready    hero buildings in fixtures/buildings.json: full briefing (CoStar + Vexcel + Matterport cached)
  scanned  every building with a Matterport 3D scan (fixtures/catalog/buildings.json.gz from
           scripts.sync_catalog, ~9k buildings / 15k models), joined to CoStar where linked; Vexcel on demand
fixtures/hero_candidates.json is still read so its CoStar facts show up even before a catalog sync.

Search runs in two passes: an in-memory SQLite FTS5 index (prefix + typo-expanded tokens) picks a few
hundred candidates, then score() ranks them. Addresses we don't know are geocoded (OpenStreetMap
Nominatim, no key) and answered with the nearest known buildings, cached in fixtures/geocode/.
"""
import hashlib
import math
import re
import sqlite3
from difflib import SequenceMatcher, get_close_matches
from functools import lru_cache

import httpx

from . import cache, catalog

NOMINATIM = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "Scanferno/0.1 (HackPrinceton 2026 fire pre-plan demo)"
MIN_SCORE = 0.6
GOOD_SCORE = 0.75
CANDIDATES = 400
MAX_CANDIDATES = 5000  # find() scores every full-text match up to this, so totals and filters are exact (<250 ms)
EXTRA_WEIGHT = 0.85  # a hit on a unit name, tenant or room label counts a bit less than the name/address

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
    models = row.get("models") or []
    if models and not scan:
        scan = {"model_id": models[0]["id"], "rooms": models[0]["rooms"], "floors": models[0]["floors"]}
    return {
        "id": building_id or row.get("id") or f"costar-{pid}",
        "costar_property_id": pid,
        "name": row.get("name"),
        "address": row.get("address"),
        "city": row.get("city"),
        "lat": row.get("lat"),
        "lon": row.get("lon"),
        "property_type": row.get("type") or row.get("property_type"),
        "stories": row.get("stories"),
        "tenants": row.get("current_tenants", row.get("tenants")),
        "status": status,
        "building_id": building_id,
        "scan": {k: scan.get(k) for k in ("model_id", "rooms", "doorways", "floors") if scan.get(k) is not None} if scan else None,
        "models_count": len(models) or (1 if scan else 0),
        "models": models,
        "room_labels": row.get("room_labels") or [],
        "costar": row.get("costar"),
    }


def _merge_catalog(row: dict, cat: dict | None) -> dict:
    """Catalog facts (all scans, CoStar join) under the hand-curated row; the curated row wins."""
    if not cat:
        return row
    c = cat.get("costar") or {}
    return {
        **cat,
        "type": c.get("property_type"), "stories": c.get("stories"), "current_tenants": c.get("current_tenant_count"),
        **{k: v for k, v in row.items() if v is not None},
    }


@lru_cache
def entries() -> tuple[dict, ...]:
    candidates = {c["costar_property_id"]: c for c in cache.load_json("hero_candidates.json") or []}
    cat = catalog.buildings()
    cat_by_pid = {b["costar_property_id"]: b for b in cat if b.get("costar_property_id")}
    out, seen = [], set()
    for b in cache.buildings():
        pid = b.get("costar_property_id")
        cand = candidates.get(pid, {})
        costar = cache.load_json(b["id"], "costar.json") or {}
        row = {**cand, **b, "type": costar.get("property_type") or cand.get("type"),
               "stories": costar.get("stories") or cand.get("stories"),
               "current_tenants": costar.get("current_tenant_count", cand.get("current_tenants"))}
        out.append(_entry(_merge_catalog(row, cat_by_pid.get(pid)), "ready", b["id"]))
        seen.add(pid)
    for pid, c in candidates.items():
        if pid not in seen:
            out.append(_entry(_merge_catalog(c, cat_by_pid.get(pid)), "scanned", None))
            seen.add(pid)
    for b in cat:
        if b.get("costar_property_id") not in seen:
            c = b.get("costar") or {}
            out.append(_entry({**b, "type": c.get("property_type"), "stories": c.get("stories"),
                               "current_tenants": c.get("current_tenant_count")}, "scanned", None))
    for e in out:
        e["_name"] = tokens(e["name"] or "")
        e["_addr"] = tokens(e["address"] or "")
        extra = [m.get("name") or "" for m in e["models"]] + e["room_labels"] + list((e.get("costar") or {}).get("tenant_names") or [])
        extra += [(e.get("costar") or {}).get("building_name") or "", (e.get("costar") or {}).get("address") or ""]
        e["_extra"] = list(dict.fromkeys(t for x in extra for t in tokens(x)))
        e["_size"] = sum(m.get("rooms") or 0 for m in e["models"]) or (e["scan"] or {}).get("rooms") or 0
        e["kind"] = _kind(e)
        if not e["city"] and e["address"] and e["address"].count(",") >= 2:
            city = e["address"].split(",")[1].strip()
            e["city"] = city if re.fullmatch(r"[A-Za-z .'-]+", city) else None
    # On-demand onboarded buildings are ready (same cache layout as heroes).
    from ondemand import registry
    ready_ids = {b["id"] for b in registry.all()
                 if cache.FIXTURES.joinpath(b["id"], "matterport_vector.json").exists()}
    for e in out:
        bid = e.get("building_id") or e["id"]
        if bid in ready_ids:
            e["status"] = "ready"
            e["building_id"] = bid

    _clean_cities(out)
    _mark_ondemand_ready(out)
    return tuple(out)


def _mark_ondemand_ready(out: list[dict]) -> None:
    """Buildings prepared via POST /ondemand show as ready in search (open briefing, not the property card)."""
    from ondemand import registry  # local: ondemand.ready imports directory
    ready = {b["id"] for b in registry.all()
             if cache.FIXTURES.joinpath(b["id"], "matterport_vector.json").exists()}
    if not ready:
        return
    for e in out:
        bid = e.get("building_id") or e["id"]
        if bid in ready or e["id"] in ready:
            e["status"] = "ready"
            e["building_id"] = bid if bid in ready else e["id"]


def clear() -> None:
    """Drop search caches after onboarding so the next /search shows status ready."""
    entries.cache_clear()
    _index.cache_clear()
    _keys.cache_clear()
    _scored.cache_clear()
    _facets_cached.cache_clear()


def _clean_cities(out: list[dict]) -> None:
    """'houston', 'Houston14', 'Housotn' -> 'Houston': typos in scan addresses fold into a common city."""
    for e in out:
        if e["city"]:
            e["city"] = re.sub(r"[\d\s]+$", "", e["city"]).strip().title() or None
    counts: dict[str, int] = {}
    for e in out:
        if e["city"]:
            counts[e["city"]] = counts.get(e["city"], 0) + 1
    common = [c for c, n in counts.items() if n >= 20]
    fix = {c: (get_close_matches(c, common, n=1, cutoff=0.8) or [c])[0] for c in counts if c not in common}
    for e in out:
        if e["city"] in fix:
            e["city"] = fix[e["city"]]


COMMERCIAL_TYPES = {"Office", "Industrial", "Flex", "GeneralRetail", "Retail", "MixedUse", "Healthcare", "Hospitality"}
RESIDENTIAL = re.compile(r"\b(\d(\.\d)? ?(br|ba|bd|bed|bath)s?\b|bedroom|bathroom|studio|apartment|apt|townhome|townhouse|condo|"
                         r"loft|penthouse|residence|home|house|bachelor|primary bedroom|kitchen)", re.I)
COMMERCIAL = re.compile(r"\b(suite|ste|office|warehouse|retail|conference|reception|lobby|break ?room|clinic|medical|"
                        r"restaurant|store|showroom|industrial|plaza|tower|ctr|center)\b", re.I)


def _kind(e: dict) -> str:
    """commercial | residential | other, from the CoStar type, else from scan names and room labels."""
    if e["property_type"] in COMMERCIAL_TYPES or e["costar_property_id"] is not None:
        return "commercial"
    text = " ".join([m.get("name") or "" for m in e["models"]] + e["room_labels"] + [e["name"] or ""])
    res, com = len(RESIDENTIAL.findall(text)), len(COMMERCIAL.findall(text))
    if res > com:
        return "residential"
    if com:
        return "commercial"
    return "other"


@lru_cache
def _index() -> tuple[sqlite3.Connection, tuple[str, ...]]:
    """FTS5 over normalized tokens, plus the token vocabulary for typo expansion."""
    db = sqlite3.connect(":memory:", check_same_thread=False)
    db.execute("CREATE VIRTUAL TABLE b USING fts5(name, address, extra, tokenize='unicode61')")
    db.executemany("INSERT INTO b(rowid, name, address, extra) VALUES (?, ?, ?, ?)",
                   [(i, " ".join(e["_name"]), " ".join(e["_addr"]), " ".join(e["_extra"])) for i, e in enumerate(entries())])
    vocab = {t for e in entries() for t in e["_name"] + e["_addr"] + e["_extra"] if not t.isdigit()}
    return db, tuple(sorted(vocab))


def _fts_query(q: list[str]) -> str:
    _, vocab = _index()
    parts = []
    for i, t in enumerate(q):
        alts = {f'"{t}"*' if (not t.isdigit() or i == len(q) - 1) else f'"{t}"'}
        if len(t) >= 4 and not t.isdigit():
            alts |= {f'"{w}"' for w in get_close_matches(t, vocab, n=4, cutoff=0.8)}
        parts.append("(" + " OR ".join(sorted(alts)) + ")")
    return " OR ".join(parts)


def candidates(query: str, limit: int = CANDIDATES) -> list[dict]:
    q = tokens(query)
    if not q:
        return []
    db, _ = _index()
    rows = db.execute("SELECT rowid FROM b WHERE b MATCH ? ORDER BY bm25(b, 4.0, 3.0, 1.0) LIMIT ?",
                      (_fts_query(q), limit)).fetchall()
    es = entries()
    return [es[r[0]] for r in rows]


def public(e: dict, full: bool = False, **extra) -> dict:
    hidden = () if full else ("models", "room_labels", "costar")
    return {**{k: v for k, v in e.items() if not k.startswith("_") and k not in hidden}, **extra}


def _token_score(q: str, hay: list[str]) -> float:
    if q in hay:
        return 1.0
    if len(q) >= 2 and any(h.startswith(q) for h in hay):
        return 0.85
    if len(q) >= 4 and not q.isdigit():
        for h in hay:
            sm = SequenceMatcher(None, q, h)
            if sm.real_quick_ratio() >= 0.8 and sm.quick_ratio() >= 0.8 and sm.ratio() >= 0.8:
                return 0.6
    return 0.0


def score(query: str, e: dict) -> tuple[float, str]:
    """0..1 match of a free-text query against an entry, and which field matched (name, address, or extra:
    a scan/unit name, tenant or room label)."""
    q = tokens(query)
    if not q:
        return 0.0, ""
    best = (0.0, "")
    for field, hay in (("address", e["_addr"]), ("name", e["_name"]), ("extra", e.get("_extra") or [])):
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
        if field == "extra":
            s *= EXTRA_WEIGHT
        best = max(best, (min(1.0, round(s, 3)), field))
    return best


def distance_m(lat1, lon1, lat2, lon2) -> float:
    r = 6371000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _rank(e: dict) -> tuple:
    """Tie-breaks after score: briefing ready, CoStar facts, has a location, bigger scans."""
    return (e["status"] != "ready", e["costar_property_id"] is None, e["lat"] is None, -e["_size"])


FILTERS = ("status", "city", "kind", "costar")


def _passes(e: dict, f: dict, skip: str | None = None) -> bool:
    """f: status (ready|scanned), city, kind (commercial|residential|other), costar (True: has CoStar facts)."""
    return all((
        skip == "status" or not f.get("status") or e["status"] == f["status"],
        skip == "city" or not f.get("city") or (e["city"] or "").lower() == f["city"].lower(),
        skip == "kind" or not f.get("kind") or e["kind"] == f["kind"],
        skip == "costar" or f.get("costar") is None or (e["costar_property_id"] is not None) == f["costar"],
    ))


@lru_cache(maxsize=256)
def _facets_cached(query: str, f_items: tuple) -> dict:
    return _facets([e for _, _, e in _scored(query)], dict(f_items))


def _facets(pool: list[dict], f: dict) -> dict:
    """Counts per filter value over the matches, each ignoring its own filter (so chips show what you'd get)."""
    out = {}
    for name, key in (("status", lambda e: e["status"]), ("city", lambda e: e["city"]), ("kind", lambda e: e["kind"]),
                      ("costar", lambda e: "yes" if e["costar_property_id"] is not None else "no")):
        counts: dict = {}
        for e in pool:
            if _passes(e, f, skip=name):
                v = key(e)
                if v:
                    counts[v] = counts.get(v, 0) + 1
        out[name] = dict(sorted(counts.items(), key=lambda kv: -kv[1])[:10 if name == "city" else None])
    return out


def find(query: str = "", filters: dict | None = None, limit: int = 8, offset: int = 0,
         lat: float | None = None, lon: float | None = None) -> dict:
    """One page of ranked matches plus `total` and `facets`. Empty query browses everything (heroes, then
    CoStar-linked, then biggest scans; nearest first with lat/lon). With a query, equal scores go to the closer."""
    f = {k: v for k, v in (filters or {}).items() if k in FILTERS and v not in (None, "")}
    near = lat is not None and lon is not None
    far = (lambda e: distance_m(lat, lon, e["lat"], e["lon"]) if e["lat"] is not None else math.inf) if near else (lambda e: 0)
    query = query.strip()
    if near:
        scored = sorted(_scored(query), key=lambda h: ((-h[0] if h[0] is not None else 0), far(h[2]), _rank(h[2])))
        facets = _facets([e for _, _, e in scored], f)
    else:
        scored = _scored(query)
        facets = _facets_cached(query, tuple(sorted(f.items())))
    hits = [h for h in scored if _passes(h[2], f)]
    page = []
    for s, field, e in hits[offset:offset + limit]:
        extra = {"match": field}
        if s is not None:
            extra["score"] = s
        if near and e["lat"] is not None:
            extra["distance_m"] = round(far(e))
        page.append(public(e, **extra))
    return {"results": page, "total": len(hits), "facets": facets, "filters": f}


@lru_cache(maxsize=128)
def _scored(query: str) -> tuple:
    """(score, field, entry) for every match, best first; the empty query browses everything by _rank.
    Cached so paging and filter toggles on the same query don't re-score."""
    if not query:
        return tuple((None, "browse", e) for e in sorted(entries(), key=_rank))
    hits = []
    for e in candidates(query, MAX_CANDIDATES):
        s, field = score(query, e)
        if s >= MIN_SCORE:
            hits.append((s, field, e))
    hits.sort(key=lambda h: (-h[0], _rank(h[2])))
    return tuple(hits)


def search(query: str, limit: int = 8, lat: float | None = None, lon: float | None = None) -> list[dict]:
    return find(query, None, limit, 0, lat, lon)["results"]


def nearby(lat: float, lon: float, limit: int = 5, status: str | None = None) -> list[dict]:
    pool = [e for e in entries() if e["lat"] is not None and (status is None or e["status"] == status)]
    pool.sort(key=lambda e: distance_m(lat, lon, e["lat"], e["lon"]))
    return [public(e, distance_m=round(distance_m(lat, lon, e["lat"], e["lon"])), match="nearby") for e in pool[:limit]]


def browse(limit: int = 8) -> list[dict]:
    """Empty query: hero buildings first, then CoStar-linked scans, then the biggest scans."""
    return find("", None, limit)["results"]


@lru_cache
def _keys() -> dict[str, dict]:
    out = {}
    for e in entries():
        for m in e["models"]:
            out.setdefault(m["id"], e)
        if e["costar_property_id"] is not None:
            out[str(e["costar_property_id"])] = e
        out[e["id"]] = e
    return out


def get(key: str | int) -> dict | None:
    """By building id, CoStar property id, or any Matterport model id in the building."""
    return _keys().get(str(key))


def stats() -> dict:
    es = entries()
    return {
        "buildings": len(es),
        "ready": sum(1 for e in es if e["status"] == "ready"),
        "located": sum(1 for e in es if e["lat"] is not None),
        "with_costar": sum(1 for e in es if e["costar_property_id"] is not None),
        "matterport_models": sum(len(e["models"]) for e in es),
    }


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


def clear():
    """Drop entry caches after ondemand registry changes."""
    entries.cache_clear()
    _index.cache_clear()
    _keys.cache_clear()

