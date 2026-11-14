"""Resolve a spoken / typed address to a catalog building, then onboard it for live calls.

    from_text(text)           -> directory entry or None (search, then geocode+nearby)
    prepare_for_address(...)  -> prepare() result or None
"""
from data import directory

from . import ready


def from_text(text: str, limit: int = 5) -> dict | None:
    """Best catalog match for a free-text address or building name. None if nothing is confident."""
    text = (text or "").strip()
    if not text:
        return None
    hits = directory.search(text, limit)
    if hits and hits[0]["score"] >= directory.GOOD_SCORE:
        return directory.get(hits[0]["id"])
    # Wrong house number / weak match: still take a ready hero on the same street if score is OK
    if hits and hits[0]["score"] >= directory.MIN_SCORE and hits[0]["status"] == "ready":
        return directory.get(hits[0]["id"])
    try:
        g = directory.geocode(text)
    except Exception:
        g = None
    if not g:
        return hits[0] and directory.get(hits[0]["id"]) if hits else None
    near = directory.nearby(g["lat"], g["lon"], limit)
    return directory.get(near[0]["id"]) if near else None


def prepare_for_address(text: str, refresh: bool = False) -> dict | None:
    """Look up an address and onboard that building. None if no match; raises OnboardError on fetch failure."""
    e = from_text(text)
    if e is None:
        return None
    return ready.prepare(e["id"], refresh=refresh)
