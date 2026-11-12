import json
import re
import urllib.parse
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass

SEARCH_URL = "https://lrclib.net/api/search"
USER_AGENT = "loopbot (lyrics)"
TIMEOUT = 8
MAX_DURATION_DIFF = 15

_HANGUL = re.compile(r"[가-힣]")


@dataclass(frozen=True)
class Lyrics:
    source_id: int
    synced: str


def clean_title(title: str, performer: str | None) -> str:
    text = re.sub(r"\[[^\]]*\]", "", title)
    text = text.split("|")[0].split(" / ")[0]
    text = re.sub(r"\([^)]*\)", "", text)
    pieces = [p.strip() for p in text.split(" - ") if p.strip()]
    kept = [p for p in pieces if "LIVE WORSHIP" not in p and "워십" not in p and p != performer]
    pieces = kept or pieces
    if not pieces:
        return title.strip()
    best = max(pieces, key=lambda p: len(_HANGUL.findall(p))) if any(_HANGUL.search(p) for p in pieces) else pieces[-1]
    best = re.sub(r"^\d+(\.|\s)\s*", "", best)
    return re.sub(r"\s+", " ", best).strip()


def pick_best(candidates: list[dict], duration: int | None) -> dict | None:
    synced = [c for c in candidates if c.get("syncedLyrics")]
    if duration is None:
        return synced[0] if synced else None
    near = [c for c in synced if c.get("duration") is not None and abs(c["duration"] - duration) <= MAX_DURATION_DIFF]
    return min(near, key=lambda c: abs(c["duration"] - duration)) if near else None


def _fetch_json(url: str) -> list | dict:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return json.load(resp)


def search(title: str, artist: str | None, duration: int | None, fetch: Callable[[str], list | dict] = _fetch_json) -> Lyrics | None:
    url = SEARCH_URL + "?" + urllib.parse.urlencode({"q": clean_title(title, artist)})
    try:
        found = fetch(url)
    except (OSError, TimeoutError, ValueError):
        return None
    if not isinstance(found, list):
        return None
    best = pick_best([c for c in found if isinstance(c, dict)], duration)
    return Lyrics(best["id"], best["syncedLyrics"]) if best else None
