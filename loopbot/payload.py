import base64
import json
from collections.abc import Sequence
from dataclasses import dataclass
from urllib.parse import urlsplit

from loopbot.db import Track

MAX_LINKS = 10
TITLE_MAX = 40
MAX_URL_LEN = 4096
_TITLE_STEPS = (TITLE_MAX, 20, 8, 0)
INT64_MAX = 2**63 - 1

_YOUTUBE_HOSTS = frozenset({"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"})
_SCHEMES = frozenset({"http", "https"})

_MSG_MALFORMED = "목록이 바뀌었어요. 버튼을 다시 눌러주세요"
_MSG_TOO_MANY = f"링크는 한 번에 {MAX_LINKS}개까지 넣을 수 있어요"
_MSG_NOT_YOUTUBE = "유튜브 링크나 음원 파일만 받을 수 있어요"


class PayloadError(ValueError):
    pass


@dataclass(frozen=True)
class WebAppAction:
    order: tuple[int, ...]
    removed: tuple[int, ...]
    add: tuple[str, ...]
    play: bool


def is_youtube_url(text: str) -> bool:
    try:
        parts = urlsplit(text)
        host = parts.hostname
    except ValueError:
        return False
    return parts.scheme in _SCHEMES and host in _YOUTUBE_HOSTS


def extract_youtube_urls(text: str) -> list[str]:
    return list(dict.fromkeys(tok for tok in text.split() if is_youtube_url(tok)))


def build_webapp_url(base: str, tracks: Sequence[Track]) -> str:
    for limit in _TITLE_STEPS:
        items = [{"i": t.id, "t": t.title[:limit]} for t in tracks]
        raw = json.dumps(items, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        encoded = base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")
        url = f"{base}#d={encoded}"
        if len(url) <= MAX_URL_LEN:
            break
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


def _int_list(data: dict, key: str) -> tuple[int, ...]:
    values = data.get(key, [])
    if not isinstance(values, list) or not all(_is_int(v) and 0 <= v <= INT64_MAX for v in values):
        raise PayloadError(_MSG_MALFORMED)
    return tuple(values)


def _str_list(data: dict, key: str) -> tuple[str, ...]:
    values = data.get(key, [])
    if not isinstance(values, list) or not all(isinstance(v, str) for v in values):
        raise PayloadError(_MSG_MALFORMED)
    return tuple(values)


def parse_action(raw: str) -> WebAppAction:
    data = _load_object(raw)
    version = data.get("v")
    if not _is_int(version) or version != 1:
        raise PayloadError(_MSG_MALFORMED)
    order = _int_list(data, "order")
    removed = _int_list(data, "removed")
    add = _str_list(data, "add")
    play = data.get("play", False)
    if not isinstance(play, bool):
        raise PayloadError(_MSG_MALFORMED)
    if len(add) > MAX_LINKS:
        raise PayloadError(_MSG_TOO_MANY)
    if not all(is_youtube_url(u) for u in add):
        raise PayloadError(_MSG_NOT_YOUTUBE)
    return WebAppAction(order=order, removed=removed, add=add, play=play)
