"""General news: RSS aggregation plus an optional AI briefing.

The feed list is intentionally broad (India + world + technology) so a student
gets useful general updates, not only campus news. If Gemini is unavailable the
headlines still work; the briefing falls back to a plain spoken list.
"""
from __future__ import annotations

import asyncio
import html
import logging
import re
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any

import httpx

from .ai import prompts
from .ai.gemini import GeminiClient

log = logging.getLogger("aa.news")

FEEDS = [
    {
        "source": "The Hindu",
        "category": "India",
        "url": "https://www.thehindu.com/news/national/feeder/default.rss",
    },
    {
        "source": "The Hindu",
        "category": "World",
        "url": "https://www.thehindu.com/news/international/feeder/default.rss",
    },
    {
        "source": "The Hindu",
        "category": "Science",
        "url": "https://www.thehindu.com/sci-tech/feeder/default.rss",
    },
    {
        "source": "BBC",
        "category": "World",
        "url": "https://feeds.bbci.co.uk/news/world/rss.xml",
    },
    {
        "source": "BBC",
        "category": "India",
        "url": "https://feeds.bbci.co.uk/news/world/asia/india/rss.xml",
    },
    {
        "source": "NDTV",
        "category": "India",
        "url": "https://feeds.feedburner.com/ndtvnews-top-stories",
    },
    {
        "source": "Al Jazeera",
        "category": "World",
        "url": "https://www.aljazeera.com/xml/rss/all.xml",
    },
    {
        "source": "Indian Express",
        "category": "India",
        "url": "https://indianexpress.com/section/india/feed/",
    },
]

USER_AGENT = "AccessAbleAI/2.0 (news reader for an accessibility app)"
_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")


@dataclass
class NewsItem:
    title: str
    summary: str
    source: str
    category: str
    link: str
    published: str | None = None
    published_iso: str | None = None
    id: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "summary": self.summary,
            "source": self.source,
            "category": self.category,
            "link": self.link,
            "published": self.published,
            "published_iso": self.published_iso,
        }


@dataclass
class NewsCache:
    at: float = 0.0
    items: list[NewsItem] = field(default_factory=list)
    briefing: str = ""
    briefing_at: float = 0.0


_cache = NewsCache()


def clean_text(value: str | None, limit: int = 320) -> str:
    if not value:
        return ""
    text = html.unescape(value)
    text = _TAG_RE.sub(" ", text)
    text = _WS_RE.sub(" ", text).strip()
    if len(text) > limit:
        text = text[: limit - 1].rsplit(" ", 1)[0] + "…"
    return text


def _text(node: ET.Element, *names: str) -> str:
    for name in names:
        for child in node:
            tag = child.tag.split("}")[-1].lower()
            if tag == name.lower() and (child.text or "").strip():
                return (child.text or "").strip()
    return ""


def _parse_date(raw: str) -> tuple[str | None, str | None]:
    if not raw:
        return None, None
    try:
        dt = parsedate_to_datetime(raw)
    except (TypeError, ValueError):
        try:
            dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            return raw, None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%d %b %Y, %H:%M UTC"), dt.astimezone(timezone.utc).isoformat()


def parse_feed(xml_text: str, source: str, category: str) -> list[NewsItem]:
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return []
    items: list[NewsItem] = []
    for node in root.iter():
        tag = node.tag.split("}")[-1].lower()
        if tag not in ("item", "entry"):
            continue
        title = clean_text(_text(node, "title"), 200)
        if not title:
            continue
        summary = clean_text(
            _text(node, "description", "summary", "content", "encoded"), 360
        )
        link = _text(node, "link", "guid", "id")
        if not link:
            for child in node:
                if child.tag.split("}")[-1].lower() == "link" and child.attrib.get("href"):
                    link = child.attrib["href"]
                    break
        published, published_iso = _parse_date(_text(node, "pubDate", "published", "updated", "date"))
        items.append(
            NewsItem(
                title=title,
                summary=summary,
                source=source,
                category=category,
                link=link,
                published=published,
                published_iso=published_iso,
            )
        )
    return items


async def _fetch(client: httpx.AsyncClient, feed: dict[str, str]) -> list[NewsItem]:
    try:
        r = await client.get(feed["url"], headers={"User-Agent": USER_AGENT})
        if r.status_code != 200:
            return []
        return parse_feed(r.text, feed["source"], feed["category"])
    except httpx.HTTPError:
        return []


def _dedupe(items: list[NewsItem]) -> list[NewsItem]:
    seen: set[str] = set()
    out: list[NewsItem] = []
    for item in items:
        key = re.sub(r"[^a-z0-9 ]", "", item.title.lower())[:80]
        if key in seen:
            continue
        seen.add(key)
        item.id = f"{item.source[:12]}-{abs(hash(item.link or item.title)) & 0xFFFFFFFF:x}"
        out.append(item)
    return out


async def get_news(limit: int = 14, category: str | None = None) -> list[NewsItem]:
    now = time.monotonic()
    if not _cache.items or now - _cache.at > 300:
        async with httpx.AsyncClient(timeout=12, follow_redirects=True) as client:
            groups = await asyncio.gather(*(_fetch(client, f) for f in FEEDS))
        # Take the newest few from each feed so one very active feed cannot
        # crowd every other source out of the briefing.
        picked: list[NewsItem] = []
        for group in groups:
            group.sort(key=lambda i: i.published_iso or "", reverse=True)
            picked.extend(group[:10])
        items = _dedupe(picked)

        # Round-robin by source so the top of the list is a genuine mix.
        by_source: dict[str, list[NewsItem]] = {}
        for item in items:
            by_source.setdefault(item.source, []).append(item)
        for group in by_source.values():
            group.sort(key=lambda i: i.published_iso or "", reverse=True)
        mixed: list[NewsItem] = []
        while len(mixed) < len(items):
            added = False
            for source in list(by_source.keys()):
                group = by_source[source]
                if group:
                    mixed.append(group.pop(0))
                    added = True
            if not added:
                break
        _cache.items = mixed[:80]
        _cache.at = now
    items = _cache.items
    if category and category.lower() not in ("all", "general", "top"):
        items = [i for i in items if i.category.lower() == category.lower()]
    return items[: max(1, min(limit, 30))]


async def get_briefing(gemini: GeminiClient, limit: int = 8) -> tuple[str, list[NewsItem]]:
    items = await get_news(limit=limit)
    if not items:
        return "", []
    now = time.monotonic()
    if _cache.briefing and now - _cache.briefing_at < 300:
        return _cache.briefing, items
    digest = "\n".join(
        f"- [{i.source} / {i.category}] {i.title}. {i.summary}" for i in items[:limit]
    )
    try:
        out = await gemini.generate_json(
            [{"text": "Write the spoken briefing from these headlines:\n" + digest}],
            prompts.NEWS_SCHEMA,
            prompts.NEWS_SYSTEM,
            temperature=0.2,
        )
        briefing = clean_text(out.get("briefing"), 900)
    except Exception:  # noqa: BLE001
        briefing = ""
    if not briefing:
        # Honest fallback: read the headlines. Never invent a bridge.
        picks = items[:4]
        briefing = "Here are the top headlines. " + ". ".join(
            f"From {i.source}: {i.title}" for i in picks
        ) + "."
    _cache.briefing = briefing
    _cache.briefing_at = now
    return briefing, items


async def ask_about_story(
    gemini: GeminiClient, title: str, summary: str, question: str
) -> str:
    q = clean_text(question, 300)
    if not q:
        return "Please ask a question about the story."
    try:
        return await gemini.generate_text(
            [
                {
                    "text": (
                        f"Story title: {clean_text(title, 250)}\n"
                        f"Story summary: {clean_text(summary, 600)}\n"
                        f"Question: {q}"
                    )
                }
            ],
            prompts.NEWS_ASK_SYSTEM,
            temperature=0.2,
        )
    except Exception:  # noqa: BLE001
        return ""
