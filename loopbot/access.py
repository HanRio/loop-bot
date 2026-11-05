import logging
import time
from collections.abc import Callable, Iterable

from loopbot.config import Config

TTL_SECONDS = 30


class Access:
    def __init__(
        self,
        cfg: Config,
        fetch: Callable[[], Iterable[str]],
        now: Callable[[], float] = time.monotonic,
    ) -> None:
        self._cfg = cfg
        self._fetch = fetch
        self._now = now
        self._names: frozenset[str] = frozenset()
        self._loaded_at = float("-inf")

    def is_allowed(self, user_id: int, username: str | None) -> bool:
        if self._cfg.is_allowed(user_id, username):
            return True
        if not username:
            return False
        return username.lower() in self._current_names()

    def _current_names(self) -> frozenset[str]:
        now = self._now()
        if now - self._loaded_at > TTL_SECONDS:
            # Stamped before the fetch, so a failed fetch is not retried until the next TTL.
            self._loaded_at = now
            try:
                self._names = frozenset(self._fetch())
            except Exception as err:
                # 예외 메시지에는 DB 주소가 있을 수 있어서 이름만 남긴다.
                logging.warning("allowed usernames refresh failed: %s", type(err).__name__)
        return self._names
