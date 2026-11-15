"""Gemini REST client (no Google SDK). Never logs request bodies, media or the API key."""
from __future__ import annotations

import asyncio
import base64
import json
import logging
from typing import Any

import httpx

from ..errors import AppError

log = logging.getLogger("aa.gemini")

BUSY = AppError(503, "ai_busy", "The AI service is busy. Please try again in a minute.")


def text_part(text: str) -> dict[str, Any]:
    return {"text": text}


def inline_part(data: bytes, mime_type: str) -> dict[str, Any]:
    return {"inlineData": {"mimeType": mime_type, "data": base64.b64encode(data).decode("ascii")}}


class GeminiClient:
    def __init__(
        self,
        api_key: str,
        model: str = "gemini-flash-latest",
        base_url: str = "https://generativelanguage.googleapis.com/v1beta",
        timeout_s: float = 20.0,
        retry_delay_s: float = 2.0,
    ):
        self.api_key = api_key
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.timeout_s = timeout_s
        self.retry_delay_s = retry_delay_s

    @property
    def url(self) -> str:
        return f"{self.base_url}/models/{self.model}:generateContent"

    async def _post(self, body: dict[str, Any]) -> httpx.Response:
        async with httpx.AsyncClient(timeout=self.timeout_s) as client:
            return await client.post(
                self.url,
                json=body,
                headers={"x-goog-api-key": self.api_key, "content-type": "application/json"},
            )

    async def generate_json(
        self,
        parts: list[dict[str, Any]],
        schema: dict[str, Any],
        system_instruction: str | None = None,
    ) -> dict[str, Any]:
        """Call Gemini and return the parsed JSON object ({} if the model returned nothing)."""
        if not self.api_key:
            raise AppError(503, "ai_unavailable", "The AI feature is not set up on the server yet.")
        body: dict[str, Any] = {
            "contents": [{"role": "user", "parts": parts}],
            "generationConfig": {
                "responseMimeType": "application/json",
                "responseSchema": schema,
                "temperature": 0.1,
            },
        }
        if system_instruction:
            body["systemInstruction"] = {"parts": [{"text": system_instruction}]}

        resp: httpx.Response | None = None
        for attempt in (1, 2):
            try:
                resp = await self._post(body)
            except httpx.TimeoutException:
                log.warning("gemini timeout", extra={"attempt": attempt})
                raise AppError(504, "ai_timeout", "The AI service took too long. Please try again.")
            except httpx.HTTPError:
                log.warning("gemini network error", extra={"attempt": attempt})
                raise AppError(502, "ai_unavailable", "The AI service could not be reached. Please try again.")
            if resp.status_code == 429 and attempt == 1:
                log.info("gemini 429, retrying once")
                await asyncio.sleep(self.retry_delay_s)
                continue
            break
        assert resp is not None
        if resp.status_code == 429:
            raise BUSY
        if resp.status_code >= 400:
            log.warning("gemini http error", extra={"status": resp.status_code})
            if resp.status_code in (401, 403):
                raise AppError(503, "ai_unavailable", "The AI feature is not set up correctly on the server.")
            raise AppError(502, "ai_unavailable", "The AI service had a problem. Please try again.")
        return _extract_json(resp)


def _extract_json(resp: httpx.Response) -> dict[str, Any]:
    try:
        data = resp.json()
    except ValueError:
        raise AppError(502, "ai_bad_response", "The AI service gave an answer I could not use. Please try again.")
    cands = data.get("candidates") or []
    if not cands:
        return {}  # blocked or empty: callers turn this into "unreadable" advice
    parts = (cands[0].get("content") or {}).get("parts") or []
    text = "".join(p.get("text", "") for p in parts if isinstance(p, dict)).strip()
    if not text:
        return {}
    try:
        obj = json.loads(text)
    except ValueError:
        raise AppError(502, "ai_bad_response", "The AI service gave an answer I could not use. Please try again.")
    return obj if isinstance(obj, dict) else {}
