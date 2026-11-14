"""Vexcel client: REST for imagery/elevation, MCP for everything else (property, roof, solar).

Docs: https://api.vexcelgroup.com/v2/api-docs  ·  MCP: https://vexceldata.com/platform/vexcel-mcp/
API key comes from Vexcel support / the sponsor table. Sent as the X-API-KEY header.
Locations are WKT, lon first: POINT(-95.39 29.74).
"""
import json
import os

import httpx

BASE = "https://api.vexcelgroup.com/v2"
MCP_URL = f"{BASE}/mcp"
VIEWS = ["nadir", "oblique-north", "oblique-east", "oblique-south", "oblique-west"]


def _headers() -> dict:
    return {"X-API-KEY": os.environ["VEXCEL_API_KEY"]}


def point(lat: float, lon: float) -> str:
    return f"POINT({lon} {lat})"


def oriented_image(lat: float, lon: float, view: str = "nadir", size_m: int = 80, layer: str = "urban") -> bytes:
    """One image of the building. view is 'nadir' or 'oblique-{north,east,south,west}'."""
    r = httpx.get(
        f"{BASE}/oriented/extract",
        params={
            "wkt": point(lat, lon),
            "srid": 4326,
            "layer": layer,
            "product-type": view,
            "bbox-dimensions": f"{size_m},{size_m}",
            "image-format": "jpeg",
        },
        headers=_headers(),
        timeout=90,
    )
    r.raise_for_status()
    return r.content


def elevation(lat: float, lon: float, layer: str = "urban") -> dict:
    """DSM elevation metadata in meters (roof height = DSM minus ground)."""
    r = httpx.get(
        f"{BASE}/dsm/elevation",
        params={"wkt": point(lat, lon), "layer": layer, "unit-system": "metric"},
        headers=_headers(),
        timeout=60,
    )
    r.raise_for_status()
    return r.json()


# ---- MCP (streamable HTTP JSON-RPC) ----

class VexcelMCP:
    """Minimal MCP client. Use tools() to discover what's available, call() to run one."""

    def __init__(self):
        self.client = httpx.Client(timeout=90)
        self.session_id: str | None = None
        self._id = 0

    def _post(self, method: str, params: dict | None = None, notify: bool = False):
        msg = {"jsonrpc": "2.0", "method": method, "params": params or {}}
        if not notify:
            self._id += 1
            msg["id"] = self._id
        headers = {**_headers(), "Accept": "application/json, text/event-stream", "Content-Type": "application/json"}
        if self.session_id:
            headers["Mcp-Session-Id"] = self.session_id
        r = self.client.post(MCP_URL, json=msg, headers=headers)
        r.raise_for_status()
        self.session_id = r.headers.get("mcp-session-id", self.session_id)
        if notify or not r.content:
            return None
        if "text/event-stream" in r.headers.get("content-type", ""):
            for line in r.text.splitlines():
                if line.startswith("data:"):
                    body = json.loads(line[5:].strip())
                    if body.get("id") == msg["id"]:
                        break
            else:
                raise RuntimeError(f"No response for {method} in event stream")
        else:
            body = r.json()
        if "error" in body:
            raise RuntimeError(f"Vexcel MCP {method} error: {body['error']}")
        return body["result"]

    def connect(self) -> "VexcelMCP":
        self._post("initialize", {
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": {"name": "scanferno", "version": "0.1"},
        })
        self._post("notifications/initialized", notify=True)
        return self

    def tools(self) -> list[dict]:
        return self._post("tools/list")["tools"]

    def call(self, name: str, arguments: dict) -> dict:
        return self._post("tools/call", {"name": name, "arguments": arguments})
