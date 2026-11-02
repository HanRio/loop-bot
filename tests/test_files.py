import hashlib
import hmac
import json
import logging
import os
import threading
from pathlib import Path
from urllib.parse import urlencode

import httpx
import pytest

from loopbot.config import load_config
from loopbot.files import Deps, FileCache, TooBig, VerifiedUser, make_server, verify_init_data

TEST_TOKEN = "0000000000:test-bot-token"
NOW = 1_800_000_000
ALLOWED_ID = 1001
OTHER_ID = 2002
FRIEND_ID = 3003
AUDIO = b"AUDIO-BYTES"

# Public sample from https://docs.telegram-mini-apps.com/packages/tma-js-init-data/validating (not a secret).
PUBLISHED_TOKEN = "5768337691:AAH5YkoiEuPk8-FZa32hStHTqXiLPtAEhx8"
PUBLISHED_INIT_DATA = (
    "query_id=AAHdF6IQAAAAAN0XohDhrOrc&user=%7B%22id%22%3A279058397%2C%22first_name%22%3A%22Vladislav%22%2C%22last_name%22%3A%22Kibenko%22%2C%22username%22%3A%22vdkfrost%22%2C%22language_code%22%3A%22ru%22%2C%22is_premium%22%3Atrue%7D&auth_date=1662771648&hash=c501b71e775f74ce10e377dea85a7ea24ecd640b223ea86dfe453e0eaed2e2b2"
)


# Test-only signer that follows the Telegram rules, so the tests do not depend on files.py.
def sign(fields: list[tuple[str, str]], bot_token: str = TEST_TOKEN) -> str:
    data_check = "\n".join(f"{key}={value}" for key, value in sorted(fields, key=lambda kv: kv[0]))
    secret = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    digest = hmac.new(secret, data_check.encode(), hashlib.sha256).hexdigest()
    return urlencode([*fields, ("hash", digest)])


def signed(user_json: str, auth_date: str = str(NOW - 60)) -> str:
    return sign([("query_id", "AAHtest"), ("user", user_json), ("auth_date", auth_date)])


def signed_user(user: dict) -> str:
    return signed(json.dumps(user))


def tamper_last_char(text: str) -> str:
    return text[:-1] + ("1" if text[-1] == "0" else "0")


# verify_init_data

def test_verify_accepts_published_telegram_sample():
    user = verify_init_data(PUBLISHED_INIT_DATA, PUBLISHED_TOKEN, 1_662_771_700)

    assert user is not None
    assert user.id == 279058397


def test_verify_accepts_user_with_username():
    user = verify_init_data(signed_user({"id": 42, "username": "Friend"}), TEST_TOKEN, NOW)

    assert user == VerifiedUser(42, "Friend")


def test_verify_returns_none_username_when_absent_empty_or_not_a_string():
    for user in ({"id": 42}, {"id": 42, "username": ""}, {"id": 42, "username": 123}):
        assert verify_init_data(signed_user(user), TEST_TOKEN, NOW) == VerifiedUser(42, None)


@pytest.mark.parametrize(
    "init_data",
    [
        pytest.param(tamper_last_char(signed_user({"id": 42})), id="forged-hash"),
        pytest.param(signed_user({"id": 42}).split("&hash=")[0], id="no-hash"),
        pytest.param(
            signed_user({"id": 42}).rsplit("hash=", 1)[0] + "hash=" + signed_user({"id": 42}).rsplit("hash=", 1)[1].upper(),
            id="uppercase-hash",
        ),
        pytest.param(signed('{"id": 42}', str(NOW - 86401)), id="expired"),
        pytest.param(signed('{"id": 42}', str(NOW + 3600)), id="future"),
        pytest.param(signed('{"id": 42}', "1e10"), id="exponent-auth-date"),
        pytest.param(signed_user({"username": "friend"}), id="no-id"),
        pytest.param(signed_user({"id": True}), id="bool-id"),
        pytest.param(signed("not json"), id="user-not-json"),
    ],
)
def test_verify_rejects_invalid_init_data(init_data):
    assert verify_init_data(init_data, TEST_TOKEN, NOW) is None


# HTTP server

OWNED = {(ALLOWED_ID, 7): "FILE-7", (OTHER_ID, 8): "FILE-8", (FRIEND_ID, 9): "FILE-9"}


class Fakes:
    def __init__(self) -> None:
        self.lookups: list[tuple[int, int]] = []
        self.downloads: list[str] = []
        self.error: Exception | None = None

    def file_id_for(self, user_id: int, track_id: int) -> str | None:
        self.lookups.append((user_id, track_id))
        return OWNED.get((user_id, track_id))

    def download(self, file_id: str, dest: Path) -> None:
        self.downloads.append(file_id)
        if self.error is not None:
            raise self.error
        dest.write_bytes(AUDIO)


@pytest.fixture
def serve(tmp_path):
    cfg = load_config({
        "BOT_TOKEN": TEST_TOKEN,
        "ALLOWED_USER_IDS": str(ALLOWED_ID),
        "ALLOWED_USERNAMES": "friend",
        "WEBAPP_URL": "https://example.invalid/",
        "DATABASE_URL": "postgresql://example.invalid/db",
    })
    fakes = Fakes()
    cache_dir = tmp_path / "cache"
    deps = Deps(
        bot_token=TEST_TOKEN,
        is_allowed=cfg.is_allowed,
        file_id_for=fakes.file_id_for,
        download=fakes.download,
        cache=FileCache(cache_dir),
        now=lambda: NOW,
    )
    server = make_server(deps, "127.0.0.1", 0)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}", fakes, cache_dir
    finally:
        server.shutdown()
        server.server_close()


def auth(init_data: str) -> dict[str, str]:
    return {"X-Telegram-Init-Data": init_data}


def test_get_without_init_data_is_401(serve):
    base, fakes, _ = serve

    r = httpx.get(f"{base}/tracks/7/file")

    assert r.status_code == 401
    assert r.json() == {"error": "expired"}
    assert r.headers["access-control-allow-origin"] == "https://hanrio.github.io"
    assert fakes.lookups == []


def test_get_with_forged_init_data_is_401(serve):
    base, fakes, _ = serve

    r = httpx.get(f"{base}/tracks/7/file", headers=auth(tamper_last_char(signed_user({"id": ALLOWED_ID}))))

    assert r.status_code == 401
    assert fakes.lookups == []


def test_get_by_disallowed_user_is_403_and_touches_nothing(serve):
    base, fakes, _ = serve

    r = httpx.get(f"{base}/tracks/7/file", headers=auth(signed_user({"id": OTHER_ID})))

    assert r.status_code == 403
    assert r.json() == {"error": "forbidden"}
    assert fakes.lookups == []
    assert fakes.downloads == []


def test_get_other_users_track_is_404_without_download(serve):
    base, fakes, _ = serve

    r = httpx.get(f"{base}/tracks/8/file", headers=auth(signed_user({"id": ALLOWED_ID})))

    assert r.status_code == 404
    assert r.json() == {"error": "not_found"}
    assert fakes.downloads == []


def test_get_streams_file_and_serves_second_request_from_cache(serve):
    base, fakes, _ = serve
    headers = auth(signed_user({"id": ALLOWED_ID}))

    first = httpx.get(f"{base}/tracks/7/file", headers=headers)
    second = httpx.get(f"{base}/tracks/7/file", headers=headers)

    assert first.status_code == 200
    assert first.content == AUDIO
    assert first.headers["content-type"] == "audio/mp4"
    assert first.headers["cache-control"] == "private, max-age=31536000"
    assert first.headers["access-control-allow-origin"] == "https://hanrio.github.io"
    assert second.status_code == 200
    assert second.content == AUDIO
    assert fakes.downloads == ["FILE-7"]


def test_get_allows_user_listed_by_username(serve):
    base, _, _ = serve

    r = httpx.get(f"{base}/tracks/9/file", headers=auth(signed_user({"id": FRIEND_ID, "username": "Friend"})))

    assert r.status_code == 200
    assert r.content == AUDIO


def test_too_big_file_is_413(serve):
    base, fakes, _ = serve
    fakes.error = TooBig()

    r = httpx.get(f"{base}/tracks/7/file", headers=auth(signed_user({"id": ALLOWED_ID})))

    assert r.status_code == 413
    assert r.json() == {"error": "too_big"}


def test_download_error_is_502_without_token_and_leaves_no_cache_file(serve, caplog):
    base, fakes, cache_dir = serve
    caplog.set_level(logging.INFO)
    fakes.error = RuntimeError(f"https://api.telegram.org/bot{TEST_TOKEN}/getFile failed")

    r = httpx.get(f"{base}/tracks/7/file", headers=auth(signed_user({"id": ALLOWED_ID})))

    assert r.status_code == 502
    assert r.json() == {"error": "upstream"}
    assert TEST_TOKEN not in r.text
    assert TEST_TOKEN not in caplog.text
    assert list(cache_dir.iterdir()) == []


def test_options_is_204_with_cors_headers(serve):
    base, _, _ = serve

    r = httpx.options(f"{base}/tracks/7/file")

    assert r.status_code == 204
    assert r.headers["access-control-allow-headers"] == "x-telegram-init-data"
    assert r.headers["access-control-allow-origin"] == "https://hanrio.github.io"


@pytest.mark.parametrize("path", ["/tracks/abc/file", "/tracks/1", "/tracks/0/file", "/tracks/7/file/extra"])
def test_other_paths_are_404(serve, path):
    base, fakes, _ = serve

    r = httpx.get(f"{base}{path}")

    assert r.status_code == 404
    assert r.json() == {"error": "not_found"}
    assert fakes.lookups == []


# FileCache

def test_cache_evicts_oldest_file_over_limit_and_keeps_new_one(tmp_path):
    cache = FileCache(tmp_path, max_bytes=10)
    old = cache.store("old", lambda dest: dest.write_bytes(b"x" * 6))
    os.utime(old, (1_000, 1_000))

    new = cache.store("new", lambda dest: dest.write_bytes(b"y" * 6))

    assert not old.exists()
    assert new.exists()


def test_cache_keeps_new_file_even_when_it_alone_exceeds_limit(tmp_path):
    cache = FileCache(tmp_path, max_bytes=10)
    small = cache.store("small", lambda dest: dest.write_bytes(b"x" * 4))
    os.utime(small, (1_000, 1_000))

    big = cache.store("big", lambda dest: dest.write_bytes(b"y" * 20))

    assert big.exists()
    assert not small.exists()


def test_failed_fill_leaves_no_partial_file(tmp_path):
    cache = FileCache(tmp_path)

    def fill(dest: Path) -> None:
        dest.write_bytes(b"partial")
        raise RuntimeError("boom")

    with pytest.raises(RuntimeError, match="boom"):
        cache.store("x", fill)

    assert list(tmp_path.iterdir()) == []
    assert cache.get("x") is None
