from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

from loopbot.config import Config

DEFAULT_PLAYLIST_NAME = "기본"


@dataclass(frozen=True)
class Track:
    id: int
    user_id: int
    title: str
    file_id: str
    duration: int | None
    source: str | None


@dataclass(frozen=True)
class Playlist:
    id: int
    user_id: int
    name: str
    track_ids: tuple[int, ...]


class Store(Protocol):
    def add_track(self, user_id: int, title: str, file_id: str, duration: int | None, source: str | None) -> Track: ...
    def library(self, user_id: int) -> list[Track]: ...
    def active_playlist(self, user_id: int) -> Playlist: ...
    def playable_playlists(self, user_id: int) -> list[Playlist]: ...
    def playlist_tracks(self, user_id: int, playlist_id: int) -> tuple[Playlist, list[Track]] | None: ...
    def play_messages(self, user_id: int) -> list[int]: ...
    def set_play_messages(self, user_id: int, message_ids: Sequence[int]) -> None: ...


def open_store(cfg: Config) -> Store:
    from loopbot.store.postgres import PostgresStore

    return PostgresStore(cfg.database_url)
