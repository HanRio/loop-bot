import logging

from loopbot.access import TTL_SECONDS, Access
from loopbot.config import load_config

BASE = {"BOT_TOKEN": "t", "ALLOWED_USER_IDS": "1", "WEBAPP_URL": "https://x.io/app/",
        "DATABASE_URL": "postgresql://u@h/db"}


class Clock:
    def __init__(self) -> None:
        self.t = 0.0

    def __call__(self) -> float:
        return self.t


class Fetch:
    def __init__(self, names) -> None:
        self.names = list(names)
        self.calls = 0
        self.error: Exception | None = None

    def __call__(self):
        self.calls += 1
        if self.error is not None:
            raise self.error
        return list(self.names)


def _cfg(**env):
    return load_config({**BASE, **env})


def test_user_id_allowed_without_fetch():
    fetch = Fetch([])
    access = Access(_cfg(), fetch, now=Clock())

    assert access.is_allowed(1, None)
    assert fetch.calls == 0


def test_env_username_allowed_without_fetch():
    fetch = Fetch([])
    access = Access(_cfg(ALLOWED_USERNAMES="Env_User"), fetch, now=Clock())

    assert access.is_allowed(99, "env_user")
    assert fetch.calls == 0


def test_db_username_allowed_case_insensitively():
    fetch = Fetch(["db_user"])
    access = Access(_cfg(), fetch, now=Clock())

    assert access.is_allowed(99, "DB_User")
    assert not access.is_allowed(99, "stranger")


def test_removed_db_username_keeps_working_until_ttl_passes():
    clock = Clock()
    fetch = Fetch(["db_user"])
    access = Access(_cfg(), fetch, now=clock)
    assert access.is_allowed(99, "db_user")

    fetch.names = []
    clock.t = TTL_SECONDS - 1
    assert access.is_allowed(99, "db_user")

    clock.t = TTL_SECONDS + 1
    assert not access.is_allowed(99, "db_user")


def test_fetch_runs_once_within_ttl():
    clock = Clock()
    fetch = Fetch(["db_user"])
    access = Access(_cfg(), fetch, now=clock)

    access.is_allowed(99, "db_user")
    access.is_allowed(99, "stranger")
    clock.t = TTL_SECONDS - 1
    access.is_allowed(99, "db_user")
    assert fetch.calls == 1

    clock.t = TTL_SECONDS + 1
    access.is_allowed(99, "db_user")
    assert fetch.calls == 2


def test_fetch_failure_keeps_last_good_set_and_does_not_raise(caplog):
    clock = Clock()
    fetch = Fetch(["db_user"])
    access = Access(_cfg(), fetch, now=clock)
    assert access.is_allowed(99, "db_user")

    fetch.error = RuntimeError("postgresql://u:secret@h/db")
    clock.t = TTL_SECONDS + 1
    with caplog.at_level(logging.WARNING):
        assert access.is_allowed(99, "db_user")
    assert "RuntimeError" in caplog.text
    assert "secret" not in caplog.text

    calls = fetch.calls
    clock.t = TTL_SECONDS + 2
    assert access.is_allowed(99, "db_user")
    assert fetch.calls == calls


def test_fetch_failure_at_first_denies_db_usernames(caplog):
    fetch = Fetch(["db_user"])
    fetch.error = RuntimeError("boom")
    access = Access(_cfg(), fetch, now=Clock())

    with caplog.at_level(logging.WARNING):
        assert not access.is_allowed(99, "db_user")
    assert fetch.calls == 1


def test_username_none_or_empty_is_denied_without_fetch():
    fetch = Fetch(["db_user"])
    access = Access(_cfg(), fetch, now=Clock())

    assert not access.is_allowed(99, None)
    assert not access.is_allowed(99, "")
    assert fetch.calls == 0
