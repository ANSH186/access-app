"""Map data structure (pure) plus loaders from Postgres, Supabase REST and JSON."""
from __future__ import annotations

import json
import math
import uuid
import asyncio
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

import httpx

from ..errors import AppError

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
    # Outdoor campus nodes can carry GPS coordinates. Indoor nodes may not.
    lat: float | None = None
    lng: float | None = None


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

    def nearest_node(
        self,
        lat: float,
        lng: float,
        *,
        searchable_only: bool = False,
        max_distance_m: float | None = None,
    ) -> tuple[Node, float] | None:
        """Nearest node with GPS coordinates, using Haversine distance."""
        best: tuple[Node, float] | None = None
        for n in self.nodes.values():
            if n.lat is None or n.lng is None:
                continue
            if searchable_only and not n.searchable:
                continue
            d = haversine_m(lat, lng, n.lat, n.lng)
            if best is None or d < best[1]:
                best = (n, d)
        if best and max_distance_m is not None and best[1] > max_distance_m:
            return None
        return best

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
                lat=float(n["lat"]) if n.get("lat") is not None else None,
                lng=float(n["lng"]) if n.get("lng") is not None else None,
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


def merge_maps(*maps: MapData) -> MapData:
    """Combine maps (for example the indoor database map and the outdoor campus map)."""
    out = MapData()
    for m in maps:
        out.floors.update(m.floors)
        out.nodes.update(m.nodes)
        out.edges.update(m.edges)
    return out


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6_371_000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def campus_map_file(configured: str) -> Path | None:
    """Resolve a configured campus map path, whether the API runs from repo root or services/api."""
    if not configured.strip():
        return None
    p = Path(configured)
    if p.is_absolute() and p.exists():
        return p
    candidates = [
        p,
        Path(__file__).resolve().parents[1] / configured,
        Path(__file__).resolve().parents[2] / configured,
        Path.cwd() / configured,
        Path.cwd() / "services" / "api" / configured,
    ]
    for c in candidates:
        if c.exists():
            return c
    return None


def load_campus_map(configured: str) -> MapData | None:
    path = campus_map_file(configured)
    if not path:
        return None
    return load_map_from_file(path)


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


# ---------------------------------------------------------------------------
# Supabase REST fallback
# ---------------------------------------------------------------------------
# Render's free Postgres pooler occasionally refuses connections or the
# DATABASE_URL is rotated. The phone already talks to Supabase directly, so we
# can read the same map through PostgREST with the caller's JWT. RLS still
# enforces that the caller may only see their own institution's map.

_REST_FLOORS = "/rest/v1/floors?select=id,code,level,name&order=level"
_REST_NODES = (
    "/rest/v1/route_nodes?select=id,floor_id,code,kind,label,aliases,x,y,"
    "searchable,qr_token,verified,notes"
)
_REST_EDGES = (
    "/rest/v1/route_edges?select=id,code,from_node_id,to_node_id,kind,length_m,"
    "step_free,status,blocked_reason,verified"
)


async def load_map_from_supabase_rest(
    base_url: str,
    public_key: str,
    access_token: str,
    timeout_s: float = 15.0,
) -> MapData:
    base_url = base_url.rstrip("/")
    if not base_url:
        raise AppError(503, "map_unavailable", "The campus map is not configured yet.")
    headers = {
        "apikey": public_key,
        "Authorization": f"Bearer {access_token}",
        "Accept": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=timeout_s, headers=headers) as client:
            results = await asyncio.gather(
                client.get(base_url + _REST_FLOORS),
                client.get(base_url + _REST_NODES),
                client.get(base_url + _REST_EDGES),
            )
    except httpx.HTTPError as exc:
        raise AppError(
            503,
            "map_unavailable",
            "The campus map could not be loaded. Please try again in a moment.",
        ) from exc
    for r in results:
        if r.status_code >= 400:
            raise AppError(
                503,
                "map_unavailable",
                "The campus map could not be loaded. Please try again in a moment.",
            )
    floors_raw = results[0].json()
    nodes_raw = results[1].json()
    edges_raw = results[2].json()
    if not isinstance(floors_raw, list) or not isinstance(nodes_raw, list) or not isinstance(edges_raw, list):
        raise AppError(503, "map_unavailable", "The campus map is not available right now.")
    if not floors_raw or not nodes_raw:
        raise AppError(503, "map_unavailable", "The campus map is empty. Please try again later.")

    floor_by_id = {str(f["id"]): f for f in floors_raw}
    node_by_id = {str(n["id"]): n for n in nodes_raw}
    floors = [
        {"id": f["id"], "code": f["code"], "level": f["level"], "name": f["name"]}
        for f in floors_raw
    ]
    nodes = []
    for n in nodes_raw:
        fl = floor_by_id.get(str(n.get("floor_id")))
        if not fl:
            continue
        nodes.append(
            {
                "id": n["id"],
                "code": n["code"],
                "floor_code": fl["code"],
                "kind": n["kind"],
                "label": n["label"],
                "aliases": n.get("aliases") or [],
                "x": n["x"],
                "y": n["y"],
                "searchable": n.get("searchable"),
                "qr_token": n.get("qr_token"),
                "verified": n.get("verified"),
                "notes": n.get("notes"),
            }
        )
    edges = []
    for e in edges_raw:
        a = node_by_id.get(str(e.get("from_node_id")))
        b = node_by_id.get(str(e.get("to_node_id")))
        if not a or not b:
            continue
        edges.append(
            {
                "id": e["id"],
                "code": e["code"],
                "from_code": a["code"],
                "to_code": b["code"],
                "kind": e["kind"],
                "length_m": e["length_m"],
                "step_free": e.get("step_free"),
                "status": e.get("status"),
                "blocked_reason": e.get("blocked_reason"),
                "verified": e.get("verified"),
            }
        )
    return MapData.from_records(floors, nodes, edges)
