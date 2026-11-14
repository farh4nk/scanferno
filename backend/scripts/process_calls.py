"""Synthesize, transcribe and extract every scripted call in fixtures/calls/.

Run from backend/:
  python -m scripts.process_calls                     # all calls, skip cached steps
  python -m scripts.process_calls vibe-1-clean --refresh
  python -m scripts.process_calls --engine say        # macOS voices, no ElevenLabs TTS
Recorded calls: drop audio.wav (16 kHz mono) next to script.json and it skips synthesis.
"""
import argparse
import sys
from pathlib import Path

from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
load_dotenv(Path(__file__).resolve().parents[2] / ".env")

from dispatch import elevenlabs, pipeline  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("calls", nargs="*")
    ap.add_argument("--refresh", action="store_true", help="redo every step")
    ap.add_argument("--engine", choices=["elevenlabs", "say"], default="elevenlabs")
    args = ap.parse_args()

    for c in pipeline.list_calls():
        cid = c["call_id"]
        if args.calls and cid not in args.calls:
            continue
        print(f"== {cid}: {c['title']}")
        if args.refresh or not c["has_audio"]:
            engine = args.engine
            try:
                pipeline.synthesize(cid, engine)
            except RuntimeError as e:
                if engine != "elevenlabs":
                    raise
                print(f"  ElevenLabs TTS unavailable ({e}); using macOS say")
                engine = "say"
                pipeline.synthesize(cid, engine)
            print(f"  audio: {engine}" + (f" ({elevenlabs.tts_model})" if engine == "elevenlabs" else ""))
        result = pipeline.build_timeline(cid, refresh=args.refresh)
        for step in result["timeline"]:
            r = step["record"]
            u = result["utterances"][step["utterance_index"]]
            trapped = [f"{p['description']}@{p.get('location')}" + (f" [{p['room_id'][:8]}]" if p.get("room_id") else "")
                       for p in r.get("trapped") or []]
            print(f"  t={step['t']:5.1f}s  \"{u['text'][:60]}\"")
            print(f"      floor={r.get('floor')} side={r.get('side')} trapped={trapped} hazards={r.get('hazards')} changed={r.get('changed')}")


if __name__ == "__main__":
    main()
