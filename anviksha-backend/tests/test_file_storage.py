"""app.core.file_storage — local-fallback path (no Supabase configured).
Proves upload/get/delete round-trip correctly when Supabase env vars are
absent, which is exactly the code path local development and this test
environment both exercise. The Supabase-backed path is exercised for real
against the live backend once real credentials are configured (see
deployment notes) — this suite can't safely make real network calls to an
account that may not exist yet."""
import os

import pytest

from app.core import file_storage


@pytest.fixture(autouse=True)
def _ensure_not_configured(monkeypatch):
    """Guarantee these tests exercise the local-disk fallback regardless of
    what's in the real environment."""
    monkeypatch.setattr(file_storage, "SUPABASE_URL", "")
    monkeypatch.setattr(file_storage, "SUPABASE_SERVICE_KEY", "")


def test_upload_then_get_round_trips_real_bytes(tmp_path, monkeypatch):
    monkeypatch.setattr(file_storage, "_LOCAL_ROOT", str(tmp_path))
    file_storage.upload_file("some_dir/test.txt", b"real content")
    assert file_storage.get_file("some_dir/test.txt") == b"real content"


def test_get_missing_file_raises_file_not_found(tmp_path, monkeypatch):
    monkeypatch.setattr(file_storage, "_LOCAL_ROOT", str(tmp_path))
    with pytest.raises(FileNotFoundError):
        file_storage.get_file("nope/does_not_exist.txt")


def test_delete_removes_file_and_is_safe_to_call_twice(tmp_path, monkeypatch):
    monkeypatch.setattr(file_storage, "_LOCAL_ROOT", str(tmp_path))
    file_storage.upload_file("d/f.txt", b"x")
    assert os.path.exists(os.path.join(str(tmp_path), "d", "f.txt"))
    file_storage.delete_file("d/f.txt")
    assert not os.path.exists(os.path.join(str(tmp_path), "d", "f.txt"))
    file_storage.delete_file("d/f.txt")  # must not raise on an already-gone file


def test_upload_overwrites_existing_file(tmp_path, monkeypatch):
    monkeypatch.setattr(file_storage, "_LOCAL_ROOT", str(tmp_path))
    file_storage.upload_file("p.txt", b"first")
    file_storage.upload_file("p.txt", b"second")
    assert file_storage.get_file("p.txt") == b"second"
