"""Matterport Model API (GraphQL) client.

Docs: https://developers.matterport.com/api/property-intelligence/vector-data/
Credentials: MATTERPORT_API_KEY + MATTERPORT_API_TOKEN in .env (backend only, never ship to the browser).

The docs don't pin down the header format, so gql() tries the likely schemes in order
(Basic key:token, Basic token:key, Bearer token, Bearer key) and remembers the first one
that isn't rejected. check_access prints which one worked.
"""
import os

import httpx

ENDPOINT = "https://api.matterport.com/api/models/graph"

_REGION = """
fragment BoundedRegionData on BoundedRegion {
  edges {
    id
    type
    centerLineBias
    thickness
    openings { id height width lowerElevation relativeCenter type }
    vertices { id position { x y } }
  }
}
"""

VECTOR_QUERY = _REGION + """
query getVectorData($modelId: ID!) {
  model(id: $modelId) {
    floors { id sequence label }
    rooms {
      id
      label
      classifications { id label }
      boundary { ...BoundedRegionData }
      holes { ...BoundedRegionData }
    }
  }
}
"""

DEMO_MODELS_QUERY = """
query { models(query: "demo:true", include: demo) { results { id name } } }
"""


MODELS_PAGE_QUERY = """
query listModels($offset: String) {
  models(pageSize: 1000, offset: $offset, include: demo) {
    totalResults
    nextOffset
    results {
      id
      name
      created
      demo
      address { address streetAddressLines locality administrativeArea postalCode countryCode }
      geolocation { lat long }
      publication { address presentedBy }
      rooms { count labels }
      floors { count }
    }
  }
}
"""


auth_mode: str | None = None


def _auth_options() -> list[tuple[str, dict]]:
    key, token = os.environ["MATTERPORT_API_KEY"], os.environ["MATTERPORT_API_TOKEN"]
    return [
        ("basic key:token", {"auth": (key, token)}),
        ("basic token:key", {"auth": (token, key)}),
        ("bearer token", {"headers": {"Authorization": f"Bearer {token}"}}),
        ("bearer key", {"headers": {"Authorization": f"Bearer {key}"}}),
    ]


def _is_auth_error(r: httpx.Response) -> bool:
    if r.status_code in (401, 403):
        return True
    try:
        errs = r.json().get("errors") or []
    except ValueError:
        return False
    return any("auth" in str(e).lower() or "unauthorized" in str(e).lower() for e in errs)


def gql(query: str, variables: dict | None = None) -> dict:
    global auth_mode
    options = [o for o in _auth_options() if auth_mode in (None, o[0])]
    payload = {"query": query, "variables": variables or {}}
    last = None
    for name, kwargs in options:
        r = httpx.post(ENDPOINT, json=payload, timeout=60, **kwargs)
        if _is_auth_error(r):
            last = r
            continue
        r.raise_for_status()
        auth_mode = name
        body = r.json()
        if body.get("errors"):
            raise RuntimeError(f"Matterport GraphQL errors: {body['errors']}")
        return body["data"]
    raise RuntimeError(f"Matterport rejected every auth scheme (last {last.status_code}): {last.text[:300]}")


def demo_models() -> list[dict]:
    return gql(DEMO_MODELS_QUERY)["models"]["results"]


def list_models(progress=None) -> list[dict]:
    """Every model the API key can see (address, geolocation, room/floor counts), 1000 per page."""
    out, offset = [], None
    while True:
        page = gql(MODELS_PAGE_QUERY, {"offset": offset})["models"]
        out.extend(page["results"])
        if progress:
            progress(len(out), page["totalResults"])
        offset = page.get("nextOffset")
        if not offset or not page["results"]:
            return out


def vector_data(model_id: str) -> dict:
    """Raw floors + rooms (edges, vertices, openings). Vertices are 2D, relative to model center."""
    return gql(VECTOR_QUERY, {"modelId": model_id})["model"]
