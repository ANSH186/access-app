from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from ..ai.gemini import GeminiClient
from ..auth import AuthUser, current_user
from ..deps import ai_user, get_gemini
from ..news import ask_about_story, get_briefing, get_news

router = APIRouter(prefix="/v1/news")


@router.get("")
async def news_list(
    limit: int = Query(14, ge=1, le=30),
    category: str | None = None,
    user: AuthUser = Depends(current_user),
) -> dict:
    items = await get_news(limit=limit, category=category)
    return {
        "items": [i.as_dict() for i in items],
        "count": len(items),
        "categories": sorted({i.category for i in await get_news(limit=30)}),
    }


@router.get("/briefing")
async def news_briefing(
    limit: int = Query(8, ge=3, le=12),
    user: AuthUser = Depends(ai_user),
    gemini: GeminiClient = Depends(get_gemini),
) -> dict:
    briefing, items = await get_briefing(gemini, limit=limit)
    return {
        "briefing": briefing,
        "items": [i.as_dict() for i in items],
    }


@router.post("/ask")
async def news_ask(
    body: dict,
    user: AuthUser = Depends(ai_user),
    gemini: GeminiClient = Depends(get_gemini),
) -> dict:
    title = str(body.get("title") or "")
    summary = str(body.get("summary") or "")
    question = str(body.get("question") or "")
    answer = await ask_about_story(gemini, title, summary, question)
    if not answer:
        answer = "I could not get an explanation just now. I can still read the summary aloud."
    return {"answer": answer}
