"""Gemini wrapper. Set GEMINI_API_KEY (free key: https://aistudio.google.com/apikey).

Swap models with GEMINI_MODEL (default gemini-flash-latest, fast + free tier friendly).
"""
import os

from google import genai
from google.genai import types

_client: genai.Client | None = None


def model() -> str:
    return os.getenv("GEMINI_MODEL", "gemini-flash-latest")


def client() -> genai.Client:
    global _client
    if _client is None:
        _client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    return _client


def generate(prompt: str, system: str | None = None, json_schema: dict | None = None) -> str:
    """Text in, text out. Pass json_schema (a JSON Schema dict) to force a JSON response."""
    config = types.GenerateContentConfig(
        system_instruction=system,
        response_mime_type="application/json" if json_schema else None,
        response_json_schema=json_schema,
    )
    return client().models.generate_content(model=model(), contents=prompt, config=config).text
