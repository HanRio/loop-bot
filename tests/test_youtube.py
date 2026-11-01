import pytest
from loopbot.youtube import check_limits, FetchError

def test_check_limits_passes_short_and_unknown():
    check_limits({"duration": 3600})
    check_limits({})

def test_check_limits_rejects_long():
    with pytest.raises(FetchError, match="60분"):
        check_limits({"duration": 3601})

def test_check_limits_rejects_live():
    with pytest.raises(FetchError, match="라이브"):
        check_limits({"is_live": True})
