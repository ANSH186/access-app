from __future__ import annotations

import pathlib

from app.navigation.graph import load_map_from_file
from app.routers.ai import classify_text

FIX = pathlib.Path(__file__).parent / "fixtures" / "mini_ring_map.json"


def test_classify_navigation_strips_article():
    m = load_map_from_file(FIX)
    assert classify_text("take me to the library", m) == ("navigate", "library")
    assert classify_text("go to the toilet", m) == ("navigate", "toilet")


def test_classify_common_intents():
    m = load_map_from_file(FIX)
    assert classify_text("read this sign", m) == ("read_sign", None)
    assert classify_text("what is in front of me", m) == ("describe_scene", None)
    assert classify_text("where am i", m) == ("where_am_i", None)
    assert classify_text("news", m) == ("news", None)
    assert classify_text("emergency", m) == ("sos", None)
    assert classify_text("help", m) == ("help", None)


def test_classify_bare_destination_only_when_on_map():
    m = load_map_from_file(FIX)
    assert classify_text("library", m) == ("navigate", "library")
    assert classify_text("zzyzx", m) is None
