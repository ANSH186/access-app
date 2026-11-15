from __future__ import annotations

import json

import httpx
import pytest
import respx

from .conftest import DEV_HEADERS, block, load_mini, make_settings

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent"
JPEG = b"\xff\xd8\xff\xe0" + b"0" * 64


def gemini_reply(obj: dict) -> httpx.Response:
    return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": json.dumps(obj)}]}}]})


def img(name="x.jpg", ctype="image/jpeg", data=JPEG):
    return {"image": (name, data, ctype)}


# ---------------------------------------------------------------- basics / auth
async def test_health_no_auth(client):
    r = await client.get("/health")
    assert r.status_code == 200 and r.json()["status"] == "ok" and "time" in r.json()


async def test_missing_auth_401(client):
    r = await client.post("/v1/routes/plan", json={})
    assert r.status_code == 401
    body = r.json()
    assert body["error"]["code"] == "unauthorized"
    assert "sign in" in body["error"]["message"].lower()
    for path in ("/v1/destinations/search?q=a",):
        assert (await client.get(path)).status_code == 401
    assert (await client.post("/v1/ocr/read", files=img())).status_code == 401
    assert (await client.post("/v1/vision/describe", files=img())).status_code == 401
    assert (await client.post("/v1/assistant/command", data={"text": "hi"})).status_code == 401


async def test_bad_dev_header_401(client):
    r = await client.get("/v1/destinations/search?q=lib", headers={"X-Dev-User": "not-a-uuid"})
    assert r.status_code == 401


async def test_dev_auth_refused_in_production(make_client):
    c = make_client(make_settings(env="production", dev_auth=True))
    r = await c.get("/v1/destinations/search?q=lib", headers=DEV_HEADERS)
    assert r.status_code == 401


async def test_dev_auth_off_by_default(make_client):
    c = make_client(make_settings(dev_auth=False))
    r = await c.get("/v1/destinations/search?q=lib", headers=DEV_HEADERS)
    assert r.status_code == 401


async def test_hs256_jwt(make_client):
    import time
    import jwt

    secret = "s" * 40
    c = make_client(make_settings(dev_auth=False, supabase_jwt_secret=secret))
    good = jwt.encode({"sub": DEV_HEADERS["X-Dev-User"], "aud": "authenticated", "exp": time.time() + 300}, secret, "HS256")
    r = await c.get("/v1/destinations/search?q=library", headers={"Authorization": f"Bearer {good}"})
    assert r.status_code == 200
    expired = jwt.encode({"sub": DEV_HEADERS["X-Dev-User"], "aud": "authenticated", "exp": time.time() - 300}, secret, "HS256")
    assert (await c.get("/v1/destinations/search?q=library", headers={"Authorization": f"Bearer {expired}"})).status_code == 401
    wrong = jwt.encode({"sub": DEV_HEADERS["X-Dev-User"], "aud": "authenticated", "exp": time.time() + 300}, "other" * 10, "HS256")
    assert (await c.get("/v1/destinations/search?q=library", headers={"Authorization": f"Bearer {wrong}"})).status_code == 401
    aud = jwt.encode({"sub": DEV_HEADERS["X-Dev-User"], "aud": "x", "exp": time.time() + 300}, secret, "HS256")
    assert (await c.get("/v1/destinations/search?q=library", headers={"Authorization": f"Bearer {aud}"})).status_code == 401


async def test_error_shape_404_and_validation(client):
    r = await client.get("/nope")
    assert r.json()["error"]["code"] == "not_found"
    r = await client.post("/v1/routes/plan", json={"from_node_id": "x"}, headers=DEV_HEADERS)
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_request"


# ---------------------------------------------------------------- routes / search
def _ids():
    m = load_mini()
    return m.node_by_code("LB-G-ENTRANCE").id, m.node_by_code("LB-1-LIBRARY").id


async def test_plan_route(client):
    a, b = _ids()
    r = await client.post("/v1/routes/plan", json={"from_node_id": a, "to_node_id": b}, headers=DEV_HEADERS)
    assert r.status_code == 200
    j = r.json()
    assert j["found"] is True and j["steps"] and j["arrival_message"]
    assert set(j["steps"][0]) == {
        "index", "instruction", "from_node_id", "to_node_id", "floor_level", "length_m", "kind", "checkpoint_qr"
    }
    assert set(j) == {
        "found", "total_length_m", "node_ids", "edge_ids", "steps", "explanation",
        "blocked_edges_avoided", "warnings", "arrival_message",
    }


async def test_plan_blocked_has_explanation(make_client):
    m = load_mini()
    block(m, "LB-1-N1", "LB-1-N2")
    c = make_client(m=m)
    a, b = _ids()
    j = (await c.post("/v1/routes/plan", json={"from_node_id": a, "to_node_id": b}, headers=DEV_HEADERS)).json()
    assert "north corridor" in j["explanation"]
    assert j["blocked_edges_avoided"][0]["label"] == "North corridor, Floor 1"


async def test_plan_unknown_node_404(client):
    a, _ = _ids()
    r = await client.post(
        "/v1/routes/plan",
        json={"from_node_id": a, "to_node_id": "00000000-0000-0000-0000-0000000000aa"},
        headers=DEV_HEADERS,
    )
    assert r.status_code == 404 and r.json()["error"]["code"] == "node_not_found"


async def test_search_endpoint(client):
    r = await client.get("/v1/destinations/search", params={"q": "toilet"}, headers=DEV_HEADERS)
    j = r.json()
    assert j["results"][0]["label"] == "Ground floor washroom"
    assert set(j["results"][0]) == {"node_id", "code", "label", "kind", "floor_level", "floor_name", "score"}
    r = await client.get("/v1/destinations/search", params={"q": "library", "floor_level": 0}, headers=DEV_HEADERS)
    assert r.json() == {"results": []}


# ---------------------------------------------------------------- OCR
@respx.mock
async def test_ocr_happy_path(client):
    route = respx.post(GEMINI_URL).mock(
        return_value=gemini_reply(
            {"text": "DEPARTMENT LIBRARY\nOpen 9 to 5", "language": "en", "confidence": "high",
             "spoken": "Department Library. Open 9 to 5.", "answer": "9 to 5", "advice": None}
        )
    )
    r = await client.post("/v1/ocr/read", files=img(), data={"question": "When is it open?"}, headers=DEV_HEADERS)
    assert r.status_code == 200
    j = r.json()
    assert j["text"].startswith("DEPARTMENT LIBRARY") and j["confidence"] == "high" and j["answer"] == "9 to 5"
    assert j["advice"] is None
    req = route.calls.last.request
    assert req.headers["x-goog-api-key"] == "fake-key"
    body = json.loads(req.content)
    assert body["generationConfig"]["responseMimeType"] == "application/json"
    assert body["generationConfig"]["responseSchema"]["properties"]["text"]
    assert body["contents"][0]["parts"][1]["inlineData"]["mimeType"] == "image/jpeg"
    assert "When is it open?" in body["contents"][0]["parts"][0]["text"]


@respx.mock
async def test_ocr_unreadable_gives_advice(client):
    respx.post(GEMINI_URL).mock(
        return_value=gemini_reply(
            {"text": "", "language": "en", "confidence": "high", "spoken": "It says hello", "answer": "made up", "advice": None}
        )
    )
    j = (await client.post("/v1/ocr/read", files=img(), headers=DEV_HEADERS)).json()
    assert j["text"] == "" and j["confidence"] == "low" and j["advice"] and j["answer"] is None
    assert "hello" not in j["spoken"].lower()


@respx.mock
async def test_ocr_empty_candidates(client):
    respx.post(GEMINI_URL).mock(return_value=httpx.Response(200, json={"candidates": []}))
    j = (await client.post("/v1/ocr/read", files=img(), headers=DEV_HEADERS)).json()
    assert j["confidence"] == "low" and j["advice"]


@respx.mock
async def test_429_then_success(client):
    route = respx.post(GEMINI_URL).mock(
        side_effect=[
            httpx.Response(429, json={"error": {"message": "quota"}}),
            gemini_reply({"description": "A corridor with a door.", "confidence": "medium", "answer": None}),
        ]
    )
    r = await client.post("/v1/vision/describe", files=img(), headers=DEV_HEADERS)
    assert r.status_code == 200 and route.call_count == 2
    j = r.json()
    assert j["description"] == "A corridor with a door." and j["caution"] == "I can't judge distances or confirm the path is safe."


@respx.mock
async def test_429_twice_503_ai_busy(client):
    respx.post(GEMINI_URL).mock(return_value=httpx.Response(429, json={}))
    r = await client.post("/v1/ocr/read", files=img(), headers=DEV_HEADERS)
    assert r.status_code == 503
    assert r.json() == {"error": {"code": "ai_busy", "message": "The AI service is busy. Please try again in a minute."}}


@respx.mock
async def test_gemini_timeout_and_server_error(client):
    respx.post(GEMINI_URL).mock(side_effect=httpx.ReadTimeout("slow"))
    r = await client.post("/v1/ocr/read", files=img(), headers=DEV_HEADERS)
    assert r.status_code == 504 and r.json()["error"]["code"] == "ai_timeout"
    respx.post(GEMINI_URL).mock(return_value=httpx.Response(500))
    r = await client.post("/v1/ocr/read", files=img(), headers=DEV_HEADERS)
    assert r.status_code == 502


@respx.mock
async def test_bad_json_from_gemini(client):
    respx.post(GEMINI_URL).mock(
        return_value=httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": "not json"}]}}]})
    )
    r = await client.post("/v1/ocr/read", files=img(), headers=DEV_HEADERS)
    assert r.status_code == 502 and r.json()["error"]["code"] == "ai_bad_response"


@respx.mock
async def test_oversize_upload_413(client):
    route = respx.post(GEMINI_URL)
    big = b"\xff\xd8" + b"0" * (5 * 1024 * 1024 + 10)
    r = await client.post("/v1/ocr/read", files=img(data=big), headers=DEV_HEADERS)
    assert r.status_code == 413 and r.json()["error"]["code"] == "file_too_large"
    assert not route.called


@respx.mock
async def test_unsupported_type_415(client):
    route = respx.post(GEMINI_URL)
    r = await client.post("/v1/vision/describe", files=img("a.gif", "image/gif"), headers=DEV_HEADERS)
    assert r.status_code == 415 and "JPEG or PNG" in r.json()["error"]["message"]
    assert not route.called


async def test_vision_missing_image_422(client):
    r = await client.post("/v1/vision/describe", headers=DEV_HEADERS)
    assert r.status_code == 422


@respx.mock
async def test_vision_empty_description_low(client):
    respx.post(GEMINI_URL).mock(return_value=gemini_reply({"description": "", "confidence": "high"}))
    j = (await client.post("/v1/vision/describe", files=img(), headers=DEV_HEADERS)).json()
    assert j["confidence"] == "low" and j["caution"]


# ---------------------------------------------------------------- command
@respx.mock
async def test_command_navigate_text(client):
    respx.post(GEMINI_URL).mock(
        return_value=gemini_reply({"transcript": "take me to the library", "intent": "navigate", "destination_query": "library"})
    )
    r = await client.post("/v1/assistant/command", data={"text": "take me to the library"}, headers=DEV_HEADERS)
    j = r.json()
    assert j["intent"] == "navigate" and j["destination_query"] == "library"
    assert j["destination"]["label"] == "Department Library" and j["destination"]["floor_level"] == 1
    assert j["reply"] == "Finding a route to the Department Library."


@respx.mock
async def test_command_navigate_audio(client):
    route = respx.post(GEMINI_URL).mock(
        return_value=gemini_reply({"transcript": "take me to the librery", "intent": "navigate", "destination_query": "librery"})
    )
    r = await client.post(
        "/v1/assistant/command", files={"audio": ("c.m4a", b"audio-bytes", "audio/mp4")}, headers=DEV_HEADERS
    )
    j = r.json()
    assert j["transcript"] == "take me to the librery" and j["destination"]["label"] == "Department Library"
    parts = json.loads(route.calls.last.request.content)["contents"][0]["parts"]
    assert parts[1]["inlineData"]["mimeType"] == "audio/mp4"


@respx.mock
async def test_command_destination_not_found(client):
    respx.post(GEMINI_URL).mock(
        return_value=gemini_reply({"transcript": "go to the cafeteria", "intent": "navigate", "destination_query": "cafeteria"})
    )
    j = (await client.post("/v1/assistant/command", data={"text": "go to the cafeteria"}, headers=DEV_HEADERS)).json()
    assert j["destination"] is None
    assert j["reply"] == "I couldn't find cafeteria on the map. Try saying the room name again."


@respx.mock
async def test_command_sos_has_no_side_effects(client):
    respx.post(GEMINI_URL).mock(
        return_value=gemini_reply({"transcript": "help me emergency", "intent": "sos", "destination_query": None})
    )
    j = (await client.post("/v1/assistant/command", data={"text": "help me emergency"}, headers=DEV_HEADERS)).json()
    assert j["intent"] == "sos" and j["destination"] is None
    assert j["reply"] == "Opening emergency help. Confirm on the screen to send an alert."


@respx.mock
async def test_command_sos_works_even_if_gemini_down(client):
    respx.post(GEMINI_URL).mock(return_value=httpx.Response(500))
    j = (await client.post("/v1/assistant/command", data={"text": "this is an emergency"}, headers=DEV_HEADERS)).json()
    assert j["intent"] == "sos"


@respx.mock
async def test_command_unknown_intent_value_maps_to_unknown(client):
    respx.post(GEMINI_URL).mock(return_value=gemini_reply({"transcript": "blah", "intent": "dance", "destination_query": "x"}))
    j = (await client.post("/v1/assistant/command", data={"text": "blah"}, headers=DEV_HEADERS)).json()
    assert j["intent"] == "unknown" and j["destination_query"] is None


async def test_command_requires_input(client):
    r = await client.post("/v1/assistant/command", headers=DEV_HEADERS)
    assert r.status_code == 400 and r.json()["error"]["code"] == "missing_input"


@respx.mock
async def test_command_audio_too_big_and_bad_type(client):
    route = respx.post(GEMINI_URL)
    r = await client.post(
        "/v1/assistant/command", files={"audio": ("c.wav", b"0" * (2 * 1024 * 1024 + 5), "audio/wav")}, headers=DEV_HEADERS
    )
    assert r.status_code == 413
    r = await client.post("/v1/assistant/command", files={"audio": ("c.txt", b"abc", "text/plain")}, headers=DEV_HEADERS)
    assert r.status_code == 415
    assert not route.called


# ---------------------------------------------------------------- rate limit
@respx.mock
async def test_rate_limit_per_user(make_client):
    c = make_client(make_settings(ai_rate_limit_calls=3))
    respx.post(GEMINI_URL).mock(return_value=gemini_reply({"description": "A hall.", "confidence": "high"}))
    for _ in range(3):
        assert (await c.post("/v1/vision/describe", files=img(), headers=DEV_HEADERS)).status_code == 200
    r = await c.post("/v1/vision/describe", files=img(), headers=DEV_HEADERS)
    assert r.status_code == 429 and r.json()["error"]["code"] == "rate_limited" and "Retry-After" in r.headers
    other = {"X-Dev-User": "22222222-2222-2222-2222-222222222222"}
    assert (await c.post("/v1/vision/describe", files=img(), headers=other)).status_code == 200


async def test_missing_gemini_key_503(make_client):
    c = make_client(make_settings(gemini_api_key=""))
    r = await c.post("/v1/ocr/read", files=img(), headers=DEV_HEADERS)
    assert r.status_code == 503 and r.json()["error"]["code"] == "ai_unavailable"
