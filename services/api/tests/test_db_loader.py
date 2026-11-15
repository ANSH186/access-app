"""Optional integration test: needs a local Postgres (host /tmp, port 54329, user postgres, no password).
Creates a throwaway database aa_api_test with minimal CONTRACT section 2 tables, then drops it."""
from __future__ import annotations

import json

import asyncpg
import pytest

from app.navigation.graph import load_map_from_db
from app.navigation.planner import plan_route

from .conftest import FIX, LAB_BLOCK

CONN = dict(host="/tmp", port=54329, user="postgres")
INST = "00000000-0000-0000-0000-000000000001"
OTHER_INST = "00000000-0000-0000-0000-000000000002"

DDL = """
create table buildings(id uuid primary key, institution_id uuid, code text unique not null, name text not null);
create table floors(id uuid primary key, building_id uuid references buildings, code text unique not null, level int not null, name text not null);
create table route_nodes(id uuid primary key, floor_id uuid references floors, code text unique not null, kind text, label text not null,
  aliases text[] not null default '{}', x double precision not null, y double precision not null, searchable boolean not null default false,
  qr_token text unique, verified boolean not null default false, notes text);
create table route_edges(id uuid primary key, code text unique not null, from_node_id uuid references route_nodes, to_node_id uuid references route_nodes,
  kind text, length_m double precision not null, step_free boolean not null, status text not null default 'open', blocked_reason text,
  verified boolean not null default false);
"""


@pytest.fixture
async def pool():
    try:
        admin = await asyncpg.connect(database="postgres", timeout=2, **CONN)
    except Exception:
        pytest.skip("local postgres on /tmp:54329 not available")
    await admin.execute("drop database if exists aa_api_test")
    await admin.execute("create database aa_api_test")
    p = await asyncpg.create_pool(database="aa_api_test", statement_cache_size=0, min_size=1, max_size=2, **CONN)
    try:
        async with p.acquire() as c:
            await c.execute(DDL)
        yield p
    finally:
        await p.close()
        await admin.execute("drop database if exists aa_api_test")
        await admin.close()


async def seed(pool, data, building_id, inst):
    from app.navigation.graph import det_uuid

    async with pool.acquire() as c:
        await c.execute("insert into buildings values($1::uuid,$2::uuid,'LB','Lab Block')", building_id, inst)
        fid = {}
        for f in data["floors"]:
            fid[f["code"]] = f.get("id") or det_uuid(f["code"])
            await c.execute("insert into floors values($1::uuid,$2::uuid,$3,$4,$5)", fid[f["code"]], building_id, f["code"], f["level"], f["name"])
        nid = {}
        for n in data["nodes"]:
            nid[n["code"]] = n.get("id") or det_uuid(n["code"])
            await c.execute(
                "insert into route_nodes values($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
                nid[n["code"]], fid[n["floor_code"]], n["code"], n["kind"], n["label"], n["aliases"], float(n["x"]), float(n["y"]),
                n["searchable"], n["qr_token"], n["verified"], n["notes"],
            )
        for e in data["edges"]:
            code = e.get("code") or f"{e['from_code']}__{e['to_code']}"
            await c.execute(
                "insert into route_edges values($1::uuid,$2,$3::uuid,$4::uuid,$5,$6,$7,$8,$9,$10)",
                e.get("id") or det_uuid(code), code, nid[e["from_code"]], nid[e["to_code"]], e["kind"], float(e["length_m"]),
                e["step_free"], e.get("status", "open"), e.get("blocked_reason"), e.get("verified", False),
            )


async def test_load_from_db_matches_file(pool):
    data = json.loads(FIX.read_text())
    await seed(pool, data, "00000000-0000-0000-0000-0000000000b1", INST)
    # a second institution's building must not leak in
    other = {"floors": [{"code": "XX-G", "level": 0, "name": "Other"}], "nodes": [], "edges": []}
    async with pool.acquire() as c:
        await c.execute("insert into buildings values('00000000-0000-0000-0000-0000000000b2',$1::uuid,'XX','Other')", OTHER_INST)
        await c.execute("insert into floors values('00000000-0000-0000-0000-0000000000f2','00000000-0000-0000-0000-0000000000b2','XX-G',0,'Other')")
    m = await load_map_from_db(pool, INST)
    assert set(m.floors) == {"LB-G", "LB-1"}
    assert len(m.nodes) == len(data["nodes"]) and len(m.edges) == len(data["edges"])
    lib = m.node_by_code("LB-1-LIBRARY")
    assert lib.searchable and "library" in lib.aliases and lib.floor_level == 1 and lib.floor_name == "Floor 1"
    p = plan_route(m, m.node_by_code("LB-G-ENTRANCE").id, lib.id)
    assert p.found and p.steps[-1].instruction.startswith("The Department Library door is on your")
    # status/blocked_reason are read fresh each call
    async with pool.acquire() as c:
        await c.execute("update route_edges set status='blocked', blocked_reason='wet floor' where code like '%N1__LB-1-N2' or code like '%N2__LB-1-N1'")
    m2 = await load_map_from_db(pool, INST)
    assert any(e.blocked and e.blocked_reason == "wet floor" for e in m2.edges.values())


@pytest.mark.skipif(not LAB_BLOCK.exists(), reason="lab_block.json not generated")
async def test_load_real_map_from_db(pool):
    data = json.loads(LAB_BLOCK.read_text())
    await seed(pool, data, "00000000-0000-0000-0000-0000000000b1", INST)
    m = await load_map_from_db(pool, INST)
    assert len(m.nodes) == len(data["nodes"])
    p = plan_route(m, m.node_by_code("LB-G-ENTRANCE").id, m.node_by_code("LB-2-LIBRARY").id)
    assert p.found
