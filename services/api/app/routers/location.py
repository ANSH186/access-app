from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from ..ai import prompts
from ..ai.gemini import GeminiClient
from ..auth import AuthUser, current_user
from ..deps import ai_user, get_gemini, get_map_data
from ..geocode import bearing_text, reverse_geocode
from ..navigation.graph import MapData, haversine_m

router = APIRouter(prefix="/v1/location")


def _node_json(n, distance: float, lat: float, lng: float) -> dict:
    return {
        "node_id": n.id,
        "code": n.code,
        "label": n.label,
        "kind": n.kind,
        "floor_level": n.floor_level,
        "floor_name": n.floor_name,
        "lat": n.lat,
        "lng": n.lng,
        "distance_m": round(distance, 1),
        "bearing": bearing_text(lat, lng, n.lat, n.lng) if n.lat is not None and n.lng is not None else None,
        "verified": n.verified,
        "notes": n.notes,
    }


@router.get("/nearest")
async def nearest(
    lat: float = Query(..., ge=-90, le=90),
    lng: float = Query(..., ge=-180, le=180),
    user: AuthUser = Depends(current_user),
    m: MapData = Depends(get_map_data),
) -> dict:
    hit = m.nearest_node(lat, lng, searchable_only=True)
    if not hit:
        return {"found": False, "nearest": None}
    node, distance = hit
    return {
        "found": True,
        "on_campus": distance <= 600,
        "nearest": _node_json(node, distance, lat, lng),
        "accuracy_note": "Straight-line distance. GPS can be off by several metres, especially between buildings.",
    }


@router.get("/landmarks")
async def landmarks(
    lat: float = Query(..., ge=-90, le=90),
    lng: float = Query(..., ge=-180, le=180),
    limit: int = Query(5, ge=1, le=10),
    user: AuthUser = Depends(current_user),
    m: MapData = Depends(get_map_data),
) -> dict:
    rows: list[tuple] = []
    for n in m.nodes.values():
        if not n.searchable or n.lat is None or n.lng is None:
            continue
        rows.append((n, haversine_m(lat, lng, n.lat, n.lng)))
    rows.sort(key=lambda r: r[1])
    picked = rows[:limit]
    on_campus = bool(picked and picked[0][1] <= 600)
    return {
        "on_campus": on_campus,
        "landmarks": [_node_json(n, d, lat, lng) for n, d in picked],
        "accuracy_note": "Straight-line distances from your phone's GPS. They are approximate.",
    }


@router.get("/reverse")
async def reverse(
    lat: float = Query(..., ge=-90, le=90),
    lng: float = Query(..., ge=-180, le=180),
    user: AuthUser = Depends(current_user),
) -> dict:
    ctx = await reverse_geocode(lat, lng)
    return {
        "found": ctx.error is None,
        "lat": lat,
        "lng": lng,
        "display_name": ctx.display_name,
        "name": ctx.name,
        "short": ctx.short,
        "road": ctx.road,
        "suburb": ctx.suburb,
        "city": ctx.city,
        "state": ctx.state,
        "country": ctx.country,
        "postcode": ctx.postcode,
        "error": ctx.error,
    }


@router.get("/context")
async def context(
    lat: float = Query(..., ge=-90, le=90),
    lng: float = Query(..., ge=-180, le=180),
    user: AuthUser = Depends(ai_user),
    m: MapData = Depends(get_map_data),
    gemini: GeminiClient = Depends(get_gemini),
) -> dict:
    ctx = await reverse_geocode(lat, lng)
    hit = m.nearest_node(lat, lng, searchable_only=True)
    nearest = None
    if hit:
        node, distance = hit
        if distance <= 600:
            nearest = _node_json(node, distance, lat, lng)

    fallback = ""
    if nearest:
        fallback = (
            f"You are on NIE North Campus, near {nearest['label']}, about {round(nearest['distance_m'])} metres "
            f"to the {nearest['bearing'] or 'north'}."
        )
    elif ctx.short and ctx.short != "an unknown place":
        fallback = f"You are near {ctx.short}."
    else:
        fallback = "I could not identify this place from the available location data."

    description = ""
    if ctx.display_name or nearest:
        try:
            out = await gemini.generate_json(
                [
                    {
                        "text": (
                            "Help me understand this location.\n"
                            + ctx.prompt_line()
                            + (f"\nnearest campus landmark: {nearest['label']} ({round(nearest['distance_m'])} metres away)"
                               if nearest else "")
                        )
                    }
                ],
                prompts.PLACE_SCHEMA,
                prompts.PLACE_SYSTEM,
                temperature=0.2,
            )
            description = str(out.get("description") or "").strip()
            place_name = str(out.get("place_name") or "").strip() or None
        except Exception:  # noqa: BLE001
            place_name = None
    else:
        place_name = None

    return {
        "lat": lat,
        "lng": lng,
        "display_name": ctx.display_name,
        "short": ctx.short,
        "nearest": nearest,
        "on_campus": bool(nearest),
        "description": description or fallback,
        "place_name": place_name or (nearest["label"] if nearest else ctx.name),
        "confidence": "medium" if nearest else "low",
    }
