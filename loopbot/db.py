import sqlite3
from dataclasses import dataclass
from pathlib import Path

MEMORY_PATH = ":memory:"

SCHEMA = """
CREATE TABLE IF NOT EXISTS tracks (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, position INTEGER NOT NULL,
  title TEXT NOT NULL, file_id TEXT NOT NULL, duration INTEGER, source TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tracks_user ON tracks(user_id, position);
"""

TRACK_COLUMNS = "id, user_id, position, title, file_id, duration, source"


@dataclass(frozen=True)
class Track:
    id: int
    user_id: int
    position: int
    title: str
    file_id: str
    duration: int | None
    source: str | None


def _to_track(row: tuple) -> Track:
    return Track(*row)


class TrackRepo:
    def __init__(self, path: str) -> None:
        if path != MEMORY_PATH:
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.executescript(SCHEMA)

    def add(
        self,
        user_id: int,
        title: str,
        file_id: str,
        duration: int | None,
        source: str | None,
    ) -> Track:
        with self._conn:
            cur = self._conn.execute(
                "INSERT INTO tracks (user_id, position, title, file_id, duration, source) "
                "VALUES (?, (SELECT COALESCE(MAX(position) + 1, 0) FROM tracks WHERE user_id = ?), ?, ?, ?, ?)",
                (user_id, user_id, title, file_id, duration, source),
            )
            row = self._conn.execute(
                f"SELECT {TRACK_COLUMNS} FROM tracks WHERE id = ?", (cur.lastrowid,)
            ).fetchone()
        return _to_track(row)

    def list(self, user_id: int) -> list[Track]:
        rows = self._conn.execute(
            f"SELECT {TRACK_COLUMNS} FROM tracks WHERE user_id = ? ORDER BY position",
            (user_id,),
        ).fetchall()
        return [_to_track(row) for row in rows]
