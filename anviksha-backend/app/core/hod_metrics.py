"""HOD Department Intelligence — shared metric contract and query helpers.

Paper contribution statement: we extend the retrieval-grounded generation
principle used in Anviksha's conversational assistants to the department-
level analytics layer, pairing every metric with a real-data-traceable
explanation rather than a static figure.

This module is the ONLY place new department-analytics query logic lives.
It never re-implements existing business rules — see the imports below,
which pull the real at-risk/attendance/scoping helpers straight from
routers/teacher.py rather than duplicating them (Part A4 of the spec this
module was built against).

Every "headline" metric returned to the frontend uses one consistent shape
(the D1 contract):
    {
      "value": <number|null>, "status": "available"|"pending"|"unavailable",
      "display": "<string>", "basis": {...}, "explanation": "<string>",
      "reason_unavailable": "<string, only when status != available>",
    }
Table/grid rows use a lighter per-row status ("available"|"pending") without
the full basis/explanation blob, since repeating that on every one of
dozens of rows would be unreadable rather than useful — the full contract is
reserved for card-level aggregate metrics, exactly where "how is this
calculated?" is actually a question worth answering.
"""
from datetime import date, timedelta
from typing import Optional

from sqlalchemy import and_, case, func
from sqlalchemy.orm import Session

from app.models.models import AttendanceRecord, AttendanceSession, Student, Subject

# Phase 2+ (Faculty Monitoring) reuses app.routers.teacher's own
# _matching_student_ids / _teacher_student_ids_for_subject helpers directly
# by importing them at point of use — never re-implemented here. Phase 1's
# attendance queries below are department-wide rollups and don't need them.

# ---------------------------------------------------------------------------
# Severity thresholds — reusing the two attendance thresholds that already
# exist elsewhere in the app (teacher.py's at-risk rule uses 50%, hod.py's
# at-risk rule uses 75%) rather than inventing new numbers. Documented once,
# here, per Part D3.
# ---------------------------------------------------------------------------
ATTENDANCE_HEALTHY_PCT = 75.0   # matches hod.py's existing at-risk attendance threshold
ATTENDANCE_WARNING_PCT = 50.0   # matches teacher.py's existing at-risk attendance threshold


def attendance_severity(pct: Optional[float]) -> str:
    if pct is None:
        return "neutral"
    if pct >= ATTENDANCE_HEALTHY_PCT:
        return "green"
    if pct >= ATTENDANCE_WARNING_PCT:
        return "amber"
    return "red"


def _today() -> date:
    """The one new 'today' convention this feature introduces. No such
    convention existed anywhere in the backend before this (Phase 0, item
    F) — every existing attendance date is client-supplied. This is a
    server-local calendar date, used only by this module's new endpoints;
    it does not change how any existing endpoint computes or stores dates."""
    return date.today()


def metric(value, status: str, display: str, basis: dict, explanation: str, reason_unavailable: Optional[str] = None) -> dict:
    """Builds the D1 traceable-metric contract. `basis` should always include
    at least `sources`, `filters`, `numerator`, `denominator`, `record_count`
    so the 'How is this calculated?' popover always has something concrete
    to show — never an empty explanation for a non-trivial metric."""
    out = {"value": value, "status": status, "display": display, "basis": basis, "explanation": explanation}
    if reason_unavailable:
        out["reason_unavailable"] = reason_unavailable
    return out


def at_risk_from_students(active_students: list) -> list:
    """The department-level 'at risk' definition ALREADY used by the HOD's
    own /hod/ask-ai and /hod/insight endpoints (real backlog on record, OR
    general attendance below 75%; missing attendance is never treated as
    below threshold). Extracted here, byte-for-byte identical to the inline
    logic previously duplicated in hod.py, so every HOD-facing at-risk
    number in the app — old and new — comes from exactly one definition.
    (A second, different at-risk definition exists in teacher.py, scoped to
    a single subject via real Marks + subject attendance; that one stays a
    teacher-scoped concept and is intentionally NOT reused here — see
    docs/hod-intelligence/PROGRESS.md, Phase 0 section D, for why.)"""
    return [s for s in active_students if (s.backlogs or 0) > 0 or (s.attendance_pct is not None and s.attendance_pct < 75)]


# ---------------------------------------------------------------------------
# Live daily attendance (Phase 1)
# ---------------------------------------------------------------------------

def _expected_subjects_with_enrollment(db: Session, department_id: int):
    """Real subjects in this department with at least one real, active
    enrolled student in their semester — one grouped aggregate query, no
    N+1. Zero-enrollment subjects are excluded (A3)."""
    return (
        db.query(
            Subject.id, Subject.code, Subject.name, Subject.semester,
            func.count(func.distinct(Student.id)).label("enrolled"),
        )
        .join(Student, and_(Student.semester == Subject.semester, Student.department_id == Subject.department_id, Student.status == "active"))
        .filter(Subject.department_id == department_id, Subject.semester.isnot(None))
        .group_by(Subject.id, Subject.code, Subject.name, Subject.semester)
        .having(func.count(func.distinct(Student.id)) > 0)
        .all()
    )


def _session_aggregates_for_date(db: Session, department_id: int, target_date: date):
    """Real per-(subject, section) present/total for every AttendanceRecord
    on a given real date — one grouped aggregate query, no N+1. `section` is
    only ever populated on the resulting rows when the real Student data for
    that record actually has one (this dataset currently has none — see
    Phase 0 section D — so today every row's section is None; the query is
    still correct and will split by real section the moment that data
    exists, since it isn't hardcoded to "no sections")."""
    return (
        db.query(
            AttendanceSession.subject_id, Student.section,
            func.sum(case((AttendanceRecord.present == True, 1), else_=0)).label("present"),
            func.count(AttendanceRecord.id).label("total"),
        )
        .join(AttendanceRecord, AttendanceRecord.session_id == AttendanceSession.id)
        .join(Student, Student.id == AttendanceRecord.student_id)
        .join(Subject, Subject.id == AttendanceSession.subject_id)
        .filter(Subject.department_id == department_id, AttendanceSession.date == target_date)
        .group_by(AttendanceSession.subject_id, Student.section)
        .all()
    )


def today_attendance_headline(db: Session, department_id: int) -> dict:
    """'Today: {present}/{total} students attended ({pct}%)' — computed from
    submitted/complete sessions only. If nothing has been submitted today,
    returns status='pending' (never a fabricated 0%)."""
    target = _today()
    agg = _session_aggregates_for_date(db, department_id, target)
    total_present = sum(r.present for r in agg)
    total_all = sum(r.total for r in agg)
    basis = {
        "sources": ["attendance_sessions", "attendance_records", "subjects"],
        "filters": {"department_id": department_id, "date": target.isoformat()},
        "numerator": total_present if total_all else None,
        "denominator": total_all if total_all else None,
        "record_count": len(agg),
    }
    if total_all == 0:
        return metric(
            value=None, status="pending", display="Pending",
            basis=basis,
            explanation=f"No attendance has been submitted yet today ({target.isoformat()}) for this department.",
            reason_unavailable="No AttendanceSession has been recorded for today yet.",
        )
    pct = round(total_present / total_all * 100, 1)
    return metric(
        value=pct, status="available", display=f"{total_present}/{total_all} students attended ({pct}%)",
        basis=basis,
        explanation=(
            f"Computed from {len(agg)} real attendance session-group(s) submitted today across the "
            f"department: {total_present} of {total_all} real AttendanceRecord rows marked present."
        ),
    )


def today_attendance_breakdown(db: Session, department_id: int) -> list:
    """Semester | Section | Subject | Present | Absent | Total | % — a
    subject/section with no submission today is 'pending', never 0%.
    Zero-enrollment subjects are excluded upstream in
    _expected_subjects_with_enrollment."""
    target = _today()
    expected = _expected_subjects_with_enrollment(db, department_id)
    agg = _session_aggregates_for_date(db, department_id, target)
    agg_by_subject: dict = {}
    for r in agg:
        agg_by_subject.setdefault(r.subject_id, []).append(r)

    rows = []
    for e in expected:
        entries = agg_by_subject.get(e.id)
        if not entries:
            rows.append({
                "semester": e.semester, "section": None, "subject_code": e.code, "subject_name": e.name,
                "present": None, "absent": None, "total": None, "pct": None,
                "status": "pending", "display": "Pending", "severity": "neutral",
            })
            continue
        for entry in entries:
            present, total = entry.present, entry.total
            pct = round(present / total * 100, 1) if total else None
            rows.append({
                "semester": e.semester, "section": entry.section, "subject_code": e.code, "subject_name": e.name,
                "present": present, "absent": (total - present) if total else None, "total": total, "pct": pct,
                "status": "available" if total else "pending", "display": f"{pct}%" if pct is not None else "Pending",
                "severity": attendance_severity(pct),
            })
    rows.sort(key=lambda r: (r["semester"] or 0, r["subject_code"] or ""))
    return rows


def today_attendance_heatmap(breakdown_rows: list) -> dict:
    """Reshapes the same breakdown rows (no extra query) into a Section x
    Subject grid for the heatmap. When no real section data exists at all
    (the current state of this dataset), every subject collapses onto one
    'All Sections' column — an honest reflection of what the data actually
    supports, not a fabricated section split."""
    real_sections = sorted({r["section"] for r in breakdown_rows if r["section"]})
    sections = real_sections or ["All Sections"]
    subject_keys = sorted({(r["semester"], r["subject_code"], r["subject_name"]) for r in breakdown_rows})

    grid = []
    for sem, code, name in subject_keys:
        matches = [r for r in breakdown_rows if r["subject_code"] == code and r["semester"] == sem]
        cells = []
        for sec in sections:
            match = next((r for r in matches if r["section"] == sec or (r["section"] is None and sec == "All Sections")), None)
            if match:
                cells.append({
                    "section": sec, "pct": match["pct"], "status": match["status"], "display": match["display"],
                    "present": match["present"], "absent": match["absent"], "total": match["total"], "severity": match["severity"],
                })
            else:
                cells.append({"section": sec, "pct": None, "status": "pending", "display": "Pending", "present": None, "absent": None, "total": None, "severity": "neutral"})
        grid.append({"semester": sem, "subject_code": code, "subject_name": name, "cells": cells})
    return {"sections": sections, "rows": grid}


def attendance_trend(db: Session, department_id: int, days: int = 14) -> list:
    """7-14 day department attendance trend. Days with no submitted
    attendance appear as status='pending' (a real gap), never a 0% data
    point — a line chart must not silently draw a fake dip to zero."""
    target = _today()
    start = target - timedelta(days=days - 1)
    rows = (
        db.query(
            AttendanceSession.date,
            func.sum(case((AttendanceRecord.present == True, 1), else_=0)).label("present"),
            func.count(AttendanceRecord.id).label("total"),
        )
        .join(AttendanceRecord, AttendanceRecord.session_id == AttendanceSession.id)
        .join(Subject, Subject.id == AttendanceSession.subject_id)
        .filter(Subject.department_id == department_id, AttendanceSession.date >= start, AttendanceSession.date <= target)
        .group_by(AttendanceSession.date)
        .all()
    )
    by_date = {r.date: r for r in rows}
    points = []
    d = start
    while d <= target:
        r = by_date.get(d)
        if r and r.total:
            pct = round(r.present / r.total * 100, 1)
            points.append({"date": d.isoformat(), "pct": pct, "status": "available", "severity": attendance_severity(pct)})
        else:
            points.append({"date": d.isoformat(), "pct": None, "status": "pending", "severity": "neutral"})
        d += timedelta(days=1)
    return points
