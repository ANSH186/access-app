"""FastAPI app factory."""
from __future__ import annotations

import logging
import time

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from contextlib import asynccontextmanager

from .ai.ratelimit import SlidingWindowLimiter
from .auth import JWKSCache
from .config import Settings, get_settings
from .db import Database
from .errors import AppError
from .logging_setup import setup_logging
from .routers import ai, destinations, health, routes

log = logging.getLogger("aa.api")


def _err(status: int, code: str, message: str, headers: dict | None = None) -> JSONResponse:
    return JSONResponse({"error": {"code": code, "message": message}}, status_code=status, headers=headers)


def create_app(settings: Settings | None = None) -> FastAPI:
    setup_logging()
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if settings.is_production and settings.dev_auth:
            log.warning("DEV_AUTH is set but ENV=production: the dev header is refused")
        if settings.map_source == "db" and settings.database_url:
            try:
                await app.state.db.pool()
            except AppError:
                log.warning("database not reachable at startup; will retry on first request")
        yield
        await app.state.db.close()

    app = FastAPI(title="AccessAble AI API", version="1.0.0", lifespan=lifespan)
    app.state.settings = settings
    app.state.db = Database(settings.database_url)
    app.state.limiter = SlidingWindowLimiter(settings.ai_rate_limit_calls, settings.ai_rate_limit_window_s)
    app.state.jwks = JWKSCache(f"{settings.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json")
    app.state.log = log

    origins = settings.cors_list
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials="*" not in origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def access_log(request: Request, call_next):
        t0 = time.perf_counter()
        resp = await call_next(request)
        if request.url.path != "/health":
            log.info(
                "request",
                extra={
                    "method": request.method,
                    "path": request.url.path,
                    "status": resp.status_code,
                    "ms": round((time.perf_counter() - t0) * 1000),
                },
            )
        return resp

    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError):
        return _err(exc.status, exc.code, exc.message, exc.headers)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException):
        if exc.status_code == 404:
            return _err(404, "not_found", "That page does not exist.")
        if exc.status_code == 405:
            return _err(405, "method_not_allowed", "That action is not allowed here.")
        return _err(exc.status_code, "http_error", "Something went wrong with that request.")

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError):
        return _err(422, "invalid_request", "Something was missing or not valid in that request.")

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception):
        log.error("unhandled error", extra={"path": request.url.path, "error": type(exc).__name__})
        return _err(500, "internal_error", "Something went wrong on the server. Please try again.")

    app.include_router(health.router)
    app.include_router(routes.router)
    app.include_router(destinations.router)
    app.include_router(ai.router)
    return app


app = create_app()
