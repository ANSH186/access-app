"""asyncpg pool (direct Postgres). statement_cache_size=0 so it also works behind a pooler."""
from __future__ import annotations

import asyncio
import logging

import asyncpg

from .errors import AppError

log = logging.getLogger("aa.db")


class Database:
    def __init__(self, dsn: str):
        self.dsn = dsn
        self._pool: asyncpg.Pool | None = None
        self._lock = asyncio.Lock()

    async def pool(self) -> asyncpg.Pool:
        if self._pool is not None:
            return self._pool
        if not self.dsn:
            raise AppError(503, "map_unavailable", "The map is not available right now. Please try again later.")
        async with self._lock:
            if self._pool is None:
                try:
                    self._pool = await asyncpg.create_pool(
                        self.dsn, min_size=1, max_size=5, statement_cache_size=0, timeout=15, command_timeout=15
                    )
                except Exception as exc:  # noqa: BLE001
                    log.error("database connect failed", extra={"error": type(exc).__name__})
                    raise AppError(
                        503, "map_unavailable", "The map is not available right now. Please try again later."
                    )
        return self._pool

    async def close(self) -> None:
        if self._pool is not None:
            await self._pool.close()
            self._pool = None
