"""The server visits its own public address so the host does not put it to sleep."""
import time

from app.core import keep_awake


def test_it_runs_only_on_the_host_and_can_be_switched_off(monkeypatch):
    monkeypatch.setattr(keep_awake, "_started", False)
    monkeypatch.delenv("RENDER_EXTERNAL_URL", raising=False)
    assert keep_awake.public_url() == "" and keep_awake.start() is False          # a developer's computer, or tests

    monkeypatch.setenv("RENDER_EXTERNAL_URL", "https://example-backend.test/")
    monkeypatch.setenv("KEEP_AWAKE", "off")
    assert keep_awake.public_url() == "" and keep_awake.start() is False
    monkeypatch.delenv("KEEP_AWAKE")
    assert keep_awake.public_url() == "https://example-backend.test"


def test_it_visits_its_own_health_address_and_survives_a_failed_visit(monkeypatch):
    visits = []

    def fake_get(url, timeout=None):
        visits.append(url)
        if len(visits) == 1:
            raise RuntimeError("network blip")

    monkeypatch.setattr(keep_awake, "_started", False)
    monkeypatch.setattr(keep_awake.httpx, "get", fake_get)
    monkeypatch.setenv("RENDER_EXTERNAL_URL", "https://example-backend.test")
    monkeypatch.delenv("KEEP_AWAKE", raising=False)
    assert keep_awake.start(interval=0.02) is True
    assert keep_awake.start(interval=0.02) is True                               # asking again does not start a second one
    deadline = time.time() + 3
    while len(visits) < 3 and time.time() < deadline:
        time.sleep(0.02)
    assert len(visits) >= 3 and set(visits) == {"https://example-backend.test/health"}   # kept going after the failure
