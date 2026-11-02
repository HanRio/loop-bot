import base64
import json
import logging
import re
from collections.abc import Sequence
from dataclasses import dataclass

from loopbot.store import Playlist, Track

MAX_LINKS = 10
TITLE_MAX = 40
MAX_URL_LEN = 4096
_TITLE_STEPS = (TITLE_MAX, 20, 8, 0)
INT64_MAX = 2**63 - 1
NAME_MAX = 20
DEFAULT_NEW_NAME = "새 플레이리스트"

_URL_CHARS = r"A-Za-z0-9\-._~:/?#\[\]@!$&'*+;=%"
# Text around a link may touch it directly, so a link ends at the first non-URL character (Korean, brackets, comma).
_URL_TOKEN = re.compile(
    r"(?:(?P<scheme>https?://)|(?<![A-Za-z0-9_./-]))(?:(?:www|m|music)\.)?(?:youtube\.com|youtu\.be)/"
    rf"[{_URL_CHARS}]+?(?=https?://|[^{_URL_CHARS}]|$)",
    re.IGNORECASE,
)
_TRAILING_PUNCTUATION = ".!?;:'"

_MSG_MALFORMED = "목록이 바뀌었어요. 버튼을 다시 눌러주세요"
_MSG_TOO_MANY = f"링크는 한 번에 {MAX_LINKS}개까지 넣을 수 있어요"


class PayloadError(ValueError):
    pass


@dataclass(frozen=True)
class WebAppAction:
    playlist: int | None
    name: str
    tracks: tuple[int, ...]
    delete_tracks: tuple[int, ...]
    delete_playlist: bool
    add: tuple[str, ...]
    play: bool


def extract_youtube_urls(text: str) -> list[str]:
    urls = (
        (m.group() if m["scheme"] else f"https://{m.group()}").rstrip(_TRAILING_PUNCTUATION)
        for m in _URL_TOKEN.finditer(text)
    )
    return list(dict.fromkeys(urls))


def build_webapp_url(base: str, library: Sequence[Track], playlists: Sequence[Playlist], active_id: int) -> str:
    pls = [{"i": p.id, "n": p.name[:NAME_MAX], "t": list(p.track_ids)} for p in playlists]
    for limit in _TITLE_STEPS:
        lib = [{"i": t.id, "t": t.title[:limit]} for t in library]
        data = {"v": 2, "lib": lib, "pls": pls, "a": active_id}
        raw = json.dumps(data, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        encoded = base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")
        url = f"{base}#d={encoded}"
        if len(url) <= MAX_URL_LEN:
            break
    if len(url) > MAX_URL_LEN:
        logging.warning("webapp url is %d chars (limit %d) even without titles; %d tracks", len(url), MAX_URL_LEN, len(library))
    return url


def _is_int(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _load_object(raw: str) -> dict:
    try:
        data = json.loads(raw)
    except (ValueError, RecursionError) as exc:
        raise PayloadError(_MSG_MALFORMED) from exc
    if not isinstance(data, dict):
        raise PayloadError(_MSG_MALFORMED)
    return data


def _is_id(value: object) -> bool:
    return _is_int(value) and 0 <= value <= INT64_MAX


def _int_list(data: dict, key: str) -> tuple[int, ...]:
    values = data.get(key, [])
    if not isinstance(values, list) or not all(_is_id(v) for v in values):
        raise PayloadError(_MSG_MALFORMED)
    return tuple(values)


def _str_list(data: dict, key: str) -> tuple[str, ...]:
    values = data.get(key, [])
    if not isinstance(values, list) or not all(isinstance(v, str) for v in values):
        raise PayloadError(_MSG_MALFORMED)
    return tuple(values)


def _bool(data: dict, key: str) -> bool:
    value = data.get(key, False)
    if not isinstance(value, bool):
        raise PayloadError(_MSG_MALFORMED)
    return value


def _name(data: dict) -> str:
    name = data.get("name", "")
    if not isinstance(name, str):
        raise PayloadError(_MSG_MALFORMED)
    return name.strip()[:NAME_MAX] or DEFAULT_NEW_NAME


def parse_action(raw: str) -> WebAppAction:
    data = _load_object(raw)
    version = data.get("v")
    if not _is_int(version) or version != 2:
        raise PayloadError(_MSG_MALFORMED)
    playlist = data.get("playlist")
    if playlist is not None and not _is_id(playlist):
        raise PayloadError(_MSG_MALFORMED)
    add = tuple(extract_youtube_urls("\n".join(_str_list(data, "add"))))
    if len(add) > MAX_LINKS:
        raise PayloadError(_MSG_TOO_MANY)
    return WebAppAction(
        playlist=playlist,
        name=_name(data),
        tracks=_int_list(data, "tracks"),
        delete_tracks=_int_list(data, "delete_tracks"),
        delete_playlist=_bool(data, "delete_playlist"),
        add=add,
        play=_bool(data, "play"),
    )
