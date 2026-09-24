"""HOD Department Intelligence & Faculty Monitoring — add-on router.

New, modular file (Part A9): every endpoint here is prefixed
`/hod/intelligence`, kept entirely separate from the existing `hod.py`
router so this feature can be removed cleanly later (drop this file, drop
the one `include_router` line in main.py, drop the one nav entry on the
frontend — nothing else references it).

Every endpoint reuses the existing `require_role("hod")` guard and the
existing `_department_or_403` department-resolution helper from `hod.py` —
never a new auth or scoping mechanism.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import require_role
from app.models.models import User
from app.routers.hod import _department_or_403

router = APIRouter(prefix="/hod/intelligence", tags=["hod-intelligence"])


# ---------------------------------------------------------------------------
# Phase 1 — Live Daily Attendance
# ---------------------------------------------------------------------------

@router.get("/attendance/today")
def attendance_today(db: Session = Depends(get_db), user: User = Depends(require_role("hod"))):
    """Today's department attendance: headline metric (D1 contract),
    per-subject/section breakdown table, and the same data reshaped into a
    Section x Subject heatmap grid — all from two grouped aggregate queries
    total, no N+1."""
    from app.core.hod_metrics import today_attendance_headline, today_attendance_breakdown, today_attendance_heatmap

    dept = _department_or_403(user, db)
    headline = today_attendance_headline(db, dept.id)
    breakdown = today_attendance_breakdown(db, dept.id)
    heatmap = today_attendance_heatmap(breakdown)
    return {"department": dept.name, "headline": headline, "breakdown": breakdown, "heatmap": heatmap}


@router.get("/attendance/trend")
def attendance_trend_endpoint(days: int = 14, db: Session = Depends(get_db), user: User = Depends(require_role("hod"))):
    """7-14 day department attendance trend. Days with no submitted
    attendance are returned as real gaps (status='pending'), never 0%."""
    from app.core.hod_metrics import attendance_trend

    if days < 1 or days > 31:
        raise HTTPException(status_code=400, detail="days must be between 1 and 31")
    dept = _department_or_403(user, db)
    return {"department": dept.name, "days": days, "points": attendance_trend(db, dept.id, days=days)}
