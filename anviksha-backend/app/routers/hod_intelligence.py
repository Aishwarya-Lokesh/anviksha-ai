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
from typing import Optional

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


# ---------------------------------------------------------------------------
# Phase 2 — Faculty Monitoring & Faculty Alerts
# ---------------------------------------------------------------------------

@router.get("/faculty/overview")
def faculty_overview(db: Session = Depends(get_db), user: User = Depends(require_role("hod"))):
    """Objective, real activity counts only — no faculty score or ranking."""
    from app.core.hod_metrics import department_faculty_overview

    dept = _department_or_403(user, db)
    return {"department": dept.name, **department_faculty_overview(db, dept.id)}


@router.get("/faculty")
def faculty_table(search: Optional[str] = None, db: Session = Depends(get_db), user: User = Depends(require_role("hod"))):
    """One row per real faculty member, default-sorted by name — never a
    ranking. `search` matches name, VTU teacher ID, or an assigned real
    subject code."""
    from app.core.hod_metrics import department_faculty_table

    dept = _department_or_403(user, db)
    return {"department": dept.name, "faculty": department_faculty_table(db, dept.id, search=search)}


@router.get("/faculty/{faculty_id}")
def faculty_detail_endpoint(faculty_id: int, db: Session = Depends(get_db), user: User = Depends(require_role("hod"))):
    """404 for any faculty ID outside the caller's own department, even if
    the ID is otherwise valid — an HOD must never learn whether an ID from
    another department exists."""
    from app.core.hod_metrics import faculty_detail

    dept = _department_or_403(user, db)
    detail = faculty_detail(db, dept.id, faculty_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Faculty not found in your department")
    return detail


@router.get("/alerts")
def alerts(db: Session = Depends(get_db), user: User = Depends(require_role("hod"))):
    """Every open, DB-grounded alert across the department. Never includes a
    'Delayed'/'Attention Required' style alert — no deadline data exists
    anywhere in this schema to establish that something is overdue rather
    than merely pending (see docs/hod-intelligence/PROGRESS.md, Phase 0
    section J)."""
    from app.core.hod_metrics import department_alerts

    dept = _department_or_403(user, db)
    return {"department": dept.name, "alerts": department_alerts(db, dept.id)}


# ---------------------------------------------------------------------------
# Phase 3 — Department Health Snapshot (rollup)
# ---------------------------------------------------------------------------

@router.get("/health-snapshot")
def health_snapshot(db: Session = Depends(get_db), user: User = Depends(require_role("hod"))):
    """Today's attendance %, at-risk count, average CGPA, pending documents —
    a pure rollup of already-computed values (Phase 1's attendance headline,
    the existing HOD at-risk formula, the existing stored CGPA field, and
    one new department-scoped documents-pending query)."""
    from app.core.hod_metrics import department_health_snapshot

    dept = _department_or_403(user, db)
    return {"department": dept.name, **department_health_snapshot(db, dept.id)}


@router.get("/at-risk-detail")
def at_risk_detail(db: Session = Depends(get_db), user: User = Depends(require_role("hod"))):
    from app.core.hod_metrics import department_at_risk_detail

    dept = _department_or_403(user, db)
    return {"department": dept.name, **department_at_risk_detail(db, dept.id)}


@router.get("/pending-documents")
def pending_documents(db: Session = Depends(get_db), user: User = Depends(require_role("hod"))):
    from app.core.hod_metrics import department_pending_documents

    dept = _department_or_403(user, db)
    return {"department": dept.name, **department_pending_documents(db, dept.id)}


# ---------------------------------------------------------------------------
# Phase 4 — Assessment Intelligence
# ---------------------------------------------------------------------------

@router.get("/assessment/pass-rate-outliers")
def pass_rate_outliers(db: Session = Depends(get_db), user: User = Depends(require_role("hod"))):
    """Subject pass rate vs. department average — subjects only, never a
    ranked list of teacher names."""
    from app.core.hod_metrics import department_pass_rate_outliers

    dept = _department_or_403(user, db)
    return {"department": dept.name, **department_pass_rate_outliers(db, dept.id)}


@router.get("/assessment/bloom-coverage")
def bloom_coverage(db: Session = Depends(get_db), user: User = Depends(require_role("hod"))):
    """Question COUNT/percentage per Bloom's level — coverage, never
    performance (no data links a real score to a question's Bloom's level)."""
    from app.core.hod_metrics import department_bloom_coverage

    dept = _department_or_403(user, db)
    return {"department": dept.name, **department_bloom_coverage(db, dept.id)}


@router.get("/assessment/section-comparison")
def section_comparison(subject_id: int, db: Session = Depends(get_db), user: User = Depends(require_role("hod"))):
    from app.core.hod_metrics import department_section_comparison

    dept = _department_or_403(user, db)
    return {"department": dept.name, **department_section_comparison(db, dept.id, subject_id)}


# ---------------------------------------------------------------------------
# Phase 5 — Placement Funnel
# ---------------------------------------------------------------------------

@router.get("/placement/funnel")
def placement_funnel(passed_out_year: Optional[int] = None, db: Session = Depends(get_db), user: User = Depends(require_role("hod"))):
    """A real 2-stage funnel — the schema has no richer stage data (Phase 0
    section H)."""
    from app.core.hod_metrics import department_placement_funnel

    dept = _department_or_403(user, db)
    return {"department": dept.name, **department_placement_funnel(db, dept.id, passed_out_year)}


@router.get("/placement/tiers")
def placement_tiers(passed_out_year: Optional[int] = None, db: Session = Depends(get_db), user: User = Depends(require_role("hod"))):
    from app.core.hod_metrics import department_placement_tiers

    dept = _department_or_403(user, db)
    return {"department": dept.name, **department_placement_tiers(db, dept.id, passed_out_year)}


@router.get("/placement/cycle-comparison")
def placement_cycle_comparison(db: Session = Depends(get_db), user: User = Depends(require_role("hod"))):
    from app.core.hod_metrics import department_placement_cycle_comparison

    dept = _department_or_403(user, db)
    return {"department": dept.name, **department_placement_cycle_comparison(db, dept.id)}
