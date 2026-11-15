from __future__ import annotations

import dataclasses

from fastapi import APIRouter, Depends, Query

from ..auth import AuthUser, current_user
from ..deps import get_map_data
from ..navigation.graph import MapData
from ..navigation.search import search_destinations

router = APIRouter(prefix="/v1/destinations")


@router.get("/search")
async def search(
    q: str = Query(..., min_length=1, max_length=100),
    floor_level: int | None = None,
    user: AuthUser = Depends(current_user),
    m: MapData = Depends(get_map_data),
) -> dict:
    results = search_destinations(m, q, floor_level=floor_level)
    return {"results": [dataclasses.asdict(r) for r in results]}
