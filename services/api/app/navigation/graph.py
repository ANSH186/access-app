"""Map data structure (pure) plus loaders from Postgres and from the lab_block.json shape."""
from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

NAMESPACE = uuid.UUID("6f1c2a1e-7d1b-4c5e-9a43-2b8f0d7e4a10")


def det_uuid(code: str) -> str:
    return str(uuid.uuid5(NAMESPACE, code))


@dataclass(frozen=True)
class Floor:
    id: str
    code: str
    level: int
    name: str


@dataclass(frozen=True)
class Node:
    id: str
    code: str
    floor_code: str
    floor_level: int
    floor_name: str
    kind: str
    label: str
    aliases: tuple[str, ...]
    x: float
    y: float
    searchable: bool = False
    qr_token: str | None = None
    verified: bool = False
    notes: str | None = None


@dataclass(frozen=True)
class Edge:
    id: str
    code: str
    from_id: str
    to_id: str
    kind: str
    length_m: float
    step_free: bool
    status: str = "open"
    verified: bool = False
    blocked_reason: str | None = None

    @property
    def blocked(self) -> bool:
        return self.status == "blocked"


@dataclass
class MapData:
    floors: dict[str, Floor] = field(default_factory=dict)  # by code
    nodes: dict[str, Node] = field(default_factory=dict)  # by id
    edges: dict[str, Edge] = field(default_factory=dict)  # by id
    _bounds: dict[str, tuple[float, float, float, float]] = field(default_factory=dict, repr=False)

    def node_by_code(self, code: str) -> Node | None:
        for n in self.nodes.values():
            if n.code == code:
                return n
        return None

    def edge_by_code(self, code: str) -> Edge | None:
        for e in self.edges.values():
            if e.code == code:
                return e
        return None

    def floor_bounds(self, floor_code: str) -> tuple[float, float, float, float] | None:
        """(xmin, xmax, ymin, ymax) of the corridor ring on a floor, derived from node coordinates."""
        if floor_code not in self._bounds:
            pts = [(n.x, n.y) for n in self.nodes.values() if n.floor_code == floor_code and n.kind == "corridor"]
            if not pts:
                return None
            xs, ys = [p[0] for p in pts], [p[1] for p in pts]
            self._bounds[floor_code] = (min(xs), max(xs), min(ys), max(ys))
        return self._bounds[floor_code]

    @classmethod
    def from_records(
        cls,
        floors: Iterable[dict[str, Any]],
        nodes: Iterable[dict[str, Any]],
        edges: Iterable[dict[str, Any]],
    ) -> "MapData":
        md = cls()
        for f in floors:
            md.floors[f["code"]] = Floor(
                id=str(f.get("id") or det_uuid(f["code"])), code=f["code"], level=int(f["level"]), name=f["name"]
            )
        id_by_code: dict[str, str] = {}
        for n in nodes:
            fl = md.floors[n["floor_code"]]
            nid = str(n.get("id") or det_uuid(n["code"]))
            id_by_code[n["code"]] = nid
            md.nodes[nid] = Node(
                id=nid,
                code=n["code"],
                floor_code=fl.code,
                floor_level=fl.level,
                floor_name=fl.name,
                kind=n["kind"],
                label=n["label"],
                aliases=tuple(a.lower() for a in (n.get("aliases") or [])),
                x=float(n["x"]),
                y=float(n["y"]),
                searchable=bool(n.get("searchable", False)),
                qr_token=n.get("qr_token") or None,
                verified=bool(n.get("verified", False)),
                notes=n.get("notes"),
            )
        for e in edges:
            code = e.get("code") or f"{e['from_code']}__{e['to_code']}"
            eid = str(e.get("id") or det_uuid(code))
            md.edges[eid] = Edge(
                id=eid,
                code=code,
                from_id=id_by_code[e["from_code"]],
                to_id=id_by_code[e["to_code"]],
                kind=e["kind"],
                length_m=float(e["length_m"]),
                step_free=bool(e["step_free"]),
                status=e.get("status") or "open",
                verified=bool(e.get("verified", False)),
                blocked_reason=e.get("blocked_reason"),
            )
        return md

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "MapData":
        return cls.from_records(d["floors"], d["nodes"], d["edges"])


def load_map_from_file(path: str | Path) -> MapData:
    with open(path, encoding="utf-8") as fh:
        return MapData.from_dict(json.load(fh))


_FLOORS_SQL = """
select f.id, f.code, f.level, f.name
from floors f join buildings b on b.id = f.building_id
where b.institution_id = $1::uuid
"""
_NODES_SQL = """
select n.id, n.code, f.code as floor_code, n.kind, n.label, n.aliases, n.x, n.y,
       n.searchable, n.qr_token, n.verified, n.notes
from route_nodes n
join floors f on f.id = n.floor_id
join buildings b on b.id = f.building_id
where b.institution_id = $1::uuid
"""
_EDGES_SQL = """
select e.id, e.code, fn.code as from_code, tn.code as to_code, e.kind, e.length_m,
       e.step_free, e.status, e.blocked_reason, e.verified
from route_edges e
join route_nodes fn on fn.id = e.from_node_id
join route_nodes tn on tn.id = e.to_node_id
join floors f on f.id = fn.floor_id
join buildings b on b.id = f.building_id
where b.institution_id = $1::uuid
"""


async def load_map_from_db(pool, institution_id: str) -> MapData:
    """Load floors, nodes and edges for the institution. Fresh on every call (about 200 nodes)."""
    async with pool.acquire() as conn:
        floors = await conn.fetch(_FLOORS_SQL, institution_id)
        nodes = await conn.fetch(_NODES_SQL, institution_id)
        edges = await conn.fetch(_EDGES_SQL, institution_id)
    return MapData.from_records(
        [dict(r) for r in floors], [dict(r) for r in nodes], [dict(r) for r in edges]
    )
