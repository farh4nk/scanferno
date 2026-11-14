"""Build the search catalog: every Matterport model our key can see, grouped into buildings, joined to CoStar.

Run from backend/:
  python -m scripts.sync_catalog            # pull all models (~20 s), write fixtures/catalog/buildings.json
  python -m scripts.sync_catalog --offline  # regroup from fixtures/catalog/matterport_models.json, no API call

Grouping: models with the same street line + ZIP are one building (apartment units, suites, amenities).
Models with coordinates but no street number join the nearest building within MERGE_M, else stand alone.
Models with no address and no coordinates stay searchable by name only.

CoStar: with the kit unzipped (costar-kit/), commercial-properties.csv links model ids to CoStar property
ids and the kit supplies facts and tenants. Without it, the 100 properties in fixtures/hero_candidates.json
and the hero buildings still get linked. Vexcel is fetched per building on demand (GET /properties/{id}/vexcel).
"""
import argparse
import re
import sys
from collections import Counter, defaultdict
from difflib import SequenceMatcher
from pathlib import Path

from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
load_dotenv(Path(__file__).resolve().parents[2] / ".env")

from data import cache, catalog, costar, matterport  # noqa: E402
from data.directory import distance_m, tokens  # noqa: E402

MERGE_M = 60
SAME_PLACE_M = 300  # scan geotags are noisy; number + ZIP + street spelling already agree
STATES = {"texas": "TX", "tx": "TX", "california": "CA", "ca": "CA", "new jersey": "NJ", "nj": "NJ"}
ZIP = re.compile(r"\b(\d{5})(?:-\d{4})?\b")


def _street_line(m: dict) -> str | None:
    """'2001 Westheimer Rd' from the model address, or None if no part starts with a house number."""
    a = m.get("address") or {}
    parts = list(a.get("streetAddressLines") or []) + (a.get("address") or "").split(",")
    for p in parts:
        p = p.strip()
        if re.match(r"^\d+[a-zA-Z]?\s+\S", p) and not re.match(r"^\d{5}$", p):
            return re.sub(r"\s+", " ", p)
    return None


def _geo(m: dict) -> tuple[float, float] | None:
    g = m.get("geolocation") or {}
    try:
        lat, lon = float(g["lat"]), float(g["long"])
    except (KeyError, TypeError, ValueError):
        return None
    return (lat, lon) if lat or lon else None


def _place(m: dict) -> dict:
    a = m.get("address") or {}
    raw = a.get("address") or ""
    z = a.get("postalCode") or (ZIP.search(raw).group(1) if ZIP.search(raw) else None)
    state = (a.get("administrativeArea") or "").strip()
    city = (a.get("locality") or "").split(",")[0].strip() or None
    return {"zip": z, "state": STATES.get(state.lower(), state.upper() or None), "city": city, "raw": raw or None}


def _model(m: dict) -> dict:
    return {
        "id": m["id"],
        "name": (m.get("name") or "").strip() or None,
        "rooms": (m.get("rooms") or {}).get("count") or 0,
        "floors": (m.get("floors") or {}).get("count") or 0,
        "created": (m.get("created") or "")[:10] or None,
    }


def group(models: list[dict]) -> list[dict]:
    groups: dict[str, list[dict]] = defaultdict(list)
    loose = []
    for m in models:
        street, place = _street_line(m), _place(m)
        if street:
            groups[" ".join(tokens(street)) + "|" + (place["zip"] or place["city"] or "")].append(m)
        else:
            loose.append(m)

    buildings = [_building(ms) for ms in _merge_spellings(groups).values()]
    # spatial grid (~0.01 deg cells) so loose models find the nearest building fast
    grid = defaultdict(list)
    for b in buildings:
        if b["lat"] is not None:
            grid[(round(b["lat"], 2), round(b["lon"], 2))].append(b)
    for m in loose:
        g = _geo(m)
        if g is None:
            buildings.append(_building([m]))
            continue
        near = [b for dy in (-0.01, 0, 0.01) for dx in (-0.01, 0, 0.01)
                for b in grid.get((round(g[0] + dy, 2), round(g[1] + dx, 2)), [])]
        best = min(near, key=lambda b: distance_m(*g, b["lat"], b["lon"]), default=None)
        if best and distance_m(*g, best["lat"], best["lon"]) <= MERGE_M:
            best["_models"].append(m)
        else:
            b = _building([m])
            buildings.append(b)
            grid[(round(g[0], 2), round(g[1], 2))].append(b)
    return [_finish(b) for b in buildings]


def _merge_spellings(groups: dict[str, list[dict]]) -> dict[str, list[dict]]:
    """'1027 Wilshire Boulevard', '1027 Wilshire Roof' and '1027 Wiltshire Blvd' in one ZIP are one building:
    same house number and ZIP, street name within a typo, scans within SAME_PLACE_M of each other."""
    buckets = defaultdict(list)
    for key in groups:
        street, z = key.split("|")
        words = street.split()
        if len(words) >= 2:
            buckets[(words[0], z)].append(key)
    for keys in buckets.values():
        keys.sort(key=lambda k: -len(groups[k]))
        for k in keys[1:]:
            main = next((m for m in keys if m != k and m in groups and len(groups[m]) >= len(groups[k])
                         and SequenceMatcher(None, _street_word(m), _street_word(k)).ratio() >= 0.8
                         and _near(groups[m], groups[k])), None)
            if main:
                groups[main].extend(groups.pop(k))
    return groups


def _street_word(key: str) -> str:
    words = key.split("|")[0].split()[1:]
    return next((w for w in words if w not in ("n", "s", "e", "w")), "")


def _near(a: list[dict], b: list[dict]) -> bool:
    ga, gb = _building(a), _building(b)
    if ga["lat"] is None or gb["lat"] is None:
        return True
    return distance_m(ga["lat"], ga["lon"], gb["lat"], gb["lon"]) <= SAME_PLACE_M


def _building(ms: list[dict]) -> dict:
    geos = [g for g in map(_geo, ms) if g]
    lat = sorted(g[0] for g in geos)[len(geos) // 2] if geos else None
    lon = sorted(g[1] for g in geos)[len(geos) // 2] if geos else None
    return {"lat": lat, "lon": lon, "_models": list(ms)}


UNIT = re.compile(r"^(\d|studio|suite|ste\b|unit|apt|plan|bachelor|penthouse|ph\b|floor|level|lobby|pool|fitness|\w+ ?\d* ?br\b)", re.I)


def _complex_name(names: list[str]) -> str | None:
    """'Skylux on Wilshire' when several unit scans are titled 'Skylux on Wilshire - Plan 2E - ...'."""
    heads = Counter(n.split(" - ")[0].strip() for n in names if n and " - " in n)
    head, count = heads.most_common(1)[0] if heads else (None, 0)
    if head and count >= max(2, len(names) // 3) and not UNIT.match(head) and len(head) <= 60:
        return head
    return None


def _finish(b: dict) -> dict:
    ms = b.pop("_models")
    streets = Counter(s for s in map(_street_line, ms) if s)
    places = [_place(m) for m in ms]
    pick = lambda key: Counter(p[key] for p in places if p[key]).most_common(1)[0][0] if any(p[key] for p in places) else None
    street, city, state, z = (streets.most_common(1)[0][0] if streets else None), pick("city"), pick("state"), pick("zip")
    models = sorted((_model(m) for m in ms), key=lambda x: -x["rooms"])
    tail = ", ".join(x for x in (city, " ".join(y for y in (state, z) if y)) if x)
    address = ", ".join(x for x in (street, tail) if x) or None
    labels = Counter(lab for m in ms for lab in ((m.get("rooms") or {}).get("labels") or []))
    return {
        "id": f"mp-{models[0]['id']}",
        "name": _complex_name([m["name"] for m in models]) or street or models[0]["name"] or models[0]["id"],
        "address": address,
        "city": city, "state": state, "zip": z,
        "lat": b["lat"], "lon": b["lon"],
        "models": models,
        "room_labels": [lab for lab, _ in labels.most_common(12)],
    }


def costar_links(buildings: list[dict]) -> dict[str, int]:
    """Matterport model id -> CoStar property id, from the kit if present plus every cached source."""
    links = {}
    try:
        for pid, mids in costar.matterport_models().items():
            for mid in mids:
                links[mid] = pid
        print(f"CoStar kit: {len(links)} model links")
    except FileNotFoundError as e:
        print(f"CoStar kit not available ({e}); linking from cached candidates only")
    for c in cache.load_json("hero_candidates.json") or []:
        for mid in c.get("matterport_model_ids") or []:
            links.setdefault(mid, c["costar_property_id"])
    for h in cache.buildings():
        if h.get("matterport_model_id") and h.get("costar_property_id"):
            links[h["matterport_model_id"]] = int(h["costar_property_id"])
    return links


def costar_facts(pids: set[int]) -> dict[int, dict]:
    """Search-sized CoStar facts per property: one pass over each kit file, else hero_candidates."""
    out = {}
    for c in cache.load_json("hero_candidates.json") or []:
        if c["costar_property_id"] in pids:
            out[c["costar_property_id"]] = {
                "building_name": c.get("name"), "address": c.get("address"), "property_type": c.get("type"),
                "stories": c.get("stories"), "current_tenant_count": c.get("current_tenants"),
                "lat": c.get("lat"), "lon": c.get("lon"),
            }
    try:
        costar.kit_dir()
    except FileNotFoundError:
        return out
    occ = defaultdict(list)
    for o in costar.jsonl("location-occupancy"):
        if o["propertyId"] in pids and not o.get("toDate"):
            occ[o["propertyId"]].append(o)
    cos = costar.companies({o["tenantLocationId"] for os_ in occ.values() for o in os_ if o.get("tenantLocationId")})
    for p in costar.jsonl("commercial-property"):
        pid = p["id"]
        if pid not in pids:
            continue
        a = p.get("primaryAddress") or {}
        built = [e["year"] for e in p.get("constructionEvents") or [] if e.get("eventType") == 2 and e.get("year")]
        tenants = sorted({(cos.get(o.get("tenantLocationId")) or {}).get("name") for o in occ[pid]} - {None})
        out[pid] = {
            "building_name": p.get("buildingName"),
            "address": costar.address_of(p),
            "property_type": costar.enum("PropertyType", p.get("propertyType")),
            "stories": p.get("numStoriesAboveGrade"),
            "year_built": min(built) if built else None,
            "rba_sqft": p.get("rentableBuildingAreaSquareFeet"),
            "construction_material": costar.enum("BuildingConstructionMaterialType", p.get("buildingConstructionMaterial")),
            "has_sprinklers": p.get("hasSprinklers"),
            "current_tenant_count": len(occ[pid]),
            "tenant_names": tenants[:25],
            "lat": a.get("latitude"), "lon": a.get("longitude"),
        }
    return out


def join_costar(buildings: list[dict]) -> list[dict]:
    """Address groups that link to the same CoStar property become one building (CoStar wins over spelling)."""
    links = costar_links(buildings)
    by_pid: dict[int, list[dict]] = defaultdict(list)
    out = []
    for b in buildings:
        pid = Counter(links[m["id"]] for m in b["models"] if m["id"] in links).most_common(1)
        (by_pid[pid[0][0]] if pid else out).append(b)
    facts = costar_facts(set(by_pid))
    for pid, parts in by_pid.items():
        b = max(parts, key=lambda p: (len(p["models"]), p["lat"] is not None))
        for p in parts:
            if p is not b:
                b["models"] = sorted(b["models"] + p["models"], key=lambda x: -x["rooms"])
                b["room_labels"] = list(dict.fromkeys(b["room_labels"] + p["room_labels"]))[:12]
        f = facts.get(pid, {})
        b["id"] = f"costar-{pid}"
        b["costar_property_id"] = pid
        b["costar"] = {k: v for k, v in f.items() if k not in ("lat", "lon") and v not in (None, [], "")}
        if f.get("building_name") and not re.match(r"^\d", f["building_name"]):
            b["name"] = f["building_name"]
        if f.get("lat") is not None:  # CoStar's rooftop point beats the median of scan geotags
            b["lat"], b["lon"] = f["lat"], f["lon"]
        out.append(b)
    print(f"linked {len(by_pid)} buildings to CoStar ({len(facts)} with facts)")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true", help="regroup the cached model list without calling Matterport")
    args = ap.parse_args()
    if args.offline:
        models = catalog.load_models()
        if not models:
            sys.exit("No cached fixtures/catalog/matterport_models.json; run without --offline first.")
    else:
        models = matterport.list_models(lambda n, t: print(f"\rMatterport models {n}/{t}", end="", flush=True))
        print()
        catalog.save_models(models)
    buildings = join_costar(group(models))
    buildings.sort(key=lambda b: (b["lat"] is None, -sum(m["rooms"] for m in b["models"])))
    catalog.save_buildings(buildings)
    located = sum(1 for b in buildings if b["lat"] is not None)
    print(f"{len(models)} models -> {len(buildings)} buildings ({located} located, "
          f"{sum(1 for b in buildings if b.get('costar_property_id'))} with CoStar)")


if __name__ == "__main__":
    main()
