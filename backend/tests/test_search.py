from fastapi.testclient import TestClient

from app.main import app
from data import directory

client = TestClient(app)


def test_search_matches_abbreviations_and_ranks_ready_first():
    r = client.get("/search", params={"q": "8866 Gulf Freeway"}).json()
    top = r["results"][0]
    assert top["building_id"] == "costar-239873" and top["status"] == "ready" and top["score"] >= directory.GOOD_SCORE


def test_search_by_name_finds_scanned_properties():
    r = client.get("/search", params={"q": "harwin plaza"}).json()["results"]
    assert r and all(x["status"] == "scanned" and x["building_id"] is None for x in r)


def test_wrong_house_number_is_a_weak_match():
    r = client.get("/search", params={"q": "8860 gulf fwy"}).json()["results"]
    assert r[0]["building_id"] == "costar-239873" and r[0]["score"] < directory.GOOD_SCORE


def test_empty_query_browses_and_coordinates_find_nearby():
    assert client.get("/search").json()["results"][0]["status"] == "ready"
    near = client.get("/search", params={"lat": 29.6623, "lon": -95.259}).json()["nearby"]
    assert near[0]["id"] == "costar-239873" and near[0]["distance_m"] < 100


def test_geocode_fallback_uses_cache(monkeypatch):
    monkeypatch.setattr(directory, "geocode", lambda q: {"lat": 29.7097, "lon": -95.4749, "display_name": "somewhere"})
    r = client.get("/search", params={"q": "1 Nowhere Lane", "geocode": True}).json()
    assert r["geocoded"] and r["nearby"][0]["id"] == "costar-350372"


def test_property_detail():
    hit = client.get("/search", params={"q": "harwin plaza"}).json()["results"][0]
    p = client.get(f"/properties/{hit['costar_property_id']}").json()
    assert p["onboard_hint"] and p["nearest_ready"]
    assert client.get("/properties/costar-239873").json()["status"] == "ready"
    assert client.get("/properties/nope").status_code == 404
