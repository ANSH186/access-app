"""Tests against the real generated map (skipped if data/sample-campus/lab_block.json is absent)."""
from __future__ import annotations

import pytest

from app.navigation.graph import load_map_from_file
from app.navigation.planner import plan_route
from app.navigation.search import search_destinations

from .conftest import LAB_BLOCK, block

pytestmark = pytest.mark.skipif(not LAB_BLOCK.exists(), reason="lab_block.json not generated")


@pytest.fixture
def lb():
    return load_map_from_file(LAB_BLOCK)


def go(m, a="LB-G-ENTRANCE", b="LB-2-LIBRARY", avoid=False):
    return plan_route(m, m.node_by_code(a).id, m.node_by_code(b).id, avoid)


def test_entrance_to_library(lb):
    p = go(lb)
    assert p.found and p.node_ids[-1] == lb.node_by_code("LB-2-LIBRARY").id
    assert p.steps[0].instruction.startswith("You are at the main entrance, facing into the building.")
    assert any("Take the" in s.instruction and "Floor 2" in s.instruction for s in p.steps)
    assert p.arrival_message.startswith("The Department Library should be on your")
    assert p.warnings


def test_avoid_stairs_uses_lift(lb):
    p = go(lb, avoid=True)
    assert p.found
    assert all(lb.edges[e].step_free for e in p.edge_ids)
    assert any("Take the lift up to Floor 2." == s.instruction.split(" Hold")[0] or "Take the lift up" in s.instruction for s in p.steps)


def test_block_north_corridor_floor2_with_lift_route(lb):
    normal = go(lb, avoid=True)
    block(lb, "LB-2-N1", "LB-2-N2")
    p = go(lb, avoid=True)
    assert p.found and p.total_length_m > normal.total_length_m + 50
    assert "north corridor" in p.explanation and "Floor 2" in p.explanation
    assert p.blocked_edges_avoided[0]["label"] == "North corridor, Floor 2"


def test_search_on_real_map(lb):
    assert search_destinations(lb, "toilet")[0].kind == "washroom"
    assert search_destinations(lb, "librery")[0].label == "Department Library"
    assert search_destinations(lb, "reception")[0].kind == "help_desk"


def test_every_destination_reachable_from_entrance(lb):
    start = lb.node_by_code("LB-G-ENTRANCE").id
    for n in lb.nodes.values():
        if n.searchable and n.id != start:
            p = plan_route(lb, start, n.id)
            assert p.found, n.code
            assert p.steps and p.steps[-1].to_node_id == n.id
