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
        # Supabase Storage reports a missing object as 404 on some routes and as
        # 400 with a "not found" body on others; both mean the file is not there.
        if resp.status_code == 404 or (resp.status_code == 400 and "not" in resp.text.lower() and "found" in resp.text.lower()):
            raise FileNotFoundError(path)
        if resp.status_code != 200:
            raise RuntimeError(f"Supabase Storage download failed for {path}: {resp.status_code} {resp.text}")
        return resp.content

    local_path = _local_path(path)
    if not os.path.exists(local_path):
        raise FileNotFoundError(path)
    with open(local_path, "rb") as f:
        return f.read()


def storage_status() -> dict:
    """Where files are being kept right now, and whether that place answers."""
    if not is_configured():
        return {"mode": "local", "configured": False, "bucket": None, "reachable": True,
                "note": "Files are kept on the server's own disk and are lost when it restarts."}
    try:
        resp = httpx.get(f"{SUPABASE_URL}/storage/v1/bucket/{SUPABASE_BUCKET}",
                         headers={"Authorization": f"Bearer {SUPABASE_SERVICE_KEY}"}, timeout=20)
    except Exception as exc:  # network trouble is reported, not raised
        return {"mode": "supabase", "configured": True, "bucket": SUPABASE_BUCKET, "reachable": False, "note": type(exc).__name__}
    if resp.status_code == 200:
        return {"mode": "supabase", "configured": True, "bucket": SUPABASE_BUCKET, "reachable": True,
                "public": bool(resp.json().get("public")), "note": None}
    return {"mode": "supabase", "configured": True, "bucket": SUPABASE_BUCKET, "reachable": False,
            "note": f"Storage answered {resp.status_code}: {resp.text[:120]}"}


def list_files(prefix: str) -> list[str]:
    """File names directly under `prefix` (a folder such as "real_mooc_certs")."""
    if is_configured():
        names, offset = [], 0
        while True:
            resp = httpx.post(
                f"{SUPABASE_URL}/storage/v1/object/list/{SUPABASE_BUCKET}",
                headers={"Authorization": f"Bearer {SUPABASE_SERVICE_KEY}"},
                json={"prefix": prefix.rstrip("/") + "/", "limit": 1000, "offset": offset}, timeout=30,
            )
            if resp.status_code != 200:
                raise RuntimeError(f"Supabase Storage list failed for {prefix}: {resp.status_code} {resp.text}")
            page = [item["name"] for item in resp.json() if item.get("id")]   # folders have no id
            names += page
            if len(resp.json()) < 1000:
                return names
            offset += 1000
    folder = _local_path(prefix)
    return sorted(os.listdir(folder)) if os.path.isdir(folder) else []


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
