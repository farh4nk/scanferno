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


def test_catalog_covers_every_matterport_model():
    s = client.get("/search/stats").json()
    assert s["matterport_models"] > 10000 and s["located"] > 5000 and s["ready"] == 3


def test_search_finds_complexes_by_unit_scan_names_and_typos():
    sky = client.get("/search", params={"q": "skylux"}).json()["results"][0]
    assert sky["status"] == "scanned" and sky["models_count"] > 10 and sky["scan"]["model_id"]
    typo = client.get("/search", params={"q": "2001 westheimr rd"}).json()["results"][0]
    assert typo["address"].startswith("2001 Westheimer") and typo["score"] >= directory.GOOD_SCORE


def test_filters_facets_and_paging():
    everything = client.get("/search", params={"limit": 5}).json()
    assert everything["total"] > 8000 and everything["facets"]["status"]["ready"] >= 3
    ready = client.get("/search", params={"q": "houston", "status": "ready"}).json()
    assert ready["total"] >= 3 and all(r["status"] == "ready" for r in ready["results"])
    la = client.get("/search", params={"city": "Los Angeles", "kind": "residential", "limit": 10}).json()
    assert la["total"] > 500 and all(r["city"] == "Los Angeles" and r["kind"] == "residential" for r in la["results"])
    page2 = client.get("/search", params={"city": "Los Angeles", "kind": "residential", "limit": 10, "offset": 10}).json()
    assert page2["total"] == la["total"] and not {r["id"] for r in la["results"]} & {r["id"] for r in page2["results"]}
    assert client.get("/search", params={"q": "suite", "costar": "true"}).json()["facets"]["costar"].get("yes")


def test_property_by_matterport_model_id_merges_all_scans():
    p = client.get("/properties/szdeKc4TjsE").json()
    assert p["id"] == "costar-239873" and p["status"] == "ready"
    assert {m["id"] for m in p["models"]} >= {"szdeKc4TjsE", "QB5AhU1bLSH"}


def test_hero_vexcel_and_aerial_come_from_fixtures():
    v = client.get("/properties/costar-239873/vexcel").json()
    assert v["roof_material"] == "membrane" and v["footprint_area_m2"]
    r = client.get("/properties/costar-239873/aerial", params={"view": "oblique-north"})
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg"
    assert client.get("/properties/costar-239873/aerial", params={"view": "sideways"}).status_code == 422
