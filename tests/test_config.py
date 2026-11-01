from loopbot.config import load_config
import pytest

BASE = {"BOT_TOKEN": "t", "ALLOWED_USER_IDS": "1, 2", "WEBAPP_URL": "https://x.github.io/a/"}

def test_load_config_parses_ids_and_defaults():
    cfg = load_config(BASE)
    assert cfg.allowed_user_ids == frozenset({1, 2})
    assert cfg.db_path == "data/loopbot.db"
    assert cfg.ytdlp_cookies is None

def test_load_config_reports_all_missing():
    with pytest.raises(ValueError, match="BOT_TOKEN.*WEBAPP_URL"):
        load_config({"ALLOWED_USER_IDS": "1"})

def test_load_config_rejects_non_integer_ids():
    with pytest.raises(ValueError):
        load_config({**BASE, "ALLOWED_USER_IDS": "abc"})
