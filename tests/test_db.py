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
