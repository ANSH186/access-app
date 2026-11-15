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
    "You describe a photo for a blind person in 2 or 3 short, plain sentences. Mention only what you can clearly "
    "see: people, doors, signs, obstacles, steps, furniture. Do not guess what is out of view. "
    "Never state distances in metres or say whether a path is safe. "
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

INTENTS = [
    "navigate", "read_sign", "describe_scene", "report_problem", "sos",
    "where_am_i", "repeat", "cancel", "help", "unknown",
]

COMMAND_SYSTEM = (
    "You turn a short spoken or typed English command from a blind student using a campus navigation app "
    "into an intent. Intents: navigate (go to a place; set destination_query to just the place, for example "
    "'library' or 'lab 101' or 'toilet'), read_sign (read a sign or text), describe_scene (what is in front of me), "
    "report_problem (report an obstacle or problem), sos (emergency, need urgent help, hurt, in danger), "
    "where_am_i, repeat (say that again), cancel (stop), help (what can I say), unknown. "
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
