"""Rank CoStar kit buildings as hero-building candidates.

Run from backend/:
  python -m scripts.pick_heroes                     # print top 25, save fixtures/hero_candidates.json
  python -m scripts.pick_heroes --check-matterport 15   # also pull vector data for the top 15, count rooms/doors
  python -m scripts.pick_heroes --write 3           # write the top 3 (after any check) to fixtures/buildings.json

Score favors: current tenants (hazard variety), more stories (search + mayday story), industrial/flex
(fire load). A good Matterport scan matters most, so run --check-matterport once keys work.
"""
import argparse
import sys
from collections import Counter
from pathlib import Path

from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
load_dotenv(Path(__file__).resolve().parents[2] / ".env")

from data import cache, costar, matterport  # noqa: E402


def score(tenants: int, stories: int, ptype: int, n_models: int) -> int:
    # 2-5 stories is the demo sweet spot: real search/mayday story, and scans likely cover the building.
    # Towers rarely have whole-building scans.
    height = 12 if 2 <= stories <= 5 else 6 if stories <= 10 else 0
    return min(tenants, 15) + height + 2 * min(n_models, 5) + (3 if ptype in (2, 7) else 0)


def candidates() -> list[dict]:
    tenants = Counter(o["propertyId"] for o in costar.jsonl("location-occupancy") if not o.get("toDate"))
    models = costar.matterport_models()
    rows = []
    for p in costar.jsonl("commercial-property"):
        pid, ptype = p["id"], p.get("propertyType")
        if ptype not in costar.COMMERCIAL_TYPES or pid not in models:
            continue
        stories = p.get("numStoriesAboveGrade") or 1
        n = tenants.get(pid, 0)
        a = p.get("primaryAddress") or {}
        rows.append({
            "costar_property_id": pid,
            "name": p.get("buildingName") or costar.address_of(p),
            "address": costar.address_of(p),
            "lat": a.get("latitude"),
            "lon": a.get("longitude"),
            "type": costar.COMMERCIAL_TYPES[ptype],
            "stories": stories,
            "current_tenants": n,
            "matterport_model_ids": models[pid],
            "score": score(n, stories, ptype, len(models[pid])),
        })
    rows.sort(key=lambda r: -r["score"])
    return rows


def check_scan(row: dict) -> None:
    """Pick the model with the most rooms; record rooms/doorways counts."""
    best = None
    for mid in row["matterport_model_ids"][:4]:
        try:
            v = matterport.vector_data(mid)
        except Exception as e:
            row.setdefault("scan_errors", []).append(f"{mid}: {type(e).__name__}: {str(e)[:120]}")
            continue
        rooms = v.get("rooms") or []
        doors = sum(
            1 for r in rooms for e in (r.get("boundary") or {}).get("edges") or []
            for o in e.get("openings") or [] if o.get("type") == "doorway"
        )
        stats = {"model_id": mid, "floors": len(v.get("floors") or []), "rooms": len(rooms), "doorways": doors}
        if best is None or stats["rooms"] > best["rooms"]:
            best = stats
    row["scan"] = best


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--top", type=int, default=25)
    ap.add_argument("--check-matterport", type=int, default=0, metavar="N")
    ap.add_argument("--write", type=int, default=0, metavar="K")
    args = ap.parse_args()

    rows = candidates()
    print(f"{len(rows)} commercial candidates with Matterport scans")
    if args.check_matterport:
        for r in rows[: args.check_matterport]:
            check_scan(r)
        checked = rows[: args.check_matterport]
        checked.sort(key=lambda r: -((r.get("scan") or {}).get("rooms", 0)))
        rows = checked + rows[args.check_matterport:]

    cache.save_json(rows[:100], "hero_candidates.json")
    print(f"{'pid':>8}  {'score':>5}  {'type':<13} {'st':>2} {'ten':>3}  {'scan':<24} name / address")
    for r in rows[: args.top]:
        s = r.get("scan")
        scan = f"{s['rooms']}r {s['doorways']}d {s['floors']}f" if s else ("ERR" if r.get("scan_errors") else "-")
        print(f"{r['costar_property_id']:>8}  {r['score']:>5}  {r['type']:<13} {r['stories']:>2} {r['current_tenants']:>3}  {scan:<24} {r['name']} / {r['address']}")

    if args.write:
        picks = rows[: args.write]
        # keep hand-tuned fields (front, scan_rotation_deg, floorplan_overrides) for buildings already listed
        existing = {b["id"]: b for b in cache.buildings()}
        cache.save_json([
            {
                **existing.get(f"costar-{r['costar_property_id']}", {}),
                "id": f"costar-{r['costar_property_id']}",
                "name": r["name"],
                "address": r["address"],
                "lat": r["lat"],
                "lon": r["lon"],
                "matterport_model_id": (r.get("scan") or {}).get("model_id") or r["matterport_model_ids"][0],
                "costar_property_id": r["costar_property_id"],
            }
            for r in picks
        ], "buildings.json")
        print(f"wrote {len(picks)} buildings to fixtures/buildings.json")


if __name__ == "__main__":
    main()
