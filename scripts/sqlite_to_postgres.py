"""Copy one SQLite store into a PostgresStore.

Usage: python -m scripts.sqlite_to_postgres <sqlite path> <dsn-env-name> <schema>
Refuses for any user who already has tracks in the target. A crash mid-user leaves partial rows,
so the guard then refuses that user: clear their rows in the target before rerunning.
"""
import os
import sqlite3
import sys

from loopbot.store import Store
from loopbot.store.postgres import PostgresStore
from loopbot.store.sqlite import SqliteStore


def source_user_ids(path: str) -> list[int]:
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        rows = conn.execute("SELECT user_id FROM tracks UNION SELECT user_id FROM playlists ORDER BY 1")
        return [u for (u,) in rows]
    finally:
        conn.close()


def copy_user(src: Store, dst: Store, user_id: int) -> tuple[int, int]:
    if dst.library(user_id):
        raise SystemExit(f"user {user_id}: target already has tracks, refusing")
    new_ids = {t.id: dst.add_track(user_id, t.title, t.file_id, t.duration, t.source).id for t in src.library(user_id)}
    source_playlists = src.playlists(user_id)
    reuse = dst.active_playlist(user_id).id  # add_track created the default; the first copied playlist takes it
    active_id = src.active_playlist(user_id).id
    copies = {}
    for playlist in source_playlists:
        copies[playlist.id] = dst.save_playlist(user_id, reuse, playlist.name, [new_ids[i] for i in playlist.track_ids])
        reuse = None
    active_copy = copies.get(active_id)
    if active_copy is not None:
        dst.save_playlist(user_id, active_copy.id, active_copy.name, active_copy.track_ids)
    return len(new_ids), len(source_playlists)


def main(sqlite_path: str, dsn_env: str, schema: str) -> None:
    src = SqliteStore(sqlite_path)
    dst = PostgresStore(os.environ[dsn_env], schema=schema)
    try:
        for user_id in source_user_ids(sqlite_path):
            tracks, playlists = copy_user(src, dst, user_id)
            print(f"user {user_id}: {tracks} tracks, {playlists} playlists")
    finally:
        src.close()
        dst.close()


if __name__ == "__main__":
    if len(sys.argv) != 4:
        raise SystemExit(__doc__)
    main(*sys.argv[1:])
