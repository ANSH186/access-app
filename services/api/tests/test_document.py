from __future__ import annotations

import io
import json

import httpx
import respx
from PIL import Image

from app.routers.ai import _local_answer

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent"


def jpeg_page(text_height: int = 900) -> bytes:
    img = Image.new("RGB", (700, text_height), "white")
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=80)
    return buf.getvalue()


def gemini_text(text: str) -> httpx.Response:
    return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": text}]}}]})


def test_local_answer_picks_relevant_line():
    text = "Page 1\nThe library opens at nine.\nPage 2\nThe lab is closed on Sunday."
    answer = _local_answer(text, "When is the lab closed?")
    assert "Sunday" in answer


@respx.mock
async def test_document_reader_returns_lines(client):
    respx.post(GEMINI_URL).mock(return_value=gemini_text("Line one\nLine two\nLine three"))
    r = await client.post(
        "/v1/ocr/read_document",
        files={"image": ("page.jpg", jpeg_page(), "image/jpeg")},
        headers={"X-Dev-User": "11111111-1111-1111-1111-111111111111"},
    )
    assert r.status_code == 200
    j = r.json()
    assert "Line one" in j["text"] and j["lines"] >= 1


@respx.mock
async def test_ocr_answer_falls_back_to_text_search(client):
    respx.post(GEMINI_URL).mock(return_value=httpx.Response(500))
    r = await client.post(
        "/v1/ocr/answer",
        data={"text": "Library hours are nine to five.", "question": "What are the library hours?"},
        headers={"X-Dev-User": "11111111-1111-1111-1111-111111111111"},
    )
    assert r.status_code == 200
    assert "nine" in r.json()["answer"].lower() or "five" in r.json()["answer"].lower()
