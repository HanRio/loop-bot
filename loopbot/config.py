from collections.abc import Mapping
from dataclasses import dataclass

REQUIRED_KEYS = ("BOT_TOKEN", "ALLOWED_USER_IDS", "WEBAPP_URL")
DEFAULT_DB_PATH = "data/loopbot.db"


@dataclass(frozen=True)
class Config:
    bot_token: str
    allowed_user_ids: frozenset[int]
    webapp_url: str
    ytdlp_cookies: str | None
    db_path: str


def load_config(env: Mapping[str, str]) -> Config:
    missing = [key for key in REQUIRED_KEYS if not env.get(key)]
    if missing:
        raise ValueError("필수 환경변수 없음: " + ", ".join(missing))

    return Config(
        bot_token=env["BOT_TOKEN"],
        allowed_user_ids=frozenset(
            int(part) for part in env["ALLOWED_USER_IDS"].split(",") if part.strip()
        ),
        webapp_url=env["WEBAPP_URL"],
        ytdlp_cookies=env.get("YTDLP_COOKIES") or None,
        db_path=env.get("DB_PATH") or DEFAULT_DB_PATH,
    )
