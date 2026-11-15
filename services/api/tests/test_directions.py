from __future__ import annotations

from app.navigation.directions import edge_label
from app.navigation.planner import plan_route

from .conftest import block, edge_between


def route(m, avoid=False):
    return plan_route(m, m.node_by_code("LB-G-ENTRANCE").id, m.node_by_code("LB-1-LIBRARY").id, avoid)


def texts(p):
    return [s.instruction for s in p.steps]


def test_orientation_first(mini):
    t = texts(route(mini))
    assert t[0].startswith("You are at the main entrance, facing into the building.")


def test_corridor_names_courtyard_and_merged_lengths(mini):
    t = texts(route(mini))
    assert "Turn left into the south corridor. Walk about 15 metres. The courtyard railing is on your right." in t
    # SW -> W1 -> W2 -> W3 -> NW merged into ONE 45 m step
    assert "Turn right into the west corridor. Walk about 45 metres. The courtyard railing is on your right." in t
    assert sum("west corridor" in s for s in t) == 1


def test_floor_change_sentence(mini):
    t = texts(route(mini))
    assert "Take the north staircase up to Floor 1. Hold the handrail." in t
    t2 = texts(route(mini, avoid=True))
    assert "Take the lift up to Floor 1." in t2


def test_stairs_down_wording(mini):
    p = plan_route(mini, mini.node_by_code("LB-1-LIBRARY").id, mini.node_by_code("LB-G-ENTRANCE").id)
    t = texts(p)
    assert any(s.startswith("Take the north staircase down to the Ground floor. Hold the handrail.") for s in t)


def test_door_side_and_arrival(mini):
    p = route(mini)
    assert p.steps[-1].instruction == "The Department Library door is on your left. Turn left and walk about 3 metres to reach it."
    assert p.arrival_message == (
        "The Department Library should be on your left. Use Read Sign or a checkpoint to confirm before going in."
    )


def test_door_side_flips_on_the_long_way(mini):
    block(mini, "LB-1-N1", "LB-1-N2")
    p = route(mini)
    assert "door is on your right" in p.steps[-1].instruction
    assert "should be on your right" in p.arrival_message


def test_checkpoint_qr(mini):
    p = route(mini)
    qr_steps = [s for s in p.steps if s.checkpoint_qr]
    assert qr_steps and qr_steps[-1].checkpoint_qr == "AA-CP-1-LIBRARY"
    for s in qr_steps:
        assert s.instruction.endswith("There is a checkpoint here — scan it to confirm where you are.")
    assert all(not s.checkpoint_qr or s.to_node_id for s in p.steps)


def test_runs_do_not_merge_across_checkpoint():
    # a QR node in the middle of a straight run splits it
    from dataclasses import replace
    from .conftest import load_mini

    m = load_mini()
    w2 = m.node_by_code("LB-G-W2")
    m.nodes[w2.id] = replace(w2, qr_token="AA-CP-TEST")
    p = route(m)
    assert sum("west corridor" in s.instruction for s in p.steps) == 2


def test_rounding_whole_metres(mini):
    import re

    for s in route(mini).steps:
        for n in re.findall(r"about ([\d.]+) metre", s.instruction):
            assert n.isdigit()


def test_start_inside_room_and_wing_from_coordinates(mini):
    p = plan_route(mini, mini.node_by_code("LB-1-LAB101").id, mini.node_by_code("LB-1-LIBRARY").id)
    t = texts(p)
    assert t[0].startswith("Leave Lab 101 through its door and walk about 3 metres to the west corridor.")


def test_start_on_corridor_without_heading(mini):
    p = plan_route(mini, mini.node_by_code("LB-1-SM").id, mini.node_by_code("LB-1-S1").id)
    assert p.steps[0].instruction.startswith("Face along the south corridor with the courtyard railing on your right.")


def test_edge_label(mini):
    e = edge_between(mini, "LB-1-N1", "LB-1-N2")
    assert edge_label(mini, e) == "North corridor, Floor 1"


def test_step_fields(mini):
    p = route(mini)
    s0 = p.steps[0]
    assert s0.index == 0 and s0.floor_level == 0 and s0.kind == "door"
    assert [s.index for s in p.steps] == list(range(len(p.steps)))
    for a, b in zip(p.steps, p.steps[1:]):
        assert a.to_node_id == b.from_node_id
