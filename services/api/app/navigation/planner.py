"""Route planning (pure, no I/O). Deterministic code decides routes; AI never does.

Weights: stairs x2.0, lift +20 (waiting; plus a 0.01 tie-break so equal-cost trips prefer stairs),
blocked edges excluded, avoid_stairs excludes step_free=false edges.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import networkx as nx

from .directions import Step, build_steps, describe_edge, edge_label, np
from .graph import Edge, MapData

STAIR_FACTOR = 2.0
LIFT_PENALTY = 20.0
LIFT_TIE_BREAK = 0.01


@dataclass
class RoutePlan:
    found: bool
    total_length_m: float = 0.0
    node_ids: list[str] = field(default_factory=list)
    edge_ids: list[str] = field(default_factory=list)
    steps: list[Step] = field(default_factory=list)
    explanation: str | None = None
    blocked_edges_avoided: list[dict] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    arrival_message: str | None = None


def edge_weight(e: Edge) -> float:
    if e.kind == "stairs":
        return e.length_m * STAIR_FACTOR
    if e.kind == "lift":
        return e.length_m + LIFT_PENALTY + LIFT_TIE_BREAK
    return e.length_m


def _shortest(m: MapData, src: str, dst: str, avoid_stairs: bool, ignore_blocks: bool):
    g = nx.Graph()
    for e in m.edges.values():
        if e.blocked and not ignore_blocks:
            continue
        if avoid_stairs and not e.step_free:
            continue
        g.add_edge(e.from_id, e.to_id, edge_id=e.id, weight=edge_weight(e))
    if src not in g or dst not in g:
        return None
    try:
        path = nx.dijkstra_path(g, src, dst, weight="weight")
    except nx.NetworkXNoPath:
        return None
    return path, [g[u][v]["edge_id"] for u, v in zip(path, path[1:])]


def _warnings(m: MapData, node_ids: list[str], edge_ids: list[str]) -> list[str]:
    out: list[str] = []

    def add(msg: str) -> None:
        if msg not in out:
            out.append(msg)

    for nid in node_ids:
        n = m.nodes[nid]
        if n.verified:
            continue
        if n.kind == "lift":
            add("This route uses the lift. Its position has not been verified yet.")
        elif n.kind == "stairs":
            add("This route uses a staircase. Its position has not been verified yet.")
        elif n.kind == "entrance":
            add("The entrance position has not been verified yet, so the first steps are an estimate.")
    for eid in edge_ids:
        e = m.edges[eid]
        if e.verified:
            continue
        if e.kind == "lift":
            add("This route uses the lift. Its position has not been verified yet.")
        elif e.kind == "stairs":
            add("This route uses a staircase. Its position has not been verified yet.")
    return out


def _reason(e: Edge) -> str:
    r = (e.blocked_reason or "").replace("_", " ").strip()
    return r or "reported as blocked"


def _join(items: list[str]) -> str:
    if len(items) <= 1:
        return "".join(items)
    return ", ".join(items[:-1]) + " and " + items[-1]


def plan_route(m: MapData, from_id: str, to_id: str, avoid_stairs: bool = False) -> RoutePlan:
    if from_id not in m.nodes or to_id not in m.nodes:
        raise KeyError("unknown node id")
    dest = m.nodes[to_id]

    if from_id == to_id:
        steps, arrival = build_steps(m, [from_id], [])
        return RoutePlan(found=True, node_ids=[from_id], steps=steps, arrival_message=arrival)

    actual = _shortest(m, from_id, to_id, avoid_stairs, ignore_blocks=False)
    ideal = _shortest(m, from_id, to_id, avoid_stairs, ignore_blocks=True)

    # blocked edges on the route we would otherwise have used
    avoided: list[Edge] = []
    if ideal:
        avoided = [m.edges[eid] for eid in ideal[1] if m.edges[eid].blocked]
    avoided_json = [
        {"edge_id": e.id, "label": edge_label(m, e), "reason": _reason(e)} for e in avoided
    ]

    def blocked_sentence() -> str:
        places = []
        for e in avoided:
            place, fl = describe_edge(m, e)
            places.append(f"the {place} on {fl}")
        reasons = _join([_reason(e) for e in avoided])
        return f"The usual route through {_join(places)} is blocked ({reasons})."

    if not actual:
        target = np(dest.label)
        if avoid_stairs:
            expl = (
                f"There is no step-free path to {target} right now. "
                "Please ask someone nearby for help, or allow stairs and try again."
            )
        else:
            expl = (
                f"I could not find a path to {target} right now. "
                "Some routes may be blocked. Please ask someone nearby for help."
            )
        if avoided:
            expl = f"{blocked_sentence()} {expl}"
        return RoutePlan(found=False, explanation=expl, blocked_edges_avoided=avoided_json)

    nodes, edge_ids = actual
    length = sum(m.edges[e].length_m for e in edge_ids)
    steps, arrival = build_steps(m, nodes, edge_ids)

    explanation = None
    if avoided and ideal:
        ideal_len = sum(m.edges[e].length_m for e in ideal[1])
        diff = int(round(length - ideal_len))
        longer = f"about {diff} metres longer" if diff >= 2 else "about the same length"
        explanation = f"{blocked_sentence()} This route goes around instead and is {longer}."

    return RoutePlan(
        found=True,
        total_length_m=round(length, 1),
        node_ids=nodes,
        edge_ids=edge_ids,
        steps=steps,
        explanation=explanation,
        blocked_edges_avoided=avoided_json,
        warnings=_warnings(m, nodes, edge_ids),
        arrival_message=arrival,
    )
