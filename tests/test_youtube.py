import pytest
from loopbot.youtube import check_limits, FetchError, _download_error_message

def test_check_limits_passes_short_and_unknown():
    check_limits({"duration": 3600})
    check_limits({})

def test_check_limits_rejects_long():
    with pytest.raises(FetchError, match="60분"):
        check_limits({"duration": 3601})

def test_check_limits_rejects_live():
    with pytest.raises(FetchError, match="라이브"):
        check_limits({"is_live": True})

def test_check_limits_rejects_playlist():
    with pytest.raises(FetchError, match="재생목록"):
        check_limits({"_type": "playlist"})
    with pytest.raises(FetchError, match="재생목록"):
        check_limits({"entries": []})

def test_download_error_message_maps_known_causes():
    assert _download_error_message(Exception("Sign in to confirm you're not a bot")) == "유튜브가 서버 접근을 막았어요 (쿠키 필요)"
    assert _download_error_message(Exception("ERROR: Private video. Sign in")) == "비공개 영상이에요"
    assert _download_error_message(Exception("something else")) == "영상을 받지 못했어요"
