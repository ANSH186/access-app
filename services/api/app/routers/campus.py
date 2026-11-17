from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request

from ..ai.gemini import GeminiClient
from ..auth import AuthUser, current_user
from ..deps import ai_user, get_gemini, get_map_data
from ..navigation.graph import MapData, haversine_m

router = APIRouter(prefix="/v1/campus")

CAMPUS_NOTE = (
    "This campus layout is a schematic traced from satellite imagery. "
    "Building names and path positions must be verified on site."
)


@router.get("/layout")
async def layout(
    request: Request,
    user: AuthUser = Depends(current_user),
    m: MapData = Depends(get_map_data),
) -> dict:
    campus_nodes = [n for n in m.nodes.values() if n.floor_code.upper().startswith("NIE")]
    campus_edges = [e for e in m.edges.values() if e.from_id in {n.id for n in campus_nodes}]
    return {
        "source": getattr(request.state, "map_source", "unknown"),
        "note": CAMPUS_NOTE,
        "map_image": "/static/campus/nie_north_campus.png",
        "center": {"lat": 12.3720, "lng": 76.5850},
        "nodes": [
            {
                "id": n.id,
                "code": n.code,
                "label": n.label,
                "kind": n.kind,
                "lat": n.lat,
                "lng": n.lng,
                "searchable": n.searchable,
                "qr_token": n.qr_token,
            }
            for n in campus_nodes
            if n.searchable
        ],
        "edges": [
            {
                "id": e.id,
                "from": e.from_id,
                "to": e.to_id,
                "kind": e.kind,
                "length_m": e.length_m,
                "step_free": e.step_free,
                "status": e.status,
            }
            for e in campus_edges
        ],
    }


@router.get("/nearby")
async def nearby(
    lat: float = Query(..., ge=-90, le=90),
    lng: float = Query(..., ge=-180, le=180),
    limit: int = Query(5, ge=1, le=12),
    user: AuthUser = Depends(current_user),
    m: MapData = Depends(get_map_data),
) -> dict:
    rows = [
        (n, haversine_m(lat, lng, n.lat, n.lng))
        for n in m.nodes.values()
        if n.searchable and n.lat is not None and n.lng is not None
    ]
    rows.sort(key=lambda r: r[1])
    return {
        "places": [
            {
                "node_id": n.id,
                "label": n.label,
                "kind": n.kind,
                "distance_m": round(d, 1),
                "verified": n.verified,
            }
            for n, d in rows[:limit]
        ],
        "note": CAMPUS_NOTE,
    }


@router.post("/ask")
async def ask(
    body: dict,
    user: AuthUser = Depends(ai_user),
    m: MapData = Depends(get_map_data),
    gemini: GeminiClient = Depends(get_gemini),
) -> dict:
    question = str(body.get("question") or "").strip()[:400]
    if not question:
        return {"answer": "Ask me about a building or a place on the NIE North Campus."}
    places = [
        f"{n.label} ({n.kind})" for n in m.nodes.values() if n.searchable and n.floor_code.upper().startswith("NIE")
    ]
    context = (
        "Campus: NIE North Campus, Koorgalli, Mysuru. "
        "The map is a schematic and may be approximate. Known destinations: " + "; ".join(places) + ". "
    )
    try:
        answer = await gemini.generate_text(
            [{"text": context + "\nQuestion: " + question}],
            "Answer a blind student's question about their campus using only the destination list provided. "
            "If the place is not in the list, say you do not know. Keep it to two short sentences. "
            "Do not invent room numbers, opening times or facilities.",
            temperature=0.1,
        )
    except Exception:  # noqa: BLE001
        answer = ""
    return {
        "answer": answer or "I could not answer that just now. Try searching for the destination instead.",
        "note": CAMPUS_NOTE,
    }
