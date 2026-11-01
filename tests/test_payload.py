import base64, json, pytest
from loopbot.db import Track
from loopbot.payload import (is_youtube_url, extract_youtube_urls, build_webapp_url,
                             parse_action, PayloadError, WebAppAction)

def test_is_youtube_url_variants():
    ok = ["https://youtu.be/abc?si=xyz", "https://www.youtube.com/watch?v=abc",
          "https://youtube.com/shorts/abc", "https://music.youtube.com/watch?v=abc",
          "http://m.youtube.com/watch?v=abc"]
    bad = ["youtube.com/watch?v=abc", "https://evil.com/youtube.com", "https://youtube.com.evil.com/x",
           "ftp://youtu.be/abc", "그냥 글"]
    assert all(is_youtube_url(u) for u in ok)
    assert not any(is_youtube_url(u) for u in bad)

def test_extract_youtube_urls_from_mixed_text():
    text = "이거 https://youtu.be/a 랑\nhttps://youtu.be/b https://youtu.be/a 들어봐"
    assert extract_youtube_urls(text) == ["https://youtu.be/a", "https://youtu.be/b"]

def test_build_webapp_url_roundtrips_korean_and_emoji():
    t = Track(7, 1, 0, "가" * 50 + "🎵", "f", None, None)
    url = build_webapp_url("https://x.io/app/", [t])
    enc = url.split("#d=", 1)[1]
    data = json.loads(base64.urlsafe_b64decode(enc + "=" * (-len(enc) % 4)).decode())
    assert url.startswith("https://x.io/app/#d=")
    assert data == [{"i": 7, "t": "가" * 40}]

def test_parse_action_full():
    raw = json.dumps({"v": 1, "order": [3, 1], "removed": [2], "add": ["https://youtu.be/a"], "play": True})
    assert parse_action(raw) == WebAppAction((3, 1), (2,), ("https://youtu.be/a",), True)

def test_parse_action_defaults():
    assert parse_action('{"v":1}') == WebAppAction((), (), (), False)

@pytest.mark.parametrize("raw", ["not json", "[]", '{"v":2}', '{"v":1,"order":["1"]}',
                                 '{"v":1,"order":[true]}', '{"v":1,"play":"yes"}'])
def test_parse_action_rejects_malformed(raw):
    with pytest.raises(PayloadError, match="버튼을 다시"):
        parse_action(raw)

@pytest.mark.parametrize("raw", ['{"v":1,"order":[-1]}', '{"v":1,"removed":[9223372036854775808]}',
                                 '{"v":1,"removed":[false]}', '{"v":true}'])
def test_parse_action_rejects_out_of_range_or_bool_ids(raw):
    with pytest.raises(PayloadError, match="버튼을 다시"):
        parse_action(raw)

def test_parse_action_rejects_too_many_links():
    raw = json.dumps({"v": 1, "add": [f"https://youtu.be/{i}" for i in range(11)]})
    with pytest.raises(PayloadError, match="10개"):
        parse_action(raw)

def test_parse_action_rejects_non_youtube_link():
    with pytest.raises(PayloadError, match="유튜브"):
        parse_action('{"v":1,"add":["https://evil.com"]}')

def _decode(url):
    enc = url.split("#d=", 1)[1]
    return json.loads(base64.urlsafe_b64decode(enc + "=" * (-len(enc) % 4)).decode())

def test_build_webapp_url_shrinks_titles_for_long_lists():
    from loopbot.payload import MAX_URL_LEN
    tracks = [Track(i, 1, i, "가" * 40, "f", None, None) for i in range(1, 101)]
    url = build_webapp_url("https://x.io/app/", tracks)
    assert len(url) <= MAX_URL_LEN
    assert [x["i"] for x in _decode(url)] == list(range(1, 101))
