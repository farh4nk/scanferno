"""What changed between two briefings, as short lines the UI can flash ("Search first: Office 110").

The live stream rebuilds the whole briefing after every dispatch record; this keeps the UI from having
to diff it and gives the commander one line per meaningful change.
"""


def _labels(b: dict) -> dict:
    return {s["room_id"]: s["label"] for s in b.get("search_plan") or []}


def diff(prev: dict | None, new: dict) -> list[dict]:
    if not prev:
        return []
    out = []
    labels = {**_labels(prev), **_labels(new)}

    old_fire, new_fire = set(prev.get("fire_room_ids") or []), set(new.get("fire_room_ids") or [])
    if new_fire != old_fire and new_fire:
        names = ", ".join(labels.get(r, r) for r in sorted(new_fire))
        out.append({"kind": "fire", "text": f"Fire area now {names}."})

    old_trapped = {(t["description"], t.get("room_id")) for t in prev.get("trapped") or []}
    for t in new.get("trapped") or []:
        if (t["description"], t.get("room_id")) in old_trapped:
            continue
        where = t["candidates"][0]["label"] if t.get("candidates") else "location unknown"
        out.append({"kind": "trapped", "text": f"Trapped: {t['description']}, likely {where}.", "room_id": t.get("room_id")})

    old_plan, new_plan = prev.get("search_plan") or [], new.get("search_plan") or []
    if new_plan and (not old_plan or old_plan[0]["room_id"] != new_plan[0]["room_id"]):
        was = f" (was {old_plan[0]['label']})" if old_plan else ""
        out.append({"kind": "search_plan", "text": f"Search first: {new_plan[0]['label']}{was}.", "room_id": new_plan[0]["room_id"]})

    old_rerouted = {r["from_room_id"] for r in prev.get("exit_routes") or [] if r.get("rerouted")}
    for r in new.get("exit_routes") or []:
        if r.get("rerouted") and r["from_room_id"] not in old_rerouted:
            out.append({"kind": "route", "text": f"Exit route from {labels.get(r['from_room_id'], r['from_room_id'])} rerouted around the fire.",
                        "room_id": r["from_room_id"]})

    old_hz = {h["text"] for h in prev.get("hazards") or []}
    for h in new.get("hazards") or []:
        if h["text"] not in old_hz and h["severity"] in ("high", "med"):
            out.append({"kind": "hazard", "text": h["text"], "severity": h["severity"]})
    return out
