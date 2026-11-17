from __future__ import annotations

from app.news import clean_text, parse_feed


RSS = """<?xml version="1.0"?>
<rss version="2.0"><channel>
<item>
  <title><![CDATA[Test story &amp; one]]></title>
  <description><![CDATA[<p>A <b>short</b> summary.</p>]]></description>
  <link>https://example.com/story</link>
  <pubDate>Mon, 17 Nov 2026 10:00:00 GMT</pubDate>
</item>
<item>
  <title>Second story</title>
  <description>Second summary</description>
  <guid>https://example.com/second</guid>
</item>
</channel></rss>
"""


def test_parse_feed_cleans_html_and_dates():
    items = parse_feed(RSS, "Test", "World")
    assert len(items) == 2
    assert items[0].title == "Test story & one"
    assert items[0].summary == "A short summary."
    assert items[0].link == "https://example.com/story"
    assert items[0].published_iso and items[0].published_iso.startswith("2026-11-17")
    assert items[1].link == "https://example.com/second"


def test_clean_text_truncates_without_cutting_a_word():
    text = clean_text("one two three four five six seven eight nine ten", limit=20)
    assert text.endswith("…")
    assert len(text) <= 21
