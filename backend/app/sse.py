import json


def event(name: str, data) -> str:
    """One server-sent event frame."""
    return f"event: {name}\ndata: {json.dumps(data, default=str)}\n\n"
