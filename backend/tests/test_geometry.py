import pytest

from data import cache, layers
from geometry import evac, wallfollow
from geometry.navgraph import NavGraph
from geometry.sides import footprint_sides, side_map

HEROES = [b["id"] for b in cache.buildings()]
SAMPLE = cache.load_json("sample", "floorplan.json")


@pytest.mark.parametrize("bid", HEROES)
def test_every_room_reaches_an_exit(bid):
    fp = layers.floorplan(bid)
    assert any(d["is_exit"] for d in fp["doors"])
    for r in fp["rooms"]:
        assert not fp["maze_detail"][r["id"]].get("unreachable"), r["label"]
        assert 0 <= fp["maze_score"][r["id"]] <= 1


@pytest.mark.parametrize("bid", HEROES)
def test_labels_unique(bid):
    labels = [r["label"] for r in layers.floorplan(bid)["rooms"]]
    assert len(labels) == len(set(labels))


def test_route_to_specific_exit_stays_inside():
    nav = layers.nav("costar-239873")
    for ex in nav.exits():
        r = nav.to_exit("r-tx2gws", ex["id"])
        assert "outside" not in r["nodes"]
        assert r["exit_door_id"] == ex["id"]
    dists = nav.exit_distances("r-tx2gws")
    assert len(set(dists.values())) > 1, "exits far apart must not share one distance"


def test_sample_routes_and_mayday():
    nav = NavGraph(SAMPLE)
    r = nav.to_exit("r-302")
    assert r["exit_door_id"] == "d-rear"
    assert r["path"] == ["r-302", "r-hall"]
    res = wallfollow.mayday(SAMPLE, "r-302", nav)
    assert res["exit_door_id"] == "d-rear"
    assert res["directions"][1].endswith("hand on the wall.")
    assert "Exit door" in res["directions"][-1]


def test_mayday_hero_is_short_and_spoken():
    fp, nav = layers.floorplan("costar-239873"), layers.nav("costar-239873")
    res = wallfollow.mayday(fp, "r-tx2gws", nav, layers.sides("costar-239873").of_local)
    assert res["distance_m"] < 30
    assert len(res["directions"]) <= 12
    assert res["wall_path"]


def test_maze_score_ranks_dead_end_above_hallway():
    fp = layers.floorplan("costar-239873")
    hall = next(r for r in fp["rooms"] if r["type"] == "hallway")
    assert fp["maze_score"]["r-tx2gws"] > fp["maze_score"][hall["id"]]


def test_side_map_clockwise():
    assert side_map("S") == {"S": "A", "W": "B", "N": "C", "E": "D"}
    assert side_map("N") == {"N": "A", "E": "B", "S": "C", "W": "D"}


def test_footprint_sides():
    wkt = "POLYGON ((-95.0 29.0, -94.999 29.0, -94.999 29.001, -95.0 29.001, -95.0 29.0))"
    s = footprint_sides(wkt, "S")
    assert s["A"]["compass"] == "S" and s["C"]["compass"] == "N"
    assert s["A"]["staging_lat"] < s["A"]["lat"]


def test_evac_clears_everyone():
    res = evac.simulate(layers.floorplan("costar-239873"), 30, layers.nav("costar-239873"))
    assert res["occupants"] > 0
    assert res["clear_time_s"] < 600
    assert sum(res["per_exit"].values()) == res["occupants"]
