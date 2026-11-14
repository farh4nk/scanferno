"""Navigation graph over a floorplan.

Nodes: ("room", id) at the room anchor, ("door", id) at each doorway, and "outside".
Edges carry walking distance inside the shared room, computed as the shortest path within the room
polygon (visibility graph on the polygon shrunk away from the walls), so routes through L-shaped
hallways bend around corners instead of passing through walls. Door width is kept on door nodes as
capacity for the evacuation model.
"""
import math
from functools import cached_property
from itertools import combinations

import networkx as nx
from shapely.geometry import LineString, Point, Polygon
from shapely.prepared import prep

OUTSIDE = "outside"
WALL_CLEARANCE_M = 0.3


class RoomSpace:
    """Shortest paths inside one room polygon."""

    def __init__(self, room: dict):
        self.room = room
        self.poly = Polygon(room["polygon"], room.get("holes") or [])
        self._free = prep(self.poly.buffer(0.05))
        inner = self.poly.buffer(-WALL_CLEARANCE_M, join_style=2)
        if inner.is_empty:
            inner = self.poly
        polys = [inner] if inner.geom_type == "Polygon" else list(inner.geoms)
        self.verts = [c for p in polys for ring in [p.exterior, *p.interiors]
                      for c in list(ring.simplify(0.05).coords)[:-1]]

    def visible(self, a, b) -> bool:
        return a == b or self._free.contains(LineString([a, b]))

    @cached_property
    def _vis(self) -> nx.Graph:
        g = nx.Graph()
        for i, a in enumerate(self.verts):
            g.add_node(i)
        for (i, a), (j, b) in combinations(enumerate(self.verts), 2):
            if self.visible(a, b):
                g.add_edge(i, j, weight=math.dist(a, b))
        return g

    def path(self, a, b) -> list[tuple[float, float]]:
        a, b = tuple(a), tuple(b)
        if self.visible(a, b):
            return [a, b]
        g = self._vis.copy()
        for name, p in (("a", a), ("b", b)):
            g.add_node(name)
            for i, v in enumerate(self.verts):
                if self.visible(p, v):
                    g.add_edge(name, i, weight=math.dist(p, v))
        try:
            nodes = nx.shortest_path(g, "a", "b", weight="weight")
        except (nx.NetworkXNoPath, nx.NodeNotFound):
            return [a, b]
        return [a if n == "a" else b if n == "b" else self.verts[n] for n in nodes]


def polyline_length(pts) -> float:
    return sum(math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1))


class NavGraph:
    def __init__(self, fp: dict):
        self.fp = fp
        self.rooms = {r["id"]: r for r in fp["rooms"]}
        self.doors = {d["id"]: d for d in fp["doors"]}
        self.spaces = {rid: RoomSpace(r) for rid, r in self.rooms.items()}
        self.g = nx.Graph()
        self._legs: dict[tuple, list] = {}
        self._build()
        # routes to a specific exit or room must not shortcut out one door and back in another
        self.inside = self.g.subgraph([n for n in self.g if n != OUTSIDE])

    def _leg(self, rid: str, a, b) -> list:
        key = (rid, tuple(a), tuple(b))
        if key not in self._legs:
            self._legs[key] = self.spaces[rid].path(a, b)
        return self._legs[key]

    def _build(self):
        g = self.g
        g.add_node(OUTSIDE)
        by_room: dict[str, list[dict]] = {rid: [] for rid in self.rooms}
        for d in self.doors.values():
            g.add_node(("door", d["id"]), pos=tuple(d["position"]), width=d["width_m"])
            for rid in d["rooms"]:
                if rid in by_room:
                    by_room[rid].append(d)
            if d["is_exit"]:
                g.add_edge(("door", d["id"]), OUTSIDE, weight=0.0, room=None)
        for rid, r in self.rooms.items():
            c = tuple(r["centroid"])
            g.add_node(("room", rid), pos=c)
            for d in by_room[rid]:
                pts = self._leg(rid, c, d["position"])
                g.add_edge(("room", rid), ("door", d["id"]), weight=polyline_length(pts), room=rid)
            for d1, d2 in combinations(by_room[rid], 2):
                pts = self._leg(rid, d1["position"], d2["position"])
                w = polyline_length(pts)
                if g.has_edge(("door", d1["id"]), ("door", d2["id"])) and g[("door", d1["id"])][("door", d2["id"])]["weight"] <= w:
                    continue
                g.add_edge(("door", d1["id"]), ("door", d2["id"]), weight=w, room=rid)

    def doors_of(self, rid: str) -> list[dict]:
        return [d for d in self.doors.values() if rid in d["rooms"]]

    def exits(self) -> list[dict]:
        return [d for d in self.doors.values() if d["is_exit"]]

    def route(self, nodes: list) -> dict:
        """Expand a node path (room/door nodes, optionally ending at OUTSIDE) into rooms, doors, polyline."""
        pts, rooms, door_ids, dist = [], [], [], 0.0
        for u, v in zip(nodes, nodes[1:]):
            if OUTSIDE in (u, v):
                continue
            rid = self.g[u][v]["room"]
            a, b = self.g.nodes[u]["pos"], self.g.nodes[v]["pos"]
            leg_pts = self._leg(rid, a, b)
            pts.extend(leg_pts if not pts else leg_pts[1:])
            dist += polyline_length(leg_pts)
            if not rooms or rooms[-1] != rid:
                rooms.append(rid)
        for n in nodes:
            if isinstance(n, tuple) and n[0] == "door":
                door_ids.append(n[1])
        return {
            "path": rooms, "door_ids": door_ids, "distance_m": round(dist, 1),
            "polyline": [[round(x, 2), round(y, 2)] for x, y in pts],
        }

    def to_exit(self, rid: str, exit_door_id: str | None = None) -> dict | None:
        """Shortest route from a room to the nearest exit (or a specific exit door)."""
        target = ("door", exit_door_id) if exit_door_id else OUTSIDE
        graph = self.inside if exit_door_id else self.g
        try:
            nodes = nx.shortest_path(graph, ("room", rid), target, weight="weight")
        except (nx.NetworkXNoPath, nx.NodeNotFound):
            return None
        out = self.route(nodes)
        exit_id = exit_door_id or next(n[1] for n in reversed(nodes) if isinstance(n, tuple) and n[0] == "door")
        out.update({"from_room_id": rid, "exit_door_id": exit_id, "nodes": nodes})
        out["door_ids"] = [d for d in out["door_ids"] if d != exit_id]
        return out

    def between(self, a: str, b: str) -> dict | None:
        try:
            nodes = nx.shortest_path(self.inside, ("room", a), ("room", b), weight="weight")
        except (nx.NetworkXNoPath, nx.NodeNotFound):
            return None
        out = self.route(nodes)
        out.update({"from_room_id": a, "to_room_id": b})
        return out

    def exit_distances(self, rid: str) -> dict[str, float]:
        """Distance from a room to every reachable exit door."""
        lengths = nx.single_source_dijkstra_path_length(self.inside, ("room", rid), weight="weight")
        return {d["id"]: round(lengths[("door", d["id"])], 1) for d in self.exits() if ("door", d["id"]) in lengths}

    def room_at(self, xy) -> str | None:
        p = Point(xy)
        hits = [(s.poly.area, rid) for rid, s in self.spaces.items() if s.poly.buffer(0.05).contains(p)]
        return min(hits)[1] if hits else None
