from __future__ import annotations

from app.navigation.planner import plan_route

from .conftest import block, edge_between, load_mini


def ids(m):
    return (m.node_by_code("LB-G-ENTRANCE").id, m.node_by_code("LB-1-LIBRARY").id)


def kinds(m, plan):
    return [m.edges[e].kind for e in plan.edge_ids]


def test_entrance_to_library_found(mini):
    a, b = ids(mini)
    p = plan_route(mini, a, b)
    assert p.found
    assert p.node_ids[0] == a and p.node_ids[-1] == b
    assert p.total_length_m == sum(mini.edges[e].length_m for e in p.edge_ids)
    assert p.explanation is None and p.blocked_edges_avoided == []
    assert any(k in ("stairs", "lift") for k in kinds(mini, p))
    assert len(p.node_ids) == len(p.edge_ids) + 1


def test_unverified_warnings_deduplicated(mini):
    a, b = ids(mini)
    p = plan_route(mini, a, b)
    assert len(p.warnings) == len(set(p.warnings))
    assert any("staircase" in w or "lift" in w for w in p.warnings)
    assert any("entrance" in w for w in p.warnings)


def test_avoid_stairs_uses_lift(mini):
    a, b = ids(mini)
    p = plan_route(mini, a, b, avoid_stairs=True)
    assert p.found
    ks = kinds(mini, p)
    assert "lift" in ks and "stairs" not in ks
    assert all(mini.edges[e].step_free for e in p.edge_ids)
    assert any("lift" in s.instruction.lower() for s in p.steps)


def test_blocking_north_corridor_forces_long_way(mini):
    a, b = ids(mini)
    normal = plan_route(mini, a, b)
    block(mini, "LB-1-N1", "LB-1-N2")
    p = plan_route(mini, a, b)
    assert p.found
    n1, n2 = mini.node_by_code("LB-1-N1").id, mini.node_by_code("LB-1-N2").id
    blocked = edge_between(mini, "LB-1-N1", "LB-1-N2").id
    assert blocked not in p.edge_ids
    assert p.total_length_m > normal.total_length_m + 50
    assert p.explanation and "north corridor" in p.explanation and "Floor 1" in p.explanation
    assert "longer" in p.explanation
    assert p.blocked_edges_avoided == [
        {"edge_id": blocked, "label": "North corridor, Floor 1", "reason": "blocked path: chairs stacked in corridor"}
    ]


def test_everything_blocked_not_found(mini):
    from dataclasses import replace

    for k, e in list(mini.edges.items()):
        mini.edges[k] = replace(e, status="blocked")
    a, b = ids(mini)
    p = plan_route(mini, a, b)
    assert not p.found
    assert p.explanation and "ask someone" in p.explanation
    assert p.steps == [] and p.node_ids == [] and p.edge_ids == []


def test_not_found_message_differs_when_avoiding_stairs(mini):
    from dataclasses import replace

    for k, e in list(mini.edges.items()):
        if e.kind == "lift":
            mini.edges[k] = replace(e, status="blocked")
    a, b = ids(mini)
    p = plan_route(mini, a, b, avoid_stairs=True)
    assert not p.found
    assert "step-free" in p.explanation and "allow stairs" in p.explanation
    p2 = plan_route(mini, a, b, avoid_stairs=False)
    assert p2.found  # stairs still work


def test_same_node_zero_steps(mini):
    a, _ = ids(mini)
    p = plan_route(mini, a, a)
    assert p.found and p.steps == [] and p.total_length_m == 0
    assert "already at" in p.arrival_message


def test_unknown_node_raises(mini):
    import pytest

    with pytest.raises(KeyError):
        plan_route(mini, "nope", ids(mini)[1])


def test_stairs_cost_double(mini):
    # one floor via the stairs weighs 24 and via the lift 24.01, so ties go to the stairs
    a, b = ids(mini)
    p = plan_route(mini, a, b)
    assert "stairs" in kinds(mini, p)
