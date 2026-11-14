"""Check access to every data source and the LLM. Run from backend/:  python -m scripts.check_access"""
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
load_dotenv(Path(__file__).resolve().parents[2] / ".env")

from data import cache, costar, matterport, vexcel  # noqa: E402


def check(name: str, keys: list[str], fn) -> bool:
    missing = [k for k in keys if not os.getenv(k)]
    if missing:
        print(f"[MISSING] {name}: set {', '.join(missing)} in .env")
        return False
    try:
        print(f"[OK]      {name}: {fn()}")
        return True
    except Exception as e:  # report and keep going
        print(f"[FAIL]    {name}: {type(e).__name__}: {str(e)[:400]}")
        return False


def matterport_check():
    # Use a real kit model so we test vector data access, not just login.
    pid, models = next(iter(costar.matterport_models().items()))
    v = matterport.vector_data(models[0])
    return (f"auth={matterport.auth_mode}; model {models[0]} (property {pid}): "
            f"{len(v.get('floors') or [])} floors, {len(v.get('rooms') or [])} rooms")


def vexcel_check():
    tools = vexcel.VexcelMCP().connect().tools()
    p = cache.save_json(tools, "vexcel_mcp_tools.json")
    return f"{len(tools)} MCP tools, saved to {p.name}: {[t['name'] for t in tools][:8]}"


def costar_check():
    kit = costar.kit_dir()
    return f"kit at {kit}, {len(costar.matterport_models())} properties with Matterport models"


def gemini_check():
    from agent import llm
    reply = llm.generate("Reply with exactly: OK")
    return f"model={llm.last_model} (primary {llm.model()}) replied {reply.strip()[:40]!r}"


if __name__ == "__main__":
    results = [
        check("CoStar kit", [], costar_check),
        check("Matterport", ["MATTERPORT_API_KEY", "MATTERPORT_API_TOKEN"], matterport_check),
        check("Vexcel", ["VEXCEL_API_KEY"], vexcel_check),
        check("Gemini", ["GEMINI_API_KEY"], gemini_check),
    ]
    sys.exit(0 if all(results) else 1)
