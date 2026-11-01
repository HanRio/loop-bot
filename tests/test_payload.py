import base64, json, pytest
from loopbot.store import Playlist, Track
from loopbot.payload import (is_youtube_url, extract_youtube_urls, build_webapp_url,
                             parse_action, PayloadError, WebAppAction, MAX_URL_LEN)

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

def test_extract_youtube_urls_splits_glued_links_and_drops_other_hosts():
    text = "https://youtu.be/a,https://evil.com/x,https://youtu.be/b\nhttps://youtu.be/chttps://youtu.be/d"
    assert extract_youtube_urls(text) == ["https://youtu.be/a", "https://youtu.be/b",
                                          "https://youtu.be/c", "https://youtu.be/d"]

def _decode(url):
    enc = url.split("#d=", 1)[1]
    return json.loads(base64.urlsafe_b64decode(enc + "=" * (-len(enc) % 4)).decode())

def _track(i, title):
    return Track(i, 1, title, "f", None, None)

def test_build_webapp_url_v2_shape_and_truncation():
    lib = [_track(7, "가" * 50 + "🎵"), _track(9, "B")]
    pls = [Playlist(1, 1, "기본", (9, 7)), Playlist(2, 1, "나" * 30, ())]
    url = build_webapp_url("https://x.io/app/", lib, pls, 2)
    assert url.startswith("https://x.io/app/#d=")
    assert _decode(url) == {"v": 2, "lib": [{"i": 7, "t": "가" * 40}, {"i": 9, "t": "B"}],
                            "pls": [{"i": 1, "n": "기본", "t": [9, 7]}, {"i": 2, "n": "나" * 20, "t": []}],
                            "a": 2}

@pytest.mark.parametrize("count,title_len", [(30, 20), (300, 0)])
def test_build_webapp_url_shrinks_titles_for_long_libraries(count, title_len):
    lib = [_track(i, "가" * 40) for i in range(1, count + 1)]
    url = build_webapp_url("https://x.io/app/", lib, [Playlist(1, 1, "기본", ())], 1)
    data = _decode(url)
    assert [x["i"] for x in data["lib"]] == list(range(1, count + 1))
    assert {len(x["t"]) for x in data["lib"]} == {title_len}
    assert count == 300 or len(url) <= MAX_URL_LEN

def _raw(**kw):
    return json.dumps({"v": 2, **kw})

def test_parse_action_full():
    raw = _raw(playlist=1, name="  출근길 ", tracks=[5, 3], delete_tracks=[2], delete_playlist=False,
               add=["https://youtu.be/a"], play=True)
    assert parse_action(raw) == WebAppAction(playlist=1, name="출근길", tracks=(5, 3), delete_tracks=(2,),
                                             delete_playlist=False, add=("https://youtu.be/a",), play=True)

def test_parse_action_defaults():
    assert parse_action('{"v":2}') == WebAppAction(None, "새 플레이리스트", (), (), False, (), False)

@pytest.mark.parametrize("name,expected", [("   ", "새 플레이리스트"), ("가" * 25, "가" * 20)])
def test_parse_action_normalizes_name(name, expected):
    assert parse_action(_raw(name=name)).name == expected

@pytest.mark.parametrize("raw", ["not json", "[]", '{"v":1}', '{"v":true}', '{"v":2,"tracks":["1"]}',
                                 '{"v":2,"tracks":[true]}', '{"v":2,"play":"yes"}', '{"v":2,"name":3}',
                                 '{"v":2,"playlist":"1"}', '{"v":2,"playlist":true}',
                                 '{"v":2,"delete_playlist":1}', '{"v":2,"delete_tracks":[-1]}',
                                 '{"v":2,"tracks":[9223372036854775808]}', '{"v":2,"add":"https://youtu.be/a"}'])
def test_parse_action_rejects_malformed(raw):
    with pytest.raises(PayloadError, match="버튼을 다시"):
        parse_action(raw)

def test_parse_action_rejects_too_many_links():
    with pytest.raises(PayloadError, match="10개"):
        parse_action(_raw(add=[f"https://youtu.be/{i}" for i in range(11)]))

def test_parse_action_drops_non_youtube_lines_and_splits_glued_links():
    add = ["https://evil.com", "https://youtu.be/a,https://youtu.be/b", "memo", "https://youtu.be/a"]
    assert parse_action(_raw(add=add)).add == ("https://youtu.be/a", "https://youtu.be/b")

def test_parse_action_caps_links_after_extraction():
    with pytest.raises(PayloadError, match="10개"):
        parse_action(_raw(add=[",".join(f"https://youtu.be/{i}" for i in range(11))]))
    assert parse_action(_raw(add=["https://evil.com"] * 20)).add == ()
