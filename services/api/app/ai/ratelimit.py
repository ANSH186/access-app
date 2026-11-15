"""Per-user in-memory sliding window limiter (20 calls / 5 minutes by default)."""
from __future__ import annotations

import time
from collections import defaultdict, deque


class SlidingWindowLimiter:
    def __init__(self, max_calls: int = 20, window_s: float = 300.0, clock=time.monotonic):
        self.max_calls = max_calls
        self.window_s = window_s
        self._clock = clock
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def hit(self, key: str) -> float | None:
        """Record a call. Returns None if allowed, else seconds until a slot frees up."""
        now = self._clock()
        q = self._hits[key]
        while q and now - q[0] >= self.window_s:
            q.popleft()
        if len(q) >= self.max_calls:
            return max(1.0, self.window_s - (now - q[0]))
        q.append(now)
        return None

    def reset(self) -> None:
        self._hits.clear()
