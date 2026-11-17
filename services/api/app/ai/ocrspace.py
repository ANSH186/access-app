"""OCR.space fallback.

Google's flash models occasionally return 503 "high demand" or time out on a
dense image. OCR.space is a small, independent text reader so a blind user is
not left without a sign reader. The public `helloworld` key is rate-limited and
for testing only; set OCR_SPACE_API_KEY for a real deployment.
"""
from __future__ import annotations

import logging
import re
from typing import Any

import httpx

log = logging.getLogger("aa.ocrspace")

OCR_SPACE_URL = "https://api.ocr.space/parse/image"


async def read_text(
    data: bytes,
    mime: str,
    api_key: str,
    timeout_s: float = 15.0,
) -> str | None:
    if not api_key:
        return None
    try:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            resp = await client.post(
                OCR_SPACE_URL,
                data={
                    "apikey": api_key,
                    "language": "eng",
                    "isOverlayRequired": "false",
                    "OCREngine": "1",
                    "scale": "true",
                    "detectOrientation": "true",
                },
                files={"file": ("image.jpg", data, mime)},
                headers={"User-Agent": "AccessAbleAI/2.0"},
            )
    except httpx.HTTPError as exc:
        log.warning("ocr.space network error: %s", type(exc).__name__)
        return None
    if resp.status_code >= 400:
        log.warning("ocr.space http error: %s", resp.status_code)
        return None
    try:
        payload: dict[str, Any] = resp.json()
    except ValueError:
        return None
    if payload.get("IsErroredOnProcessing"):
        return None
    parts: list[str] = []
    for result in payload.get("ParsedResults") or []:
        text = result.get("ParsedText") if isinstance(result, dict) else None
        if isinstance(text, str) and text.strip():
            parts.append(text.strip())
    text = "\n".join(parts).strip()
    # The public demo key sometimes prepends an advertisement. Never read that
    # to a user as if it were part of the sign.
    text = re.sub(
        r"\[\s*Note:.*?freekey\s*\]\s*",
        "",
        text,
        flags=re.IGNORECASE | re.DOTALL,
    ).strip()
    return text or None
