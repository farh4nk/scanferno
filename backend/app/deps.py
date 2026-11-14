"""Shared lookups for the routers: turn path/query params into building rows and room ids, or 404."""
from fastapi import HTTPException

from data import layers
from dispatch.locate import locate


def building(bid: str) -> dict:
    try:
        return layers.building(bid)
    except KeyError:
        raise HTTPException(404, f"Unknown building {bid}")


def room_id(bid: str, text: str) -> str:
    """Room id from an id, a label or free text ("office by the elevators")."""
    fp = layers.floorplan(bid)
    if any(r["id"] == text for r in fp["rooms"]):
        return text
    c = locate(text, fp, layers.nav(bid), building(bid).get("front", "S"), top=1)
    if not c:
        raise HTTPException(404, f"No room matches '{text}'")
    return c[0]["room_id"]


def room_ids(bid: str, csv: str | None) -> list[str]:
    """Comma-separated room ids / labels -> room ids (unknown entries are dropped)."""
    out = []
    for part in (csv or "").split(","):
        part = part.strip()
        if not part:
            continue
        try:
            out.append(room_id(bid, part))
        except HTTPException:
            pass
    return out
