from __future__ import annotations

import pathlib
from dataclasses import replace

import httpx
import pytest

from app.config import Settings
from app.deps import get_map_data
from app.main import create_app
from app.navigation.graph import MapData, load_map_from_file

FIX = pathlib.Path(__file__).parent / "fixtures" / "mini_ring_map.json"
LAB_BLOCK = pathlib.Path(__file__).parents[3] / "data" / "sample-campus" / "lab_block.json"
DEV_USER = "11111111-1111-1111-1111-111111111111"
DEV_HEADERS = {"X-Dev-User": DEV_USER}


def load_mini() -> MapData:
    return load_map_from_file(FIX)


def edge_between(m: MapData, code_a: str, code_b: str):
    a, b = m.node_by_code(code_a).id, m.node_by_code(code_b).id
    return next(e for e in m.edges.values() if {e.from_id, e.to_id} == {a, b})


def block(m: MapData, code_a: str, code_b: str, reason: str = "blocked_path: chairs stacked in corridor") -> None:
    e = edge_between(m, code_a, code_b)
    m.edges[e.id] = replace(e, status="blocked", blocked_reason=reason)


@pytest.fixture
def mini() -> MapData:
    return load_mini()


def make_settings(**kw) -> Settings:
    base = dict(
        env="development", dev_auth=True, gemini_api_key="fake-key", gemini_retry_delay_s=0.0,
        gemini_ocr_race_models=1, ocr_space_api_key="", map_source="file:/nonexistent", supabase_url="", supabase_jwt_secret="", _env_file=None,
    )
    base.update(kw)
    return Settings(**base)


@pytest.fixture
def make_client():
    clients = []

    def _make(settings: Settings | None = None, m: MapData | None = None):
        app = create_app(settings or make_settings())
        mm = m or load_mini()
        app.dependency_overrides[get_map_data] = lambda: mm
        client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")
        clients.append(client)
        client.app = app  # type: ignore[attr-defined]
        return client

    yield _make


@pytest.fixture
async def client(make_client):
    return make_client()
