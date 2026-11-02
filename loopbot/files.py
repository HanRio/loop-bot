import hashlib
import hmac
import json
import logging
import os
import re
import shutil
import tempfile
import time
from collections.abc import Callable
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit

import httpx
import psycopg
from dotenv import load_dotenv
from psycopg import sql

from loopbot.config import load_config

ALLOWED_ORIGIN = "https://hanrio.github.io"
MAX_AGE_SEC = 86400
MAX_CLOCK_SKEW_SEC = 60
CACHE_MAX_BYTES = 10 * 1024**3
TIMEOUT_SEC = 60
CONNECT_TIMEOUT_SEC = 10
DB_SCHEMA = "loopbot"  # same default as PostgresStore
PART_SUFFIX = ".part"
HASH_PATTERN = re.compile(r"[0-9a-f]{64}")
AUTH_DATE_PATTERN = re.compile(r"\d+", re.ASCII)
TRACK_PATH = re.compile(r"/tracks/([1-9][0-9]{0,17})/(file|sheet)")
CONTENT_TYPES = {"file": "audio/mp4", "sheet": "image/jpeg"}
TELEGRAM_API = "https://api.telegram.org"
CORS_HEADERS = {
    "access-control-allow-origin": ALLOWED_ORIGIN,
    "access-control-allow-headers": "x-telegram-init-data",
    "access-control-allow-methods": "GET, OPTIONS",
    "vary": "origin",
}


@dataclass(frozen=True)
class VerifiedUser:
    id: int
    username: str | None


def _first(pairs: list[tuple[str, str]], key: str) -> str | None:
    return next((value for k, value in pairs if k == key), None)


def _parse_user(raw: str | None) -> VerifiedUser | None:
    try:
        parsed = json.loads(raw if raw is not None else "null")
    except ValueError:
        return None
    if not isinstance(parsed, dict):
        return None
    user_id = parsed.get("id")
    if not isinstance(user_id, int) or isinstance(user_id, bool) or abs(user_id) >= 2**53:
        return None
    username = parsed.get("username")
    if not isinstance(username, str) or username == "":
        username = None
    return VerifiedUser(user_id, username)


def verify_init_data(init_data: str, bot_token: str, now: int, max_age: int = MAX_AGE_SEC) -> VerifiedUser | None:
    pairs = parse_qsl(init_data, keep_blank_values=True)
    received_hash = _first(pairs, "hash")
    if received_hash is None or not HASH_PATTERN.fullmatch(received_hash):
        return None

    raw_auth_date = _first(pairs, "auth_date") or ""
    if not AUTH_DATE_PATTERN.fullmatch(raw_auth_date):
        return None
    auth_date = int(raw_auth_date)
    if auth_date > now + MAX_CLOCK_SKEW_SEC or now - auth_date > max_age:
        return None

    data_check = "\n".join(
        f"{key}={value}" for key, value in sorted((kv for kv in pairs if kv[0] != "hash"), key=lambda kv: kv[0])
    )
    secret = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    expected = hmac.new(secret, data_check.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, received_hash):
        return None
    return _parse_user(_first(pairs, "user"))


class FileCache:
    def __init__(self, directory: Path, max_bytes: int = CACHE_MAX_BYTES) -> None:
        self._dir = directory
        self._max_bytes = max_bytes
        self._dir.mkdir(parents=True, exist_ok=True)

    def path(self, file_id: str) -> Path:
        return self._dir / hashlib.sha256(file_id.encode()).hexdigest()

    def get(self, file_id: str) -> Path | None:
        path = self.path(file_id)
        try:
            os.utime(path)
        except FileNotFoundError:
            return None
        return path

    def store(self, file_id: str, fill: Callable[[Path], None]) -> Path:
        final = self.path(file_id)
        fd, tmp_name = tempfile.mkstemp(dir=self._dir, suffix=PART_SUFFIX)
        os.close(fd)
        tmp = Path(tmp_name)
        try:
            fill(tmp)
            os.replace(tmp, final)
        except BaseException:
            tmp.unlink(missing_ok=True)
            raise
        self._evict(keep=final)
        return final

    def _evict(self, keep: Path) -> None:
        # ponytail: 파일별 잠금 없음. 동시에 같은 곡을 받으면 마지막 것이 남는다.
        entries = [p for p in self._dir.iterdir() if p.is_file() and p.suffix != PART_SUFFIX]
        total = sum(p.stat().st_size for p in entries)
        for path in sorted((p for p in entries if p != keep), key=lambda p: p.stat().st_mtime):
            if total <= self._max_bytes:
                break
            total -= path.stat().st_size
            path.unlink(missing_ok=True)


class TooBig(Exception):
    pass


def download_from_telegram(bot_token: str, file_id: str, dest: Path) -> None:
    timeout = httpx.Timeout(TIMEOUT_SEC, connect=CONNECT_TIMEOUT_SEC)
    info = httpx.get(f"{TELEGRAM_API}/bot{bot_token}/getFile", params={"file_id": file_id}, timeout=timeout).json()
    if not info.get("ok"):
        if "too big" in (info.get("description") or "").lower():
            raise TooBig()
        raise RuntimeError("getFile rejected")

    url = f"{TELEGRAM_API}/file/bot{bot_token}/{info['result']['file_path']}"
    with httpx.stream("GET", url, timeout=timeout) as response:
        if not response.is_success:
            raise RuntimeError("download failed")
        with dest.open("wb") as out:
            for chunk in response.iter_bytes():
                out.write(chunk)


# Read rule for a track's audio and sheet: the user owns it, or it sits in a shared playlist.
READABLE_TRACK_SQL = (
    "t.id = %s AND (t.user_id = %s OR EXISTS ("
    "SELECT 1 FROM playlist_tracks pt JOIN playlists p ON p.id = pt.playlist_id "
    "WHERE pt.track_id = t.id AND p.shared))"
)
FILE_ID_SQL = f"SELECT t.file_id FROM tracks t WHERE {READABLE_TRACK_SQL}"
SHEET_FILE_ID_SQL = (
    "SELECT m.sheet_file_id FROM tracks t JOIN track_media m ON m.track_id = t.id "
    f"WHERE {READABLE_TRACK_SQL} AND m.sheet_file_id IS NOT NULL"
)


def _lookup(database_url: str, query: str, user_id: int, track_id: int, schema: str) -> str | None:
    # ponytail: 요청마다 연결. 부하가 생기면 풀을 쓴다.
    with psycopg.connect(database_url, autocommit=True, prepare_threshold=None, connect_timeout=10) as conn:
        conn.execute(sql.SQL("SET search_path TO {}").format(sql.Identifier(schema)))
        row = conn.execute(query, (track_id, user_id)).fetchone()
    return row[0] if row else None


def file_id_for(database_url: str, user_id: int, track_id: int, schema: str = DB_SCHEMA) -> str | None:
    return _lookup(database_url, FILE_ID_SQL, user_id, track_id, schema)


def sheet_file_id_for(database_url: str, user_id: int, track_id: int, schema: str = DB_SCHEMA) -> str | None:
    return _lookup(database_url, SHEET_FILE_ID_SQL, user_id, track_id, schema)


@dataclass(frozen=True)
class Deps:
    bot_token: str
    is_allowed: Callable[[int, str | None], bool]
    file_id_for: Callable[[int, int], str | None]
    sheet_file_id_for: Callable[[int, int], str | None]
    download: Callable[[str, Path], None]
    cache: FileCache
    now: Callable[[], int]


def make_server(deps: Deps, host: str, port: int) -> ThreadingHTTPServer:
    class Handler(FileHandler):
        pass

    Handler.deps = deps
    return ThreadingHTTPServer((host, port), Handler)


class FileHandler(BaseHTTPRequestHandler):
    deps: Deps
    timeout = TIMEOUT_SEC
    protocol_version = "HTTP/1.1"

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:
        match = TRACK_PATH.fullmatch(urlsplit(self.path).path)
        if match is None:
            self._json(404, "not_found")
            return

        user = verify_init_data(self.headers.get("X-Telegram-Init-Data", ""), self.deps.bot_token, self.deps.now())
        if user is None:
            self._json(401, "expired")
            return
        if not self.deps.is_allowed(user.id, user.username):
            self._json(403, "forbidden")
            return

        kind = match.group(2)
        lookup = self.deps.file_id_for if kind == "file" else self.deps.sheet_file_id_for
        file_id = lookup(user.id, int(match.group(1)))
        if file_id is None:
            self._json(404, "not_found")
            return

        try:
            path = self.deps.cache.get(file_id) or self.deps.cache.store(
                file_id, lambda dest: self.deps.download(file_id, dest)
            )
        except TooBig:
            self._json(413, "too_big")
            return
        except Exception as err:
            # 예외 메시지에는 봇 토큰이 든 URL이 있을 수 있어서 이름만 남긴다.
            logging.warning("file fetch failed: %s", type(err).__name__)
            self._json(502, "upstream")
            return
        self._send_file(path, CONTENT_TYPES[kind])

    def _send_file(self, path: Path, content_type: str) -> None:
        self.send_response(200)
        self._cors()
        self.send_header("content-type", content_type)
        self.send_header("cache-control", "private, max-age=31536000")
        self.send_header("content-length", str(path.stat().st_size))
        self.end_headers()
        try:
            with path.open("rb") as f:
                shutil.copyfileobj(f, self.wfile)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _json(self, status: int, code: str) -> None:
        body = json.dumps({"error": code}).encode()
        self.send_response(status)
        self._cors()
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _cors(self) -> None:
        for name, value in CORS_HEADERS.items():
            self.send_header(name, value)

    def log_message(self, format: str, *args) -> None:
        logging.info(format, *args)


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    logging.getLogger("httpx").setLevel(logging.WARNING)  # request URLs contain the bot token
    load_dotenv()
    try:
        cfg = load_config(os.environ)
    except ValueError as e:
        print(e)
        raise SystemExit(1)

    cache_dir = Path(os.environ.get("FILE_CACHE_DIR", "~/.cache/loopbot-files")).expanduser()
    port = int(os.environ.get("FILE_PORT", "8081"))
    deps = Deps(
        bot_token=cfg.bot_token,
        is_allowed=cfg.is_allowed,
        file_id_for=lambda user_id, track_id: file_id_for(cfg.database_url, user_id, track_id),
        sheet_file_id_for=lambda user_id, track_id: sheet_file_id_for(cfg.database_url, user_id, track_id),
        download=lambda file_id, dest: download_from_telegram(cfg.bot_token, file_id, dest),
        cache=FileCache(cache_dir),
        now=lambda: int(time.time()),
    )
    make_server(deps, "127.0.0.1", port).serve_forever()


if __name__ == "__main__":
    main()
