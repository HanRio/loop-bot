import os
import sqlite3

import pytest

from loopbot.config import load_config
from loopbot.store import open_store
from loopbot.store.sqlite import SqliteStore

PG_ENV = "LOOPBOT_TEST_DATABASE_URL"


def _sqlite(tmp_path):
    return SqliteStore(str(tmp_path / "sub" / "s.db"))


def _postgres(tmp_path):
    from loopbot.store.postgres import PostgresStore

    store = PostgresStore(os.environ[PG_ENV])
    if hasattr(store, "reset"):
        store.reset()
    return store


@pytest.fixture(params=[
    pytest.param(_sqlite, id="sqlite"),
    pytest.param(_postgres, id="postgres",
                 marks=pytest.mark.skipif(not os.environ.get(PG_ENV), reason=f"{PG_ENV} not set")),
])
def store(request, tmp_path):
    s = request.param(tmp_path)
    yield s
    if hasattr(s, "close"):
        s.close()


def _add(store, user_id, *titles):
    return [store.add_track(user_id, t, "f" + t, None, None).id for t in titles]


def _titles(store, user_id, playlist):
    by_id = {t.id: t.title for t in store.library(user_id)}
    return [by_id[i] for i in playlist.track_ids]


def test_add_track_creates_default_playlist_and_appends(store):
    t = store.add_track(1, "A", "fa", 10, "https://youtu.be/a")
    _add(store, 1, "B")
    assert (t.user_id, t.title, t.file_id, t.duration, t.source) == (1, "A", "fa", 10, "https://youtu.be/a")
    [pl] = store.playlists(1)
    assert pl.name == "기본"
    assert store.active_playlist(1) == pl
    assert _titles(store, 1, pl) == ["A", "B"]
    assert [t.title for t in store.library(1)] == ["A", "B"]


def test_active_playlist_creates_default_once(store):
    first = store.active_playlist(1)
    assert first.name == "기본" and first.track_ids == ()
    assert store.active_playlist(1) == first
    assert store.playlists(1) == [first]


def test_save_playlist_new_sets_active_and_receives_new_tracks(store):
    a, b = _add(store, 1, "A", "B")
    pl = store.save_playlist(1, None, "출근길", [b, a])
    assert (pl.name, pl.track_ids) == ("출근길", (b, a))
    assert store.active_playlist(1) == pl
    [c] = _add(store, 1, "C")
    assert store.active_playlist(1).track_ids == (b, a, c)
    assert [p.name for p in store.playlists(1)] == ["기본", "출근길"]


def test_save_playlist_existing_renames_and_reorders(store):
    a, b, c = _add(store, 1, "A", "B", "C")
    default = store.active_playlist(1)
    other = store.save_playlist(1, None, "다른", [a])
    saved = store.save_playlist(1, default.id, "새 이름", [c, a])
    assert saved.id == default.id
    assert (saved.name, saved.track_ids) == ("새 이름", (c, a))
    assert store.active_playlist(1).id == default.id
    assert [p.id for p in store.playlists(1)] == [default.id, other.id]


def test_save_playlist_ignores_foreign_unknown_and_duplicate_ids(store):
    a, b = _add(store, 1, "A", "B")
    [x] = _add(store, 2, "X")
    pl = store.save_playlist(1, None, "목록", [b, x, 999_999, a, b])
    assert pl.track_ids == (b, a)
    assert _titles(store, 2, store.active_playlist(2)) == ["X"]


def test_save_playlist_with_foreign_or_unknown_id_creates_new(store):
    [x] = _add(store, 2, "X")
    foreign = store.active_playlist(2)
    [a] = _add(store, 1, "A")
    pl = store.save_playlist(1, foreign.id, "내 것", [a])
    assert pl.id != foreign.id and pl.user_id == 1
    assert store.playlists(2) == [foreign]
    assert store.active_playlist(2).track_ids == (x,)
    ghost = store.save_playlist(1, 999_999, "유령", [])
    assert ghost.id != 999_999
    assert [p.name for p in store.playlists(1)] == ["기본", "내 것", "유령"]


def test_delete_active_playlist_falls_back_to_most_recent(store):
    first = store.active_playlist(1)
    second = store.save_playlist(1, None, "둘", [])
    third = store.save_playlist(1, None, "셋", [])
    store.save_playlist(1, second.id, "둘", [])
    store.delete_playlist(1, second.id)
    assert store.active_playlist(1).id == third.id
    assert [p.id for p in store.playlists(1)] == [first.id, third.id]


def test_delete_last_playlist_recreates_default(store):
    [a] = _add(store, 1, "A")
    store.delete_playlist(1, store.active_playlist(1).id)
    pl = store.active_playlist(1)
    assert pl.name == "기본" and pl.track_ids == ()
    assert [t.id for t in store.library(1)] == [a]


def test_delete_inactive_playlist_keeps_active(store):
    first = store.active_playlist(1)
    second = store.save_playlist(1, None, "둘", [])
    store.delete_playlist(1, first.id)
    assert store.active_playlist(1).id == second.id


def test_delete_playlist_ignores_foreign(store):
    foreign = store.active_playlist(2)
    store.delete_playlist(1, foreign.id)
    assert store.playlists(2) == [foreign]


def test_delete_tracks_removes_from_library_and_all_playlists(store):
    a, b, c = _add(store, 1, "A", "B", "C")
    other = store.save_playlist(1, None, "다른", [c, b])
    [x] = _add(store, 2, "X")
    store.delete_tracks(1, [b, x])
    assert [t.id for t in store.library(1)] == [a, c]
    lists = {p.id: p.track_ids for p in store.playlists(1)}
    assert lists[other.id] == (c,)
    assert sorted(t for ids in lists.values() for t in ids) == sorted([a, c, c])
    assert [t.id for t in store.library(2)] == [x]
    assert store.active_playlist(2).track_ids == (x,)


def test_users_are_isolated(store):
    _add(store, 1, "A")
    assert store.library(2) == []
    assert store.active_playlist(2).track_ids == ()
    assert len(store.playlists(1)) == 1


OLD_SCHEMA = """
CREATE TABLE tracks (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, position INTEGER NOT NULL,
  title TEXT NOT NULL, file_id TEXT NOT NULL, duration INTEGER, source TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_tracks_user ON tracks(user_id, position);
"""


def _old_db(path):
    conn = sqlite3.connect(path)
    conn.executescript(OLD_SCHEMA)
    conn.executemany(
        "INSERT INTO tracks (id, user_id, position, title, file_id, duration, source) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [(1, 1, 2, "A", "fa", 10, "https://youtu.be/a"), (2, 1, 0, "B", "fb", None, None),
         (3, 2, 0, "X", "fx", None, None), (4, 1, 1, "C", "fc", None, None)],
    )
    conn.commit()
    conn.close()


def _snapshot(store):
    return {u: (store.library(u), store.playlists(u), store.active_playlist(u)) for u in (1, 2)}


def test_sqlite_migrates_old_schema_in_order_and_is_idempotent(tmp_path):
    path = str(tmp_path / "old.db")
    _old_db(path)
    store = SqliteStore(path)
    pl = store.active_playlist(1)
    assert pl.name == "기본" and pl.track_ids == (2, 4, 1)
    assert store.active_playlist(2).track_ids == (3,)
    assert store.library(1)[0].source == "https://youtu.be/a"
    before = _snapshot(store)
    store.close()

    again = SqliteStore(path)
    assert _snapshot(again) == before
    again.close()
    conn = sqlite3.connect(path)
    assert "position" not in [r[1] for r in conn.execute("PRAGMA table_info(tracks)")]
    conn.close()


def test_open_store_defaults_to_sqlite(tmp_path):
    cfg = load_config({"BOT_TOKEN": "t", "ALLOWED_USER_IDS": "1", "WEBAPP_URL": "https://x",
                       "DB_PATH": str(tmp_path / "x.db"), "DATABASE_URL": ""})
    store = open_store(cfg)
    assert isinstance(store, SqliteStore)
    store.close()
