import http.client
from urllib.parse import parse_qs, urlparse

import pytest

from loopbot.lyrics import Lyrics, LyricsUnavailable, clean_title, pick_best, search


@pytest.mark.parametrize("title,performer,expected", [
    ("F.I.A - F.I.A LIVE WORSHIP - 슬픈 마음 있는 사람 (찬송가 91장/피아버전) / TAKE THE NAME OF JESUS WITH YOU (FIA.ver)", None, "슬픈 마음 있는 사람"),
    ("F.I.A - 나의 가장 낮은 마음 / HUMBLE AND LOWLY SPIRIT - 피아워십", None, "나의 가장 낮은 마음"),
    ("F.I.A - 1. 나는 일어섭니다 (Official) | I SHALL STAND", "F.I.A", "나는 일어섭니다"),
    ("ANOINTING - 13 빛으로 비추시네 (Official Video)", None, "빛으로 비추시네"),
    ("WECCLESIA 위클레시아 - 예수 늘 함께하시네 | Jesus", None, "예수 늘 함께하시네"),
    ("[LIVE] 예수, 늘 함께하시네 - 마커스워십 정규 앨범 실황 (Official Live Video)", None, "예수, 늘 함께하시네"),
    ("Way Maker", None, "Way Maker"),
    ("찬양 - 은혜", None, "찬양"),
    ("   ", None, ""),
    ("1 . 나는 일어섭니다", None, "나는 일어섭니다"),
])
def test_clean_title(title, performer, expected):
    assert clean_title(title, performer) == expected


def _c(id, duration, synced="[00:01.00]a"):
    return {"id": id, "duration": duration, "syncedLyrics": synced}


def test_pick_best():
    assert pick_best([_c(1, 200), _c(2, 263)], 260)["id"] == 2
    assert pick_best([_c(1, 260, None)], 260) is None
    assert pick_best([_c(1, 276)], 260) is None
    assert pick_best([_c(1, 275)], 260)["id"] == 1
    assert pick_best([_c(1, 1, None), _c(2, 999)], None)["id"] == 2


def test_search_uses_cleaned_title_as_q():
    urls = []

    def fetch(url):
        urls.append(url)
        return [_c(7, 100, "[00:01.00]x")]

    assert search("ANOINTING - 13 빛으로 비추시네 (Official Video)", None, 100, fetch) == Lyrics(7, "[00:01.00]x")
    assert parse_qs(urlparse(urls[0]).query)["q"] == ["빛으로 비추시네"]


@pytest.mark.parametrize("exc", [OSError, TimeoutError, ValueError, http.client.IncompleteRead])
def test_search_raises_unavailable_on_fetch_error(exc):
    def fetch(url):
        raise exc(b"") if exc is http.client.IncompleteRead else exc()

    with pytest.raises(LyricsUnavailable):
        search("x", None, 1, fetch)


def test_search_raises_unavailable_on_non_list_body():
    with pytest.raises(LyricsUnavailable):
        search("x", None, 1, lambda url: {"a": 1})


def test_search_returns_none_when_no_candidate():
    assert search("x", None, 1, lambda url: []) is None
