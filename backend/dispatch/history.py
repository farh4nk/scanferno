"""What the caller corrected during a live call ("no wait, it's the kitchen").

`track` is called after every record update with a state dict that lives for the whole call. It returns
the cumulative corrections {field: [{from, to, t}]} so the UI can strike through superseded values.
A scalar field counts as corrected when a non-empty value changes; a list field only when an earlier
item disappears (adding a second hazard is new information, not a correction).
"""
FIELDS = ("address", "floor", "side", "fire_location", "conditions", "hazards", "caller_location", "cross_street")


def _empty(v) -> bool:
    return v is None or v == "" or v == []


def _values(record: dict) -> dict:
    out = {f: record.get(f) for f in FIELDS}
    out["trapped"] = [t.get("location") or t.get("description") for t in record.get("trapped") or []]
    return out


def _is_correction(old, new) -> bool:
    if isinstance(old, list) and isinstance(new, list):
        return bool({str(x) for x in old} - {str(x) for x in new})
    return True


def track(state: dict, record: dict, t: float) -> dict:
    last = state.setdefault("last", {})
    corrections = state.setdefault("corrections", {})
    for field, value in _values(record).items():
        if _empty(value):
            continue
        old = last.get(field)
        if old is not None and old != value and _is_correction(old, value):
            corrections.setdefault(field, []).append({"from": old, "to": value, "t": t})
        last[field] = value
    return corrections
