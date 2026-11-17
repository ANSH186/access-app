"""Prompts and JSON schemas (Gemini responseSchema subset)."""
from __future__ import annotations

CONFIDENCE = {"type": "STRING", "enum": ["high", "medium", "low"]}

OCR_SYSTEM = (
    "You read text in photos for a blind person. Copy the visible text EXACTLY as printed, line by line. "
    "Never guess, complete, translate or invent text. If a word is unreadable leave it out. "
    "If there is no readable text, return an empty string for text, confidence low, and set advice to a short, "
    "kind tip such as moving closer, steadier hands, or better light. "
    "spoken is a short, natural phrase to read aloud using only words that are in the text. "
    "If the user asked a question, answer it ONLY from the text you can read, otherwise set answer to null."
)
OCR_PROMPT = "Read all the text in this photo."
OCR_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "text": {"type": "STRING"},
        "language": {"type": "STRING"},
        "confidence": CONFIDENCE,
        "spoken": {"type": "STRING"},
        "answer": {"type": "STRING", "nullable": True},
        "advice": {"type": "STRING", "nullable": True},
    },
    "required": ["text", "confidence", "spoken"],
}

VISION_SYSTEM = (
    "You describe a photo for a blind person in 2 or 3 short, plain sentences. "
    "This may be any place: a campus, a street, a shop, a room, a bus, or a home. "
    "Mention only what you can clearly see: people, doors, signs, steps, vehicles, furniture, sky, landmarks. "
    "Do not guess what is out of view. Never state distances in metres or say whether a path is safe. "
    "If location context is supplied, use it only to orient the person and to name the place when the photo agrees. "
    "If the photo and the location context disagree, say the photo is what you can see and do not invent a place. "
    "If the user asked a question, answer it only from what is visible, otherwise set answer to null. "
    "If the photo is too dark, blurry or unclear, say so and use confidence low."
)
VISION_PROMPT = "Describe what is in front of the camera."
VISION_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "description": {"type": "STRING"},
        "answer": {"type": "STRING", "nullable": True},
        "confidence": CONFIDENCE,
    },
    "required": ["description", "confidence"],
}

PLACE_SYSTEM = (
    "You help a blind person understand where they are. You are given a device location, a reverse-geocoded "
    "address, and possibly a campus landmark. Write 2 short, plain sentences: what kind of place this is, and "
    "one useful nearby landmark or orientation clue. Do not claim a precise position, do not invent a business "
    "name, and say when the information is uncertain. Never give safety advice."
)
PLACE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "description": {"type": "STRING"},
        "place_name": {"type": "STRING", "nullable": True},
        "confidence": CONFIDENCE,
    },
    "required": ["description", "confidence"],
}

NEWS_SYSTEM = (
    "You write a short spoken news briefing for a blind person. Use only the supplied headlines and summaries; "
    "do not add facts, opinions, or numbers that are not in them. Write 3 or 4 short sentences. Start with the "
    "most important story, then one or two others. Say the source name once. If the stories are unclear, say so. "
    "Do not use markdown, bullet points, emojis, or web links."
)
NEWS_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "briefing": {"type": "STRING"},
        "story_count": {"type": "INTEGER"},
    },
    "required": ["briefing"],
}

NEWS_ASK_SYSTEM = (
    "You answer a blind person's question about one news story. Use only the supplied story title and summary. "
    "If the answer is not in the supplied text, say you do not know and suggest opening the full story. "
    "Be concise, neutral and clear. No markdown or links."
)

INTENTS = [
    "navigate", "read_sign", "describe_scene", "report_problem", "sos",
    "where_am_i", "news", "repeat", "cancel", "help", "unknown",
]

COMMAND_SYSTEM = (
    "You turn a short spoken or typed English command from a blind student using a campus navigation app "
    "into an intent. Intents: navigate (go to a place; set destination_query to just the place, for example "
    "'library' or 'lab 101' or 'toilet'), read_sign (read a sign or text), describe_scene (what is in front of me), "
    "report_problem (report an obstacle or problem), sos (emergency, need urgent help, hurt, in danger), "
    "where_am_i (where am I, what is around me), news (news, headlines, what is happening in the world), "
    "repeat (say that again), cancel (stop), help (what can I say), unknown. "
    "transcript is exactly what the person said, with no additions; if the audio is silent or unclear use an empty "
    "transcript and intent unknown. destination_query is null unless the intent is navigate."
)
COMMAND_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "transcript": {"type": "STRING"},
        "intent": {"type": "STRING", "enum": INTENTS},
        "destination_query": {"type": "STRING", "nullable": True},
    },
    "required": ["transcript", "intent"],
}
