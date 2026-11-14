"""Gemini wrapper. Set GEMINI_API_KEY (free key: https://aistudio.google.com/apikey).

Primary model is GEMINI_MODEL (default gemini-3.5-flash). Overloaded models fail fast
(503/429), so generate() moves straight down FALLBACKS instead of waiting; a demo call
never stalls more than TIMEOUT_S on one model.
"""
import os

import httpx
from google import genai
from google.genai import errors, types

TIMEOUT_S = 20
FALLBACKS = ["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]
RETRYABLE = (429, 500, 503, 504)

_client: genai.Client | None = None
last_model: str | None = None


def model() -> str:
    return os.getenv("GEMINI_MODEL", "gemini-3.5-flash")


def models() -> list[str]:
    primary = model()
    return [primary] + [m for m in FALLBACKS if m != primary]


def client() -> genai.Client:
    global _client
    if _client is None:
        # SDK's own retries off: generate() handles fallback.
        _client = genai.Client(
            api_key=os.environ["GEMINI_API_KEY"],
            http_options=types.HttpOptions(timeout=TIMEOUT_S * 1000, retry_options=types.HttpRetryOptions(attempts=1)),
        )
    return _client


def generate(prompt: str, system: str | None = None, json_schema: dict | None = None) -> str:
    """Text in, text out. Pass json_schema (a JSON Schema dict) to force a JSON response."""
    global last_model
    config = types.GenerateContentConfig(
        system_instruction=system,
        response_mime_type="application/json" if json_schema else None,
        response_json_schema=json_schema,
    )
    last: Exception | None = None
    for m in models():
        try:
            text = client().models.generate_content(model=m, contents=prompt, config=config).text
            last_model = m
            return text
        except (errors.APIError, httpx.TimeoutException) as e:
            if isinstance(e, errors.APIError) and e.code not in RETRYABLE:
                raise
            last = e  # overloaded / rate limited / timed out: try the next model
    raise last
