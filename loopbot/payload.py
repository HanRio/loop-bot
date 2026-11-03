import re
from urllib.parse import parse_qs, urlsplit

MAX_LINKS = 10
YOUTUBE_ID = re.compile(r"[A-Za-z0-9_-]{11}")
YOUTUBE_SHORT_HOST = "youtu.be"
YOUTUBE_HOSTS = frozenset({"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"})
YOUTUBE_PATH_PREFIXES = ("/shorts/", "/embed/", "/live/")

_URL_CHARS = r"A-Za-z0-9\-._~:/?#\[\]@!$&'*+;=%"
# Text around a link may touch it directly, so a link ends at the first non-URL character (Korean, brackets, comma).
_URL_TOKEN = re.compile(
    r"(?:(?P<scheme>https?://)|(?<![A-Za-z0-9_./-]))(?:(?:www|m|music)\.)?(?:youtube\.com|youtu\.be)/"
    rf"[{_URL_CHARS}]+?(?=https?://|[^{_URL_CHARS}]|$)",
    re.IGNORECASE,
)
_TRAILING_PUNCTUATION = ".!?;:'"


def extract_youtube_urls(text: str) -> list[str]:
    urls = (
        (m.group() if m["scheme"] else f"https://{m.group()}").rstrip(_TRAILING_PUNCTUATION)
        for m in _URL_TOKEN.finditer(text)
    )
    return list(dict.fromkeys(urls))


def youtube_video_id(url: str) -> str | None:
    try:
        parts = urlsplit(url)
    except ValueError:
        return None
    if parts.scheme not in ("http", "https"):
        return None

    host = parts.hostname
    if host == YOUTUBE_SHORT_HOST:
        video_id = parts.path[1:]
    elif host in YOUTUBE_HOSTS:
        if parts.path == "/watch":
            video_id = parse_qs(parts.query).get("v", [""])[0]
        else:
            video_id = next((parts.path[len(p):] for p in YOUTUBE_PATH_PREFIXES if parts.path.startswith(p)), "")
    else:
        return None
    return video_id if YOUTUBE_ID.fullmatch(video_id) else None
