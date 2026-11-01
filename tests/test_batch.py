import asyncio
import json
from types import SimpleNamespace

import pytest

from loopbot import handlers
from loopbot.config import load_config
from loopbot.store.sqlite import SqliteStore
from loopbot.youtube import Audio, FetchError

USER = 1


class FakeStatus:
    def __init__(self, log):
        self.log = log

    async def edit_text(self, text):
        self.log.append(("edit", text))

    async def delete(self):
        self.log.append(("delete",))


class FakeMessage:
    def __init__(self, text=None, web_app_data=None):
        self.text = text
        self.web_app_data = web_app_data and SimpleNamespace(data=web_app_data)
        self.log = []

    async def reply_text(self, text, **kw):
        self.log.append(("text", text, "reply_markup" in kw))
        return FakeStatus(self.log)

    async def reply_audio(self, f, **kw):
        self.log.append(("audio", kw["title"]))
        return SimpleNamespace(audio=SimpleNamespace(file_id="file-" + kw["title"]))


def fake_fetch(url, workdir, cookies):
    if "bad" in url:
        raise FetchError("비공개 영상이에요")
    path = workdir / "x.m4a"
    path.write_bytes(b"audio")
    return Audio(path=path, title=url.rsplit("/", 1)[1], duration=1, performer=None)


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setattr(handlers, "fetch_audio", fake_fetch)
    store = SqliteStore(str(tmp_path / "s.db"))
    tasks = []
    cfg = load_config({"BOT_TOKEN": "t", "ALLOWED_USER_IDS": str(USER), "WEBAPP_URL": "https://x.io/app/"})
    context = SimpleNamespace(
        bot=None,
        bot_data={"cfg": cfg, "store": store, "lock": asyncio.Lock()},
        application=SimpleNamespace(create_task=tasks.append),
    )
    yield SimpleNamespace(store=store, context=context, tasks=tasks)
    store.close()


def _update(msg):
    return SimpleNamespace(effective_message=msg, effective_user=SimpleNamespace(id=USER),
                           effective_chat=SimpleNamespace(id=USER))


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


def _web(env, **payload):
    msg = FakeMessage(web_app_data=json.dumps({"v": 2, **payload}))
    asyncio.run(handlers.on_web_app_data(_update(msg), env.context))
    return msg


def test_web_app_saves_new_playlist_and_adds_links_to_it(env):
    a, b, c = (env.store.add_track(USER, t, "f", None, None).id for t in "ABC")
    msg = _web(env, playlist=None, name="출근길", tracks=[c, b, a], delete_tracks=[b],
               add=["https://youtu.be/d"])
    assert msg.log == [("text", "✅ 저장했어요", True)]
    assert env.store.active_playlist(USER).name == "출근길"
    assert _active_titles(env.store) == ["C", "A"]
    [task] = env.tasks
    asyncio.run(task)
    assert _active_titles(env.store) == ["C", "A", "d"]
    assert msg.log[-1] == ("text", "✅ 추가됨: d", True)


def test_web_app_delete_playlist_ignores_other_fields(env):
    [a] = (env.store.add_track(USER, "A", "f", None, None).id,)
    other = env.store.save_playlist(USER, None, "다른", [a])
    msg = _web(env, playlist=other.id, delete_playlist=True, delete_tracks=[a], play=True)
    assert [p.name for p in env.store.playlists(USER)] == ["기본"]
    assert [t.title for t in env.store.library(USER)] == ["A"]
    assert msg.log == [("text", "🗑 플레이리스트를 지웠어요", True)]


def test_web_app_malformed_payload(env):
    msg = FakeMessage(web_app_data='{"v":1}')
    asyncio.run(handlers.on_web_app_data(_update(msg), env.context))
    assert msg.log == [("text", "목록이 바뀌었어요. 버튼을 다시 눌러주세요", True)]


def test_list_shows_active_playlist_name(env):
    env.store.add_track(USER, "A", "f", None, None)
    env.store.save_playlist(USER, None, "출근길", [])
    msg = FakeMessage()
    asyncio.run(handlers.list_tracks(_update(msg), env.context))
    assert msg.log == [("text", "🎵 출근길\n아직 곡이 없어요. 링크나 음원을 보내주세요", False)]
    env.store.save_playlist(USER, env.store.playlists(USER)[0].id, "기본", [1])
    asyncio.run(handlers.list_tracks(_update(msg), env.context))
    assert msg.log[-1] == ("text", "🎵 기본\n1. A", False)
