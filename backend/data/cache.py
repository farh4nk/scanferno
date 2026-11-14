"""Read/write cached API responses under fixtures/ so the demo runs offline."""
import json
from pathlib import Path

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"


def fixture_path(*parts: str) -> Path:
    p = FIXTURES.joinpath(*parts)
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def load_json(*parts: str):
    p = FIXTURES.joinpath(*parts)
    return json.loads(p.read_text()) if p.exists() else None


def save_json(data, *parts: str) -> Path:
    p = fixture_path(*parts)
    p.write_text(json.dumps(data, indent=2))
    return p


def save_bytes(data: bytes, *parts: str) -> Path:
    p = fixture_path(*parts)
    p.write_bytes(data)
    return p


def buildings() -> list[dict]:
    return load_json("buildings.json") or []
