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
        timeout_s: float = 45.0,
        retry_delay_s: float = 1.5,
        fallback_models: list[str] | None = None,
    ):
        self.api_key = api_key
        self.models = []
        for m in [model, *(fallback_models or [])]:
            if m and m not in self.models:
                self.models.append(m)
        self.model = self.models[0] if self.models else "gemini-flash-latest"
        self.base_url = base_url.rstrip("/")
        self.timeout_s = timeout_s
        self.retry_delay_s = retry_delay_s

    def _url(self, model: str) -> str:
        return f"{self.base_url}/models/{model}:generateContent"

    async def _post(self, model: str, body: dict[str, Any]) -> httpx.Response:
        async with httpx.AsyncClient(timeout=self.timeout_s) as client:
            return await client.post(
                self._url(model),
                json=body,
                headers={"x-goog-api-key": self.api_key, "content-type": "application/json"},
            )

    async def _generate(
        self,
        parts: list[dict[str, Any]],
        *,
        schema: dict[str, Any] | None = None,
        system_instruction: str | None = None,
        temperature: float = 0.1,
    ) -> dict[str, Any]:
        """Call Gemini and return the parsed JSON object ({} if the model returned nothing)."""
        if not self.api_key:
            raise AppError(503, "ai_unavailable", "The AI feature is not set up on the server yet.")
        body: dict[str, Any] = {
            "contents": [{"role": "user", "parts": parts}],
            "generationConfig": {"temperature": temperature},
        }
        if schema is not None:
            body["generationConfig"]["responseMimeType"] = "application/json"
            body["generationConfig"]["responseSchema"] = schema
        if system_instruction:
            body["systemInstruction"] = {"parts": [{"text": system_instruction}]}

        resp: httpx.Response | None = None
        last_status = 0
        for model in self.models:
            for attempt in (1, 2):
                try:
                    resp = await self._post(model, body)
                except httpx.TimeoutException:
                    log.warning("gemini timeout", extra={"attempt": attempt, "model": model})
                    raise AppError(504, "ai_timeout", "The AI service took too long. Please try again.")
                except httpx.HTTPError:
                    log.warning("gemini network error", extra={"attempt": attempt, "model": model})
                    raise AppError(502, "ai_unavailable", "The AI service could not be reached. Please try again.")
                last_status = resp.status_code
                if resp.status_code == 429 and attempt == 1:
                    log.info("gemini 429, retrying once")
                    await asyncio.sleep(self.retry_delay_s)
                    continue
                break
            if resp is not None and resp.status_code < 400:
                break
            # Only try another model when this model is unavailable/unknown.
            # Timeouts and 5xx errors fail fast instead of multiplying latency.
            if resp is not None and resp.status_code not in (404, 400):
                break

        if resp is None:
            if last_status == 429:
                raise BUSY
            raise AppError(504, "ai_timeout", "The AI service took too long. Please try again.")
        if resp.status_code == 429:
            raise BUSY
        if resp.status_code >= 400:
            log.warning("gemini http error", extra={"status": resp.status_code})
            if resp.status_code in (401, 403):
                raise AppError(503, "ai_unavailable", "The AI feature is not set up correctly on the server.")
            raise AppError(502, "ai_unavailable", "The AI service had a problem. Please try again.")
        return _extract_json(resp)

    async def generate_json(
        self,
        parts: list[dict[str, Any]],
        schema: dict[str, Any],
        system_instruction: str | None = None,
        *,
        temperature: float = 0.1,
    ) -> dict[str, Any]:
        return await self._generate(
            parts, schema=schema, system_instruction=system_instruction, temperature=temperature
        )

    async def generate_text(
        self,
        parts: list[dict[str, Any]],
        system_instruction: str | None = None,
        *,
        temperature: float = 0.2,
    ) -> str:
        """Generate free text (used by the news briefing). Returns '' on an empty answer."""
        if not self.api_key:
            return ""
        body: dict[str, Any] = {
            "contents": [{"role": "user", "parts": parts}],
            "generationConfig": {"temperature": temperature},
        }
        if system_instruction:
            body["systemInstruction"] = {"parts": [{"text": system_instruction}]}
        for model in self.models:
            try:
                async with httpx.AsyncClient(timeout=self.timeout_s) as client:
                    resp = await client.post(
                        self._url(model),
                        json=body,
                        headers={"x-goog-api-key": self.api_key, "content-type": "application/json"},
                    )
            except httpx.HTTPError:
                continue
            if resp.status_code >= 400:
                if resp.status_code in (404, 400):
                    continue
                return ""
            try:
                data = resp.json()
            except ValueError:
                return ""
            cands = data.get("candidates") or []
            if not cands:
                return ""
            parts_out = (cands[0].get("content") or {}).get("parts") or []
            return "".join(p.get("text", "") for p in parts_out if isinstance(p, dict)).strip()
        return ""

    async def probe(self) -> list[dict[str, Any]]:
        """Return redacted upstream status for each configured model (diagnostics only)."""
        if not self.api_key:
            return [{"model": m, "status": 0, "error": "no_api_key"} for m in self.models]
        body = {
            "contents": [{"role": "user", "parts": [{"text": "Reply with the single word OK."}]}],
            "generationConfig": {"temperature": 0},
        }
        out: list[dict[str, Any]] = []
        for model in self.models:
            try:
                async with httpx.AsyncClient(timeout=min(self.timeout_s, 20)) as client:
                    resp = await client.post(
                        self._url(model),
                        json=body,
                        headers={"x-goog-api-key": self.api_key, "content-type": "application/json"},
                    )
                preview = resp.text[:600].replace(self.api_key, "***") if resp.text else ""
                out.append({"model": model, "status": resp.status_code, "body": preview})
            except httpx.HTTPError as exc:
                out.append({"model": model, "status": 0, "error": type(exc).__name__})
        return out

    async def list_models(self) -> list[str]:
        """List model ids visible to this key (diagnostics only)."""
        if not self.api_key:
            return []
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                resp = await client.get(
                    f"{self.base_url}/models",
                    headers={"x-goog-api-key": self.api_key},
                    params={"pageSize": 100},
                )
            if resp.status_code >= 400:
                return []
            data = resp.json()
            out = []
            for m in data.get("models") or []:
                name = str(m.get("name") or "")
                if name.startswith("models/"):
                    name = name[7:]
                methods = m.get("supportedGenerationMethods") or []
                if name and (not methods or "generateContent" in methods):
                    out.append(name)
            return out
        except (httpx.HTTPError, ValueError):
            return []


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
