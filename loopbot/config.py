from collections.abc import Mapping
from dataclasses import dataclass

DEFAULT_APPLE_WEBAPP_URL = "https://hanrio.github.io/loop-bot-apple/v.apple/"

REQUIRED_KEYS = ("BOT_TOKEN", "ALLOWED_USER_IDS", "WEBAPP_URL", "DATABASE_URL")


@dataclass(frozen=True)
class Config:
    bot_token: str
    allowed_user_ids: frozenset[int]
    allowed_usernames: frozenset[str]
    webapp_url: str
    ytdlp_cookies: str | None
    database_url: str
    apple_webapp_url: str = DEFAULT_APPLE_WEBAPP_URL

    def is_allowed(self, user_id: int, username: str | None) -> bool:
        return user_id in self.allowed_user_ids or (username or "").lower() in self.allowed_usernames


def _usernames(raw: str) -> frozenset[str]:
    names = (part.strip().removeprefix("@").lower() for part in raw.split(","))
    return frozenset(name for name in names if name)


def load_config(env: Mapping[str, str]) -> Config:
    missing = [key for key in REQUIRED_KEYS if not env.get(key)]
    if missing:
        raise ValueError("필수 환경변수 없음: " + ", ".join(missing))

    return Config(
        bot_token=env["BOT_TOKEN"],
        allowed_user_ids=frozenset(
            int(part) for part in env["ALLOWED_USER_IDS"].split(",") if part.strip()
        ),
        allowed_usernames=_usernames(env.get("ALLOWED_USERNAMES", "")),
        webapp_url=env["WEBAPP_URL"],
        ytdlp_cookies=env.get("YTDLP_COOKIES") or None,
        database_url=env["DATABASE_URL"],
        apple_webapp_url=env.get("APPLE_WEBAPP_URL") or DEFAULT_APPLE_WEBAPP_URL,
    )
