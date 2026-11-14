"""CoStar hackathon kit loader. The kit is static JSONL files (no API).

Put the unzipped kit at <repo>/costar-kit (gitignored) or set COSTAR_KIT_DIR.
Docs live in the kit: index.md, models/*.md. Enums are ints; decode with enum().

Main entry point: get(building) -> the costar.json shape in fixtures/sample/costar.json,
cached at fixtures/<building_id>/costar.json after the first build (~10 s, streams the files).
"""
import csv
import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Iterator

from . import cache

REPO = Path(__file__).resolve().parents[2]
# PropertyType codes worth a fire pre-plan (apartments/homes excluded: few tenants, little interior data)
COMMERCIAL_TYPES = {2: "Industrial", 5: "Office", 6: "GeneralRetail", 7: "Flex", 9: "MixedUse", 13: "Healthcare"}


def kit_dir() -> Path:
    d = Path(os.getenv("COSTAR_KIT_DIR") or REPO / "costar-kit")
    if not d.is_absolute():
        d = REPO / d
    if not (d / "index.md").exists():
        raise FileNotFoundError(f"CoStar kit not found at {d}. Unzip costar-hackathon-kit.zip there or set COSTAR_KIT_DIR.")
    return d


@lru_cache
def _enums() -> dict:
    return json.loads((kit_dir() / "schemas" / "enums.json").read_text())


def enum(name: str, value) -> str | None:
    if value is None:
        return None
    return _enums().get(name, {}).get(str(value), str(value))


def jsonl(dataset: str) -> Iterator[dict]:
    with open(kit_dir() / "data" / f"{dataset}.jsonl") as f:
        for line in f:
            yield json.loads(line)


@lru_cache
def matterport_models() -> dict[int, list[str]]:
    """PropertyId -> Matterport model ids (from commercial-properties.csv)."""
    out: dict[int, list[str]] = {}
    with open(kit_dir() / "commercial-properties.csv", newline="") as f:
        for row in csv.DictReader(f):
            if row["MatterportModelId"]:
                out.setdefault(int(row["PropertyId"]), []).append(row["MatterportModelId"])
    return out


def find_property(pid: int) -> dict:
    for p in jsonl("commercial-property"):
        if p["id"] == pid:
            return p
    raise KeyError(f"CoStar property {pid} not in kit")


def current_tenancies(pid: int) -> list[dict]:
    return [o for o in jsonl("location-occupancy") if o["propertyId"] == pid and not o.get("toDate")]


def companies(ids: set[int]) -> dict[int, dict]:
    return {c["id"]: c for c in jsonl("company-detail") if c["id"] in ids} if ids else {}


def address_of(p: dict) -> str:
    a = p.get("primaryAddress") or {}
    street = " ".join(str(x) for x in (a.get("streetNumber"), a.get("streetName"), a.get("streetType")) if x)
    return f"{street}, {a.get('city')}, {a.get('state')}"


def summarize(pid: int) -> dict:
    p = find_property(pid)
    a = p.get("primaryAddress") or {}
    floors = {f["propertyFloorId"]: f for f in p.get("floors") or []}
    events = p.get("constructionEvents") or []
    built = [e["year"] for e in events if e.get("eventType") == 2 and e.get("year")]
    renovated = [e["year"] for e in events if e.get("eventType") in (4, 16) and e.get("year")]

    occ = current_tenancies(pid)
    cos = companies({o["tenantLocationId"] for o in occ if o.get("tenantLocationId")})
    tenants = []
    for o in occ:
        c = cos.get(o.get("tenantLocationId")) or {}
        industry = (c.get("profile") or {}).get("industryType") if c else o.get("industryType")
        for s in o.get("spaces") or [{}]:
            fl = floors.get(s.get("propertyFloorId")) or {}
            tenants.append({
                "name": c.get("name") or "Unknown tenant",
                "industry": enum("IndustryType", industry),
                "employees": c.get("numEmployees"),
                "floor": enum("FloorName", fl.get("floorName")),
                "suite": c.get("suite"),
                "sqft": s.get("squareFeetOccupied"),
                "space_use": enum("SpaceUse", (o.get("leaseDeal") or {}).get("spaceUse")),
            })

    return {
        "costar_property_id": pid,
        "building_name": p.get("buildingName"),
        "address": address_of(p),
        "lat": a.get("latitude"),
        "lon": a.get("longitude"),
        "property_type": enum("PropertyType", p.get("propertyType")),
        "year_built": min(built) if built else None,
        "year_renovated": max(renovated) if renovated else None,
        "stories": p.get("numStoriesAboveGrade"),
        "height_ft": p.get("buildingHeightInFeet"),
        "rba_sqft": p.get("rentableBuildingAreaSquareFeet"),
        "construction_material": enum("BuildingConstructionMaterialType", p.get("buildingConstructionMaterial")),
        "has_sprinklers": p.get("hasSprinklers"),
        "sprinkler_type": enum("SprinklerType", p.get("sprinklerType")),
        "floors": [
            {"id": fid, "name": enum("FloorName", f.get("floorName")), "sqft": (f.get("floorSize") or {}).get("squareFeet")}
            for fid, f in floors.items()
        ],
        "current_tenant_count": len(occ),
        "vacant": len(occ) == 0,
        "tenants": tenants,
        "photo_url": (p.get("primaryPhoto") or {}).get("attachmentUri"),
        "matterport_model_ids": matterport_models().get(pid, []),
    }


def get(building: dict, refresh: bool = False) -> dict:
    """costar.json for a building from fixtures/buildings.json (needs costar_property_id)."""
    bid = building["id"]
    data = None if refresh else cache.load_json(bid, "costar.json")
    if data is None:
        data = summarize(int(building["costar_property_id"]))
        cache.save_json(data, bid, "costar.json")
    return data
