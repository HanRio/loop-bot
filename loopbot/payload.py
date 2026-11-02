import re

MAX_LINKS = 10

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
