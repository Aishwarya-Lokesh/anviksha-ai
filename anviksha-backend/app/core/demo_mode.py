"""Demo Mode — masks real names/USNs in API responses for supervisor demos or
screenshots, without ever altering the underlying database records."""

from app.core.config import settings


def mask_name(name: str) -> str:
    if not name:
        return name
    parts = name.split()
    return f"{parts[0][0]}. Student" if parts else "Student"


def mask_usn(usn: str) -> str:
    if not usn or len(usn) < 6:
        return "XXXXXXX"
    return usn[:3] + "XX" + usn[-4:]


def apply_demo_mask(record: dict, demo_mode: bool = None) -> dict:
    """Mutates a copy of a student-like dict when demo mode is on. Pass demo_mode
    explicitly per-request (query param) or fall back to the server-wide env flag."""
    active = settings.DEMO_MODE if demo_mode is None else demo_mode
    if not active:
        return record
    masked = dict(record)
    if "name" in masked:
        masked["name"] = mask_name(masked["name"])
    if "usn" in masked:
        masked["usn"] = mask_usn(masked["usn"])
    return masked
