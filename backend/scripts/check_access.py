"""Check access to all three data sources. Run from backend/:  python -m scripts.check_access"""
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
load_dotenv(Path(__file__).resolve().parents[2] / ".env")

from data import cache, matterport, vexcel  # noqa: E402


def check(name: str, keys: list[str], fn) -> bool:
    missing = [k for k in keys if not os.getenv(k)]
    if missing:
        print(f"[MISSING] {name}: set {', '.join(missing)} in .env")
        return False
    try:
        print(f"[OK]      {name}: {fn()}")
        return True
    except Exception as e:  # report and keep going
        print(f"[FAIL]    {name}: {type(e).__name__}: {e}")
        return False


def matterport_check():
    models = matterport.demo_models()
    return f"{len(models)} demo model(s): {[m['id'] for m in models][:5]}"


def vexcel_check():
    tools = vexcel.VexcelMCP().connect().tools()
    p = cache.save_json(tools, "vexcel_mcp_tools.json")
    return f"{len(tools)} MCP tools, saved to {p.name}: {[t['name'] for t in tools][:8]}"


def costar_check():
    have = [b["id"] for b in cache.buildings() if cache.load_json(b["id"], "costar.json")]
    return f"local CoStar data for: {have or 'none yet (get it from the sponsor table)'}"


if __name__ == "__main__":
    results = [
        check("Matterport", ["MATTERPORT_TOKEN_ID", "MATTERPORT_TOKEN_SECRET"], matterport_check),
        check("Vexcel", ["VEXCEL_API_KEY"], vexcel_check),
        check("CoStar", [], costar_check),
    ]
    sys.exit(0 if all(results) else 1)
