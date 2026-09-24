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

from app.models.models import AttendanceRecord, AttendanceSession, Faculty, Marks, Student, Subject, TeachingAssignment

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


# ---------------------------------------------------------------------------
# Faculty Monitoring & Faculty Alerts (Phase 2) — objective activity only.
# No score, no ranking, no "best/worst faculty" anywhere below.
# ---------------------------------------------------------------------------

def _faculty_teaching_context(db: Session, faculty_id: int) -> list:
    """Real (subject_id, batch, semester, section) this faculty member
    teaches — from their own real TeachingAssignments when any exist, else
    falls back to Subject.faculty_id (batch-blind), exactly mirroring the
    same fallback already established in
    app.routers.teacher._teacher_student_ids. Never re-implements a
    different rule for 'what a faculty teaches'."""
    assignments = db.query(TeachingAssignment).filter(TeachingAssignment.faculty_id == faculty_id, TeachingAssignment.passed_out == False, TeachingAssignment.subject_id.isnot(None)).all()
    if assignments:
        return [{"subject_id": a.subject_id, "batch": a.batch, "semester": a.semester, "section": a.section} for a in assignments]
    subjects = db.query(Subject).filter(Subject.faculty_id == faculty_id).all()
    return [{"subject_id": s.id, "batch": None, "semester": s.semester, "section": None} for s in subjects]


def _students_for_context(db: Session, ctx: dict) -> list:
    """Real students for one teaching-context entry — reuses the exact same
    section-aware matching rule as Phase 1/teacher.py (see
    _matching_student_ids), never a new one."""
    from app.routers.teacher import _matching_student_ids

    if ctx["batch"] and ctx["semester"]:
        fake_assignment = TeachingAssignment(batch=ctx["batch"], semester=ctx["semester"], section=ctx["section"])
        return _matching_student_ids(db, [fake_assignment])
    if not ctx["semester"]:
        return []
    rows = db.query(Student.id).filter(Student.semester == ctx["semester"], Student.status == "active").all()
    return [r[0] for r in rows]


def _missing_attendance_alerts_for_faculty(db: Session, faculty: Faculty, contexts: list) -> list:
    """'Attendance record pending for {Subject} ({Sem}-{Sec})' — fires ONLY
    when this exact faculty member has a real history of recording
    attendance for that subject (proving it's an actively-tracked class,
    never inventing a schedule for one that's never been recorded) AND has
    not recorded a session for it today. See docs/hod-intelligence/
    PROGRESS.md Phase 0 section J for why this rule exists instead of a
    timetable-based one (no timetable data exists anywhere)."""
    target = _today()
    alerts = []
    for ctx in contexts:
        subject = db.query(Subject).filter(Subject.id == ctx["subject_id"]).first()
        if not subject:
            continue
        history_count = db.query(AttendanceSession).filter(AttendanceSession.subject_id == subject.id, AttendanceSession.marked_by_faculty_id == faculty.id).count()
        if history_count == 0:
            continue  # never recorded for this subject at all — not an "expected" session, nothing to flag
        today_count = db.query(AttendanceSession).filter(AttendanceSession.subject_id == subject.id, AttendanceSession.marked_by_faculty_id == faculty.id, AttendanceSession.date == target).count()
        if today_count > 0:
            continue
        alerts.append({
            "type": "missing_attendance",
            "message": f"Attendance record pending for {subject.code} (Sem {ctx['semester']}{'-' + ctx['section'] if ctx['section'] else ''})",
            "faculty_id": faculty.id, "faculty_name": faculty.name, "subject_id": subject.id, "subject_code": subject.code,
            "basis": {
                "sources": ["attendance_sessions"],
                "filters": {"faculty_id": faculty.id, "subject_id": subject.id, "date": target.isoformat()},
                "numerator": history_count, "denominator": None, "record_count": history_count,
            },
            "explanation": f"{faculty.name} has recorded real attendance for {subject.code} {history_count} time(s) before, but not yet today ({target.isoformat()}).",
        })
    return alerts


def _pending_marks_alerts_for_faculty(db: Session, faculty: Faculty, contexts: list) -> list:
    """'Internal marks entry pending for {Subject}' — an assessment is
    considered to exist for a (subject, exam_type) the moment at least one
    real Marks row exists for it; enrolled students still missing that
    exam_type's row are the pending count."""
    alerts = []
    for ctx in contexts:
        subject = db.query(Subject).filter(Subject.id == ctx["subject_id"]).first()
        if not subject:
            continue
        students = _students_for_context(db, ctx)
        if not students:
            continue
        existing_exam_types = {r[0] for r in db.query(Marks.exam_type).filter(Marks.subject_id == subject.id).distinct().all()}
        for exam_type in sorted(existing_exam_types):
            entered_ids = {r[0] for r in db.query(Marks.student_id).filter(Marks.subject_id == subject.id, Marks.exam_type == exam_type).all()}
            missing = [sid for sid in students if sid not in entered_ids]
            if not missing:
                continue
            alerts.append({
                "type": "pending_marks",
                "message": f"Internal marks entry pending for {subject.code} ({exam_type}) — {len(missing)} student(s)",
                "faculty_id": faculty.id, "faculty_name": faculty.name, "subject_id": subject.id, "subject_code": subject.code,
                "basis": {
                    "sources": ["marks", "students"],
                    "filters": {"subject_id": subject.id, "exam_type": exam_type},
                    "numerator": len(students) - len(missing), "denominator": len(students), "record_count": len(entered_ids),
                },
                "explanation": f"{exam_type} marks for {subject.code} have started being entered ({len(entered_ids)} of {len(students)} real students so far) but {len(missing)} student(s) still have no {exam_type} record.",
            })
    return alerts


def faculty_alerts(db: Session, faculty: Faculty) -> list:
    """Every open alert for one faculty member — objective, DB-grounded,
    never a fabricated deadline. See the two helpers above for exactly what
    fires and why."""
    contexts = _faculty_teaching_context(db, faculty.id)
    return _missing_attendance_alerts_for_faculty(db, faculty, contexts) + _pending_marks_alerts_for_faculty(db, faculty, contexts)


def faculty_status(alert_count: int) -> str:
    """'Up to Date' (zero open alerts) or 'Pending' (at least one). 'Attention
    Required' is never used anywhere in this feature — it would require a
    DB-established deadline that has actually passed, and no deadline data
    of any kind exists in this schema (Phase 0, item J)."""
    return "up_to_date" if alert_count == 0 else "pending"


def department_faculty_overview(db: Session, department_id: int) -> dict:
    """The Phase 2.2 overview metrics — only those Phase 0 marked
    computable. Every count here is a plain, real, department-scoped
    aggregate; no faculty ranking or score is computed anywhere."""
    faculty_rows = db.query(Faculty).filter(Faculty.department_id == department_id).all()
    faculty_ids = [f.id for f in faculty_rows]
    subjects = db.query(Subject).filter(Subject.department_id == department_id).all()
    taught_subject_ids = {s.id for s in subjects if s.faculty_id}
    faculty_with_subjects = {s.faculty_id for s in subjects if s.faculty_id}

    sessions_recorded = db.query(AttendanceSession).join(Subject, Subject.id == AttendanceSession.subject_id).filter(Subject.department_id == department_id).count()

    all_alerts = []
    all_student_ids = set()
    for f in faculty_rows:
        contexts = _faculty_teaching_context(db, f.id)
        all_alerts.extend(_missing_attendance_alerts_for_faculty(db, f, contexts))
        all_alerts.extend(_pending_marks_alerts_for_faculty(db, f, contexts))
        for ctx in contexts:
            all_student_ids.update(_students_for_context(db, ctx))

    active_dept_students = db.query(Student).filter(Student.department_id == department_id, Student.status == "active").all()
    students_in_faculty_subjects = [s for s in active_dept_students if s.id in all_student_ids] if all_student_ids else []
    at_risk = at_risk_from_students(students_in_faculty_subjects) if students_in_faculty_subjects else []

    return {
        "total_faculty": len(faculty_rows),
        "faculty_with_assigned_subjects": len(faculty_with_subjects),
        "subjects_being_taught": len(taught_subject_ids),
        "sessions_recorded": sessions_recorded,
        "pending_attendance_alerts": sum(1 for a in all_alerts if a["type"] == "missing_attendance"),
        "pending_marks_alerts": sum(1 for a in all_alerts if a["type"] == "pending_marks"),
        "students_in_faculty_subjects": len(students_in_faculty_subjects),
        "at_risk_students_in_faculty_subjects": len(at_risk),
    }


def department_faculty_table(db: Session, department_id: int, search: str = None) -> list:
    """One row per real faculty member in this department — no ranking, no
    score column; default order is by name. `search` matches name, real
    subject code, or vtu_teacher_id."""
    q = db.query(Faculty).filter(Faculty.department_id == department_id)
    faculty_rows = q.order_by(Faculty.name).all()

    rows = []
    for f in faculty_rows:
        contexts = _faculty_teaching_context(db, f.id)
        subject_ids = [c["subject_id"] for c in contexts]
        subjects = db.query(Subject).filter(Subject.id.in_(subject_ids)).all() if subject_ids else []
        if search:
            needle = search.lower()
            haystack = f.name.lower() + " " + (f.vtu_teacher_id or "").lower() + " " + " ".join(s.code.lower() for s in subjects)
            if needle not in haystack:
                continue

        sessions = db.query(AttendanceSession).filter(AttendanceSession.subject_id.in_(subject_ids), AttendanceSession.marked_by_faculty_id == f.id).all() if subject_ids else []
        last_updated = max((s.date for s in sessions), default=None)
        alerts = _missing_attendance_alerts_for_faculty(db, f, contexts) + _pending_marks_alerts_for_faculty(db, f, contexts)

        student_ids = set()
        for ctx in contexts:
            student_ids.update(_students_for_context(db, ctx))
        at_risk_count = len(at_risk_from_students(db.query(Student).filter(Student.id.in_(student_ids), Student.status == "active").all())) if student_ids else 0

        # marks_status must reflect whether real Marks data actually exists
        # for this faculty's subjects — NOT just whether they have subjects
        # assigned. Real Marks rows are empty department-wide right now, and
        # that must show as "unavailable", never as a false "available".
        has_any_marks = bool(subject_ids) and db.query(Marks).filter(Marks.subject_id.in_(subject_ids)).first() is not None
        if any(a["type"] == "pending_marks" for a in alerts):
            marks_status = "pending"
        elif has_any_marks:
            marks_status = "available"
        else:
            marks_status = "unavailable"

        rows.append({
            "faculty_id": f.id, "name": f.name, "vtu_teacher_id": f.vtu_teacher_id, "designation": f.designation,
            "assigned_subjects": [s.code for s in subjects],
            "batches_semesters_sections": [{"batch": c["batch"], "semester": c["semester"], "section": c["section"]} for c in contexts],
            "sessions_recorded": len(sessions),
            "attendance_last_updated": last_updated.isoformat() if last_updated else None,
            "marks_status": marks_status,
            "student_count": len(student_ids),
            "at_risk_students": at_risk_count,
            "open_alert_count": len(alerts),
            "status": faculty_status(len(alerts)),
        })
    return rows


def department_alerts(db: Session, department_id: int) -> list:
    """Every open alert across every real faculty member in this department —
    powers the Faculty Alerts tab. Same two rule functions as everywhere
    else; nothing new is computed here."""
    faculty_rows = db.query(Faculty).filter(Faculty.department_id == department_id).all()
    alerts = []
    for f in faculty_rows:
        contexts = _faculty_teaching_context(db, f.id)
        alerts.extend(_missing_attendance_alerts_for_faculty(db, f, contexts))
        alerts.extend(_pending_marks_alerts_for_faculty(db, f, contexts))
    return alerts


def faculty_detail(db: Session, department_id: int, faculty_id: int) -> dict:
    """Full detail view for one faculty member — 404 if they don't belong to
    the caller's own department, even if the ID is otherwise valid."""
    f = db.query(Faculty).filter(Faculty.id == faculty_id, Faculty.department_id == department_id).first()
    if not f:
        return None

    contexts = _faculty_teaching_context(db, f.id)
    per_subject = []
    for ctx in contexts:
        subject = db.query(Subject).filter(Subject.id == ctx["subject_id"]).first()
        if not subject:
            continue
        students = _students_for_context(db, ctx)
        sessions = db.query(AttendanceSession).filter(AttendanceSession.subject_id == subject.id, AttendanceSession.marked_by_faculty_id == f.id).all()
        marks_rows = db.query(Marks).filter(Marks.subject_id == subject.id, Marks.student_id.in_(students)).all() if students else []
        scored = [m.marks_obtained for m in marks_rows if m.marks_obtained is not None]
        avg_marks = round(sum(scored) / len(scored), 1) if scored else None
        active_students = db.query(Student).filter(Student.id.in_(students), Student.status == "active").all() if students else []
        at_risk_count = len(at_risk_from_students(active_students))

        # Real subject attendance %, averaged across this subject's real students — reused, not re-implemented.
        from app.routers.teacher import _real_subject_attendance_pct
        pct_values = [p for p in (_real_subject_attendance_pct(db, sid, subject.id) for sid in students) if p is not None]
        avg_attendance = round(sum(pct_values) / len(pct_values), 1) if pct_values else None

        per_subject.append({
            "subject_id": subject.id, "subject_code": subject.code, "subject_name": subject.name,
            "batch": ctx["batch"], "semester": ctx["semester"], "section": ctx["section"],
            "student_count": len(students),
            "sessions_recorded": len(sessions),
            "avg_internal_marks": avg_marks, "marks_status": "available" if scored else "unavailable",
            "avg_attendance_pct": avg_attendance, "attendance_status": "available" if pct_values else "unavailable",
            "at_risk_count": at_risk_count,
        })

    alerts = _missing_attendance_alerts_for_faculty(db, f, contexts) + _pending_marks_alerts_for_faculty(db, f, contexts)
    return {
        "faculty_id": f.id, "name": f.name, "designation": f.designation, "email": f.email,
        "vtu_teacher_id": f.vtu_teacher_id, "extra_work": f.extra_work,
        "subjects": per_subject,
        "alerts": alerts,
        "status": faculty_status(len(alerts)),
    }
