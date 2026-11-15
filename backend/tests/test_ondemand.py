"""On-demand ready: catalog building → vector + floorplan, same API as heroes."""
import json

from fastapi.testclient import TestClient

from app.main import app
from data import cache, directory, layers
from ondemand import registry

client = TestClient(app)

# Skylux: large multi-scan building in the catalog (not a hero)
CATALOG_ID = "mp-KKw46Xg1vgH"


def _fake_vector(model_id="fake"):
    """Tiny Matterport-like vector with one room and an exterior doorway."""
    return {
        "floors": [{"id": "f1", "sequence": 0, "label": "1"}],
        "rooms": [{
            "id": "roomA",
            "label": "Office",
            "classifications": [{"label": "Office"}],
            "boundary": {
                "edges": [
                    {"id": "e1", "type": "wall",
                     "vertices": [{"position": {"x": 0, "y": 0}}, {"position": {"x": 5, "y": 0}}],
                     "openings": [{"id": "o1", "type": "doorway", "width": 1.0, "relativeCenter": 0.5}]},
                    {"id": "e2", "type": "wall",
                     "vertices": [{"position": {"x": 5, "y": 0}}, {"position": {"x": 5, "y": 4}}],
                     "openings": []},
                    {"id": "e3", "type": "wall",
                     "vertices": [{"position": {"x": 5, "y": 4}}, {"position": {"x": 0, "y": 4}}],
                     "openings": []},
                    {"id": "e4", "type": "wall",
                     "vertices": [{"position": {"x": 0, "y": 4}}, {"position": {"x": 0, "y": 0}}],
                     "openings": []},
                ]
            },
            "holes": [],
        }],
    }


def test_status_unknown_and_hero():
    assert client.get("/ondemand/nope").status_code == 404
    s = client.get("/ondemand/costar-239873").json()
    assert s["status"] == "ready" and s["building_id"] == "costar-239873" and s["cached"]


def test_prepare_catalog_building_with_mocked_matterport(monkeypatch, tmp_path):
    monkeypatch.setattr("ondemand.ready.matterport.vector_data", lambda mid: _fake_vector(mid))
    monkeypatch.setattr("ondemand.ready.vexcel.oriented_image", lambda *a, **k: b"JPEG")
    monkeypatch.setattr("ondemand.ready.vexcel.structure", lambda *a, **k: {"features": []})
    # wipe prior on-demand cache so the first call is a real fetch
    import shutil
    shutil.rmtree(cache.FIXTURES / CATALOG_ID, ignore_errors=True)
    rows = [b for b in registry.all() if b["id"] != CATALOG_ID]
    cache.save_json(rows, *registry.PATH)
    registry.clear()
    directory.clear()
    layers.clear()
    e = directory.get(CATALOG_ID)
    assert e and e["status"] == "scanned"

    r = client.post(f"/ondemand/{CATALOG_ID}", params={"outside": False}).json()
    assert r["status"] == "ready" and r["building_id"] == CATALOG_ID and r["cached"] is False
    assert registry.get(CATALOG_ID)
    assert cache.FIXTURES.joinpath(CATALOG_ID, "matterport_vector.json").exists()
    assert cache.FIXTURES.joinpath(CATALOG_ID, "floorplan.json").exists()

    fp = client.get(f"/buildings/{CATALOG_ID}/floorplan").json()
    assert fp["rooms"] and any(d.get("is_exit") for d in fp["doors"])

    again = client.post(f"/ondemand/{CATALOG_ID}", params={"outside": False}).json()
    assert again["cached"] is True

    # search list flips to ready so picking it opens the briefing (not the property modal)
    hit = client.get("/search", params={"q": "skylux", "limit": 5}).json()["results"][0]
    assert hit["id"] == CATALOG_ID and hit["status"] == "ready" and hit["building_id"] == CATALOG_ID
    assert client.get(f"/properties/{CATALOG_ID}").json()["status"] == "ready"

    # listed alongside heroes
    ids = {b["id"] for b in client.get("/buildings").json()}
    assert CATALOG_ID in ids and "costar-239873" in ids


def test_prepare_empty_scan_is_422(monkeypatch):
    monkeypatch.setattr("ondemand.ready.matterport.vector_data",
                        lambda mid: {"floors": [], "rooms": [{"id": "v", "classifications": [{"label": "Void"}],
                                                             "boundary": {"edges": []}, "holes": []}]})
    # use a different catalog building so we don't clash with the previous test's cache
    e = next(x for x in directory.entries() if x["status"] == "scanned" and x["id"] != CATALOG_ID and x.get("scan"))
    # wipe any prior vector so prepare tries the fake empty one
    p = cache.FIXTURES / e["id"] / "matterport_vector.json"
    if p.exists():
        p.unlink()
    r = client.post(f"/ondemand/{e['id']}", params={"outside": False})
    assert r.status_code == 422


def test_resolve_address_finds_hero():
    from ondemand import resolve
    e = resolve.from_text("8866 Gulf Freeway")
    assert e and e["building_id"] == "costar-239873"


def test_live_session_switches_building_on_address(monkeypatch):
    from dispatch import session as sess
    # Ensure catalog target is ready with fake vector
    monkeypatch.setattr("ondemand.ready.matterport.vector_data", lambda mid: _fake_vector(mid))
    client.post(f"/ondemand/{CATALOG_ID}", params={"outside": False})

    def fake_extract(transcript, building_id=None, use_llm=None, previous=None):
        from dispatch.facts import _empty
        rec = previous or _empty()
        rec["address"] = "1027 Wilshire Boulevard, Los Angeles"
        rec["building_id"] = building_id
        return rec

    monkeypatch.setattr("dispatch.session.facts.extract", fake_extract)
    monkeypatch.setattr("ondemand.resolve.from_text", lambda text, limit=5: directory.get(CATALOG_ID))
    monkeypatch.setattr("ondemand.resolve.prepare_for_address",
                        lambda text, refresh=False: {"building_id": CATALOG_ID})

    s = sess.create("costar-239873")
    out = s.update([{"role": "caller", "text": "We're at 1027 Wilshire Boulevard", "start": 0, "end": 2}])
    assert out["building_id"] == CATALOG_ID and out["building_changed"] is True
