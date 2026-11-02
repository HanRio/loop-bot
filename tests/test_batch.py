import asyncio
import os
from types import SimpleNamespace

import pytest

from loopbot import handlers
from loopbot.config import load_config
from loopbot.store.postgres import PostgresStore
from loopbot.youtube import Audio, FetchError

PG_ENV = "LOOPBOT_TEST_DATABASE_URL"
USER = 1


class FakeStatus:
    def __init__(self, log):
        self.log = log

    async def edit_text(self, text):
        self.log.append(("edit", text))

    async def delete(self):
        self.log.append(("delete",))


class FakeMessage:
    def __init__(self, text=None):
        self.text = text
        self.log = []

    async def reply_text(self, text, **kw):
        self.log.append(("text", text, "reply_markup" in kw))
        return FakeStatus(self.log)

    async def reply_audio(self, f, **kw):
        self.log.append(("audio", kw["title"]))
        return SimpleNamespace(audio=SimpleNamespace(file_id="file-" + kw["title"]), delete=_noop)


async def _noop():
    pass


def fake_fetch(url, workdir, cookies):
    if "bad" in url:
        raise FetchError("비공개 영상이에요")
    path = workdir / "x.m4a"
    path.write_bytes(b"audio")
    return Audio(path=path, title=url.rsplit("/", 1)[1], duration=1, performer=None)


@pytest.fixture
def env(monkeypatch):
    dsn = os.environ.get(PG_ENV)
    if not dsn:
        pytest.skip(f"{PG_ENV} not set")
    monkeypatch.setattr(handlers, "fetch_audio", fake_fetch)
    store = PostgresStore(dsn, schema="loopbot_test")
    store.reset()
    tasks = []
    cfg = load_config({"BOT_TOKEN": "t", "ALLOWED_USER_IDS": str(USER), "WEBAPP_URL": "https://x.io/app/",
                       "DATABASE_URL": dsn})
    context = SimpleNamespace(
        bot=None,
        bot_data={"cfg": cfg, "store": store, "lock": asyncio.Lock()},
        application=SimpleNamespace(create_task=tasks.append),
    )
    yield SimpleNamespace(store=store, context=context, tasks=tasks)
    store.close()


def _update(msg):
    return SimpleNamespace(effective_message=msg, effective_user=SimpleNamespace(id=USER),
                           effective_chat=SimpleNamespace(id=USER, type="private"))


def _active_titles(store):
    by_id = {t.id: t.title for t in store.library(USER)}
    return [by_id[i] for i in store.active_playlist(USER).track_ids]


def test_batch_reports_progress_continues_past_failure_and_summarizes(env):
    msg = FakeMessage("https://youtu.be/a,https://youtu.be/bad\nhttps://youtu.be/c 들어봐")
    asyncio.run(handlers.on_text(_update(msg), env.context))
    assert _active_titles(env.store) == ["a", "c"]
    assert msg.log == [
        ("text", "⏳ 받는 중 (1/3): https://youtu.be/a", False),
        ("audio", "a"),
        ("edit", "⏳ 받는 중 (2/3): https://youtu.be/bad"),
        ("edit", "⏳ 받는 중 (3/3): https://youtu.be/c"),
        ("audio", "c"),
        ("delete",),
        ("text", "✅ 3곡 중 2곡을 '기본'에 추가했어요\n❌ https://youtu.be/bad (비공개 영상이에요)", True),
    ]


def test_single_link_summary(env):
    msg = FakeMessage("https://youtu.be/a")
    asyncio.run(handlers.on_text(_update(msg), env.context))
    assert msg.log[-1] == ("text", "✅ 추가됨: a", True)


def test_single_failed_link_summary(env):
    msg = FakeMessage("https://youtu.be/bad")
    asyncio.run(handlers.on_text(_update(msg), env.context))
    assert env.store.library(USER) == []
    assert msg.log[-1] == ("text", "❌ 받지 못했어요: https://youtu.be/bad (비공개 영상이에요)", True)


def test_list_shows_active_playlist_name(env):
    msg = FakeMessage()
    asyncio.run(handlers.list_tracks(_update(msg), env.context))
    assert msg.log == [("text", "🎵 기본\n아직 곡이 없어요. 링크나 음원을 보내주세요", False)]
    env.store.add_track(USER, "A", "f", None, None)
    asyncio.run(handlers.list_tracks(_update(msg), env.context))
    assert msg.log[-1] == ("text", "🎵 기본\n1. A", False)
