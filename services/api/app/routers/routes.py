from __future__ import annotations

import dataclasses
import uuid

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..auth import AuthUser, current_user
from ..deps import get_map_data
from ..errors import AppError
from ..navigation.graph import MapData
from ..navigation.planner import plan_route

router = APIRouter(prefix="/v1/routes")


class PlanRequest(BaseModel):
    from_node_id: uuid.UUID
    to_node_id: uuid.UUID
    avoid_stairs: bool = False


@router.post("/plan")
async def plan(
    body: PlanRequest,
    user: AuthUser = Depends(current_user),
    m: MapData = Depends(get_map_data),
) -> dict:
    try:
        plan = plan_route(m, str(body.from_node_id), str(body.to_node_id), body.avoid_stairs)
    except KeyError:
        raise AppError(404, "node_not_found", "I couldn't find that place on the map.")
    return dataclasses.asdict(plan)
