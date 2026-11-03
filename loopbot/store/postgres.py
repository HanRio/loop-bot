import re
from collections.abc import Callable, Sequence
from typing import TypeVar

import psycopg
from psycopg import Cursor, sql

from loopbot.payload import youtube_video_id
from loopbot.store import DEFAULT_PLAYLIST_NAME, Playlist, Track

T = TypeVar("T")

SCHEMA_NAME = re.compile(r"^[a-z_][a-z0-9_]*$")
TRACK_COLUMNS = "id, user_id, title, file_id, duration, source"


class PostgresStore:
    def __init__(self, dsn: str, schema: str = "loopbot") -> None:
        if not SCHEMA_NAME.fullmatch(schema):
            raise ValueError(f"잘못된 스키마 이름: {schema!r}")
        self._dsn = dsn
        self._schema = schema
        self._conn = self._connect()

    def _connect(self) -> psycopg.Connection:
        # Session-level search_path: needs the pooler's session mode (port 5432), not transaction mode.
        conn = psycopg.connect(
            self._dsn,
            autocommit=True,
            prepare_threshold=None,
            connect_timeout=10,
            keepalives=1,
            keepalives_idle=30,
        )
        conn.execute(sql.SQL("SET search_path TO {}").format(sql.Identifier(self._schema)))
        return conn

    def close(self) -> None:
        self._conn.close()

    def reset(self) -> None:
        def work(cur: Cursor) -> None:
            cur.execute("TRUNCATE tracks, playlists, playlist_tracks, user_state CASCADE")

        self._run(work)

    def _run(self, work: Callable[[Cursor], T]) -> T:
        try:
            return self._once(work)
        except psycopg.OperationalError:
            # Supavisor drops idle connections; reconnect and replay the method once.
            try:
                self._conn.close()
            except psycopg.Error:
                pass
            self._conn = self._connect()
            return self._once(work)

    def _once(self, work: Callable[[Cursor], T]) -> T:
        with self._conn.transaction(), self._conn.cursor() as cur:
            return work(cur)

    @staticmethod
    def _create_playlist(cur: Cursor, user_id: int, name: str) -> int:
        cur.execute("INSERT INTO playlists (user_id, name) VALUES (%s, %s) RETURNING id", (user_id, name))
        return cur.fetchone()[0]

    @staticmethod
    def _set_active(cur: Cursor, user_id: int, playlist_id: int) -> None:
        cur.execute(
            "INSERT INTO user_state (user_id, active_playlist_id) VALUES (%s, %s) "
            "ON CONFLICT (user_id) DO UPDATE SET active_playlist_id = EXCLUDED.active_playlist_id",
            (user_id, playlist_id),
        )

    def _active_id(self, cur: Cursor, user_id: int) -> int:
        cur.execute("SELECT active_playlist_id FROM user_state WHERE user_id = %s", (user_id,))
        row = cur.fetchone()
        if row and row[0] is not None:
            return row[0]
        cur.execute("SELECT MAX(id) FROM playlists WHERE user_id = %s", (user_id,))
        latest = cur.fetchone()[0]
        playlist_id = latest if latest is not None else self._create_playlist(cur, user_id, DEFAULT_PLAYLIST_NAME)
        self._set_active(cur, user_id, playlist_id)
        return playlist_id

    @staticmethod
    def _playlist(cur: Cursor, playlist_id: int) -> Playlist:
        cur.execute("SELECT user_id, name FROM playlists WHERE id = %s", (playlist_id,))
        user_id, name = cur.fetchone()
        cur.execute("SELECT track_id FROM playlist_tracks WHERE playlist_id = %s ORDER BY position", (playlist_id,))
        return Playlist(playlist_id, user_id, name, tuple(t for (t,) in cur.fetchall()))

    def add_track(self, user_id: int, title: str, file_id: str, duration: int | None, source: str | None) -> Track:
        def work(cur: Cursor) -> Track:
            cur.execute(
                "INSERT INTO tracks (user_id, title, file_id, duration, source) VALUES (%s, %s, %s, %s, %s) "
                "RETURNING id",
                (user_id, title, file_id, duration, source),
            )
            track_id = cur.fetchone()[0]
            video_id = youtube_video_id(source) if source else None
            if video_id is not None:
                cur.execute("INSERT INTO track_media (track_id, video_id) VALUES (%s, %s)", (track_id, video_id))
            playlist_id = self._active_id(cur, user_id)
            cur.execute(
                "INSERT INTO playlist_tracks (playlist_id, track_id, position) "
                "VALUES (%s, %s, (SELECT COALESCE(MAX(position) + 1, 0) FROM playlist_tracks WHERE playlist_id = %s))",
                (playlist_id, track_id, playlist_id),
            )
            return Track(track_id, user_id, title, file_id, duration, source)

        return self._run(work)

    def library(self, user_id: int) -> list[Track]:
        def work(cur: Cursor) -> list[Track]:
            cur.execute(f"SELECT {TRACK_COLUMNS} FROM tracks WHERE user_id = %s ORDER BY id", (user_id,))
            return [Track(*row) for row in cur.fetchall()]

        return self._run(work)

    def active_playlist(self, user_id: int) -> Playlist:
        return self._run(lambda cur: self._playlist(cur, self._active_id(cur, user_id)))

    def playable_playlists(self, user_id: int) -> list[Playlist]:
        def work(cur: Cursor) -> list[Playlist]:
            cur.execute(
                "SELECT id FROM playlists WHERE user_id = %s OR shared = true ORDER BY (user_id <> %s), id",
                (user_id, user_id),
            )
            return [self._playlist(cur, playlist_id) for (playlist_id,) in cur.fetchall()]

        return self._run(work)

    def playlist_tracks(self, user_id: int, playlist_id: int) -> tuple[Playlist, list[Track]] | None:
        def work(cur: Cursor) -> tuple[Playlist, list[Track]] | None:
            cur.execute("SELECT user_id, shared FROM playlists WHERE id = %s", (playlist_id,))
            row = cur.fetchone()
            if row is None or (row[0] != user_id and not row[1]):
                return None
            cur.execute(
                "SELECT t.id, t.user_id, t.title, t.file_id, t.duration, t.source "
                "FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id "
                "WHERE pt.playlist_id = %s ORDER BY pt.position",
                (playlist_id,),
            )
            tracks = [Track(*r) for r in cur.fetchall()]
            return self._playlist(cur, playlist_id), tracks

        return self._run(work)

    def play_messages(self, user_id: int) -> list[int]:
        def work(cur: Cursor) -> list[int]:
            cur.execute("SELECT play_message_ids FROM user_state WHERE user_id = %s", (user_id,))
            row = cur.fetchone()
            return list(row[0]) if row else []

        return self._run(work)

    def set_play_messages(self, user_id: int, message_ids: Sequence[int]) -> None:
        ids = list(message_ids)
        self._run(lambda cur: cur.execute(
            "INSERT INTO user_state (user_id, play_message_ids) VALUES (%s, %s::bigint[]) "
            "ON CONFLICT (user_id) DO UPDATE SET play_message_ids = EXCLUDED.play_message_ids",
            (user_id, ids),
        ))
