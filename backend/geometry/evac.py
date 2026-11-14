"""Evacuation simulation: occupant dots walk their exit routes and queue at narrow doors.

Occupants are spread over the non-corridor rooms by floor area (count from CoStar employees on the floor).
Each walks its room's shortest exit route at WALK_MPS. Every doorway passes at most
FLOW_PPSM people per second per meter of clear width (the standard specific-flow figure used in egress
design), so a 0.8 m door clears about 1 person/s and a crowd jams there. Returns animation frames, the
bottleneck door, per-exit counts and a staging suggestion.
"""
import random

from shapely.geometry import LineString, Point, Polygon

from .navgraph import NavGraph

WALK_MPS = 1.2
FLOW_PPSM = 1.3
DT = 0.25
FRAME_EVERY_S = 1.0
MAX_S = 600


def _spawn(room: dict, rng: random.Random) -> tuple[float, float]:
    poly = Polygon(room["polygon"]).buffer(-0.4)
    if poly.is_empty:
        return tuple(room["centroid"])
    minx, miny, maxx, maxy = poly.bounds
    for _ in range(50):
        p = (rng.uniform(minx, maxx), rng.uniform(miny, maxy))
        if poly.contains(Point(p)):
            return p
    return tuple(room["centroid"])


def simulate(fp: dict, occupants: int, nav: NavGraph | None = None, seed: int = 7) -> dict:
    nav = nav or NavGraph(fp)
    rng = random.Random(seed)
    rooms = [r for r in fp["rooms"] if r["type"] not in ("hallway", "stairwell")]
    total_area = sum(r.get("area_m2", 1) for r in rooms) or 1
    routes = {r["id"]: nav.to_exit(r["id"]) for r in rooms}

    agents = []
    for r in rooms:
        route = routes[r["id"]]
        if not route:
            continue
        n = max(0, round(occupants * r.get("area_m2", 1) / total_area))
        for _ in range(n):
            start = _spawn(r, rng)
            line = LineString([start] + [tuple(p) for p in route["polyline"]][1:]) if len(route["polyline"]) > 1 else LineString([start, start])
            door_ids = route["door_ids"] + [route["exit_door_id"]]
            checkpoints = sorted((line.project(Point(nav.doors[d]["position"])), d) for d in door_ids)
            agents.append({"id": len(agents), "room": r["id"], "line": line, "s": 0.0, "checkpoints": checkpoints,
                           "next": 0, "done_at": None, "exit": route["exit_door_id"], "speed": WALK_MPS * rng.uniform(0.85, 1.15)})

    credit = {d: 0.0 for d in nav.doors}
    peak_queue = {d: 0 for d in nav.doors}
    frames, t = [], 0.0
    next_frame = 0.0
    while t <= MAX_S and any(a["done_at"] is None for a in agents):
        for d in credit:
            credit[d] = min(credit[d] + FLOW_PPSM * nav.doors[d]["width_m"] * DT, 1.0 + FLOW_PPSM * nav.doors[d]["width_m"] * DT)
        waiting = {d: 0 for d in nav.doors}
        for a in sorted((a for a in agents if a["done_at"] is None), key=lambda a: -a["s"]):
            target = a["s"] + a["speed"] * DT
            if a["next"] < len(a["checkpoints"]):
                cs, did = a["checkpoints"][a["next"]]
                if target >= cs - 0.3:
                    if credit[did] >= 1.0:
                        credit[did] -= 1.0
                        a["next"] += 1
                    else:
                        target = max(a["s"], cs - 0.3 - 0.45 * waiting[did])
                        waiting[did] += 1
            a["s"] = min(target, a["line"].length)
            if a["next"] >= len(a["checkpoints"]):
                a["done_at"] = round(t, 2)
        for d, n in waiting.items():
            peak_queue[d] = max(peak_queue[d], n)
        if t >= next_frame:
            frames.append({"t": round(t, 1),
                           "agents": [[round(c, 2) for c in a["line"].interpolate(a["s"]).coords[0]] if a["done_at"] is None else None for a in agents],
                           "queues": {d: n for d, n in waiting.items() if n}})
            next_frame += FRAME_EVERY_S
        t += DT

    per_exit = {}
    for a in agents:
        per_exit[a["exit"]] = per_exit.get(a["exit"], 0) + 1
    bottleneck = max(peak_queue, key=peak_queue.get) if agents else None
    exits = [d for d in nav.doors.values() if d["is_exit"]]
    unused = [d["id"] for d in exits if per_exit.get(d["id"], 0) == 0]
    clear = max((a["done_at"] or MAX_S for a in agents), default=0)
    def name(did):
        d = nav.doors[did]
        labels = [nav.rooms[x]["label"] if x in nav.rooms else x for x in d["rooms"]]
        where = f"exit from {labels[0]}" + (f" (side {d['side']})" if d.get("side") else "") if d["is_exit"] else " / ".join(labels)
        return f"{d['width_m']:.1f} m door, {where}"

    advice = []
    if bottleneck and peak_queue[bottleneck] >= 3:
        advice.append(f"Queue of {peak_queue[bottleneck]} at the {name(bottleneck)}: stage a crew there and keep it propped open.")
    if unused:
        advice.append("Unused by shortest routes: " + "; ".join(name(u) for u in unused) + ". Direct occupants there to spread the load.")
    return {
        "occupants": len(agents), "clear_time_s": clear, "per_exit": per_exit,
        "bottleneck_door_id": bottleneck, "peak_queue": {d: n for d, n in peak_queue.items() if n},
        "advice": advice, "frames": frames,
        "agent_rooms": [a["room"] for a in agents],
    }
