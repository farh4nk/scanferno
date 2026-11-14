"""Matterport vector data -> floorplan.json (see docs/CONTRACTS.md).

Rooms come from boundary/hole edge loops. Doors and windows come from edge openings; which rooms an
opening joins is decided geometrically (probe a point just past each face of the wall), so doors on
walls that Matterport didn't share between rooms still connect correctly. An opening with open air on
one side is an exit.

Most scans label rooms "Other", so type is inferred from shape and door count (type_inferred: true).
Per-building overrides in buildings.json (`floorplan_overrides`) can rename rooms or add exits that
the scan missed (e.g. a suite whose entrance opens onto an unscanned corridor).
"""
import math

from shapely.geometry import LineString, MultiLineString, Point, Polygon
from shapely.ops import polygonize, unary_union

LABEL_TYPES = {
    "office": "office", "hallway": "hallway", "corridor": "hallway", "kitchen": "kitchen",
    "bathroom": "restroom", "restroom": "restroom", "toilet": "restroom", "closet": "storage",
    "storage": "storage", "utility": "storage", "laundry": "storage", "lobby": "lobby",
    "entryway": "lobby", "foyer": "lobby", "reception": "lobby", "stairs": "stairwell",
    "stairwell": "stairwell", "staircase": "stairwell",
}
TYPE_NAMES = {
    "office": "Office", "hallway": "Hallway", "kitchen": "Kitchen", "restroom": "Restroom",
    "storage": "Storage", "lobby": "Lobby", "stairwell": "Stairwell", "open_area": "Open area", "other": "Room",
}
PROBE_DEPTHS_M = (0.3, 0.6, 1.0, 1.5)


def _xy(v: dict) -> tuple[float, float]:
    return (v["position"]["x"], v["position"]["y"])


def _region_polygon(region: dict) -> Polygon | None:
    lines = [LineString([_xy(v) for v in e["vertices"]]) for e in region["edges"] if len(e["vertices"]) == 2]
    if not lines:
        return None
    polys = list(polygonize(unary_union(MultiLineString(lines))))
    return max(polys, key=lambda p: p.area) if polys else None


def _room_polygon(room: dict) -> Polygon | None:
    outer = _region_polygon(room["boundary"])
    if outer is None:
        return None
    for h in room.get("holes") or []:
        hp = _region_polygon(h)
        if hp is not None:
            outer = outer.difference(hp)
    if outer.geom_type != "Polygon":
        outer = max(outer.geoms, key=lambda p: p.area)
    return outer


def _rnd(p) -> list[float]:
    return [round(p[0], 3), round(p[1], 3)]


def _anchor(poly: Polygon) -> Point:
    c = poly.centroid
    return c if poly.contains(c) else poly.representative_point()


def _infer_type(poly: Polygon, door_count: int) -> str:
    rect = poly.minimum_rotated_rectangle
    xs, ys = rect.exterior.coords.xy
    sides = sorted(math.dist((xs[i], ys[i]), (xs[i + 1], ys[i + 1])) for i in range(2))
    width, length = sides[0], sides[1]
    area = poly.area
    compactness = 4 * math.pi * area / (poly.length ** 2)
    if area > 80 and door_count >= 4:
        return "open_area"
    if width < 2.6 and length / max(width, 0.1) > 2.5 and door_count >= 2:
        return "hallway"
    if compactness < 0.35 and door_count >= 3:
        return "hallway"
    if area < 5:
        return "storage"
    return "office"


def _matterport_type(room: dict) -> str | None:
    for c in room.get("classifications") or []:
        t = LABEL_TYPES.get((c.get("label") or "").strip().lower())
        if t:
            return t
    return None


def _is_void(room: dict) -> bool:
    return any((c.get("label") or "").lower() == "void" for c in room.get("classifications") or [])


def build(raw: dict, building: dict) -> dict:
    """raw = matterport.vector_data(); building = entry from fixtures/buildings.json."""
    overrides = building.get("floorplan_overrides") or {}
    floors = sorted(raw.get("floors") or [{"id": "f-1", "sequence": 0, "label": "Floor 1"}], key=lambda f: f["sequence"])
    floor_id = floors[0]["id"]

    rooms, voids, edge_owner = {}, [], {}
    used_ids = set()
    for r in raw["rooms"]:
        poly = _room_polygon(r)
        if poly is None or poly.area < 0.5:
            continue
        if _is_void(r):
            voids.append(poly)
            continue
        rid = "r-" + r["id"][:6]
        while rid in used_ids:
            rid += "x"
        used_ids.add(rid)
        rooms[rid] = {"raw": r, "poly": poly}
        for region in [r["boundary"]] + (r.get("holes") or []):
            for e in region["edges"]:
                edge_owner.setdefault(e["id"], set()).add(rid)

    occupied = unary_union([v["poly"] for v in rooms.values()] + voids)
    outline = occupied.buffer(0.3, join_style=2).buffer(-0.3, join_style=2)
    if outline.geom_type != "Polygon":
        outline = max(outline.geoms, key=lambda p: p.area)

    def room_at(pt: Point, exclude: set) -> str | None:
        hits = [(v["poly"].area, rid) for rid, v in rooms.items() if rid not in exclude and v["poly"].contains(pt)]
        return min(hits)[1] if hits else None

    doors, windows, seen = [], [], set()
    for rid, v in rooms.items():
        for region in [v["raw"]["boundary"]] + (v["raw"].get("holes") or []):
            for e in region["edges"]:
                for o in e.get("openings") or []:
                    if o["id"] in seen or len(e["vertices"]) != 2:
                        continue
                    seen.add(o["id"])
                    (ax, ay), (bx, by) = _xy(e["vertices"][0]), _xy(e["vertices"][1])
                    t = o.get("relativeCenter", 0.5)
                    pos = (ax + (bx - ax) * t, ay + (by - ay) * t)
                    seg = math.hypot(bx - ax, by - ay) or 1.0
                    nx, ny = -(by - ay) / seg, (bx - ax) / seg
                    owners = edge_owner.get(e["id"], {rid})
                    sides = []
                    for sign in (1, -1):
                        hit = None
                        for depth in PROBE_DEPTHS_M:
                            p = Point(pos[0] + sign * nx * depth, pos[1] + sign * ny * depth)
                            hit = room_at(p, set())
                            if hit:
                                break
                            if any(v.contains(p) for v in voids):
                                hit = "unscanned"
                                break
                        sides.append(hit or "outside")
                    if sides[0] == sides[1]:
                        sides[1] = next((x for x in owners if x != sides[0]), "unscanned")
                    if not any(x in rooms for x in sides):
                        sides[0] = rid
                    pair = sorted(sides, key=lambda x: x not in rooms)
                    if o["type"] == "window":
                        room_side = next((x for x in pair if x in rooms), rid)
                        windows.append({
                            "id": "w-" + o["id"][:6], "floor_id": floor_id, "room_id": room_side,
                            "position": _rnd(pos), "width_m": round(o["width"], 2),
                            "sill_m": round(o.get("lowerElevation") or 0, 2),
                            "exterior": "outside" in pair,
                        })
                        continue
                    doors.append({
                        "id": "d-" + o["id"][:6], "floor_id": floor_id, "rooms": pair[:2],
                        "position": _rnd(pos), "width_m": round(o["width"], 2),
                        "type": "doorway" if o["width"] < 1.6 else "opening",
                        "is_exit": "outside" in pair,
                    })

    for i, ex in enumerate(overrides.get("exits") or []):
        p = Point(ex["position"])
        rid = ex.get("room_id") or room_at(p, set())
        if rid is None:
            rid = min(rooms, key=lambda k: rooms[k]["poly"].exterior.distance(p))
        doors.append({
            "id": ex.get("id") or f"d-exit{i + 1}", "floor_id": floor_id, "rooms": [rid, "outside"],
            "position": _rnd(ex["position"]), "width_m": ex.get("width_m", 0.9),
            "type": "doorway", "is_exit": True, "inferred": True,
        })

    door_count = {rid: 0 for rid in rooms}
    for d in doors:
        for x in d["rooms"]:
            if x in door_count:
                door_count[x] += 1

    for rid in [r for r, n in door_count.items() if n == 0]:
        ring = rooms[rid]["poly"].exterior
        band = ring.buffer(0.4)
        shared = [(band.intersection(v["poly"].exterior).length, other) for other, v in rooms.items() if other != rid]
        length, other = max(shared, default=(0, None))
        if not other or length < 0.9:
            continue
        contact = band.intersection(rooms[other]["poly"].exterior)
        pos = ring.interpolate(ring.project(contact.interpolate(0.5, normalized=True)))
        doors.append({
            "id": f"d-assumed-{rid[2:]}", "floor_id": floor_id, "rooms": [rid, other],
            "position": _rnd(pos.coords[0]), "width_m": 0.9, "type": "doorway", "is_exit": False,
            "inferred": True,
        })
        door_count[rid] += 1
        door_count[other] += 1

    out_rooms = []
    for rid, v in rooms.items():
        poly = v["poly"]
        mtype = _matterport_type(v["raw"])
        rtype = mtype or _infer_type(poly, door_count[rid])
        out_rooms.append({
            "id": rid, "floor_id": floor_id, "label": None, "type": rtype,
            "type_inferred": mtype is None,
            "polygon": [_rnd(c) for c in list(poly.exterior.coords)[:-1]],
            "holes": [[_rnd(c) for c in list(h.coords)[:-1]] for h in poly.interiors],
            "centroid": _rnd(_anchor(poly).coords[0]),
            "area_m2": round(poly.area, 1),
            "matterport_id": v["raw"]["id"],
        })

    _label_rooms(out_rooms, floors[0]["sequence"] + 1)
    for rid, ov in (overrides.get("rooms") or {}).items():
        for r in out_rooms:
            if r["id"] == rid:
                r.update({k: ov[k] for k in ("label", "type") if k in ov})
                if "type" in ov:
                    r["type_inferred"] = False

    return {
        "building_id": building["id"],
        "units": "meters",
        "floors": [{"id": f["id"], "label": f.get("label") or f"Floor {f['sequence'] + 1}", "sequence": f["sequence"]} for f in floors],
        "rooms": out_rooms,
        "doors": doors,
        "windows": windows,
        "stairs": [],
        "voids": [[_rnd(c) for c in list(v.exterior.coords)[:-1]] for v in voids],
        "outline": [_rnd(c) for c in list(outline.exterior.coords)[:-1]],
    }


def _label_rooms(rooms: list[dict], floor_num: int) -> None:
    """Readable radio-friendly labels: Office 101, Storage 104, Hallway A. Numbered west-to-east, north-to-south."""
    rooms.sort(key=lambda r: (-round(r["centroid"][1] / 3), r["centroid"][0]))
    n, lettered = 1, {}
    for r in rooms:
        if r["type"] in ("hallway", "open_area"):
            k = lettered.get(r["type"], 0)
            r["label"] = f"{TYPE_NAMES[r['type']]} {chr(ord('A') + k)}"
            lettered[r["type"]] = k + 1
        else:
            r["label"] = f"{TYPE_NAMES.get(r['type'], 'Room')} {floor_num}{n:02d}"
            n += 1
