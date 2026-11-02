import os

import pytest

from loopbot.config import load_config
from loopbot.store import open_store

PG_ENV = "LOOPBOT_TEST_DATABASE_URL"


@pytest.fixture
def store():
    from loopbot.store.postgres import PostgresStore

    if not os.environ.get(PG_ENV):
        pytest.skip(f"{PG_ENV} not set")
    s = PostgresStore(os.environ[PG_ENV], schema="loopbot_test")
    s.reset()
    yield s
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
    pl = store.active_playlist(1)
    assert pl.name == "기본"
    assert _titles(store, 1, pl) == ["A", "B"]
    assert [t.title for t in store.library(1)] == ["A", "B"]


def test_active_playlist_creates_default_once(store):
    first = store.active_playlist(1)
    assert first.name == "기본" and first.track_ids == ()
    assert store.active_playlist(1) == first


def test_users_are_isolated(store):
    _add(store, 1, "A")
    assert store.library(2) == []
    assert store.active_playlist(2).track_ids == ()


def test_play_messages_empty_for_new_user(store):
    assert store.play_messages(1) == []


def test_set_play_messages_roundtrips_in_order(store):
    store.set_play_messages(1, [30, 10, 20])
    assert store.play_messages(1) == [30, 10, 20]
    store.set_play_messages(1, [5])
    assert store.play_messages(1) == [5]


def test_set_play_messages_keeps_active_playlist(store):
    _add(store, 1, "A")
    pl = store.active_playlist(1)
    store.set_play_messages(1, [7, 8])
    assert store.active_playlist(1) == pl


def test_play_messages_are_per_user(store):
    store.set_play_messages(1, [1, 2])
    store.set_play_messages(2, [3])
    assert store.play_messages(1) == [1, 2]
    assert store.play_messages(2) == [3]
    assert store.play_messages(3) == []


def test_postgres_reconnects_once_after_connection_drop(store):
    [a] = _add(store, 1, "A")
    store._conn.close()
    assert [t.id for t in store.library(1)] == [a]
    store._conn.close()
    [b] = _add(store, 1, "B")
    assert [t.id for t in store.library(1)] == [a, b]
    assert store.active_playlist(1).track_ids == (a, b)


def test_postgres_rejects_bad_schema_name():
    from loopbot.store.postgres import PostgresStore

    for bad in ("Loopbot", "x; drop table tracks", "1abc", "", "a-b"):
        with pytest.raises(ValueError):
            PostgresStore("postgresql://unused", schema=bad)


def test_open_store_builds_postgres_store_from_database_url(monkeypatch):
    from loopbot.store import postgres

    made = []
    monkeypatch.setattr(postgres, "PostgresStore", lambda dsn: made.append(dsn) or "STORE")
    cfg = load_config({"BOT_TOKEN": "t", "ALLOWED_USER_IDS": "1", "WEBAPP_URL": "https://x",
                       "DATABASE_URL": "postgresql://u@h/db"})
    assert open_store(cfg) == "STORE"
    assert made == ["postgresql://u@h/db"]


def _make_playlist(store, user_id, name):
    def work(cur):
        cur.execute("INSERT INTO playlists (user_id, name) VALUES (%s, %s) RETURNING id", (user_id, name))
        return cur.fetchone()[0]

    return store._run(work)


def _share(store, playlist_id):
    store._run(lambda cur: cur.execute("UPDATE playlists SET shared = true WHERE id = %s", (playlist_id,)))


def test_playable_playlists_lists_own_then_shared_and_hides_unshared(store):
    mine = _make_playlist(store, 1, "mine")
    mine_shared = _make_playlist(store, 1, "mine shared")
    _share(store, mine_shared)
    other_hidden = _make_playlist(store, 2, "hidden")
    other_shared = _make_playlist(store, 2, "other shared")
    _share(store, other_shared)
    assert [p.id for p in store.playable_playlists(1)] == [mine, mine_shared, other_shared]
    assert [p.id for p in store.playable_playlists(2)] == [other_hidden, other_shared, mine_shared]
    assert other_hidden not in [p.id for p in store.playable_playlists(1)]


def test_playlist_tracks_returns_shared_tracks_in_order_for_another_user(store):
    _add(store, 1, "A", "B", "C")
    pid = store.active_playlist(1).id
    _share(store, pid)
    playlist, tracks = store.playlist_tracks(2, pid)
    assert playlist.user_id == 1
    assert [t.title for t in tracks] == ["A", "B", "C"]
    assert [t.user_id for t in tracks] == [1, 1, 1]


def test_playlist_tracks_is_none_for_unshared_or_missing_playlist(store):
    _add(store, 1, "A")
    pid = store.active_playlist(1).id
    assert store.playlist_tracks(2, pid) is None
    assert store.playlist_tracks(1, pid) is not None
    assert store.playlist_tracks(1, 999999) is None
