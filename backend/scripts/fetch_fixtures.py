"""Pull and cache raw data for every hero building in fixtures/buildings.json.

Run from backend/:  python -m scripts.fetch_fixtures [building_id] [--refresh]
Writes fixtures/<id>/matterport_vector.json, vexcel/<view>.jpg, vexcel/elevation.json, costar.json.
Skips anything already cached unless --refresh.
"""
import sys
from pathlib import Path

from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
load_dotenv(Path(__file__).resolve().parents[2] / ".env")

from data import cache, costar, matterport, vexcel  # noqa: E402


def step(label: str, out: Path, refresh: bool, fn):
    if out.exists() and not refresh:
        print(f"  skip  {label} (cached)")
        return
    try:
        fn()
        print(f"  ok    {label}")
    except Exception as e:
        print(f"  FAIL  {label}: {type(e).__name__}: {e}")


def fetch(b: dict, refresh: bool):
    bid = b["id"]
    print(f"{bid}: {b.get('name')}")
    if b.get("matterport_model_id"):
        out = cache.FIXTURES / bid / "matterport_vector.json"
        step("matterport vector data", out, refresh,
             lambda: cache.save_json(matterport.vector_data(b["matterport_model_id"]), bid, "matterport_vector.json"))
    else:
        print("  todo  set matterport_model_id")

    if b.get("lat") is not None and b.get("lon") is not None:
        for view in vexcel.VIEWS:
            out = cache.FIXTURES / bid / "vexcel" / f"{view}.jpg"
            step(f"vexcel {view}", out, refresh,
                 lambda v=view: cache.save_bytes(vexcel.oriented_image(b["lat"], b["lon"], v), bid, "vexcel", f"{v}.jpg"))
        out = cache.FIXTURES / bid / "vexcel" / "elevation.json"
        step("vexcel elevation", out, refresh,
             lambda: cache.save_json(vexcel.elevation(b["lat"], b["lon"]), bid, "vexcel", "elevation.json"))
        for tool in vexcel.STRUCTURE_TOOLS:
            out = cache.FIXTURES / bid / "vexcel" / f"{tool}.json"
            step(f"vexcel {tool}", out, refresh,
                 lambda t=tool: cache.save_json(vexcel.structure(b["lat"], b["lon"], t), bid, "vexcel", f"{t}.json"))
    else:
        print("  todo  set lat/lon")

    if b.get("costar_property_id"):
        out = cache.FIXTURES / bid / "costar.json"
        step("costar summary", out, refresh, lambda: costar.get(b, refresh=True))
    else:
        print("  todo  set costar_property_id")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    refresh = "--refresh" in sys.argv
    targets = [b for b in cache.buildings() if not args or b["id"] in args]
    if not targets:
        sys.exit("No buildings. Add them to fixtures/buildings.json.")
    for b in targets:
        fetch(b, refresh)
