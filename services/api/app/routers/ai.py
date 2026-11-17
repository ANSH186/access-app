from __future__ import annotations

import asyncio
import io
import logging
import re

from fastapi import APIRouter, Depends, Form, Request, UploadFile
from fastapi import File as FormFile
from PIL import Image

from ..ai import prompts
from ..ai.gemini import GeminiClient, inline_part, text_part
from ..ai.ocrspace import read_text as ocr_space_read_text
from ..auth import AuthUser
from ..deps import ai_user, get_gemini, get_map_data, get_map_data_optional
from ..errors import AppError
from ..geocode import reverse_geocode
from ..navigation.graph import MapData
from ..navigation.search import best_match

log = logging.getLogger("aa.ai")
router = APIRouter(prefix="/v1")

CAUTION = "I can't judge distances or confirm the path is safe."
OCR_DEFAULT_ADVICE = "I could not read any text. Hold the phone closer, keep it steady, and try again."
OCR_LOW_ADVICE = "The text is hard to read. Hold the phone closer, keep it steady, and try again."
OCR_PLAIN_PROMPT = (
    "Read all the text in this photo exactly as printed, line by line. Do not translate, guess, "
    "or add anything. If there is no readable text, reply with exactly NO_TEXT."
)
OCR_PLAIN_SYSTEM = (
    "You are a careful sign and document reader for a blind person. Copy the visible text exactly, "
    "preserve line breaks, and never invent words. Reply with the text only."
)
CONF = {"high", "medium", "low"}

IMAGE_TYPES = {"image/jpeg": "image/jpeg", "image/jpg": "image/jpeg", "image/png": "image/png"}
IMAGE_EXT = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png"}
AUDIO_TYPES = {
    "audio/mp4": "audio/mp4", "audio/m4a": "audio/mp4", "audio/x-m4a": "audio/mp4", "audio/mpeg4-generic": "audio/mp4",
    "audio/aac": "audio/aac", "audio/x-aac": "audio/aac",
    "audio/wav": "audio/wav", "audio/x-wav": "audio/wav", "audio/wave": "audio/wav", "audio/vnd.wave": "audio/wav",
    "audio/webm": "audio/webm", "video/webm": "audio/webm",
}
AUDIO_EXT = {".m4a": "audio/mp4", ".mp4": "audio/mp4", ".aac": "audio/aac", ".wav": "audio/wav", ".webm": "audio/webm"}

SOS_RE = re.compile(
    r"\b(emergency|sos|ambulance|i need help|help me|i am hurt|i'?m hurt|i have fallen|i fell|i am in danger|i'?m in danger)\b", re.I
)

NAV_RE = re.compile(
    r"\b(?:take me to|navigate to|go to|walk me to|directions to|find|where is|where'?s)\s+(.+)$", re.I
)
READ_RE = re.compile(r"\b(read (this |the )?sign|read a sign|read text|read this|what does this say)\b", re.I)
DESCRIBE_RE = re.compile(
    r"\b(describe (the )?scene|describe what is in front of me|what is in front of me|what'?s in front of me|what do you see|describe this)\b",
    re.I,
)
WHERE_RE = re.compile(r"\b(where am i|where am i now|my location|what is around me|what'?s around me)\b", re.I)
NEWS_RE = re.compile(r"\b(news|headlines|brief me|latest news|what is happening|what'?s happening|current affairs)\b", re.I)
REPORT_RE = re.compile(r"\b(report a problem|report an issue|report a blocked|report a broken|report problem)\b", re.I)
REPEAT_RE = re.compile(r"\b(repeat|say that again|say it again)\b", re.I)
CANCEL_RE = re.compile(r"\b(cancel|stop|stop navigation|never mind)\b", re.I)
HELP_RE = re.compile(r"\b(help|what can i say|what can i do|voice commands)\b", re.I)


def classify_text(text: str, m: MapData | None = None) -> tuple[str, str | None] | None:
    """Fast, deterministic command classifier.

    Common commands never depend on the AI being healthy. Gemini is only the
    fallback for unusual phrasing (and for audio transcription).
    """
    t = text.strip()
    if not t:
        return None
    if SOS_RE.search(t):
        return ("sos", None)
    if READ_RE.search(t):
        return ("read_sign", None)
    if DESCRIBE_RE.search(t):
        return ("describe_scene", None)
    if WHERE_RE.search(t):
        return ("where_am_i", None)
    if NEWS_RE.search(t):
        return ("news", None)
    if REPORT_RE.search(t):
        return ("report_problem", None)
    if REPEAT_RE.search(t):
        return ("repeat", None)
    if CANCEL_RE.search(t):
        return ("cancel", None)
    if HELP_RE.search(t):
        return ("help", None)
    nav = NAV_RE.search(t)
    if nav:
        query = nav.group(1).strip().rstrip(".!?")
        query = re.sub(r"^(?:the|a|an)\s+", "", query, flags=re.I).strip()
        return ("navigate", query or None)
    # A bare place name is navigation if it is on the map.
    if m is not None and len(t.split()) <= 5 and best_match(m, t):
        return ("navigate", t)
    return None

REPLIES = {
    "sos": "Opening emergency help. Confirm on the screen to send an alert.",
    "read_sign": "Opening the sign reader.",
    "describe_scene": "Opening the camera to describe what is in front of you.",
    "report_problem": "Opening the report form.",
    "where_am_i": "Checking where you are.",
    "news": "Opening your news briefing.",
    "repeat": "Repeating the last instruction.",
    "cancel": "Okay, cancelled.",
    "help": "You can say: take me to the library, read this sign, what is in front of me, where am I, news, report a problem, or emergency.",
    "unknown": "Sorry, I did not catch that. Please try again.",
}


def _resolve_mime(f: UploadFile, by_type: dict[str, str], by_ext: dict[str, str]) -> str | None:
    ct = (f.content_type or "").split(";")[0].strip().lower()
    if ct in by_type:
        return by_type[ct]
    if ct in ("", "application/octet-stream"):
        name = (f.filename or "").lower()
        for ext, mime in by_ext.items():
            if name.endswith(ext):
                return mime
    return None


async def _read_limited(f: UploadFile, limit: int, too_big: str) -> bytes:
    data = await f.read(limit + 1)
    if len(data) > limit:
        raise AppError(413, "file_too_large", too_big)
    if not data:
        raise AppError(400, "empty_file", "The file was empty. Please try again.")
    return data


async def _image(f: UploadFile, request: Request) -> tuple[bytes, str]:
    mime = _resolve_mime(f, IMAGE_TYPES, IMAGE_EXT)
    if mime is None:
        raise AppError(415, "unsupported_media_type", "That picture type is not supported. Please use a JPEG or PNG picture.")
    limit = request.app.state.settings.max_image_bytes
    data = await _read_limited(f, limit, "That picture is too large. Please take a smaller picture, up to 5 megabytes.")
    return data, mime


def _clean(s) -> str:
    return s.strip() if isinstance(s, str) else ""


def _conf(v) -> str:
    return v if v in CONF else "low"


async def _ocr_with_fallback(
    data: bytes,
    mime: str,
    prompt: str,
    gemini: GeminiClient,
    settings,
    has_question: bool,
) -> tuple[dict, AppError | None]:
    """Prefer Gemini, but race two flash-lite models and OCR.space.

    For plain sign reading, the first non-empty answer wins. For a follow-up
    question, Gemini may answer from the text, so the Gemini models get the
    first chance; the backup reader is used only if they fail.
    """
    models = [m for m in gemini.models[: max(1, settings.gemini_ocr_race_models)] if m] or [gemini.model]
    clients = [
        GeminiClient(
            gemini.api_key,
            m,
            gemini.base_url,
            gemini.timeout_s,
            gemini.retry_delay_s,
        )
        for m in models
    ]
    gem_tasks = [
        asyncio.create_task(
            c.generate_json(
                [text_part(prompt), inline_part(data, mime)],
                prompts.OCR_SCHEMA,
                prompts.OCR_SYSTEM,
                max_output_tokens=900,
            )
        )
        for c in clients
    ]
    ocr_task = None if has_question else asyncio.create_task(
        ocr_space_read_text(
            data,
            mime,
            settings.ocr_space_api_key,
            settings.ocr_space_timeout_s,
        )
    )

    gem_error: AppError | None = None
    if has_question or not settings.ocr_space_api_key:
        for task in gem_tasks:
            try:
                out = await task
                if out.get("text"):
                    return out, None
            except AppError as exc:
                gem_error = exc
            except Exception:  # noqa: BLE001
                gem_error = AppError(502, "ai_unavailable", "The AI service had a problem. Please try again.")
        if settings.ocr_space_api_key:
            text = await ocr_space_read_text(
                data, mime, settings.ocr_space_api_key, settings.ocr_space_timeout_s
            )
            if text:
                return {"text": text, "confidence": "medium", "spoken": text[:300]}, None
        # The JSON schema path can be rejected by a model as an invalid
        # argument. A plain-text request is a much simpler body and often works.
        if gem_error is not None and gem_error.code == "ai_unavailable":
            for c in clients:
                try:
                    plain = await c.generate_text(
                        [text_part(OCR_PLAIN_PROMPT), inline_part(data, mime)],
                        OCR_PLAIN_SYSTEM,
                        max_output_tokens=900,
                    )
                except Exception:  # noqa: BLE001
                    plain = ""
                if plain and plain.strip() and "NO_TEXT" not in plain:
                    return {"text": plain.strip(), "confidence": "medium", "spoken": plain.strip()[:300]}, None
        return {}, gem_error

    pending: set[asyncio.Task] = set(gem_tasks)
    if ocr_task is not None:
        pending.add(ocr_task)
    while pending:
        done, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED, timeout=20)
        if not done:
            break
        for task in done:
            if task is ocr_task:
                text = task.result()
                if text:
                    for p in pending:
                        p.cancel()
                    return {"text": text, "confidence": "medium", "spoken": text[:300]}, None
                continue
            try:
                out = task.result()
            except AppError as exc:
                gem_error = exc
                out = {}
            except Exception:  # noqa: BLE001
                gem_error = AppError(502, "ai_unavailable", "The AI service had a problem. Please try again.")
                out = {}
            if out.get("text"):
                for p in pending:
                    p.cancel()
                return out, None
    for p in pending:
        p.cancel()
    if gem_error is not None and gem_error.code == "ai_unavailable":
        for c in clients:
            try:
                plain = await c.generate_text(
                    [text_part(OCR_PLAIN_PROMPT), inline_part(data, mime)],
                    OCR_PLAIN_SYSTEM,
                    max_output_tokens=900,
                )
            except Exception:  # noqa: BLE001
                plain = ""
            if plain and plain.strip() and "NO_TEXT" not in plain:
                return {"text": plain.strip(), "confidence": "medium", "spoken": plain.strip()[:300]}, None
    return {}, gem_error


def _local_answer(text: str, question: str) -> str:
    """Tiny offline answerer used when the AI is unavailable."""
    q = re.sub(r"[^a-z0-9 ]+", " ", question.lower()).split()
    q = [w for w in q if len(w) > 2 and w not in {"the", "what", "where", "when", "who", "how", "why", "does", "this", "that", "from", "with", "about"}]
    if not text.strip():
        return "There is no text to search."
    lines = [ln.strip() for ln in re.split(r"[\n\r]+", text) if ln.strip()]
    if not lines:
        return "There is no text to search."
    scored = []
    for line in lines:
        low = line.lower()
        score = sum(1 for w in q if w in low)
        if score:
            scored.append((score, line))
    scored.sort(key=lambda x: (-x[0], len(x[1])))
    if not scored:
        return "I could not find that in the text."
    best = [ln for _, ln in scored[:2]]
    return "I found this in the text: " + " ".join(best)


async def answer_from_text(gemini: GeminiClient, text: str, question: str) -> str:
    q = _clean(question)
    if not q:
        return "Please ask a question about the text."
    body_text = text[:12000]
    try:
        answer = await gemini.generate_text(
            [{"text": f"Text:\n{body_text}\n\nQuestion: {q}"}],
            prompts.TEXT_ANSWER_SYSTEM,
            temperature=0.1,
            max_output_tokens=300,
        )
        if answer.strip():
            return answer.strip()
    except Exception:  # noqa: BLE001
        pass
    return _local_answer(text, q)


async def _document_half_text(data: bytes, fast: GeminiClient, settings) -> str:
    """Read one image half with Gemini plain text, then OCR.space as backup."""
    try:
        text = await fast.generate_text(
            [text_part(prompts.DOCUMENT_OCR_PROMPT), inline_part(data, "image/jpeg")],
            prompts.DOCUMENT_OCR_SYSTEM,
            max_output_tokens=900,
        )
        if text.strip() and "NO_TEXT" not in text:
            return text.strip()
    except Exception:  # noqa: BLE001
        pass
    fallback = await ocr_space_read_text(data, "image/jpeg", settings.ocr_space_api_key, settings.ocr_space_timeout_s)
    return (fallback or "").strip()


@router.post("/ocr/read_document")
async def ocr_read_document(
    request: Request,
    image: UploadFile = FormFile(...),
    user: AuthUser = Depends(ai_user),
    gemini: GeminiClient = Depends(get_gemini),
) -> dict:
    """Read a full notebook or book page, including lines near the edges.

    Tall pages are split into two overlapping halves and read in parallel. The
    app can add one page at a time and keep the text for the whole book.
    """
    data, _ = await _image(image, request)
    try:
        img = Image.open(io.BytesIO(data)).convert("RGB")
    except Exception:  # noqa: BLE001
        raise AppError(400, "invalid_image", "That picture could not be opened. Please take it again.")
    w, h = img.size
    parts: list[bytes] = []
    if h >= 900:
        top = img.crop((0, 0, w, int(h * 0.58)))
        bottom = img.crop((0, int(h * 0.42), w, h))
        for part in (top, bottom):
            buf = io.BytesIO()
            part.save(buf, format="JPEG", quality=78)
            parts.append(buf.getvalue())
    else:
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=80)
        parts.append(buf.getvalue())

    fast = GeminiClient(
        gemini.api_key,
        gemini.models[0] if gemini.models else gemini.model,
        gemini.base_url,
        min(gemini.timeout_s, 18.0),
        gemini.retry_delay_s,
        fallback_models=gemini.models[1:],
    )
    texts = await asyncio.gather(
        *(_document_half_text(part, fast, request.app.state.settings) for part in parts),
        return_exceptions=True,
    )
    cleaned: list[str] = []
    for t in texts:
        if isinstance(t, str) and t.strip():
            cleaned.append(t.strip())
    if len(cleaned) == 2:
        # Remove the duplicated lines at the overlap between the two halves.
        top_lines = cleaned[0].splitlines()
        bottom_lines = cleaned[1].splitlines()
        max_k = min(12, len(top_lines), len(bottom_lines))
        for k in range(max_k, 0, -1):
            if [ln.strip() for ln in top_lines[-k:]] == [ln.strip() for ln in bottom_lines[:k]]:
                bottom_lines = bottom_lines[k:]
                break
        cleaned = ["\n".join(top_lines), "\n".join(bottom_lines)]
    text = "\n".join(x for x in cleaned if x.strip()).strip()
    if not text:
        raise AppError(502, "ai_unavailable", "I could not read this page. Hold the phone steady and try again.")
    lines = [ln for ln in text.splitlines() if ln.strip()]
    log.info("document_ocr", extra={"user": user.id, "lines": len(lines), "parts": len(parts)})
    return {
        "text": text,
        "lines": len(lines),
        "pages": len(parts),
        "confidence": "medium",
    }


@router.post("/ocr/answer")
async def ocr_answer(
    text: str = Form(...),
    question: str = Form(...),
    user: AuthUser = Depends(ai_user),
    gemini: GeminiClient = Depends(get_gemini),
) -> dict:
    answer = await answer_from_text(gemini, text, question)
    return {"answer": answer}


async def _race_gemini_json(
    gemini: GeminiClient,
    parts: list[dict],
    schema: dict,
    system: str,
    max_output_tokens: int,
    models_count: int = 2,
) -> dict:
    """Race the first flash-lite models and return the first usable JSON."""
    models = [m for m in gemini.models[: max(1, models_count)] if m] or [gemini.model]
    clients = [
        GeminiClient(gemini.api_key, m, gemini.base_url, gemini.timeout_s, gemini.retry_delay_s)
        for m in models
    ]
    tasks = {
        asyncio.create_task(
            c.generate_json(parts, schema, system, max_output_tokens=max_output_tokens)
        ): c
        for c in clients
    }
    last_error: AppError | None = None
    pending = set(tasks)
    while pending:
        done, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED, timeout=25)
        if not done:
            break
        for task in done:
            try:
                out = task.result()
            except AppError as exc:
                last_error = exc
                out = {}
            except Exception:  # noqa: BLE001
                last_error = AppError(502, "ai_unavailable", "The AI service had a problem. Please try again.")
                out = {}
            if out:
                for p in pending:
                    p.cancel()
                return out
    for p in pending:
        p.cancel()
    if last_error is not None:
        raise last_error
    return {}


@router.post("/ocr/read")
async def ocr_read(
    request: Request,
    image: UploadFile = FormFile(...),
    question: str | None = Form(None),
    user: AuthUser = Depends(ai_user),
    gemini: GeminiClient = Depends(get_gemini),
) -> dict:
    data, mime = await _image(image, request)
    q = _clean(question)
    prompt = prompts.OCR_PROMPT + (f"\nThe user asks: {q}" if q else "")
    fast = GeminiClient(
        gemini.api_key,
        gemini.models[0] if gemini.models else gemini.model,
        gemini.base_url,
        min(gemini.timeout_s, 18.0),
        gemini.retry_delay_s,
        fallback_models=gemini.models[1:],
    )
    out, gemini_error = await _ocr_with_fallback(
        data, mime, prompt, fast, request.app.state.settings, bool(q)
    )

    text = _clean(out.get("text"))
    confidence = _conf(out.get("confidence"))
    advice = _clean(out.get("advice")) or None
    answer = _clean(out.get("answer")) or None
    spoken = _clean(out.get("spoken"))

    if not text and gemini_error is not None:
        # No backup reader available: keep the original, specific error
        # instead of pretending the image was merely unreadable.
        raise gemini_error

    if text and q and not answer:
        # The structured OCR path can return text without an answer (for
        # example when OCR.space won the race). Answer from the text we have.
        answer = await answer_from_text(fast, text, q)

    if not text:
        confidence, answer = "low", None
        advice = advice or OCR_DEFAULT_ADVICE
        spoken = advice
    else:
        if confidence == "low" and not advice:
            advice = OCR_LOW_ADVICE
        if not spoken:
            spoken = text if len(text) <= 300 else text[:300]
    log.info("ocr", extra={"user": user.id, "confidence": confidence, "chars": len(text)})
    return {
        "text": text,
        "language": _clean(out.get("language")) or "en",
        "confidence": confidence,
        "spoken": spoken,
        "answer": answer,
        "advice": advice,
    }


@router.post("/vision/describe")
async def vision_describe(
    request: Request,
    image: UploadFile = FormFile(...),
    question: str | None = Form(None),
    lat: float | None = Form(None),
    lng: float | None = Form(None),
    place: str | None = Form(None),
    mode: str | None = Form(None),
    user: AuthUser = Depends(ai_user),
    gemini: GeminiClient = Depends(get_gemini),
    m: MapData | None = Depends(get_map_data_optional),
) -> dict:
    data, mime = await _image(image, request)
    q = _clean(question)
    live = (mode or "").strip().lower() == "live"
    location_lines: list[str] = []
    supplied_place = _clean(place)
    if supplied_place:
        location_lines.append(f"the user says this is: {supplied_place}")
    if lat is not None and lng is not None:
        location_lines.append(f"device coordinates: {lat:.5f}, {lng:.5f}")
        try:
            ctx = await reverse_geocode(lat, lng)
            if ctx.display_name:
                location_lines.append(f"reverse-geocoded address: {ctx.display_name}")
        except Exception:  # noqa: BLE001
            pass
        if m is not None:
            hit = m.nearest_node(lat, lng, searchable_only=True, max_distance_m=800)
            if hit:
                node, distance = hit
                location_lines.append(
                    f"nearest mapped campus landmark: {node.label}, about {round(distance)} metres away"
                )

    location_text = ""
    if location_lines:
        location_text = (
            "\nLocation context (use only to orient the person; the photo is the source of truth):\n- "
            + "\n- ".join(location_lines)
        )
        location_text += "\nIf the photo does not match this location, describe what you actually see."
    base_prompt = prompts.VISION_LIVE_PROMPT if live else prompts.VISION_PROMPT
    system = prompts.VISION_LIVE_SYSTEM if live else prompts.VISION_SYSTEM
    prompt = base_prompt + location_text + (f"\nThe user asks: {q}" if q else "")
    out = await _race_gemini_json(
        gemini,
        [text_part(prompt), inline_part(data, mime)],
        prompts.VISION_LIVE_SCHEMA if live else prompts.VISION_SCHEMA,
        system,
        700 if live else 450,
        request.app.state.settings.gemini_vision_race_models,
    )
    description = _clean(out.get("description"))
    confidence = _conf(out.get("confidence"))
    answer = _clean(out.get("answer")) or None
    if not description:
        description = "I could not make out what is in front of the camera. Try again with better light."
        confidence, answer = "low", None
    log.info("vision", extra={"user": user.id, "confidence": confidence, "located": bool(lat is not None), "live": live})
    return {"description": description, "answer": answer, "confidence": confidence, "caution": CAUTION}


@router.post("/assistant/transcribe")
async def assistant_transcribe(
    request: Request,
    audio: UploadFile | None = FormFile(None),
    text: str | None = Form(None),
    user: AuthUser = Depends(ai_user),
    gemini: GeminiClient = Depends(get_gemini),
) -> dict:
    """Transcribe (or classify) without needing the map.

    Camera questions, report dictation and news questions only need text. This
    endpoint keeps working even if the campus map is unavailable.
    """
    typed = _clean(text)
    has_audio = audio is not None and bool(audio.filename or audio.content_type)
    if not has_audio and not typed:
        raise AppError(400, "missing_input", "Please say or type what you want to do.")
    if has_audio:
        mime = _resolve_mime(audio, AUDIO_TYPES, AUDIO_EXT)
        if mime is None:
            raise AppError(415, "unsupported_media_type", "That audio type is not supported. Please record again.")
        data = await _read_limited(
            audio, request.app.state.settings.max_audio_bytes, "That recording is too long. Please keep it short."
        )
        parts = [text_part("Transcribe this short spoken question or command."), inline_part(data, mime)]
    else:
        parts = [text_part(f"Classify this command: {typed}")]

    if not has_audio:
        local = classify_text(typed)
        if local is not None:
            intent, query = local
            return {"transcript": typed, "intent": intent, "destination_query": query}

    out = await gemini.generate_json(
            parts, prompts.COMMAND_SCHEMA, prompts.COMMAND_SYSTEM, max_output_tokens=300
        )
    transcript = _clean(out.get("transcript")) or ("" if has_audio else typed)
    intent = out.get("intent") if out.get("intent") in prompts.INTENTS else "unknown"
    if SOS_RE.search(transcript):
        intent = "sos"
    query = _clean(out.get("destination_query")) or None
    return {"transcript": transcript, "intent": intent, "destination_query": query}


@router.post("/assistant/command")
async def assistant_command(
    request: Request,
    audio: UploadFile | None = FormFile(None),
    text: str | None = Form(None),
    user: AuthUser = Depends(ai_user),
    gemini: GeminiClient = Depends(get_gemini),
    m: MapData = Depends(get_map_data),
) -> dict:
    typed = _clean(text)
    has_audio = audio is not None and bool(audio.filename or audio.content_type)
    if not has_audio and not typed:
        raise AppError(400, "missing_input", "Please say or type what you want to do.")

    if has_audio:
        mime = _resolve_mime(audio, AUDIO_TYPES, AUDIO_EXT)
        if mime is None:
            raise AppError(415, "unsupported_media_type", "That audio type is not supported. Please record again.")
        data = await _read_limited(
            audio, request.app.state.settings.max_audio_bytes, "That recording is too long. Please keep it short."
        )
        parts = [text_part("Transcribe and classify this spoken command."), inline_part(data, mime)]
        local_sos = False
        local_command = None
    else:
        parts = [text_part(f"Classify this command: {typed}")]
        local_sos = bool(SOS_RE.search(typed))  # safety net; never creates an alert
        local_command = classify_text(typed, m)

    if local_command is not None:
        intent, query = local_command
        out: dict = {"transcript": typed, "intent": intent, "destination_query": query}
    elif local_sos:
        out = {"transcript": typed, "intent": "sos", "destination_query": None}
    else:
        out = await gemini.generate_json(
            parts, prompts.COMMAND_SCHEMA, prompts.COMMAND_SYSTEM, max_output_tokens=300
        )

    transcript = _clean(out.get("transcript")) or ("" if has_audio else typed)
    intent = out.get("intent") if out.get("intent") in prompts.INTENTS else "unknown"
    if has_audio and intent != "sos" and SOS_RE.search(transcript):
        intent = "sos"
    query = _clean(out.get("destination_query")) or None
    if intent != "navigate":
        query = None

    destination = None
    if intent == "navigate":
        if not query:
            reply = "Where would you like to go? Say the room name."
        elif m is None:
            reply = f"Finding a route to {query}."
        else:
            hit = best_match(m, query)
            if hit:
                destination = {
                    "node_id": hit.node_id,
                    "label": hit.label,
                    "floor_level": hit.floor_level,
                    "floor_name": hit.floor_name,
                }
                reply = f"Finding a route to {_the(hit.label)}."
            else:
                reply = f"I couldn't find {query} on the map. Try saying the room name again."
    else:
        reply = REPLIES.get(intent, REPLIES["unknown"])
    log.info("command", extra={"user": user.id, "intent": intent, "found": destination is not None})
    return {
        "transcript": transcript,
        "intent": intent,
        "destination_query": query,
        "destination": destination,
        "reply": reply,
    }


def _the(label: str) -> str:
    return label if re.match(r"^(lab|room)\b", label, re.I) else f"the {label}"
