from types import SimpleNamespace

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


_PRIVATE = SimpleNamespace(id=1, type="private")


def test_reply_falls_back_without_keyboard_on_bad_request(monkeypatch):
    import asyncio
    from types import SimpleNamespace

    from telegram.error import BadRequest

    from loopbot import handlers

    monkeypatch.setattr(handlers, "_markup", lambda c, chat: "KB")
    calls = []

    async def reply_text(text, **kw):
        calls.append(kw)
        if kw.get("reply_markup"):
            raise BadRequest("too big")

    update = SimpleNamespace(effective_message=SimpleNamespace(reply_text=reply_text), effective_chat=_PRIVATE)
    asyncio.run(handlers._reply(update, SimpleNamespace(bot_data={}), "hi"))
    assert calls == [{"reply_markup": "KB"}, {}]


def test_private_markup_is_inline_web_app_button_to_player():
    from telegram import InlineKeyboardMarkup

    from loopbot import handlers

    context = SimpleNamespace(bot_data={"cfg": SimpleNamespace(webapp_url="https://x.io/app/")})
    markup = handlers._markup(context, _PRIVATE)
    assert isinstance(markup, InlineKeyboardMarkup)
    [[button]] = markup.inline_keyboard
    assert button.text == "🎵 플레이어 열기"
    assert button.web_app.url == "https://x.io/app/"


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


def _menu_app(calls, failing_chats=(), allowed=frozenset({1})):
    from telegram.error import TelegramError

    async def set_chat_menu_button(chat_id=None, menu_button=None):
        if chat_id in failing_chats:
            raise TelegramError("chat menu refused")
        calls.append((chat_id, menu_button))

    async def send_message(*a, **kw):
        raise AssertionError("startup must not send messages")

    cfg = SimpleNamespace(allowed_user_ids=allowed, webapp_url="https://x.io/app/")
    bot = SimpleNamespace(set_chat_menu_button=set_chat_menu_button, send_message=send_message)
    return SimpleNamespace(bot_data={"cfg": cfg}, bot=bot)


def test_set_menu_button_sets_webapp_menu_for_each_allowed_user():
    import asyncio

    from telegram import MenuButtonWebApp, WebAppInfo

    from loopbot import handlers

    calls = []
    app = _menu_app(calls, allowed=frozenset({1, 2}))
    asyncio.run(handlers._set_menu_button(app))
    menu = MenuButtonWebApp("🎵 플레이어", WebAppInfo("https://x.io/app/"))
    assert calls == [(1, menu), (2, menu)]


def test_set_menu_button_failure_logs_and_continues_with_next_user(caplog):
    import asyncio

    from telegram import MenuButtonWebApp, WebAppInfo

    from loopbot import handlers

    calls = []
    app = _menu_app(calls, failing_chats={1}, allowed=frozenset({1, 2}))
    asyncio.run(handlers._set_menu_button(app))
    assert calls == [(2, MenuButtonWebApp("🎵 플레이어", WebAppInfo("https://x.io/app/")))]
    assert "chat menu refused" in caplog.text


class _FakeStore:
    def __init__(self, titles, prev=()):
        self.tracks = [SimpleNamespace(id=i, title=t, file_id=f"f{t}") for i, t in enumerate(titles, 1)]
        self.prev = list(prev)
        self.saved = None

    def active_playlist(self, user_id):
        return SimpleNamespace(id=1, name="기본", track_ids=tuple(t.id for t in self.tracks))

    def library(self, user_id):
        return self.tracks

    def play_messages(self, user_id):
        return list(self.prev)

    def set_play_messages(self, user_id, message_ids):
        self.saved = list(message_ids)


class _FakeBot:
    def __init__(self, delete_error=None):
        self.delete_error = delete_error
        self.deleted = []
        self.sent = []

    async def delete_messages(self, chat_id, message_ids):
        if self.delete_error:
            raise self.delete_error
        self.deleted.append((chat_id, list(message_ids)))

    async def send_audio(self, chat_id, audio):
        self.sent.append(audio)
        return SimpleNamespace(message_id=100 + len(self.sent))


def _play_update():
    async def reply_text(text, **kw):
        pass

    msg = SimpleNamespace(reply_text=reply_text)
    return SimpleNamespace(effective_message=msg, effective_user=SimpleNamespace(id=1),
                           effective_chat=SimpleNamespace(id=5))


def _run_play(monkeypatch, store, bot):
    import asyncio

    from loopbot import handlers

    monkeypatch.setattr(handlers, "PLAY_GAP_SECONDS", 0)
    context = SimpleNamespace(bot_data={"store": store}, bot=bot)
    asyncio.run(handlers.play(_play_update(), context))


def test_play_deletes_previous_play_messages_and_saves_new_ones(monkeypatch):
    store = _FakeStore(["A", "B"], prev=[7, 8])
    bot = _FakeBot()
    _run_play(monkeypatch, store, bot)
    assert bot.deleted == [(5, [7, 8])]
    assert store.saved == [101, 102]


def test_play_deletes_more_than_one_chunk_of_previous_messages(monkeypatch):
    store = _FakeStore(["A"], prev=range(1, 102))
    bot = _FakeBot()
    _run_play(monkeypatch, store, bot)
    assert bot.deleted == [(5, list(range(1, 101))), (5, [101])]
    assert store.saved == [101]


def test_play_continues_when_delete_fails(monkeypatch):
    from telegram.error import TelegramError

    store = _FakeStore(["A", "B"], prev=[7])
    bot = _FakeBot(delete_error=TelegramError("message can't be deleted"))
    _run_play(monkeypatch, store, bot)
    assert bot.sent == ["fA", "fB"]
    assert store.saved == [101, 102]


def test_play_without_tracks_neither_deletes_nor_saves(monkeypatch):
    store = _FakeStore([], prev=[7])
    bot = _FakeBot()
    _run_play(monkeypatch, store, bot)
    assert bot.deleted == []
    assert store.saved is None


def test_on_audio_deletes_user_message_and_confirms_with_send_message(monkeypatch):
    import asyncio

    from loopbot import handlers

    monkeypatch.setattr(handlers, "_markup", lambda context, chat: "KB")
    events = []

    class Store:
        def add_track(self, *a):
            events.append(("add", a))

    async def delete():
        events.append(("delete",))

    async def send_message(chat_id, text, reply_markup=None):
        events.append(("send", chat_id, text, reply_markup))

    media = SimpleNamespace(file_id="F", title="곡", performer=None, file_name="a.mp3", duration=7)
    update = SimpleNamespace(effective_message=SimpleNamespace(audio=media, delete=delete),
                             effective_user=SimpleNamespace(id=1), effective_chat=SimpleNamespace(id=5, type="private"))
    context = SimpleNamespace(bot_data={"store": Store()}, bot=SimpleNamespace(send_message=send_message))
    asyncio.run(handlers.on_audio(update, context))
    assert events == [
        ("add", (1, "곡", "F", 7, None)),
        ("delete",),
        ("send", 5, "✅ 추가됨: 곡", "KB"),
    ]


def test_fetch_one_deletes_upload_after_adding_track(monkeypatch, tmp_path):
    import asyncio

    from loopbot import handlers
    from loopbot.handlers import Added

    audio_file = tmp_path / "a.mp3"
    audio_file.write_bytes(b"x")
    monkeypatch.setattr(handlers, "fetch_audio", lambda url, tmp, cookies: SimpleNamespace(
        path=audio_file, title="곡", performer=None, duration=10))
    events = []

    class Store:
        def add_track(self, *a):
            events.append("add")

    async def delete():
        events.append("delete")

    async def reply_audio(f, **kw):
        return SimpleNamespace(audio=SimpleNamespace(file_id="F"), delete=delete)

    msg = SimpleNamespace(reply_audio=reply_audio)
    context = SimpleNamespace(bot_data={
        "cfg": SimpleNamespace(ytdlp_cookies=None),
        "lock": asyncio.Lock(),
        "store": Store(),
    })
    outcome = asyncio.run(handlers._fetch_one(msg, context, 1, "https://youtu.be/a"))
    assert outcome == Added("https://youtu.be/a", "곡")
    assert events == ["add", "delete"]


def _app():
    from types import SimpleNamespace

    from loopbot.handlers import build_app

    cfg = SimpleNamespace(bot_token="123:abc", allowed_user_ids=frozenset({1}))
    return build_app(cfg, store=None)


def test_build_app_registers_error_handler():
    from loopbot import handlers

    assert handlers.on_error in _app().error_handlers


def test_build_app_sets_menu_button_on_startup():
    from loopbot import handlers

    assert _app().post_init is handlers._set_menu_button


def _group_update(replies):
    async def reply_text(text, **kw):
        replies.append((text, kw.get("reply_markup")))

    return SimpleNamespace(effective_message=SimpleNamespace(reply_text=reply_text),
                           effective_user=SimpleNamespace(id=1), effective_chat=SimpleNamespace(id=-100, type="group"))


def _group_context():
    return SimpleNamespace(bot_data={}, bot=SimpleNamespace(username="loopbot_test_bot"))


def test_reply_in_group_uses_link_button_to_private_chat():
    import asyncio

    from loopbot import handlers

    replies = []
    asyncio.run(handlers._reply(_group_update(replies), _group_context(), "hi"))
    [(text, markup)] = replies
    [[button]] = markup.inline_keyboard
    assert text == "hi"
    assert button.url == "https://t.me/loopbot_test_bot?start=playlist"


def test_start_in_group_explains_why_the_app_opens_in_private_chat():
    import asyncio

    from loopbot import handlers

    replies = []
    asyncio.run(handlers.start(_group_update(replies), _group_context()))
    [(text, markup)] = replies
    assert "개인 채팅" in text
    assert markup.inline_keyboard[0][0].url.endswith("?start=playlist")


def test_play_tracks_play_messages_per_chat(monkeypatch):
    keys = []

    class Store(_FakeStore):
        def play_messages(self, key):
            keys.append(key)
            return []

        def set_play_messages(self, key, message_ids):
            keys.append(key)

    _run_play(monkeypatch, Store(["A"]), _FakeBot())
    assert keys == [5, 5]


def _private_start_update(replies, chat_id=7):
    async def reply_text(text, **kw):
        replies.append((text, kw.get("reply_markup")))

    return SimpleNamespace(effective_message=SimpleNamespace(reply_text=reply_text),
                           effective_user=SimpleNamespace(id=7), effective_chat=SimpleNamespace(id=chat_id, type="private"))


def _private_start_context(calls, failing=False):
    from telegram.error import TelegramError

    async def set_chat_menu_button(chat_id=None, menu_button=None):
        if failing:
            raise TelegramError("chat menu refused")
        calls.append((chat_id, menu_button))

    cfg = SimpleNamespace(webapp_url="https://x.io/app/")
    bot = SimpleNamespace(set_chat_menu_button=set_chat_menu_button)
    return SimpleNamespace(bot_data={"cfg": cfg}, bot=bot)


def test_private_start_sets_menu_button_for_that_chat_and_replies():
    import asyncio

    from telegram import MenuButtonWebApp, WebAppInfo

    from loopbot import handlers

    calls, replies = [], []
    asyncio.run(handlers.start(_private_start_update(replies, chat_id=7), _private_start_context(calls)))
    assert calls == [(7, MenuButtonWebApp("🎵 플레이어", WebAppInfo("https://x.io/app/")))]
    assert len(replies) == 1


def test_private_start_still_replies_when_menu_button_fails(caplog):
    import asyncio

    from loopbot import handlers

    calls, replies = [], []
    asyncio.run(handlers.start(_private_start_update(replies), _private_start_context(calls, failing=True)))
    assert calls == []
    assert len(replies) == 1
    assert "chat menu refused" in caplog.text


def test_group_start_does_not_set_menu_button():
    import asyncio

    from loopbot import handlers

    calls, replies = [], []
    context = _group_context()
    context.bot.set_chat_menu_button = lambda **kw: calls.append(kw)
    asyncio.run(handlers.start(_group_update(replies), context))
    assert calls == []
    assert len(replies) == 1


def _filter_update(user_id, username):
    from datetime import datetime, timezone

    from telegram import Chat, Message, Update, User

    user = User(id=user_id, first_name="t", is_bot=False, username=username)
    chat = Chat(id=user_id, type=Chat.PRIVATE)
    message = Message(message_id=1, date=datetime.now(timezone.utc), chat=chat, from_user=user, text="hi")
    return Update(update_id=1, message=message)


def test_allowed_user_filter_matches_by_id_or_username_case_insensitively():
    from loopbot import handlers
    from loopbot.config import load_config

    cfg = load_config({**BASE_CONFIG, "ALLOWED_USER_IDS": "1", "ALLOWED_USERNAMES": "@Some_User"})
    allowed = handlers._AllowedUser(cfg)

    assert allowed.check_update(_filter_update(1, None))
    assert allowed.check_update(_filter_update(99, "SOME_USER"))
    assert not allowed.check_update(_filter_update(99, "stranger"))
    assert not allowed.check_update(_filter_update(99, None))
    assert (~allowed).check_update(_filter_update(99, "stranger"))


def test_allowed_user_filter_rejects_blank_username():
    from loopbot import handlers
    from loopbot.config import load_config

    cfg = load_config({**BASE_CONFIG, "ALLOWED_USER_IDS": "1", "ALLOWED_USERNAMES": " , "})
    allowed = handlers._AllowedUser(cfg)

    assert not allowed.check_update(_filter_update(99, ""))
    assert not allowed.check_update(_filter_update(99, None))


BASE_CONFIG = {"BOT_TOKEN": "t", "ALLOWED_USER_IDS": "1", "WEBAPP_URL": "https://x.io/app/",
               "DATABASE_URL": "postgresql://u@h/db"}
