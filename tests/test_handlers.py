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


def _run_on_audio(msg):
    import asyncio
    from types import SimpleNamespace

    from loopbot import handlers

    added, replies = [], []

    class Store:
        def add_track(self, *a):
            added.append(a)

    async def reply_text(text, **kw):
        replies.append(text)

    msg.reply_text = reply_text
    update = SimpleNamespace(effective_message=msg, effective_user=SimpleNamespace(id=1))
    context = SimpleNamespace(bot_data={"store": Store()})
    asyncio.run(handlers.on_audio(update, context))
    return added, replies


def test_on_audio_rejects_audio_document():
    from types import SimpleNamespace

    doc = SimpleNamespace(file_id="d", file_name="a.flac", mime_type="audio/flac")
    added, replies = _run_on_audio(SimpleNamespace(audio=None, document=doc))
    assert added == []
    assert replies == ["음원 파일로 보내주세요 (mp3·m4a)"]


def test_reply_falls_back_without_keyboard_on_bad_request(monkeypatch):
    import asyncio
    from types import SimpleNamespace

    from telegram.error import BadRequest

    from loopbot import handlers

    monkeypatch.setattr(handlers, "_keyboard", lambda c, u: "KB")
    calls = []

    async def reply_text(text, **kw):
        calls.append(kw)
        if kw.get("reply_markup"):
            raise BadRequest("too big")

    update = SimpleNamespace(effective_message=SimpleNamespace(reply_text=reply_text),
                             effective_user=SimpleNamespace(id=1))
    asyncio.run(handlers._reply(update, None, "hi"))
    assert calls == [{"reply_markup": "KB"}, {}]


def _error_context(exc):
    from types import SimpleNamespace

    return SimpleNamespace(error=exc)


def test_on_error_replies_and_logs(caplog):
    import asyncio
    from types import SimpleNamespace

    from loopbot import handlers

    replies = []

    async def reply_text(text, **kw):
        replies.append(text)

    update = SimpleNamespace(effective_message=SimpleNamespace(reply_text=reply_text))
    asyncio.run(handlers.on_error(update, _error_context(RuntimeError("db down"))))
    assert replies == ["잠시 문제가 생겼어요. 잠시 뒤 다시 시도해주세요"]
    assert "db down" in caplog.text


def test_on_error_swallows_failed_reply_and_handles_no_message(caplog):
    import asyncio
    from types import SimpleNamespace

    from telegram.error import NetworkError

    from loopbot import handlers

    async def reply_text(text, **kw):
        raise NetworkError("offline")

    update = SimpleNamespace(effective_message=SimpleNamespace(reply_text=reply_text))
    asyncio.run(handlers.on_error(update, _error_context(RuntimeError("boom"))))
    assert "offline" in caplog.text
    asyncio.run(handlers.on_error(None, _error_context(RuntimeError("boom"))))
    asyncio.run(handlers.on_error(SimpleNamespace(effective_message=None), _error_context(RuntimeError("boom"))))


def _app():
    from types import SimpleNamespace

    from loopbot.handlers import build_app

    cfg = SimpleNamespace(bot_token="123:abc", allowed_user_ids=frozenset({1}))
    return build_app(cfg, store=None)


def test_build_app_registers_error_handler():
    from loopbot import handlers

    assert handlers.on_error in _app().error_handlers
