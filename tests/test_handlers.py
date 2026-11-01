from loopbot.handlers import title_for_audio


def test_title_for_audio_fallbacks():
    assert title_for_audio("곡", "가수", "a.mp3") == "가수 - 곡"
    assert title_for_audio("곡", None, "a.mp3") == "곡"
    assert title_for_audio(None, None, "내 노래.m4a") == "내 노래"
    assert title_for_audio(None, None, None) == "제목 없음"
