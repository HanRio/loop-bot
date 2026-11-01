from loopbot.db import TrackRepo

def test_add_appends_in_order_per_user():
    repo = TrackRepo(":memory:")
    a = repo.add(1, "A", "fa", 10, None)
    b = repo.add(1, "B", "fb", None, "https://youtu.be/x")
    repo.add(2, "C", "fc", None, None)
    assert [t.title for t in repo.list(1)] == ["A", "B"]
    assert a.position < b.position
    assert [t.title for t in repo.list(2)] == ["C"]

def test_creates_parent_directory(tmp_path):
    repo = TrackRepo(str(tmp_path / "sub" / "x.db"))
    repo.add(1, "A", "fa", None, None)
    assert (tmp_path / "sub" / "x.db").exists()

def _three(repo):
    return [repo.add(1, n, "f" + n, None, None).id for n in "ABC"]

def test_apply_order_reorders_and_removes():
    repo = TrackRepo(":memory:")
    a, b, c = _three(repo)
    result = repo.apply_order(1, [c, a, b], [b])
    assert [t.title for t in result] == ["C", "A"]
    assert [t.position for t in result] == [0, 1]

def test_apply_order_keeps_tracks_added_after_snapshot():
    repo = TrackRepo(":memory:")
    a, b, c = _three(repo)
    repo.add(1, "D", "fd", None, None)          # 미니앱 열린 뒤 추가
    result = repo.apply_order(1, [b, a, c], [])
    assert [t.title for t in result] == ["B", "A", "C", "D"]

def test_apply_order_ignores_foreign_and_unknown_ids():
    repo = TrackRepo(":memory:")
    a, b, c = _three(repo)
    other = repo.add(2, "X", "fx", None, None).id
    result = repo.apply_order(1, [other, 999, c], [other, 999])
    assert [t.title for t in result] == ["C", "A", "B"]
    assert [t.title for t in repo.list(2)] == ["X"]
