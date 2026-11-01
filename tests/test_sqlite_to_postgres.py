import os

import pytest

from loopbot.store.postgres import PostgresStore
from loopbot.store.sqlite import SqliteStore
from scripts.sqlite_to_postgres import main

PG_ENV = "LOOPBOT_TEST_DATABASE_URL"
pytestmark = pytest.mark.skipif(not os.environ.get(PG_ENV), reason=f"{PG_ENV} not set")


def _shape(store, user_id):
    titles = {t.id: t.title for t in store.library(user_id)}
    return (
        [(t.title, t.file_id, t.duration, t.source) for t in store.library(user_id)],
        [(p.name, [titles[i] for i in p.track_ids]) for p in store.playlists(user_id)],
        store.active_playlist(user_id).name,
    )


def test_copy_preserves_library_order_and_active_then_refuses_rerun(tmp_path):
    path = str(tmp_path / "s.db")
    src = SqliteStore(path)
    ids = [src.add_track(1, t, "f" + t, i, "https://youtu.be/" + t).id for i, t in enumerate("ABC")]
    src.add_track(2, "X", "fx", None, None)
    src.save_playlist(1, None, "출근길", [ids[2], ids[0]])
    later = src.save_playlist(1, None, "퇴근길", [ids[1]])
    src.save_playlist(1, src.playlists(1)[0].id, "기본", ids)
    src.save_playlist(1, later.id, "퇴근길", [ids[1]])
    src.save_playlist(1, src.playlists(1)[1].id, "출근길", [ids[2], ids[0]])
    expected = {u: _shape(src, u) for u in (1, 2)}
    src.close()

    os.environ["COPY_TEST_DSN"] = os.environ[PG_ENV]
    dst = PostgresStore(os.environ[PG_ENV], schema="loopbot_test")
    dst.reset()
    dst.close()
    main(path, "COPY_TEST_DSN", "loopbot_test")

    dst = PostgresStore(os.environ[PG_ENV], schema="loopbot_test")
    try:
        assert {u: _shape(dst, u) for u in (1, 2)} == expected
        assert expected[1][2] == "출근길"
        with pytest.raises(SystemExit):
            main(path, "COPY_TEST_DSN", "loopbot_test")
        assert {u: _shape(dst, u) for u in (1, 2)} == expected
    finally:
        dst.close()
