from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request

from ..ai.gemini import GeminiClient
from ..auth import AuthUser, current_user
from ..config import API_VERSION
from ..deps import get_gemini, get_map_data_optional

router = APIRouter()


@router.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "version": API_VERSION,
        "time": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/v1/diagnostics")
async def diagnostics(
    request: Request,
    user: AuthUser = Depends(current_user),
    m=Depends(get_map_data_optional),
) -> dict:
    s = request.app.state.settings
    return {
        "status": "ok",
        "version": API_VERSION,
        "map": {
            "ok": m is not None and bool(m.nodes),
            "source": getattr(request.state, "map_source", "unknown"),
            "nodes": len(m.nodes) if m else 0,
            "campus_nodes": sum(1 for n in m.nodes.values() if n.floor_code.upper().startswith("NIE")) if m else 0,
        },
        "ai": {
            "configured": bool(s.gemini_api_key),
            "model": s.gemini_model,
            "timeout_s": s.gemini_timeout_s,
        },
        "database": {
            "configured": bool(s.database_url),
            "map_mode": s.map_source,
        },
        "news": {"enabled": True},
        "user": user.id,
    }


@router.get("/v1/diagnostics/ai")
async def diagnostics_ai(
    models: str | None = None,
    user: AuthUser = Depends(current_user),
    gemini: GeminiClient = Depends(get_gemini),
) -> dict:
    """Redacted Gemini probe. Safe: no API key is returned."""
    probe_client = gemini
    if models:
        wanted = [m.strip() for m in models.split(",") if m.strip()][:6]
        probe_client = GeminiClient(
            gemini.api_key,
            wanted[0] if wanted else gemini.model,
            fallback_models=wanted[1:],
        )
    return {
        "configured": bool(probe_client.api_key),
        "models": probe_client.models,
        "available_models": await gemini.list_models(),
        "probe": await probe_client.probe(),
    }
