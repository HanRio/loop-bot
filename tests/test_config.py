from loopbot.config import load_config
import pytest

BASE = {"BOT_TOKEN": "t", "ALLOWED_USER_IDS": "1, 2", "WEBAPP_URL": "https://x.github.io/a/",
        "DATABASE_URL": "postgresql://u@h/db"}

def test_load_config_parses_ids_and_defaults():
    cfg = load_config(BASE)
    assert cfg.allowed_user_ids == frozenset({1, 2})
    assert cfg.ytdlp_cookies is None
    assert cfg.database_url == "postgresql://u@h/db"
    assert not hasattr(cfg, "db_path")

def test_load_config_requires_database_url():
    with pytest.raises(ValueError, match="DATABASE_URL"):
        load_config({k: v for k, v in BASE.items() if k != "DATABASE_URL"})

def test_load_config_reports_all_missing():
    with pytest.raises(ValueError, match="BOT_TOKEN.*WEBAPP_URL.*DATABASE_URL"):
        load_config({"ALLOWED_USER_IDS": "1"})

def test_load_config_rejects_non_integer_ids():
    with pytest.raises(ValueError):
        load_config({**BASE, "ALLOWED_USER_IDS": "abc"})
