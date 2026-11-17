from __future__ import annotations

import asyncio
import os
import time

from fastapi import Depends, Request

from .ai.gemini import GeminiClient
from .auth import AuthUser, current_user
from .errors import AppError
from .navigation.graph import (
    MapData,
    load_campus_map,
    load_map_from_db,
    load_map_from_file,
    load_map_from_supabase_rest,
    merge_maps,
)

_file_cache: dict[str, tuple[float, MapData]] = {}
_rest_cache: tuple[float, str, MapData] | None = None
_rest_lock = asyncio.Lock()
REST_CACHE_S = 10.0


def _bearer(request: Request) -> str | None:
    h = request.headers.get("authorization", "")
    parts = h.split(None, 1)
    if len(parts) == 2 and parts[0].lower() == "bearer" and parts[1].strip():
        return parts[1].strip()
    return None


def _with_campus(base: MapData, s) -> MapData:
    if not getattr(s, "campus_map_enabled", False):
        return base
    try:
        campus = load_campus_map(getattr(s, "campus_map_path", ""))
    except Exception:  # noqa: BLE001
        return base
    return merge_maps(base, campus) if campus else base


async def get_map_data(request: Request) -> MapData:
    """Load the map from the database, Supabase REST, or a local file, then add the campus map.

    The REST fallback is important on Render free tier: the API can still serve
    routes when the direct Postgres pooler is unavailable, because the caller's
    Supabase JWT is enough to read the map through PostgREST.
    """
    global _rest_cache
    s = request.app.state.settings
    source = "file" if s.map_source.startswith("file:") else "db"
    try:
        if s.map_source.startswith("file:"):
            path = s.map_source[5:]
            mtime = os.path.getmtime(path)
            hit = _file_cache.get(path)
            if hit and hit[0] == mtime:
                request.state.map_source = "file"
                return _with_campus(hit[1], s)
            md = load_map_from_file(path)
            _file_cache[path] = (mtime, md)
            request.state.map_source = "file"
            return _with_campus(md, s)

        md: MapData | None = None
        if s.database_url:
            try:
                pool = await request.app.state.db.pool()
                md = await load_map_from_db(pool, s.institution_id)
                if not md.nodes:
                    md = None
            except Exception as exc:  # noqa: BLE001
                request.app.state.log.warning("database map failed: %s", type(exc).__name__)
                md = None

        if md is None:
            token = _bearer(request)
            if not token:
                raise AppError(401, "unauthorized", "Please sign in to use the map.")
            now = time.monotonic()
            if _rest_cache and now - _rest_cache[0] < REST_CACHE_S and _rest_cache[1] == s.institution_id:
                md = _rest_cache[2]
                source = "supabase_rest"
            else:
                async with _rest_lock:
                    now = time.monotonic()
                    if _rest_cache and now - _rest_cache[0] < REST_CACHE_S and _rest_cache[1] == s.institution_id:
                        md = _rest_cache[2]
                    else:
                        md = await load_map_from_supabase_rest(
                            s.supabase_url, s.public_supabase_key, token
                        )
                        _rest_cache = (now, s.institution_id, md)
                    source = "supabase_rest"
        request.state.map_source = source
        return _with_campus(md, s)
    except AppError:
        raise
    except Exception:  # noqa: BLE001
        request.app.state.log.exception("map load failed")
        raise AppError(503, "map_unavailable", "The campus map is not available right now. Please try again later.")


async def get_map_data_optional(request: Request) -> MapData | None:
    """Map is optional for AI endpoints: sign reading and commands must still work offline."""
    try:
        return await get_map_data(request)
    except AppError:
        return None


def get_gemini(request: Request) -> GeminiClient:
    s = request.app.state.settings
    models = [s.gemini_model, *s.gemini_fallbacks]
    # Google's full flash models were returning 503 "high demand" in Nov 2026;
    # the lite flash model is the reliable multimodal option for this project.
    # Prefer it even when an older GEMINI_MODEL is still set in the deployment.
    if "gemini-flash-lite-latest" not in models:
        models.insert(0, "gemini-flash-lite-latest")
    if "gemini-3.1-flash-lite" not in models:
        models.append("gemini-3.1-flash-lite")
    return GeminiClient(
        s.gemini_api_key,
        models[0],
        s.gemini_base_url,
        s.gemini_timeout_s,
        s.gemini_retry_delay_s,
        fallback_models=models[1:],
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
