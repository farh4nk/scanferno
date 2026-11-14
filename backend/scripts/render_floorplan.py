"""Debug render of a floorplan (+ optional maze heatmap and route) to a PNG.

Run from backend/:  python -m scripts.render_floorplan <building_id> [--maze] [--mayday ROOM_ID] [--out PATH]
Needs matplotlib (pip install matplotlib).
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import matplotlib  # noqa: E402

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.patches import Polygon as MplPolygon  # noqa: E402

from data import layers  # noqa: E402
from geometry import egress, wallfollow  # noqa: E402


def render(bid: str, maze: bool, mayday: str | None, out: Path) -> Path:
    fp = layers.floorplan(bid)
    fig, ax = plt.subplots(figsize=(11, 9))
    cmap = plt.get_cmap("RdYlGn_r")
    scores = fp.get("maze_score") or {}
    for v in fp.get("voids") or []:
        ax.add_patch(MplPolygon(v, closed=True, fc="#dddddd", ec="#bbbbbb", lw=0.5))
    for r in fp["rooms"]:
        fc = cmap(scores.get(r["id"], 0)) if maze else "#f4f4f4"
        ax.add_patch(MplPolygon(r["polygon"], closed=True, fc=fc, ec="k", lw=0.8, alpha=0.85))
        label = f"{r['label']}\n{r['id']}" + (f"\n{scores[r['id']]:.2f}" if maze and r["id"] in scores else "")
        ax.text(*r["centroid"], label, fontsize=6, ha="center", va="center")
    for d in fp["doors"]:
        ax.plot(*d["position"], "s", color="red" if d["is_exit"] else "#1f77b4", ms=7 if d["is_exit"] else 4)
    for w in fp.get("windows") or []:
        ax.plot(*w["position"], "^", color="#17becf", ms=4)
    if mayday:
        res = wallfollow.mayday(fp, mayday)
        pts = res["wall_path"]
        ax.plot([p[0] for p in pts], [p[1] for p in pts], "-", color="magenta", lw=2.5)
        ax.set_title(f"{bid} mayday from {mayday}: " + " / ".join(res["directions"])[:160], fontsize=7)
    else:
        ax.set_title(bid)
    ax.set_aspect("equal")
    ax.autoscale()
    fig.savefig(out, dpi=90, bbox_inches="tight")
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("building_id")
    ap.add_argument("--maze", action="store_true")
    ap.add_argument("--mayday")
    ap.add_argument("--out")
    a = ap.parse_args()
    print(render(a.building_id, a.maze, a.mayday, Path(a.out or f"{a.building_id}.png")))
