"""Destination fuzzy search (pure): difflib plus alias matching over searchable nodes."""
from __future__ import annotations

import re
from dataclasses import dataclass
from difflib import SequenceMatcher

from .graph import MapData, Node

STOPWORDS = {
    "the", "a", "an", "to", "take", "me", "go", "find", "where", "is", "are", "i", "want", "need",
    "please", "show", "navigate", "my", "near", "nearest", "of", "in", "at", "for", "get",
}
DEFAULT_MIN_SCORE = 0.6


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9 ]+", " ", s.lower()).strip()


def _tokens(s: str) -> list[str]:
    return [t for t in _norm(s).split() if t]


def _token_match(qt: str, ct: str) -> float:
    if qt == ct:
        return 1.0
    if any(c.isdigit() for c in qt) or any(c.isdigit() for c in ct):
        return 0.0  # room numbers must match exactly (101 is not 102)
    return SequenceMatcher(None, qt, ct).ratio()


def score_text(query: str, candidate: str) -> float:
    q, c = _norm(query), _norm(candidate)
    if not q or not c:
        return 0.0
    if q == c:
        return 1.0
    qtoks = [t for t in q.split() if t not in STOPWORDS] or q.split()
    ctoks = c.split()
    best = 0.0
    qj = " ".join(qtoks)
    if qj == c:
        return 1.0
    # query words appear as whole words in the candidate (e.g. "library" in "department library")
    if all(t in ctoks for t in qtoks):
        best = max(best, 0.9 + 0.1 * len(qj) / max(len(c), 1))
    # per-token fuzzy
    per = [max(_token_match(qt, ct) for ct in ctoks) for qt in qtoks]
    best = max(best, (sum(per) / len(per)) * 0.97)
    best = max(best, SequenceMatcher(None, qj, c).ratio())
    return min(best, 1.0)


def node_score(query: str, node: Node) -> float:
    cands = [node.label, *node.aliases]
    return max(score_text(query, c) for c in cands)


@dataclass(frozen=True)
class SearchResult:
    node_id: str
    code: str
    label: str
    kind: str
    floor_level: int
    floor_name: str
    score: float


def search_destinations(
    m: MapData,
    query: str,
    floor_level: int | None = None,
    limit: int = 10,
    min_score: float = DEFAULT_MIN_SCORE,
) -> list[SearchResult]:
    out: list[SearchResult] = []
    for n in m.nodes.values():
        if not n.searchable:
            continue
        if floor_level is not None and n.floor_level != floor_level:
            continue
        s = node_score(query, n)
        if s >= min_score:
            out.append(SearchResult(n.id, n.code, n.label, n.kind, n.floor_level, n.floor_name, round(s, 3)))
    out.sort(key=lambda r: (-r.score, r.floor_level, r.label, r.code))
    return out[:limit]


def best_match(m: MapData, query: str, min_score: float = DEFAULT_MIN_SCORE) -> SearchResult | None:
    res = search_destinations(m, query, limit=1, min_score=min_score)
    return res[0] if res else None
