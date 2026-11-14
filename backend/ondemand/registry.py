"""Onboarded buildings: same shape as fixtures/buildings.json, stored in fixtures/ondemand/ready.json.

Heroes stay in buildings.json. Everything prepared by ondemand.ready is listed here so layers.building()
and GET /buildings can find them after a restart.
"""
from functools import lru_cache

from data import cache

PATH = ("ondemand", "ready.json")


@lru_cache
def all() -> tuple[dict, ...]:
    return tuple(cache.load_json(*PATH) or [])


def get(bid: str) -> dict | None:
    for b in all():
        if b["id"] == bid:
            return b
    return None


def upsert(row: dict) -> dict:
    """Insert or replace by id, persist, clear the cache. Returns the stored row."""
    rows = [b for b in all() if b["id"] != row["id"]]
    rows.append(row)
    rows.sort(key=lambda b: b["id"])
    cache.save_json(rows, *PATH)
    all.cache_clear()
    return row


def clear():
    all.cache_clear()
