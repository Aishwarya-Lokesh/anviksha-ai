"""Production file storage.

Local disk storage under data_raw/ doesn't persist across a restart/redeploy
on most production hosts (no persistent disk on free-tier compute). This
module is the one place file reads/writes go through, so that:

- In local development (no SUPABASE_URL/SUPABASE_SERVICE_KEY configured),
  behavior is IDENTICAL to before this module existed — real files under
  data_raw/, nothing changes for local dev.
- In production (those two env vars set), the exact same calls transparently
  go to real Supabase Storage instead, so uploaded/generated files survive a
  restart.

No feature flag needed — the switch is automatic based on whether Supabase
is actually configured. Callers never need to know which backend is active.
"""
import mimetypes
import os

import httpx

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
SUPABASE_BUCKET = os.environ.get("SUPABASE_STORAGE_BUCKET", "anviksha-uploads")

_LOCAL_ROOT = os.path.join(os.path.dirname(__file__), "..", "..", "data_raw")


def is_configured() -> bool:
    return bool(SUPABASE_URL and SUPABASE_SERVICE_KEY)


def _local_path(path: str) -> str:
    return os.path.join(_LOCAL_ROOT, path)


def upload_file(path: str, content: bytes, content_type: str = None) -> None:
    """Stores `content` at `path` (e.g. "profile_photos/4GW23IS001_photo.jpg"),
    upserting if it already exists — matches the pre-migration local-disk
    behavior of overwriting on re-upload."""
    if not content_type:
        content_type = mimetypes.guess_type(path)[0] or "application/octet-stream"

    if is_configured():
        url = f"{SUPABASE_URL}/storage/v1/object/{SUPABASE_BUCKET}/{path}"
        headers = {
            "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
            "Content-Type": content_type,
            "x-upsert": "true",
        }
        resp = httpx.post(url, headers=headers, content=content, timeout=30)
        if resp.status_code not in (200, 201):
            raise RuntimeError(f"Supabase Storage upload failed for {path}: {resp.status_code} {resp.text}")
        return

    local_path = _local_path(path)
    os.makedirs(os.path.dirname(local_path), exist_ok=True)
    with open(local_path, "wb") as f:
        f.write(content)


def get_file(path: str) -> bytes:
    """Real bytes for `path`. Raises FileNotFoundError if it doesn't exist —
    callers turn that into a real 404, never a fabricated placeholder."""
    if is_configured():
        url = f"{SUPABASE_URL}/storage/v1/object/{SUPABASE_BUCKET}/{path}"
        headers = {"Authorization": f"Bearer {SUPABASE_SERVICE_KEY}"}
        resp = httpx.get(url, headers=headers, timeout=30)
        if resp.status_code == 404:
            raise FileNotFoundError(path)
        if resp.status_code != 200:
            raise RuntimeError(f"Supabase Storage download failed for {path}: {resp.status_code} {resp.text}")
        return resp.content

    local_path = _local_path(path)
    if not os.path.exists(local_path):
        raise FileNotFoundError(path)
    with open(local_path, "rb") as f:
        return f.read()


def delete_file(path: str) -> None:
    """Best-effort delete — never raises if the file is already gone,
    matching the exists-then-remove pattern used throughout the
    pre-migration code."""
    if is_configured():
        url = f"{SUPABASE_URL}/storage/v1/object/{SUPABASE_BUCKET}/{path}"
        headers = {"Authorization": f"Bearer {SUPABASE_SERVICE_KEY}"}
        try:
            httpx.request("DELETE", url, headers=headers, timeout=30)
        except Exception:
            pass
        return

    local_path = _local_path(path)
    if os.path.exists(local_path):
        os.remove(local_path)
