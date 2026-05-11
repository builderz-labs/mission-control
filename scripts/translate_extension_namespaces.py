#!/usr/bin/env python3
"""Translate oapApprovals + litellmUsage namespaces from en.json into target locales.

Reads/writes from `src/extensions/i18n/{locale}.json` — extension translations live
in the fork-only directory so upstream `messages/*.json` stays byte-clean (#319).

Uses the LiteLLM proxy at localhost:4000.

Non-destructive: preserves all other keys in each locale JSON.
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from typing import Dict

import urllib.request
import urllib.error


LITELLM_URL = "http://localhost:4000/v1/chat/completions"
LITELLM_KEY = os.environ.get("LITELLM_KEY")
if not LITELLM_KEY:
    raise SystemExit("LITELLM_KEY env var is required (no default fallback — set it before running this script)")

REPO_ROOT = Path(__file__).resolve().parent.parent
MESSAGES_DIR = REPO_ROOT / "src" / "extensions" / "i18n" / "locales"

NAMESPACES = ["oapApprovals", "litellmUsage"]

LOCALES = {
    "ar": "Arabic (Modern Standard Arabic, Egyptian/Levantine neutral)",
    "de": "German (de-DE)",
    "es": "Spanish (es-ES / neutral Latin American acceptable)",
    "fr": "French (fr-FR)",
    "ja": "Japanese (ja-JP)",
    "ko": "Korean (ko-KR)",
    "pt": "Portuguese (pt-BR preferred)",
    "ru": "Russian (ru-RU)",
    "zh": "Simplified Chinese (zh-CN)",
}


SYSTEM_PROMPT = """You are a professional software localization translator.

You will receive a JSON object where each value is an English UI string for a
web application dashboard. You must translate every VALUE into the target
language while following these rules:

1. Return ONLY a JSON object with the exact same keys. No prose, no markdown
   fences, no comments.
2. Preserve ICU MessageFormat placeholders EXACTLY. Examples:
     - `{count}`, `{n}`, `{name}` — leave identifier untouched.
     - `{n, plural, one {# action applied} other {# actions applied}}` —
       translate the inner text only. The `#`, the selector keywords
       (`plural`, `one`, `other`, `few`, `many`, `=0`, etc), the variable
       name, and the commas must stay. Adjust plural categories to the
       target language's CLDR categories when needed (e.g. Russian needs
       `one`, `few`, `many`, `other`; Arabic needs `zero`, `one`, `two`,
       `few`, `many`, `other`; Chinese/Japanese/Korean only use `other`).
3. Keep these tokens in English (do NOT translate): `OAP`, `LiteLLM`, `API`,
   `LLM`. Product name "Approvals" may be translated.
4. Use the target language's natural UI conventions:
     - German, French, Spanish, Portuguese, Russian: sentence case for
       actions, Title Case only for major section headers.
     - Japanese / Korean / Chinese: no case distinction; use concise
       standard UI wording.
     - Arabic: RTL-safe wording, no directional marks needed in values.
5. Keep strings short — these are UI labels, buttons, column headers. Do not
   pad with extra words.
6. If the English uses an ellipsis `…`, keep it in translation.
7. Output must be valid JSON, UTF-8, no BOM. Use straight ASCII quotes."""


def call_llm(model: str, system: str, user: str, *, max_retries: int = 3) -> str:
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": 0.2,
    }
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        LITELLM_URL,
        data=data,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {LITELLM_KEY}",
        },
        method="POST",
    )

    last_err = None
    for attempt in range(1, max_retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                payload = json.load(resp)
            return payload["choices"][0]["message"]["content"]
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as exc:
            last_err = exc
            print(f"  [warn] LLM call failed (attempt {attempt}): {exc}", file=sys.stderr)
            time.sleep(2 * attempt)
    raise RuntimeError(f"LLM call failed after {max_retries} attempts: {last_err}")


def extract_json(text: str) -> Dict[str, str]:
    t = text.strip()
    # strip markdown fences if present
    if t.startswith("```"):
        t = t.strip("`")
        # drop possible language tag
        if t.lower().startswith("json"):
            t = t[4:]
        t = t.strip()
        # remove trailing ``` if any remnants
        if t.endswith("```"):
            t = t[:-3].strip()
    # locate the first { and last }
    start = t.find("{")
    end = t.rfind("}")
    if start == -1 or end == -1:
        raise ValueError(f"No JSON object found in LLM output: {text[:200]}")
    return json.loads(t[start : end + 1])


def translate_namespace(
    locale: str,
    locale_label: str,
    ns: str,
    en_obj: Dict[str, str],
    model: str,
) -> Dict[str, str]:
    user_msg = (
        f"Target locale: {locale} ({locale_label}).\n"
        f"Namespace: {ns}.\n\n"
        "Translate the following UI strings. Return the same keys with translated values only.\n\n"
        f"{json.dumps(en_obj, indent=2, ensure_ascii=False)}"
    )
    raw = call_llm(model, SYSTEM_PROMPT, user_msg)
    obj = extract_json(raw)

    missing = [k for k in en_obj if k not in obj]
    extra = [k for k in obj if k not in en_obj]
    if missing or extra:
        raise ValueError(
            f"Key mismatch for {locale}/{ns}: missing={missing}, extra={extra}"
        )
    # ensure all values are strings
    for k, v in obj.items():
        if not isinstance(v, str) or not v.strip():
            raise ValueError(f"Invalid value for {locale}/{ns}/{k}: {v!r}")
    return obj


def main():
    en_path = MESSAGES_DIR / "en.json"
    en_data = json.loads(en_path.read_text(encoding="utf-8"))

    sources = {ns: en_data[ns] for ns in NAMESPACES}
    for ns, obj in sources.items():
        print(f"Source {ns}: {len(obj)} keys")

    target_locales = sys.argv[1:] if len(sys.argv) > 1 else list(LOCALES.keys())

    model = os.environ.get("TRANSLATE_MODEL", "claude-sonnet-4-6")
    print(f"Using model: {model}")

    for locale in target_locales:
        if locale not in LOCALES:
            print(f"[skip] Unknown locale: {locale}")
            continue
        label = LOCALES[locale]
        print(f"\n=== {locale} ({label}) ===")
        locale_path = MESSAGES_DIR / f"{locale}.json"
        data = json.loads(locale_path.read_text(encoding="utf-8"))

        for ns, en_obj in sources.items():
            print(f"  translating {ns} ({len(en_obj)} keys)…")
            translated = translate_namespace(locale, label, ns, en_obj, model)
            data[ns] = translated
            print(f"  ✓ {ns}: {len(translated)} keys")

        locale_path.write_text(
            json.dumps(data, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        print(f"  wrote {locale_path}")

    print("\nDone.")


if __name__ == "__main__":
    main()
