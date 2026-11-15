"""Supabase JWT verification (HS256 secret or JWKS) with a DEV_AUTH header fallback."""
from __future__ import annotations

import logging
import time
import uuid
from dataclasses import dataclass

import httpx
import jwt
from fastapi import Request

from .config import Settings
from .errors import AppError

log = logging.getLogger("aa.auth")

MSG_MISSING = "Please sign in to use this feature."
MSG_INVALID = "Your sign-in has expired or is not valid. Please sign in again."
JWKS_TTL_S = 600


@dataclass
class AuthUser:
    id: str


class JWKSCache:
    def __init__(self, url: str, ttl_s: float = JWKS_TTL_S):
        self.url = url
        self.ttl_s = ttl_s
        self._keys: dict[str, jwt.PyJWK] = {}
        self._fetched = 0.0

    async def get_key(self, kid: str | None) -> jwt.PyJWK | None:
        now = time.monotonic()
        stale = now - self._fetched > self.ttl_s
        if stale or (kid and kid not in self._keys and now - self._fetched > 30):
            await self._refresh()
        if kid:
            return self._keys.get(kid)
        return next(iter(self._keys.values()), None)

    async def _refresh(self) -> None:
        try:
            async with httpx.AsyncClient(timeout=10) as c:
                r = await c.get(self.url)
                r.raise_for_status()
                keys = {}
                for jwk in r.json().get("keys", []):
                    k = jwt.PyJWK.from_dict(jwk)
                    keys[jwk.get("kid", "")] = k
                self._keys = keys
                self._fetched = time.monotonic()
        except Exception as exc:  # noqa: BLE001
            log.warning("jwks fetch failed", extra={"error": type(exc).__name__})
            self._fetched = time.monotonic() - self.ttl_s + 30  # retry in 30 s


def _bearer(request: Request) -> str | None:
    h = request.headers.get("authorization", "")
    parts = h.split(None, 1)
    if len(parts) == 2 and parts[0].lower() == "bearer" and parts[1].strip():
        return parts[1].strip()
    return None


async def current_user(request: Request) -> AuthUser:
    settings: Settings = request.app.state.settings

    token = _bearer(request)
    if token is None:
        dev = request.headers.get("x-dev-user")
        if dev and settings.dev_auth_enabled:
            try:
                return AuthUser(id=str(uuid.UUID(dev.strip())))
            except ValueError:
                raise AppError(401, "unauthorized", MSG_INVALID)
        raise AppError(401, "unauthorized", MSG_MISSING)

    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError:
        raise AppError(401, "unauthorized", MSG_INVALID)
    alg = header.get("alg", "")

    key = None
    algs: list[str]
    if alg == "HS256" and settings.supabase_jwt_secret:
        key, algs = settings.supabase_jwt_secret, ["HS256"]
    elif alg in ("RS256", "ES256") and settings.supabase_url:
        cache: JWKSCache = request.app.state.jwks
        jwk = await cache.get_key(header.get("kid"))
        if jwk is None:
            raise AppError(401, "unauthorized", MSG_INVALID)
        key, algs = jwk.key, [alg]
    else:
        raise AppError(401, "unauthorized", MSG_INVALID)

    try:
        claims = jwt.decode(
            token, key, algorithms=algs, audience="authenticated", leeway=10, options={"require": ["exp", "sub"]}
        )
    except jwt.PyJWTError:
        raise AppError(401, "unauthorized", MSG_INVALID)
    try:
        return AuthUser(id=str(uuid.UUID(str(claims["sub"]))))
    except ValueError:
        raise AppError(401, "unauthorized", MSG_INVALID)
