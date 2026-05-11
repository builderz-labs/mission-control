#!/usr/bin/env python3
"""QA cross-check: have a second LLM review 5 random keys per locale.

Reads extension namespaces from `src/extensions/i18n/{locale}.json` (#319 layout)."""

from __future__ import annotations
import json, os, random, sys, time
import urllib.request
from pathlib import Path

LITELLM_URL = "http://localhost:4000/v1/chat/completions"
LITELLM_KEY = os.environ.get("LITELLM_KEY")
if not LITELLM_KEY:
    raise SystemExit("LITELLM_KEY env var is required (no default fallback — set it before running this script)")

REPO_ROOT = Path(__file__).resolve().parent.parent
MESSAGES_DIR = REPO_ROOT / "src" / "extensions" / "i18n" / "locales"
NAMESPACES = ["oapApprovals", "litellmUsage"]

LOCALE_NAMES = {
    "ar": "Arabic",
    "de": "German",
    "es": "Spanish",
    "fr": "French",
    "ja": "Japanese",
    "ko": "Korean",
    "pt": "Portuguese (Brazil)",
    "ru": "Russian",
    "zh": "Simplified Chinese",
}

SYSTEM = """You are a professional localization QA reviewer. You will be given pairs
of (English source, target translation) for UI strings. Rate each pair:
  - OK: translation is natural, accurate, UI-appropriate, placeholders preserved.
  - MINOR: usable but could be slightly better (explain briefly).
  - MAJOR: wrong, unnatural, or placeholder broken (explain briefly).

Respond as compact JSON: an array of objects {key, verdict, note}. Note may be empty for OK."""


def call(model, system, user):
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": 0.1,
    }
    req = urllib.request.Request(
        LITELLM_URL,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {LITELLM_KEY}",
        },
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.load(resp)["choices"][0]["message"]["content"]


def extract_json_array(text):
    t = text.strip()
    if t.startswith("```"):
        t = t.strip("`")
        if t.lower().startswith("json"):
            t = t[4:]
        t = t.strip()
        if t.endswith("```"):
            t = t[:-3].strip()
    s = t.find("[")
    e = t.rfind("]")
    return json.loads(t[s : e + 1])


def main():
    random.seed(42)
    en = json.loads((MESSAGES_DIR / "en.json").read_text(encoding="utf-8"))

    # Build a flat list of all keys
    all_keys = []
    for ns in NAMESPACES:
        for k in en[ns]:
            all_keys.append((ns, k))

    model = os.environ.get("QA_MODEL", "gpt-5.4")
    print(f"Reviewing with model: {model}")

    summary = {}
    for lo in LOCALE_NAMES:
        sample = random.sample(all_keys, 5)
        d = json.loads((MESSAGES_DIR / f"{lo}.json").read_text(encoding="utf-8"))
        pairs = []
        for ns, k in sample:
            pairs.append({
                "key": f"{ns}.{k}",
                "en": en[ns][k],
                "translation": d[ns][k],
            })
        user = (
            f"Target language: {LOCALE_NAMES[lo]}\n\n"
            f"{json.dumps(pairs, indent=2, ensure_ascii=False)}"
        )
        raw = call(model, SYSTEM, user)
        try:
            arr = extract_json_array(raw)
        except Exception as exc:
            print(f"[{lo}] parse failed: {exc}\nraw: {raw[:400]}")
            continue
        summary[lo] = arr
        majors = [a for a in arr if a.get("verdict") == "MAJOR"]
        minors = [a for a in arr if a.get("verdict") == "MINOR"]
        print(f"\n=== {lo} ({LOCALE_NAMES[lo]}) ===")
        for a in arr:
            print(f"  {a.get('verdict','?')}: {a.get('key','?')} -- {a.get('note','')}")

    out = MESSAGES_DIR / ".qa_review.json"
    out.write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nWrote {out}")


if __name__ == "__main__":
    main()
