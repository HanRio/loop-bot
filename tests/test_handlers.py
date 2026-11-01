from loopbot.handlers import title_for_audio


def test_title_for_audio_fallbacks():
    assert title_for_audio("곡", "가수", "a.mp3") == "가수 - 곡"
    assert title_for_audio("곡", None, "a.mp3") == "곡"
    assert title_for_audio(None, None, "내 노래.m4a") == "내 노래"
    assert title_for_audio(None, None, None) == "제목 없음"


def test_send_with_retry_reinvokes_after_retry_after(monkeypatch):
    import asyncio
    from datetime import timedelta

    from telegram.error import RetryAfter

    from loopbot import handlers

    sleeps = []

    async def fake_sleep(seconds):
        sleeps.append(seconds)

    monkeypatch.setattr(handlers.asyncio, "sleep", fake_sleep)
    calls = []

    async def send():
        calls.append(1)
        if len(calls) == 1:
            raise RetryAfter(0)
        if len(calls) == 2:
            raise RetryAfter(timedelta(seconds=3))
        return "ok"

    assert asyncio.run(handlers._send_with_retry(send)) == "ok"
    assert len(calls) == 3
    assert sleeps == [0, 3.0]
