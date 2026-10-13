"""Stops the free hosting plan from putting the server to sleep.

The host sleeps a service that has had no visitor for 15 minutes, and the
next visitor then waits about a minute while it starts. Here the server
visits its own public address every few minutes, which counts as a visit.

Runs only on the host (it provides `RENDER_EXTERNAL_URL`), never on a
developer's computer or in tests. Set `KEEP_AWAKE=off` to switch it off."""
import logging
import os
import threading
import time

import httpx

INTERVAL_SECONDS = 8 * 60
log = logging.getLogger("keep_awake")
_started = False


def public_url() -> str:
    if os.getenv("KEEP_AWAKE", "").strip().lower() in ("off", "0", "false", "no"):
        return ""
    return os.getenv("RENDER_EXTERNAL_URL", "").strip().rstrip("/")


def _loop(url: str, interval: int) -> None:
    while True:
        time.sleep(interval)
        try:
            httpx.get(f"{url}/health", timeout=30)
        except Exception as exc:      # a missed visit is harmless; the next one follows shortly
            log.warning("keep-awake visit failed: %s", type(exc).__name__)


def start(interval: int = INTERVAL_SECONDS) -> bool:
    """Starts the background visits once. Returns whether they are running."""
    global _started
    url = public_url()
    if not url or _started:
        return _started
    _started = True
    threading.Thread(target=_loop, args=(url, interval), name="keep-awake", daemon=True).start()
    log.info("keep-awake visits started for %s every %s seconds", url, interval)
    return True
