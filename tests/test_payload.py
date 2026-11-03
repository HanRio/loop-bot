import pytest

from loopbot.payload import extract_youtube_urls, youtube_video_id

def test_extract_youtube_urls_from_mixed_text():
    text = "이거 https://youtu.be/a 랑\nhttps://youtu.be/b https://youtu.be/a 들어봐"
    assert extract_youtube_urls(text) == ["https://youtu.be/a", "https://youtu.be/b"]

def test_extract_youtube_urls_splits_glued_links_and_drops_other_hosts():
    text = "https://youtu.be/a,https://evil.com/x,https://youtu.be/b\nhttps://youtu.be/chttps://youtu.be/d"
    assert extract_youtube_urls(text) == ["https://youtu.be/a", "https://youtu.be/b",
                                          "https://youtu.be/c", "https://youtu.be/d"]

@pytest.mark.parametrize("text,expected", [
    ("노래:https://youtu.be/abc123들어봐", ["https://youtu.be/abc123"]),
    ("(https://youtu.be/abc123) 그리고", ["https://youtu.be/abc123"]),
    ("<https://www.youtube.com/watch?v=def456&t=3>.", ["https://www.youtube.com/watch?v=def456&t=3"]),
    ("들어봐 https://youtu.be/abc123! 진짜.", ["https://youtu.be/abc123"]),
    ("youtu.be/abc123 www.youtube.com/watch?v=d4", ["https://youtu.be/abc123", "https://www.youtube.com/watch?v=d4"]),
    ("노래youtu.be/abc123", ["https://youtu.be/abc123"]),
    ("https://youtu.be/a youtu.be/a", ["https://youtu.be/a"]),
    ("https://youtube.com/watch?v=a-b_c&list=x%20y", ["https://youtube.com/watch?v=a-b_c&list=x%20y"]),
])
def test_extract_youtube_urls_cuts_surrounding_text(text, expected):
    assert extract_youtube_urls(text) == expected

@pytest.mark.parametrize("text", [
    "https://evil.com/youtube.com/x", "https://youtube.com.evil.com/x", "notyoutube.com/x",
    "evil.youtu.be/x", "ftp://youtu.be/abc", "youtube.com", "그냥 글",
])
def test_extract_youtube_urls_ignores_lookalikes(text):
    assert extract_youtube_urls(text) == []

@pytest.mark.parametrize("url,expected", [
    ("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3", "dQw4w9WgXcQ"),
    ("https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=PLx", "dQw4w9WgXcQ"),
    ("https://m.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://youtu.be/dQw4w9WgXcQ?si=abc", "dQw4w9WgXcQ"),
    ("https://youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://www.youtube.com/live/dQw4w9WgXcQ?feature=share", "dQw4w9WgXcQ"),
    ("https://youtu.be/short", None),
    ("https://www.youtube.com/playlist?list=PLx", None),
    ("https://evil.com/watch?v=dQw4w9WgXcQ", None),
    ("ftp://youtu.be/dQw4w9WgXcQ", None),
    ("not a url", None),
])
def test_youtube_video_id(url, expected):
    assert youtube_video_id(url) == expected
