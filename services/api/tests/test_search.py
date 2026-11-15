from __future__ import annotations

from app.navigation.search import best_match, search_destinations


def test_toilet_finds_washroom(mini):
    r = search_destinations(mini, "toilet")
    assert r and r[0].kind == "washroom" and r[0].score >= 0.9


def test_typo_finds_library(mini):
    r = search_destinations(mini, "librery")
    assert r[0].label == "Department Library"


def test_phrase_with_filler(mini):
    assert best_match(mini, "take me to the library").label == "Department Library"


def test_room_numbers_exact(mini):
    r = search_destinations(mini, "lab 101")
    assert r[0].label == "Lab 101"
    assert all(x.label != "Lab 102" or x.score < r[0].score for x in r)


def test_only_searchable(mini):
    labels = {x.label for x in search_destinations(mini, "corridor", min_score=0.0, limit=100)}
    assert not any("corridor" in l.lower() for l in labels)


def test_floor_filter_and_no_match(mini):
    assert search_destinations(mini, "library", floor_level=0) == []
    assert search_destinations(mini, "zzzzqx") == []
