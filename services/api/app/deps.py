from __future__ import annotations

import os

from fastapi import Depends, Request

from .ai.gemini import GeminiClient
from .auth import AuthUser, current_user
from .errors import AppError
from .navigation.graph import MapData, load_map_from_db, load_map_from_file

_file_cache: dict[str, tuple[float, MapData]] = {}


async def get_map_data(request: Request) -> MapData:
    """Load the map fresh per request. Tests override this dependency."""
    s = request.app.state.settings
    if s.map_source.startswith("file:"):
        path = s.map_source[5:]
        try:
            mtime = os.path.getmtime(path)
            hit = _file_cache.get(path)
            if hit and hit[0] == mtime:
                return hit[1]
            md = load_map_from_file(path)
        except (OSError, ValueError, KeyError):
            raise AppError(503, "map_unavailable", "The map is not available right now. Please try again later.")
        _file_cache[path] = (mtime, md)
        return md
    pool = await request.app.state.db.pool()
    try:
        return await load_map_from_db(pool, s.institution_id)
    except AppError:
        raise
    except Exception:  # noqa: BLE001
        request.app.state.log.exception("map load failed")
        raise AppError(503, "map_unavailable", "The map is not available right now. Please try again later.")


def get_gemini(request: Request) -> GeminiClient:
    s = request.app.state.settings
    return GeminiClient(
        s.gemini_api_key, s.gemini_model, s.gemini_base_url, s.gemini_timeout_s, s.gemini_retry_delay_s
    )


async def ai_user(request: Request, user: AuthUser = Depends(current_user)) -> AuthUser:
    """Auth plus the per-user AI rate limit."""
    wait = request.app.state.limiter.hit(user.id)
    if wait is not None:
        raise AppError(
            429,
            "rate_limited",
            "You have used the AI helper a lot in the last few minutes. Please wait a little and try again.",
            headers={"Retry-After": str(int(wait))},
        )
    return user
