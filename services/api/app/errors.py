"""Application errors rendered as {"error": {"code", "message"}}. Messages are safe to speak aloud."""
from __future__ import annotations


class AppError(Exception):
    def __init__(self, status: int, code: str, message: str, headers: dict[str, str] | None = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.headers = headers or {}
