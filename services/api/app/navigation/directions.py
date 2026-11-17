"""Spoken step generation (pure). A blind user hears these, so wording matters.

Geometry: x east, y north (building frame, metres). Heading vectors are (dx, dy).
cross(h, v) > 0 means v is to the LEFT of heading h.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass

from .graph import Edge, MapData, Node

WALL_TOL = 1.0
STRAIGHT_DEG = 25.0
AROUND_DEG = 155.0
CHECKPOINT_SENTENCE = "There is a checkpoint here — scan it to confirm where you are."
ROOM_KINDS = {"room", "lab", "office", "library", "washroom", "help_desk"}


@dataclass
class Step:
    index: int
    instruction: str
    from_node_id: str
    to_node_id: str
    floor_level: int
    length_m: float
    kind: str
    checkpoint_qr: str | None = None


# ----------------------------------------------------------------- helpers
def _unit(dx: float, dy: float) -> tuple[float, float]:
    n = math.hypot(dx, dy)
    return (0.0, 0.0) if n == 0 else (dx / n, dy / n)


def _heading(a: Node, b: Node) -> tuple[float, float]:
    return _unit(b.x - a.x, b.y - a.y)


def _cross(h: tuple[float, float], v: tuple[float, float]) -> float:
    return h[0] * v[1] - h[1] * v[0]


def _dot(h: tuple[float, float], v: tuple[float, float]) -> float:
    return h[0] * v[0] + h[1] * v[1]


def turn_of(prev: tuple[float, float], new: tuple[float, float]) -> str:
    """'straight' | 'left' | 'right' | 'around'."""
    ang = math.degrees(math.atan2(_cross(prev, new), _dot(prev, new)))
    if abs(ang) < STRAIGHT_DEG:
        return "straight"
    if abs(ang) > AROUND_DEG:
        return "around"
    return "left" if ang > 0 else "right"


def clean_label(label: str) -> str:
    return re.sub(r"\s*\([^)]*\)", "", label).strip()


def np(label: str, capital: bool = False) -> str:
    """Noun phrase with article: 'the Department Library' (no article for 'Lab 101')."""
    lab = clean_label(label)
    if re.match(r"^(lab|room)\b", lab, re.I):
        return lab
    return ("The " if capital else "the ") + lab


def metres(n: float) -> str:
    r = max(1, int(round(n)))
    return f"about {r} metre" + ("" if r == 1 else "s")


def floor_phrase(name: str) -> str:
    return f"the {name}" if name.lower().startswith("ground") else name


def walls_near(m: MapData, floor_code: str, x: float, y: float) -> list[str]:
    b = m.floor_bounds(floor_code)
    if not b:
        return []
    xmin, xmax, ymin, ymax = b
    out = []
    if abs(x - xmin) <= WALL_TOL:
        out.append("west")
    if abs(x - xmax) <= WALL_TOL:
        out.append("east")
    if abs(y - ymin) <= WALL_TOL:
        out.append("south")
    if abs(y - ymax) <= WALL_TOL:
        out.append("north")
    return out


def wing_of_run(m: MapData, a: Node, b: Node) -> str | None:
    """Wing (west/east/north/south) of a straight corridor run from its coordinates."""
    bnd = m.floor_bounds(a.floor_code)
    if not bnd:
        return None
    xmin, xmax, ymin, ymax = bnd
    if abs(b.x - a.x) >= abs(b.y - a.y):  # runs along x -> south/north wall
        y = (a.y + b.y) / 2
        if abs(y - ymin) <= WALL_TOL:
            return "south"
        if abs(y - ymax) <= WALL_TOL:
            return "north"
    else:
        x = (a.x + b.x) / 2
        if abs(x - xmin) <= WALL_TOL:
            return "west"
        if abs(x - xmax) <= WALL_TOL:
            return "east"
    return None


def wing_of_point(m: MapData, n: Node) -> str | None:
    w = walls_near(m, n.floor_code, n.x, n.y)
    return w[0] if len(w) == 1 else None


def courtyard_centre(m: MapData, floor_code: str) -> tuple[float, float] | None:
    b = m.floor_bounds(floor_code)
    if not b:
        return None
    return ((b[0] + b[1]) / 2, (b[2] + b[3]) / 2)


def courtyard_side(m: MapData, a: Node, b: Node) -> str | None:
    c = courtyard_centre(m, a.floor_code)
    if not c:
        return None
    cr = _cross(_heading(a, b), (c[0] - a.x, c[1] - a.y))
    if abs(cr) < 1e-6:
        return None
    return "left" if cr > 0 else "right"


def core_name(m: MapData, n: Node) -> str:
    """'lift' / 'north staircase' from the node's position relative to the building."""
    if n.kind == "lift":
        return "lift"
    b = m.floor_bounds(n.floor_code)
    if b:
        xmin, xmax, ymin, ymax = b
        if n.y > ymax + WALL_TOL:
            return "north staircase"
        if n.y < ymin - WALL_TOL:
            return "south staircase"
        if n.x > xmax + WALL_TOL:
            return "east staircase"
        if n.x < xmin - WALL_TOL:
            return "west staircase"
    return "staircase"


def describe_edge(m: MapData, e: Edge) -> tuple[str, str]:
    """(place, floor_name) e.g. ('north corridor', 'Floor 2') for blocked-edge labels."""
    a, b = m.nodes[e.from_id], m.nodes[e.to_id]
    if e.kind in ("stairs", "lift") and a.floor_level != b.floor_level:
        what = "lift" if e.kind == "lift" else "staircase"
        return (f"{what} between {a.floor_name} and {b.floor_name}", a.floor_name)
    if e.kind == "corridor" and a.kind == "corridor" and b.kind == "corridor":
        wing = wing_of_run(m, a, b)
        return (f"{wing} corridor" if wing else "corridor", a.floor_name)
    other = b if a.kind == "corridor" else a
    return (f"door to {clean_label(other.label)}", a.floor_name)


def edge_label(m: MapData, e: Edge) -> str:
    place, fl = describe_edge(m, e)
    return f"{place[0].upper()}{place[1:]}, {fl}"


# ----------------------------------------------------------------- builder
def build_steps(m: MapData, node_ids: list[str], edge_ids: list[str]) -> tuple[list[Step], str | None]:
    """Return (steps, arrival_message) for a path."""
    nodes = [m.nodes[i] for i in node_ids]
    edges = [m.edges[i] for i in edge_ids]
    if not nodes:
        return [], None
    dest = nodes[-1]
    if not edges:
        return [], f"You are already at {np(dest.label)}."

    steps: list[Step] = []
    heading: tuple[float, float] | None = None
    orient = ""
    start = nodes[0]
    on_campus = "campus" in start.floor_name.lower()
    if start.kind == "entrance" and not on_campus:
        heading = (0.0, 1.0)  # assume entering heading north
        orient = f"You are at the {clean_label(start.label).lower()}, facing into the building. "
    elif on_campus:
        orient = f"You are at {np(start.label)}. "
    prev_vertical = False
    arrival_side: str | None = None
    door_final = False

    def add(i_from: int, i_to: int, text: str, length: float, kind: str) -> None:
        nonlocal orient
        to_node = nodes[i_to]
        qr = to_node.qr_token
        if qr:
            text = f"{text} {CHECKPOINT_SENTENCE}"
        steps.append(
            Step(
                index=len(steps),
                instruction=(orient + text).strip(),
                from_node_id=nodes[i_from].id,
                to_node_id=to_node.id,
                floor_level=nodes[i_from].floor_level,
                length_m=round(length, 1),
                kind=kind,
                checkpoint_qr=qr,
            )
        )
        orient = ""

    i = 0
    while i < len(edges):
        e, a, b = edges[i], nodes[i], nodes[i + 1]

        # ---- floor change (merge consecutive same-kind vertical edges in one direction)
        if a.floor_level != b.floor_level:
            j = i
            sign = 1 if b.floor_level > a.floor_level else -1
            while (
                j + 1 < len(edges)
                and edges[j + 1].kind == e.kind
                and nodes[j + 1].floor_level != nodes[j + 2].floor_level
                and (1 if nodes[j + 2].floor_level > nodes[j + 1].floor_level else -1) == sign
                and not nodes[j + 1].qr_token
            ):
                j += 1
            end = nodes[j + 1]
            levels = abs(end.floor_level - a.floor_level)
            direction = "up" if sign > 0 else "down"
            conveyance = "the lift" if e.kind == "lift" else f"the {core_name(m, a)}"
            count = "" if levels == 1 else f"{levels} floors "
            text = f"Take {conveyance} {direction} {count}to {floor_phrase(end.floor_name)}."
            if e.kind != "lift":
                text += " Hold the handrail."
            add(i, j + 1, text, sum(x.length_m for x in edges[i : j + 1]), e.kind)
            heading = None
            prev_vertical = True
            i = j + 1
            continue

        # ---- outdoor campus path run (merge collinear outdoor edges)
        if e.kind == "outdoor" and a.kind == "corridor" and b.kind == "corridor":
            h0 = _heading(a, b)
            j = i
            while (
                j + 1 < len(edges)
                and edges[j + 1].kind == "outdoor"
                and nodes[j + 1].kind == "corridor"
                and nodes[j + 2].kind == "corridor"
                and nodes[j + 1].floor_level == a.floor_level
                and not nodes[j + 1].qr_token
                and _dot(h0, _heading(nodes[j + 1], nodes[j + 2])) > 0
                and abs(_cross(h0, _heading(nodes[j + 1], nodes[j + 2]))) < 0.1
            ):
                j += 1
            end = nodes[j + 1]
            length = sum(x.length_m for x in edges[i : j + 1])
            if heading is None:
                text = f"Walk {metres(length)} along the path."
            else:
                t = turn_of(heading, h0)
                if t == "straight":
                    text = f"Continue straight for {metres(length)}."
                elif t == "around":
                    text = f"Turn around and walk {metres(length)} along the path."
                else:
                    text = f"Turn {t} and walk {metres(length)} along the path."
            add(i, j + 1, text, length, "outdoor")
            heading = h0
            prev_vertical = False
            i = j + 1
            continue

        # ---- corridor run (merge collinear corridor edges on one floor)
        if e.kind == "corridor" and a.kind == "corridor" and b.kind == "corridor":
            h0 = _heading(a, b)
            j = i
            while (
                j + 1 < len(edges)
                and edges[j + 1].kind == "corridor"
                and nodes[j + 2].kind == "corridor"
                and nodes[j + 2].floor_level == a.floor_level
                and not nodes[j + 1].qr_token
                and _dot(h0, _heading(nodes[j + 1], nodes[j + 2])) > 0
                and abs(_cross(h0, _heading(nodes[j + 1], nodes[j + 2]))) < 0.1
            ):
                j += 1
            end = nodes[j + 1]
            length = sum(x.length_m for x in edges[i : j + 1])
            wing = wing_of_run(m, a, end)
            cname = f"{wing} corridor" if wing else "corridor"
            side = courtyard_side(m, a, end)
            rail = f" The courtyard railing is on your {side}." if side else ""
            if heading is None:
                lead = f"Face along the {cname}" + (f" with the courtyard railing on your {side}" if side else "") + "."
                text = f"{lead} Walk {metres(length)}."
            else:
                t = turn_of(heading, h0)
                if t == "straight":
                    text = f"Walk {metres(length)} along the {cname}.{rail}"
                elif t == "around":
                    text = f"Turn around and walk {metres(length)} along the {cname}.{rail}"
                else:
                    text = f"Turn {t} into the {cname}. Walk {metres(length)}.{rail}"
            add(i, j + 1, text, length, "corridor")
            heading = h0
            prev_vertical = False
            i = j + 1
            continue

        # ---- any other single edge: doors, outdoor links, entrance link
        h = _heading(a, b)
        n = metres(e.length_m)
        last = i == len(edges) - 1
        turn = turn_of(heading, h) if heading is not None else None

        if last and b.kind in ROOM_KINDS and e.kind == "door":
            door = np(b.label, capital=True)
            if heading is not None and turn in ("left", "right"):
                text = f"{door} door is on your {turn}. Turn {turn} and walk {n} to reach it."
                arrival_side = turn
            elif heading is not None and turn == "straight":
                text = f"{door} door is straight ahead. Walk {n} to reach it."
                arrival_side = "straight"
            else:
                text = f"Walk {n} to {np(b.label)} door."
            door_final = True
        elif last and b.kind in ROOM_KINDS and e.kind == "outdoor":
            target = np(b.label, capital=True)
            if turn in ("left", "right"):
                text = f"{target} is on your {turn}. Turn {turn} and walk {n} to the entrance."
                arrival_side = turn
            elif turn == "straight":
                text = f"{target} is straight ahead. Walk {n} to the entrance."
                arrival_side = "straight"
            else:
                text = f"Walk {n} to {np(b.label)}."
            door_final = True
        elif e.kind == "outdoor" and a.kind in ROOM_KINDS:
            text = f"Leave {np(a.label)} and walk {n} along the path."
        elif e.kind == "outdoor" and b.kind == "corridor":
            target = "the next path junction"
            if turn in ("left", "right"):
                text = f"Turn {turn} and walk {n} to {target}."
            elif turn == "around":
                text = f"Turn around and walk {n} to {target}."
            else:
                text = f"Walk {n} to {target}."
        elif prev_vertical:
            what = "lift" if a.kind == "lift" else "staircase"
            where = _corridor_phrase(m, b)
            text = f"Leave the {what} and walk {n} to {where}."
        elif heading is None and a.kind in ROOM_KINDS:
            text = f"Leave {np(a.label)} through its door and walk {n} to {_corridor_phrase(m, b)}."
        else:
            if b.kind in ("stairs", "lift"):
                target = "the lift" if b.kind == "lift" else f"the {core_name(m, b)}"
            elif b.kind == "corridor":
                target = _corridor_phrase(m, b)
            else:
                target = np(b.label)
            if turn in ("left", "right"):
                text = f"Turn {turn} and walk {n} to {target}."
            elif turn == "around":
                text = f"Turn around and walk {n} to {target}."
            else:
                text = f"Walk {n} to {target}."
        add(i, i + 1, text, e.length_m, e.kind)
        if _heading(a, b) != (0.0, 0.0):
            heading = h
        prev_vertical = False
        i += 1

    # ---- arrival
    on_campus = "campus" in dest.floor_name.lower()
    if door_final and arrival_side in ("left", "right"):
        arrival = (
            f"{np(dest.label, True)} should be on your {arrival_side}. "
            "Use Read Sign or a checkpoint to confirm before going in."
        )
    elif door_final:
        arrival = (
            f"You should now be at {np(dest.label)}. "
            "Use Read Sign or a checkpoint to confirm before going in."
        )
    elif on_campus:
        arrival = (
            f"You should now be near {np(dest.label)}. "
            "Check the building name or ask someone if you are unsure."
        )
    else:
        arrival = f"You have arrived at {np(dest.label)}."
    return steps, arrival


def _corridor_phrase(m: MapData, n: Node) -> str:
    if n.kind == "corridor":
        w = wing_of_point(m, n)
        return f"the {w} corridor" if w else "the corridor"
    return np(n.label)
