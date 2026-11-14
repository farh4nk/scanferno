"""Fireground building sides: A = street front, then B, C (rear), D clockwise seen from above.

Two frames:
- Indoor (Matterport local meters). `scan_rotation_deg` in buildings.json rotates the scan into
  east/north (0 = scan +y is north). A point takes the side its nearest outer wall faces.
- Aerial (Vexcel footprint, lat/lon). Each side gets the footprint edge facing that way, its midpoint,
  and a ladder staging point a few meters out from it.
"""
import math

from shapely import wkt as shapely_wkt
from shapely.geometry import LineString, Point, Polygon
from shapely.geometry.polygon import orient

COMPASS = ["N", "E", "S", "W"]
SIDE_NAMES = {"A": "Alpha", "B": "Bravo", "C": "Charlie", "D": "Delta"}
M_PER_DEG_LAT = 111_320.0


def side_map(front: str = "S") -> dict[str, str]:
    """compass -> side letter, e.g. front S gives {S: A, W: B, N: C, E: D}."""
    i = COMPASS.index(front)
    return {COMPASS[(i + k) % 4]: "ABCD"[k] for k in range(4)}


def compass_of(dx_east: float, dy_north: float) -> str:
    if abs(dx_east) >= abs(dy_north):
        return "E" if dx_east > 0 else "W"
    return "N" if dy_north > 0 else "S"


def local_to_enu(xy, rotation_deg: float) -> tuple[float, float]:
    t = math.radians(rotation_deg)
    return (xy[0] * math.cos(t) - xy[1] * math.sin(t), xy[0] * math.sin(t) + xy[1] * math.cos(t))


class Sides:
    def __init__(self, building: dict, fp: dict | None = None):
        self.front = building.get("front", "S")
        self.rotation = float(building.get("scan_rotation_deg", 0))
        self.map = side_map(self.front)
        self.inverse = {v: k for k, v in self.map.items()}
        self.walls = []
        if fp and fp.get("outline"):
            ring = list(orient(Polygon(fp["outline"]), 1.0).exterior.coords)
            self.walls = [LineString([a, b]) for a, b in zip(ring, ring[1:]) if math.dist(a, b) > 1.0]

    def of_local(self, xy) -> str:
        """Side of the nearest outer wall of the scanned floor (falls back to direction from origin)."""
        if not self.walls:
            return self.map[compass_of(*local_to_enu(xy, self.rotation))]
        wall = min(self.walls, key=lambda w: w.distance(Point(xy)))
        (x1, y1), (x2, y2) = wall.coords
        e, n = local_to_enu((y2 - y1, -(x2 - x1)), self.rotation)
        return self.map[compass_of(e, n)]

    def exterior_sides(self, polygon) -> list[str]:
        """Every side whose outer wall this room runs along (a corner room has two)."""
        poly = Polygon(polygon).buffer(0.6)
        out = set()
        for wall in self.walls:
            if poly.intersection(wall).length > 1.0:
                (x1, y1), (x2, y2) = wall.coords
                out.add(self.map[compass_of(*local_to_enu((y2 - y1, -(x2 - x1)), self.rotation))])
        return sorted(out)

    def compass(self, side: str) -> str:
        return self.inverse[side]

    def label(self, side: str) -> str:
        return f"{side} ({SIDE_NAMES[side]}, {self.compass(side)})"


def footprint_sides(footprint_wkt: str, front: str = "S", standoff_m: float = 8.0) -> dict:
    """side letter -> {compass, edge midpoint lat/lon, ladder staging lat/lon, wall length}."""
    geom = shapely_wkt.loads(footprint_wkt)
    poly = geom if geom.geom_type == "Polygon" else max(geom.geoms, key=lambda g: g.area)
    lat0 = poly.centroid.y
    m_lon = M_PER_DEG_LAT * math.cos(math.radians(lat0))
    pts = [((x - poly.centroid.x) * m_lon, (y - lat0) * M_PER_DEG_LAT) for x, y in poly.exterior.coords]
    area = sum(pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1] for i in range(len(pts) - 1)) / 2
    ccw = area > 0
    best: dict[str, tuple] = {}
    for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
        dx, dy = x2 - x1, y2 - y1
        length = math.hypot(dx, dy)
        if length < 1:
            continue
        nx, ny = (dy, -dx) if ccw else (-dy, dx)
        c = compass_of(nx, ny)
        if c not in best or length > best[c][0]:
            best[c] = (length, ((x1 + x2) / 2, (y1 + y2) / 2), (nx / length, ny / length))
    smap = side_map(front)

    def to_ll(x, y):
        return round(lat0 + y / M_PER_DEG_LAT, 7), round(poly.centroid.x + x / m_lon, 7)

    out = {}
    for c, (length, (mx, my), (ux, uy)) in best.items():
        lat, lon = to_ll(mx, my)
        slat, slon = to_ll(mx + ux * standoff_m, my + uy * standoff_m)
        out[smap[c]] = {"compass": c, "wall_length_m": round(length, 1), "lat": lat, "lon": lon,
                        "staging_lat": slat, "staging_lon": slon}
    return dict(sorted(out.items()))
