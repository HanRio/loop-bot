import sqlite3
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from pathlib import Path

from loopbot.store import DEFAULT_PLAYLIST_NAME, Playlist, Track

SCHEMA = (
    """CREATE TABLE IF NOT EXISTS tracks (
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL,
      title TEXT NOT NULL, file_id TEXT NOT NULL, duration INTEGER, source TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')))""",
    """CREATE TABLE IF NOT EXISTS playlists (
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')))""",
    """CREATE TABLE IF NOT EXISTS playlist_tracks (
      playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
      track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      PRIMARY KEY (playlist_id, track_id))""",
    """CREATE TABLE IF NOT EXISTS user_state (
      user_id INTEGER PRIMARY KEY,
      active_playlist_id INTEGER REFERENCES playlists(id) ON DELETE SET NULL)""",
    "CREATE INDEX IF NOT EXISTS idx_playlists_user ON playlists(user_id, id)",
)
# Created after the migration: the legacy index of the same name covers the dropped position column.
TRACKS_INDEX = "CREATE INDEX IF NOT EXISTS idx_tracks_user ON tracks(user_id, id)"

TRACK_COLUMNS = "id, user_id, title, file_id, duration, source"


class SqliteStore:
    def __init__(self, path: str) -> None:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(path, autocommit=True, check_same_thread=False)
        self._conn.execute("PRAGMA foreign_keys = ON")
        with self._tx():
            for stmt in SCHEMA:
                self._conn.execute(stmt)
            self._migrate_positions()
            self._conn.execute(TRACKS_INDEX)

    def close(self) -> None:
        self._conn.close()

    @contextmanager
    def _tx(self) -> Iterator[None]:
        self._conn.execute("BEGIN IMMEDIATE")
        try:
            yield
        except BaseException:
            self._conn.execute("ROLLBACK")
            raise
        self._conn.execute("COMMIT")

    def _migrate_positions(self) -> None:
        columns = [row[1] for row in self._conn.execute("PRAGMA table_info(tracks)")]
        if "position" not in columns:
            return
        users = [u for (u,) in self._conn.execute("SELECT DISTINCT user_id FROM tracks ORDER BY user_id")]
        for user_id in users:
            playlist_id = self._create_playlist(user_id, DEFAULT_PLAYLIST_NAME)
            self._conn.execute(
                "INSERT INTO playlist_tracks (playlist_id, track_id, position) "
                "SELECT ?, id, ROW_NUMBER() OVER (ORDER BY position, id) FROM tracks WHERE user_id = ?",
                (playlist_id, user_id),
            )
            self._set_active(user_id, playlist_id)
        self._conn.execute("DROP INDEX IF EXISTS idx_tracks_user")
        self._conn.execute("ALTER TABLE tracks DROP COLUMN position")

    def _create_playlist(self, user_id: int, name: str) -> int:
        return self._conn.execute(
            "INSERT INTO playlists (user_id, name) VALUES (?, ?)", (user_id, name)
        ).lastrowid

    def _set_active(self, user_id: int, playlist_id: int) -> None:
        self._conn.execute(
            "INSERT INTO user_state (user_id, active_playlist_id) VALUES (?, ?) "
            "ON CONFLICT (user_id) DO UPDATE SET active_playlist_id = excluded.active_playlist_id",
            (user_id, playlist_id),
        )

    def _owned_playlist_id(self, user_id: int, playlist_id: int | None) -> int | None:
        if playlist_id is None:
            return None
        row = self._conn.execute(
            "SELECT id FROM playlists WHERE id = ? AND user_id = ?", (playlist_id, user_id)
        ).fetchone()
        return row[0] if row else None

    def _active_id(self, user_id: int) -> int:
        row = self._conn.execute(
            "SELECT active_playlist_id FROM user_state WHERE user_id = ?", (user_id,)
        ).fetchone()
        if row and row[0] is not None:
            return row[0]
        latest = self._conn.execute(
            "SELECT MAX(id) FROM playlists WHERE user_id = ?", (user_id,)
        ).fetchone()[0]
        playlist_id = latest if latest is not None else self._create_playlist(user_id, DEFAULT_PLAYLIST_NAME)
        self._set_active(user_id, playlist_id)
        return playlist_id

    def _playlist(self, playlist_id: int) -> Playlist:
        user_id, name = self._conn.execute(
            "SELECT user_id, name FROM playlists WHERE id = ?", (playlist_id,)
        ).fetchone()
        track_ids = tuple(t for (t,) in self._conn.execute(
            "SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position", (playlist_id,)
        ))
        return Playlist(playlist_id, user_id, name, track_ids)

    def add_track(self, user_id: int, title: str, file_id: str, duration: int | None, source: str | None) -> Track:
        with self._tx():
            track_id = self._conn.execute(
                "INSERT INTO tracks (user_id, title, file_id, duration, source) VALUES (?, ?, ?, ?, ?)",
                (user_id, title, file_id, duration, source),
            ).lastrowid
            playlist_id = self._active_id(user_id)
            self._conn.execute(
                "INSERT INTO playlist_tracks (playlist_id, track_id, position) "
                "VALUES (?, ?, (SELECT COALESCE(MAX(position) + 1, 0) FROM playlist_tracks WHERE playlist_id = ?))",
                (playlist_id, track_id, playlist_id),
            )
        return Track(track_id, user_id, title, file_id, duration, source)

    def library(self, user_id: int) -> list[Track]:
        rows = self._conn.execute(
            f"SELECT {TRACK_COLUMNS} FROM tracks WHERE user_id = ? ORDER BY id", (user_id,)
        ).fetchall()
        return [Track(*row) for row in rows]

    def playlists(self, user_id: int) -> list[Playlist]:
        ids = [i for (i,) in self._conn.execute(
            "SELECT id FROM playlists WHERE user_id = ? ORDER BY id", (user_id,)
        )]
        return [self._playlist(i) for i in ids]

    def active_playlist(self, user_id: int) -> Playlist:
        with self._tx():
            return self._playlist(self._active_id(user_id))

    def save_playlist(self, user_id: int, playlist_id: int | None, name: str, track_ids: Sequence[int]) -> Playlist:
        with self._tx():
            owned = self._owned_playlist_id(user_id, playlist_id)
            if owned is None:
                owned = self._create_playlist(user_id, name)
            else:
                self._conn.execute("UPDATE playlists SET name = ? WHERE id = ?", (name, owned))
            library_ids = {i for (i,) in self._conn.execute("SELECT id FROM tracks WHERE user_id = ?", (user_id,))}
            ordered = [i for i in dict.fromkeys(track_ids) if i in library_ids]
            self._conn.execute("DELETE FROM playlist_tracks WHERE playlist_id = ?", (owned,))
            self._conn.executemany(
                "INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)",
                [(owned, track_id, pos) for pos, track_id in enumerate(ordered)],
            )
            self._set_active(user_id, owned)
            return self._playlist(owned)

    def delete_playlist(self, user_id: int, playlist_id: int) -> None:
        with self._tx():
            self._conn.execute("DELETE FROM playlists WHERE id = ? AND user_id = ?", (playlist_id, user_id))

    def delete_tracks(self, user_id: int, track_ids: Sequence[int]) -> None:
        with self._tx():
            self._conn.executemany(
                "DELETE FROM tracks WHERE id = ? AND user_id = ?", [(i, user_id) for i in set(track_ids)]
            )
