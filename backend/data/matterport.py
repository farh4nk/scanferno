"""Matterport Model API (GraphQL) client.

Docs: https://developers.matterport.com/api/property-intelligence/vector-data/
Credentials: Token ID + Token Secret from https://my.matterport.com/settings/account/devtools
Vector data (rooms/walls/doors) needs an Enterprise account; ask the CoStar sponsor table.

Auth is sent as HTTP Basic (token id : token secret). The docs page we read didn't
state the header format, so if you get 401s, check the GraphiQL console at
https://api.matterport.com/api/graphiql/ and adjust _auth().
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


def _auth() -> tuple[str, str]:
    return os.environ["MATTERPORT_TOKEN_ID"], os.environ["MATTERPORT_TOKEN_SECRET"]


def gql(query: str, variables: dict | None = None) -> dict:
    r = httpx.post(ENDPOINT, json={"query": query, "variables": variables or {}}, auth=_auth(), timeout=60)
    r.raise_for_status()
    body = r.json()
    if body.get("errors"):
        raise RuntimeError(f"Matterport GraphQL errors: {body['errors']}")
    return body["data"]


def demo_models() -> list[dict]:
    return gql(DEMO_MODELS_QUERY)["models"]["results"]


def vector_data(model_id: str) -> dict:
    """Raw floors + rooms (edges, vertices, openings). Vertices are 2D, relative to model center."""
    return gql(VECTOR_QUERY, {"modelId": model_id})["model"]
