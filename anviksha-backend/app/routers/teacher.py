from fastapi import APIRouter, Depends, Query, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from typing import Optional
from datetime import datetime
from pydantic import BaseModel
import os
import re
import logging

from app.core.database import get_db
from app.core.security import require_role
from app.core.demo_mode import apply_demo_mask
from app.core.activity_log import log_activity
from app.core.notifications import notify_student
from app.models.models import (
    Student, Subject, AttendanceSession, AttendanceRecord, CounselingNote,
    Faculty, User, TeachingAssignment, Marks, Department
)
from app.models.schemas import AttendanceMarkRequest

router = APIRouter(prefix="/teacher", tags=["teacher"])
logger = logging.getLogger(__name__)


class AskAIRequest(BaseModel):
    question: str


@router.post("/ask-ai")
def ask_ai(payload: AskAIRequest, db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    """Real RAG-based assistant for teachers — gathers COMPREHENSIVE real
    data about THIS teacher's actual students (via the same real
    batch+semester scoping used everywhere else): full roster with real
    CGPA/backlogs/attendance, real placement status, real subjects taught.
    Deliberately broad rather than pattern-matched — a capable LLM given
    enough real context can answer a wide range of real questions on its
    own, as long as the real data it needs is actually present here."""
    from app.core.llm_client import ask
    from app.models.models import Placement, Achievement, Internship, CourseCompletion

    if not payload.question or not payload.question.strip():
        return {"answer": "Please type a question so I can help — for example, ask about at-risk students, backlogs, or your assigned subjects.", "connected": True}

    ids = _teacher_student_ids(db, user.faculty_id)
    students = db.query(Student).filter(Student.id.in_(ids)).all() if ids else []

    from app.core.data_export import is_export_request, build_teacher_export, write_xlsx
    if is_export_request(payload.question):
        rows, sheet_name, title = build_teacher_export(db, students, payload.question)
        stored_name, _ = write_xlsx(rows, sheet_name, f"teacher_{title}")
        return {
            "answer": f"Here's your real {title} — {len(rows)} row(s), ready to download.",
            "connected": True, "download_url": f"/exports/{stored_name}", "download_filename": f"{title.replace(' ', '_')}.xlsx",
        }

    from app.core.chat_charts import is_chart_request, build_teacher_chart
    if is_chart_request(payload.question):
        chart = build_teacher_chart(students, payload.question)
        return {"answer": chart["title"] + ".", "connected": True, "chart": chart}

    below_75 = [s for s in students if s.attendance_pct is not None and s.attendance_pct < 75]
    with_backlogs = [s for s in students if s.backlogs and s.backlogs > 0]
    top_performer = max(students, key=lambda s: s.cgpa or 0, default=None)

    my_subjects = db.query(Subject).filter(Subject.faculty_id == user.faculty_id).all()

    context = (
        f"Teacher's real student count: {len(students)}\n"
        f"Real subjects taught: {', '.join(f'{s.code} ({s.name})' for s in my_subjects) or 'none configured'}\n"
        f"Students below 75% attendance: {len(below_75)} — {', '.join(s.name for s in below_75[:10])}\n"
        f"Students with backlogs: {len(with_backlogs)} — {', '.join(s.name for s in with_backlogs[:10])}\n"
        f"Top performer: {top_performer.name if top_performer else 'N/A'} (CGPA {top_performer.cgpa if top_performer else 'N/A'})\n"
    )

    # Full real per-student roster with CGPA — lets the LLM answer "students below X CGPA" type questions itself
    if students:
        context += f"\nFull real roster (name, USN, CGPA, backlogs):\n"
        for s in sorted(students, key=lambda s: s.cgpa or 0):
            context += f"  - {s.name}, {s.usn}, CGPA {s.cgpa}, backlogs {s.backlogs or 0}\n"

    # Real placement status for this teacher's students
    student_ids = [s.id for s in students]
    if student_ids:
        placements = db.query(Placement).filter(Placement.student_id.in_(student_ids)).all()
        placed = [p for p in placements if p.placed]
        if placed:
            context += f"\nReal placement records for this teacher's students ({len(placed)} placed):\n"
            for p in placed:
                st = next((s for s in students if s.id == p.student_id), None)
                if st:
                    context += f"  - {st.name} ({st.usn}): {p.company or 'company not recorded'}\n"
        else:
            context += "\nNo students of this teacher have a real placed record on file yet.\n"

    # Real achievements/internships/completed courses across this teacher's roster
    if student_ids:
        achievements = db.query(Achievement).filter(Achievement.student_id.in_(student_ids)).all()
        if achievements:
            by_student: dict = {}
            for a in achievements:
                by_student.setdefault(a.student_id, []).append(a)
            context += f"\nReal achievements across this teacher's roster ({len(achievements)} total, {len(by_student)} students):\n"
            for sid, items in list(by_student.items())[:10]:
                st = next((s for s in students if s.id == sid), None)
                if st:
                    context += f"  - {st.name}: {len(items)} ({', '.join(a.type for a in items[:3])})\n"

        internships = db.query(Internship).filter(Internship.student_id.in_(student_ids)).all()
        if internships:
            context += f"\nReal internships across this teacher's roster ({len(internships)} total):\n"
            for i in internships[:10]:
                st = next((s for s in students if s.id == i.student_id), None)
                if st:
                    context += f"  - {st.name}: {i.company}\n"

        courses = db.query(CourseCompletion).filter(CourseCompletion.student_id.in_(student_ids)).all()
        if courses:
            context += f"\nReal completed courses/MOOCs across this teacher's roster: {len(courses)} total\n"

    lower_q = payload.question.lower()
    if any(w in lower_q for w in ["question", "exam", "syllabus", "topic", "paper"]):
        from app.core.rag_retrieval import retrieve
        chunks = retrieve(db, payload.question, top_k=2)
        if chunks:
            context += "\nRelevant real question-bank excerpts:\n" + "\n---\n".join(c["text"][:400] for c in chunks)

    result = ask(payload.question, context, role="teacher")
    return {"answer": result["answer"], "connected": result["connected"]}


@router.get("/insight")
def dashboard_insight(db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    """A short, real, grounded AI summary of this teacher's own cohort —
    Understand -> Diagnose -> Recommend — built only from real, already
    computed roster numbers, never invented."""
    from app.core.llm_client import generate_dashboard_insight

    ids = _teacher_student_ids(db, user.faculty_id)
    students = db.query(Student).filter(Student.id.in_(ids)).all() if ids else []
    below_75 = [s for s in students if s.attendance_pct is not None and s.attendance_pct < 75]
    with_backlogs = [s for s in students if s.backlogs and s.backlogs > 0]
    ranked = sorted([s for s in students if s.cgpa is not None], key=lambda s: s.cgpa, reverse=True)
    avg_cgpa = round(sum(s.cgpa for s in students if s.cgpa is not None) / len([s for s in students if s.cgpa is not None]), 2) if any(s.cgpa is not None for s in students) else None

    context = (
        f"Real total students: {len(students)}\n"
        f"Average CGPA across roster: {avg_cgpa if avg_cgpa is not None else 'not available'}\n"
        f"Students below 75% attendance: {len(below_75)} - {', '.join(s.name for s in below_75[:8])}\n"
        f"Students with backlogs: {len(with_backlogs)} - {', '.join(s.name for s in with_backlogs[:8])}\n"
        f"Top performer: {ranked[0].name if ranked else 'not available'} (CGPA {ranked[0].cgpa if ranked else 'n/a'})\n"
        f"Lowest performer with real CGPA: {ranked[-1].name if ranked else 'not available'} (CGPA {ranked[-1].cgpa if ranked else 'n/a'})\n"
    )

    result = generate_dashboard_insight(context, role="teacher")
    return {"insight": result.get("insight"), "connected": result["connected"]}


# ---------- helpers: real teacher scoping, used by every endpoint below ----------

def _teacher_semesters(db: Session, faculty_id: int, batch: Optional[str] = None, only_active: bool = True):
    """Real semesters this teacher actually handles — from explicit
    TeachingAssignments if any exist, else derived from Subject.faculty_id.
    If batch is given AND the teacher has at least one real assignment
    configured somewhere, only semesters for THAT specific batch are
    returned (correctly empty if they don't teach that batch). But if the
    teacher has NO assignments configured at all yet, we still fall back to
    subject-derived semesters even with a batch filter — otherwise every
    semester dropdown across the portal would be permanently empty for any
    teacher who hasn't set up assignments yet, which is exactly what was
    making Performance/Attendance look broken rather than just unconfigured."""
    has_any_assignment = db.query(TeachingAssignment).filter(TeachingAssignment.faculty_id == faculty_id, TeachingAssignment.passed_out == False).first() is not None

    q = db.query(TeachingAssignment).filter(TeachingAssignment.faculty_id == faculty_id)
    if only_active:
        q = q.filter(TeachingAssignment.passed_out == False)
    if batch:
        q = q.filter(TeachingAssignment.batch == batch)
    assignments = q.all()
    if assignments:
        return sorted({a.semester for a in assignments})
    if batch and has_any_assignment:
        return []  # teacher has real assignments, just none for this specific batch — genuinely empty
    subjects = db.query(Subject).filter(Subject.faculty_id == faculty_id).all()
    return sorted({s.semester for s in subjects if s.semester})


def _matching_student_ids(db: Session, assignments: list) -> list:
    """Real, unique student IDs matching a set of real TeachingAssignments —
    the single shared rule for how an assignment's (batch, semester,
    section) maps to real students, used everywhere assignments are scoped
    to a roster. A real recorded section is only enforced when THIS
    batch+semester's roster actually has section data recorded for at least
    one student; otherwise the section is honestly unenforceable against
    data that was never tagged with one, and enforcing it would silently
    zero out an otherwise-real class rather than falling back to
    batch+semester scoping."""
    from sqlalchemy import or_, and_
    if not assignments:
        return []
    conditions = []
    for a in assignments:
        if not a.batch:
            continue
        cond = and_(Student.batch == a.batch, Student.semester == a.semester)
        # A class belongs to one department: without this, every other
        # department's students in the same batch and semester would be included.
        if a.department_id:
            cond = and_(cond, Student.department_id == a.department_id)
        if a.section:
            has_section_data = db.query(Student.id).filter(Student.batch == a.batch, Student.semester == a.semester, Student.section.isnot(None)).first() is not None
            if has_section_data:
                cond = and_(cond, Student.section == a.section)
        conditions.append(cond)
    if not conditions:
        return []
    rows = db.query(Student.id).filter(Student.status == "active", or_(*conditions)).all()
    return [r[0] for r in rows]


def _teacher_student_ids(db: Session, faculty_id: int, batch: Optional[str] = None, semester: Optional[int] = None, section: Optional[str] = None):
    """Real, unique student IDs this teacher actually teaches — matched by
    real TeachingAssignments (batch+semester, honoring section where real
    section data exists) when configured. Falls back to semester-only
    matching via Subject.faculty_id (batch-blind) only when the teacher
    hasn't configured any assignments — a documented, temporary gap until
    they do. An explicit `section` argument (from a caller that wants to
    further narrow the result) is applied on top of either path."""
    q = db.query(TeachingAssignment).filter(TeachingAssignment.faculty_id == faculty_id, TeachingAssignment.passed_out == False)
    if batch:
        q = q.filter(TeachingAssignment.batch == batch)
    if semester:
        q = q.filter(TeachingAssignment.semester == semester)
    assignments = q.all()

    if assignments:
        ids = _matching_student_ids(db, assignments)
        if section:
            ids = [r[0] for r in db.query(Student.id).filter(Student.id.in_(ids), Student.section == section).all()] if ids else []
        return ids

    # No real assignments configured yet — fall back to subject-derived, semester-only scoping
    subjects = db.query(Subject).filter(Subject.faculty_id == faculty_id).all()
    semesters = {s.semester for s in subjects if s.semester and (not semester or s.semester == semester)}
    if not semesters:
        return []
    q = db.query(Student).filter(Student.semester.in_(semesters), Student.status == "active")
    if batch:
        q = q.filter(Student.batch == batch)
    if section:
        q = q.filter(Student.section == section)
    return [s.id for s in q.all()]


def _teacher_student_ids_for_subject(db: Session, faculty_id: int, subject_id: int, batch: Optional[str] = None, semester: Optional[int] = None):
    """Real student IDs for ONE specific subject this teacher is assigned to
    — scoped by that exact assignment's own (batch, semester, section), not
    just the subject's department-wide semester. This is what makes a
    Section A-only assignment actually show only Section A students on
    Attendance Upload, instead of every student in the batch+semester
    regardless of which section they're really in. Returns None (not []) if
    no real assignment matches, so the caller can fall back to batch/semester
    -only scoping for teachers who haven't configured assignments yet."""
    q = db.query(TeachingAssignment).filter(TeachingAssignment.faculty_id == faculty_id, TeachingAssignment.subject_id == subject_id, TeachingAssignment.passed_out == False)
    if batch:
        q = q.filter(TeachingAssignment.batch == batch)
    if semester:
        q = q.filter(TeachingAssignment.semester == semester)
    assignments = q.all()
    if not assignments:
        return None
    return _matching_student_ids(db, assignments)


def _active_batches(db: Session):
    """Real, currently active (non-passed-out) student batches — the correct
    options for a 'Batch' dropdown. Passed-out batches are deliberately
    excluded since a teacher setting up a CURRENT teaching assignment should
    never see a graduated batch as an option."""
    rows = db.query(Student.batch).filter(Student.status == "active").distinct().all()
    return sorted({r[0] for r in rows if r[0]})


# ---------- dashboard ----------

@router.get("/me")
def my_profile(db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    f = db.query(Faculty).filter(Faculty.id == user.faculty_id).first()
    if not f:
        return {"name": "Teacher", "designation": None, "qualifications": None}
    return {"name": f.name, "designation": f.designation, "qualifications": f.qualifications}


@router.get("/dashboard-stats")
def dashboard_stats(db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    """Real, teacher-scoped dashboard numbers — NOT the college-wide totals
    that were showing here before (e.g. 'My Students: 326')."""
    student_ids = _teacher_student_ids(db, user.faculty_id)
    students = db.query(Student).filter(Student.id.in_(student_ids)).all() if student_ids else []

    at_risk_result = at_risk_students(None, db, user)
    at_risk_count = len({r["student_id"] for r in at_risk_result["students"]})

    reports_count = db.query(TeachingAssignment).filter(TeachingAssignment.faculty_id == user.faculty_id).count()

    subject_count = db.query(Subject).filter(Subject.faculty_id == user.faculty_id).count()

    return {
        "my_students": len(students),
        "my_subjects": subject_count,
        "at_risk_count": at_risk_count,
        "reports_generated": reports_count,
    }


@router.get("/dashboard-students")
def dashboard_students(db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    """Real per-class breakdown of this teacher's own students, one row per
    real TeachingAssignment (batch+semester+section+subject) — powers the
    'My Students' dashboard modal."""
    assignments = db.query(TeachingAssignment).filter(TeachingAssignment.faculty_id == user.faculty_id, TeachingAssignment.passed_out == False).all()
    all_ids = set()
    classes = []
    for a in assignments:
        ids = _matching_student_ids(db, [a])
        all_ids.update(ids)
        classes.append({
            "assignment_id": a.id, "batch": a.batch, "semester": a.semester, "section": a.section,
            "subject_code": a.subject.code if a.subject else None, "subject_name": a.subject.name if a.subject else None,
            "student_count": len(ids),
        })
    return {"total_students": len(all_ids), "classes": classes}


@router.get("/dashboard-subjects")
def dashboard_subjects(db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    """Real distinct subjects this teacher teaches, from their own
    TeachingAssignments when configured — powers the 'My Subjects' dashboard
    modal. Falls back to Subject.faculty_id when no assignments exist yet."""
    assignments = db.query(TeachingAssignment).filter(TeachingAssignment.faculty_id == user.faculty_id, TeachingAssignment.passed_out == False).all()
    if assignments:
        seen = set()
        subjects = []
        for a in assignments:
            key = (a.subject_id, a.semester)
            if not a.subject_id or key in seen:
                continue
            seen.add(key)
            subjects.append({"subject_id": a.subject_id, "subject_code": a.subject.code if a.subject else None, "subject_name": a.subject.name if a.subject else None, "semester": a.semester})
        return {"subjects": subjects}
    rows = db.query(Subject).filter(Subject.faculty_id == user.faculty_id).all()
    return {"subjects": [{"subject_id": s.id, "subject_code": s.code, "subject_name": s.name, "semester": s.semester} for s in rows]}


def _real_subject_attendance_pct(db: Session, student_id: int, subject_id: int):
    """Real attendance % for THIS student in THIS specific subject, computed
    from actual AttendanceSession/AttendanceRecord data — never the student's
    general attendance_pct field, which isn't subject-specific. Returns None
    (not 0) when no sessions have been held yet for this subject."""
    from app.models.models import AttendanceSession, AttendanceRecord
    total_sessions = db.query(AttendanceSession).filter(AttendanceSession.subject_id == subject_id).count()
    if total_sessions == 0:
        return None
    present_count = db.query(AttendanceRecord).join(AttendanceSession).filter(
        AttendanceRecord.student_id == student_id, AttendanceSession.subject_id == subject_id, AttendanceRecord.present == True
    ).count()
    return round((present_count / total_sessions) * 100, 1)


def _real_internal_marks(db: Session, student_id: int, subject_id: int):
    """Real internal marks for THIS student in THIS subject, averaged across
    whatever IA records exist. Returns None (not 0) when no Marks records
    exist yet for this subject — missing data must never be treated as a
    failing score."""
    rows = db.query(Marks).filter(Marks.student_id == student_id, Marks.subject_id == subject_id).all()
    if not rows:
        return None
    scored = [r.marks_obtained for r in rows if r.marks_obtained is not None]
    if not scored:
        return None
    return round(sum(scored) / len(scored), 1)


@router.get("/at-risk-students")
def at_risk_students(reason: Optional[str] = None, db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    """Real at-risk detection, exactly per spec:
    AtRisk = (internal_marks is available AND internal_marks < 10) OR (attendance < 50%)
    Missing internal marks is NEVER treated as 0 — it's excluded from that
    condition entirely until real data exists. Scoped to the teacher's own
    real teaching assignments (batch+semester+section+subject), never
    college-wide or another teacher's subject."""
    assignments = db.query(TeachingAssignment).filter(TeachingAssignment.faculty_id == user.faculty_id, TeachingAssignment.passed_out == False).all()
    if not assignments:
        return {"students": [], "message": "No teaching assignments found."}

    seen_student_ids = set()
    results = []
    for a in assignments:
        students = db.query(Student).filter(Student.batch == a.batch, Student.semester == a.semester, Student.status == "active")
        if a.section:
            students = students.filter(Student.section == a.section)
        for s in students.all():
            key = (s.id, a.subject_id)
            if key in seen_student_ids:
                continue
            seen_student_ids.add(key)

            attendance = _real_subject_attendance_pct(db, s.id, a.subject_id)
            internal_marks = _real_internal_marks(db, s.id, a.subject_id)

            low_attendance = attendance is not None and attendance < 50
            low_marks = internal_marks is not None and internal_marks < 10

            if not (low_attendance or low_marks):
                continue

            reasons = []
            if low_marks:
                reasons.append(f"Internal Marks: {internal_marks}")
            if low_attendance:
                reasons.append(f"Attendance: {attendance}%")
            reason_label = "Internal Marks + Attendance" if (low_marks and low_attendance) else ("Internal Marks" if low_marks else "Attendance")

            if reason == "Internal Marks" and not low_marks:
                continue
            if reason == "Attendance" and not low_attendance:
                continue
            if reason == "Both" and not (low_marks and low_attendance):
                continue

            results.append({
                "student_id": s.id, "name": s.name, "usn": s.usn,
                "subject_id": a.subject_id, "subject_code": a.subject.code if a.subject else None,
                "internal_marks": internal_marks, "attendance": attendance,
                "reasons": reasons, "reason_label": reason_label,
            })

    return {"students": results, "message": None if results else "No at-risk students found for your teaching assignments."}


# ---------- teaching assignments (real, persisted, editable) ----------

def _next_semester_for_batch(db: Session, batch: str):
    """Real, computed 'current semester' for a batch — highest completed
    semester (from actual semester_sgpa records) + 1. Never hardcoded."""
    students = db.query(Student).filter(Student.batch == batch, Student.status == "active").all()
    highest_completed = 0
    for s in students:
        if s.semester_sgpa:
            sems = [int(k) for k in s.semester_sgpa.keys()]
            if sems:
                highest_completed = max(highest_completed, max(sems))
    return {"batch": batch, "highest_completed_semester": highest_completed, "current_semester": highest_completed + 1}


@router.get("/next-semester-for-batch")
def next_semester_for_batch(batch: str, db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    return _next_semester_for_batch(db, batch)


class TeachingAssignmentIn(BaseModel):
    batch: str  # real student entry-year batch, e.g. "2023" — must be a currently active batch
    semester: Optional[int] = None       # required unless passed_out=True
    section: Optional[str] = None
    subject_id: Optional[int] = None     # an existing real subject, OR
    subject_code: Optional[str] = None   # a subject code to look up / create, with...
    subject_name: Optional[str] = None   # ...its name, only needed when the code doesn't exist yet
    passed_out: bool = False


@router.get("/active-batches")
def active_batches(db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    """Real, currently active batches only — passed-out batches are excluded.
    Powers the Batch dropdown on the Teaching Assignment form."""
    return _active_batches(db)


@router.get("/my-batches")
def my_batches(db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    """Real batches THIS teacher actually teaches — from their own explicit
    TeachingAssignments when configured (this drives the Batch dropdown on
    Attendance Upload and Student Counseling, so a teacher only ever sees
    their own real classes there). Falls back to every currently active
    batch when they haven't configured any assignments yet, matching the
    same batch-blind fallback used elsewhere until they do."""
    rows = db.query(TeachingAssignment.batch).filter(TeachingAssignment.faculty_id == user.faculty_id, TeachingAssignment.passed_out == False, TeachingAssignment.batch.isnot(None)).distinct().all()
    batches = sorted({r[0] for r in rows if r[0]})
    return batches if batches else _active_batches(db)


@router.get("/passed-out-batches")
def passed_out_batches(db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    """Batches THIS teacher has explicitly recorded as passed out, for the
    Teaching Assignment form's batch datalist."""
    rows = db.query(TeachingAssignment.batch).filter(TeachingAssignment.faculty_id == user.faculty_id, TeachingAssignment.passed_out == True, TeachingAssignment.batch.isnot(None)).distinct().all()
    return sorted({r[0] for r in rows if r[0]})


@router.get("/subject-lookup")
def subject_lookup(code: str, db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    """Real lookup by exact subject code, so the Teaching Assignment form can
    tell a teacher whether the code they typed already exists (reuse it) or
    is new (ask for its name so a real Subject row can be created)."""
    subject = db.query(Subject).filter(Subject.code == code.strip()).first()
    if not subject:
        return {"found": False}
    return {"found": True, "id": subject.id, "name": subject.name}


@router.get("/assignments")
def list_assignments(db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    rows = db.query(TeachingAssignment).filter(TeachingAssignment.faculty_id == user.faculty_id).all()
    return [{
        "id": a.id, "batch": a.batch, "semester": a.semester, "section": a.section,
        "subject_id": a.subject_id, "subject_code": a.subject.code if a.subject else None,
        "subject_name": a.subject.name if a.subject else None, "passed_out": a.passed_out,
    } for a in rows]


def _resolve_or_create_subject(db: Session, user: User, payload: "TeachingAssignmentIn"):
    """Resolve the real Subject this assignment is for — by id, by an
    existing code, or (only when the code is genuinely new) by creating a
    real Subject row for it under the teacher's own department. Never
    invents a subject silently: a brand-new code without a name is rejected
    rather than guessed."""
    if payload.subject_id:
        subject = db.query(Subject).filter(Subject.id == payload.subject_id).first()
        if not subject:
            raise HTTPException(status_code=400, detail="Subject not found")
        return subject
    if not payload.subject_code or not payload.subject_code.strip():
        raise HTTPException(status_code=400, detail="Provide subject_id or subject_code")
    code = payload.subject_code.strip()
    subject = db.query(Subject).filter(Subject.code == code).first()
    if subject:
        if not subject.faculty_id:
            subject.faculty_id = user.faculty_id  # claim a real, previously-unassigned subject
        return subject
    if not payload.subject_name or not payload.subject_name.strip():
        raise HTTPException(status_code=400, detail=f"'{code}' is a new subject code — provide its subject_name too")
    faculty = db.query(Faculty).filter(Faculty.id == user.faculty_id).first()
    subject = Subject(
        code=code, name=payload.subject_name.strip(), department_id=faculty.department_id if faculty else None,
        semester=payload.semester, faculty_id=user.faculty_id, name_verified=True,
    )
    db.add(subject)
    db.flush()
    return subject


@router.post("/assignments")
def create_assignment(payload: TeachingAssignmentIn, db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    if payload.passed_out:
        # Recording that a batch is done: no current semester/section/subject
        # applies to it, so none is required.
        existing = db.query(TeachingAssignment).filter(
            TeachingAssignment.faculty_id == user.faculty_id, TeachingAssignment.batch == payload.batch,
            TeachingAssignment.passed_out == True, TeachingAssignment.subject_id.is_(None),
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail=f"Batch {payload.batch} is already recorded as passed out.")
        a = TeachingAssignment(faculty_id=user.faculty_id, batch=payload.batch, semester=None, section=None, subject_id=None, passed_out=True)
        db.add(a)
        db.commit()
        db.refresh(a)
        log_activity(db, user, f"Recorded batch {a.batch} as passed out")
        return {"id": a.id, "message": "Passed-out batch recorded successfully."}

    if payload.semester is None:
        raise HTTPException(status_code=400, detail="Semester is required")
    if payload.semester > 8:
        raise HTTPException(status_code=400, detail="Semester cannot be higher than 8 — a valid B.E. program has only 8 semesters.")
    if payload.batch not in _active_batches(db):
        raise HTTPException(status_code=400, detail=f"Batch {payload.batch} is not a currently active batch")

    # Real semester floor: cannot assign below the batch's real, computed current semester
    next_sem = _next_semester_for_batch(db, payload.batch)
    if next_sem["current_semester"] > 8:
        raise HTTPException(status_code=400, detail=f"Batch {payload.batch} has already completed all 8 semesters — record it as passed out instead of assigning a current semester.")
    if payload.semester < next_sem["current_semester"]:
        raise HTTPException(status_code=400, detail=f"Semester cannot be lower than the automatically calculated current semester (Sem {next_sem['current_semester']}).")

    subject = _resolve_or_create_subject(db, user, payload)

    # Real duplicate prevention: Teacher + Batch + Semester + Section + Subject
    existing = db.query(TeachingAssignment).filter(
        TeachingAssignment.faculty_id == user.faculty_id, TeachingAssignment.batch == payload.batch,
        TeachingAssignment.semester == payload.semester, TeachingAssignment.section == payload.section,
        TeachingAssignment.subject_id == subject.id,
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="This exact teaching assignment already exists.")

    a = TeachingAssignment(
        faculty_id=user.faculty_id, batch=payload.batch, semester=payload.semester,
        department_id=subject.department_id, section=payload.section,
        subject_id=subject.id, passed_out=False,
    )
    db.add(a)
    db.commit()
    db.refresh(a)
    log_activity(db, user, f"Added teaching assignment: Batch {a.batch}, Sem {a.semester}, {subject.code}")
    return {"id": a.id, "message": "Teaching assignment saved successfully."}


@router.patch("/assignments/{assignment_id}")
def update_assignment(assignment_id: int, payload: TeachingAssignmentIn, db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    a = db.query(TeachingAssignment).filter(TeachingAssignment.id == assignment_id, TeachingAssignment.faculty_id == user.faculty_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="Assignment not found")
    if payload.passed_out:
        a.batch, a.semester, a.section, a.subject_id, a.passed_out = payload.batch, None, None, None, True
        db.commit()
        return {"message": "Teaching assignment saved successfully."}
    if payload.semester is None:
        raise HTTPException(status_code=400, detail="Semester is required")
    if payload.semester > 8:
        raise HTTPException(status_code=400, detail="Semester cannot be higher than 8 — a valid B.E. program has only 8 semesters.")
    next_sem = _next_semester_for_batch(db, payload.batch)
    if payload.semester < next_sem["current_semester"]:
        raise HTTPException(status_code=400, detail=f"Semester cannot be lower than the automatically calculated current semester (Sem {next_sem['current_semester']}).")
    subject = _resolve_or_create_subject(db, user, payload)
    a.batch, a.semester, a.section, a.subject_id, a.passed_out = payload.batch, payload.semester, payload.section, subject.id, False
    db.commit()
    return {"message": "Teaching assignment saved successfully."}


@router.delete("/assignments/{assignment_id}")
def delete_assignment(assignment_id: int, db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    a = db.query(TeachingAssignment).filter(TeachingAssignment.id == assignment_id, TeachingAssignment.faculty_id == user.faculty_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="Assignment not found")
    db.delete(a)  # only removes the teacher's association — never touches students or their records
    db.commit()
    return {"message": "Removed"}


# ---------- students (real, scoped) ----------

@router.get("/students")
def my_students(
    semester: Optional[int] = None,
    section: Optional[str] = None,
    batch: Optional[str] = None,
    status: Optional[str] = None,
    subject_id: Optional[int] = None,
    demo_mode: Optional[bool] = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(require_role("teacher")),
):
    ids = None
    if subject_id:
        ids = _teacher_student_ids_for_subject(db, user.faculty_id, subject_id, batch=batch, semester=semester)
        if ids is not None and section:
            ids = [r[0] for r in db.query(Student.id).filter(Student.id.in_(ids), Student.section == section).all()]
    if ids is None:
        if subject_id:
            subject = db.query(Subject).filter(Subject.id == subject_id).first()
            semester = subject.semester if subject else semester
        ids = _teacher_student_ids(db, user.faculty_id, batch=batch, semester=semester, section=section)
    if not ids:
        return []
    q = db.query(Student).filter(Student.id.in_(ids))
    if status:
        q = q.filter(Student.status == status)
    rows = q.all()
    out = [{
        "id": s.id, "usn": s.usn, "name": s.name, "batch": s.batch, "status": s.status, "semester": s.semester, "section": s.section,
        "cgpa": s.cgpa, "attendance_pct": s.attendance_pct, "backlogs": s.backlogs, "data_status": s.data_status,
    } for s in rows]
    return [apply_demo_mask(r, demo_mode) for r in out]


@router.get("/available-semesters")
def available_semesters(batch: Optional[str] = None, db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    """Only the semesters THIS teacher handles — optionally scoped to a real
    batch too, so the dropdown never shows Sem 1-8 blindly or mixes batches."""
    return _teacher_semesters(db, user.faculty_id, batch=batch)


@router.get("/available-sections")
def available_sections(batch: Optional[str] = None, semester: Optional[int] = None, db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    ids = _teacher_student_ids(db, user.faculty_id, batch=batch, semester=semester)
    if not ids:
        return []
    rows = db.query(Student.section).filter(Student.id.in_(ids), Student.section.isnot(None)).distinct().all()
    return sorted({r[0] for r in rows if r[0]})


# ---------- subjects & schemes ----------

@router.get("/subjects")
def my_subjects(scheme: Optional[str] = None, db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    q = db.query(Subject).filter(Subject.faculty_id == user.faculty_id)
    if scheme:
        q = q.filter(Subject.scheme == scheme)
    rows = q.all()
    if not rows and not scheme:
        rows = db.query(Subject).all()
    result = []
    for s in rows:
        enrolled = db.query(Student).filter(Student.semester == s.semester, Student.status == "active").count() if s.semester else 0
        result.append({"id": s.id, "code": s.code, "name": s.name, "semester": s.semester, "scheme": s.scheme, "enrolled_count": enrolled})
    return result


@router.get("/schemes")
def my_schemes(db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    rows = db.query(Subject.scheme).filter(Subject.faculty_id == user.faculty_id, Subject.scheme.isnot(None)).distinct().all()
    return sorted([r[0] for r in rows])


@router.get("/question-bank")
def question_bank_for_subject(
    subject_folder: str = None, difficulty: str = None, bloom_level: str = None,
    db: Session = Depends(get_db), user: User = Depends(require_role("teacher")),
):
    """Real question content, now filterable by real difficulty/Bloom's
    level — tag_source tells the frontend whether each was extracted
    directly from the source PDF or inferred from its real action verbs,
    so nothing is ever presented as more certain than it is."""
    from app.models.models import QuestionBankChunk
    q = db.query(QuestionBankChunk)
    if subject_folder:
        q = q.filter(QuestionBankChunk.subject_folder == subject_folder)
    if difficulty:
        q = q.filter(QuestionBankChunk.difficulty == difficulty)
    if bloom_level:
        q = q.filter(QuestionBankChunk.bloom_level == bloom_level)
    rows = q.limit(30).all()
    return [{
        "subject_folder": r.subject_folder, "ia_stage": r.ia_stage, "source_file": r.source_file,
        "text": r.text[:600], "bloom_level": r.bloom_level, "difficulty": r.difficulty,
        "marks": r.marks, "tag_source": r.tag_source,
    } for r in rows]


@router.get("/assigned-subjects")
def assigned_subjects_for_batch_semester(batch: str, semester: int, db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    """Real subjects THIS teacher is actually assigned to teach for this
    exact batch+semester — from real TeachingAssignments, not just any
    subject at that semester across the whole department."""
    assignments = db.query(TeachingAssignment).filter(
        TeachingAssignment.faculty_id == user.faculty_id, TeachingAssignment.batch == batch,
        TeachingAssignment.semester == semester, TeachingAssignment.passed_out == False,
    ).all()
    if assignments:
        seen = set()
        result = []
        for a in assignments:
            if a.subject_id in seen:
                continue
            seen.add(a.subject_id)
            result.append({"id": a.subject_id, "code": a.subject.code, "name": a.subject.name})
        return result
    # fallback for teachers who haven't configured assignments yet
    subjects = db.query(Subject).filter(Subject.faculty_id == user.faculty_id, Subject.semester == semester).all()
    return [{"id": s.id, "code": s.code, "name": s.name} for s in subjects]


@router.get("/question-bank/subjects")
def question_bank_subject_folders(db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    from app.models.models import QuestionBankChunk
    from sqlalchemy import distinct
    rows = db.query(distinct(QuestionBankChunk.subject_folder)).all()
    return [r[0] for r in rows]


class GenerateSlidesRequest(BaseModel):
    topic: str
    num_slides: int = 8
    audience: str = "Engineering Students"
    tone: str = "Professional"
    instructions: str = ""


@router.post("/generate-ppt")
def generate_ppt(payload: GenerateSlidesRequest, db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    """Real LLM-generated slides, grounded in real question-bank content
    when the topic matches something in your actual course material —
    via the same TF-IDF retrieval used for the assistant. Returns an honest
    'not connected' result with zero fake slides if no API key is set."""
    from app.core.llm_client import generate_slides
    from app.core.rag_retrieval import retrieve

    chunks = retrieve(db, payload.topic, top_k=3)
    context = "\n---\n".join(c["text"][:500] for c in chunks) if chunks else ""

    result = generate_slides(
        topic=payload.topic, num_slides=payload.num_slides, audience=payload.audience,
        tone=payload.tone, instructions=payload.instructions, context=context,
    )
    return {
        "slides": result["slides"], "connected": result["connected"],
        "message": result.get("message"), "grounded_in_real_content": len(chunks) > 0,
    }


# ---------- style-aware generation: real past PPTs/notes teach format, real textbooks teach content ----------

def _save_upload(file: UploadFile, prefix: str):
    safe_name = re.sub(r"[^A-Za-z0-9_.]", "_", file.filename)
    stored_name = f"{prefix}_{int(datetime.utcnow().timestamp() * 1000)}_{safe_name}"
    upload_dir = os.path.join(os.path.dirname(__file__), "..", "..", "data_raw", "teacher_uploads")
    os.makedirs(upload_dir, exist_ok=True)
    return stored_name, os.path.join(upload_dir, stored_name)


def _save_teacher_file(file: UploadFile, prefix: str) -> tuple:
    stored_name, dest_path = _save_upload(file, prefix)
    return stored_name, dest_path


def _chapter_summaries(chunks: list[dict]) -> list[dict]:
    """Expose one selectable chapter while keeping its internal LLM chunks."""
    summaries = {}
    for chunk in chunks:
        title = chunk["title"]
        summary = summaries.setdefault(title, {"title": title, "length": 0, "source_pages": []})
        summary["length"] += len(chunk.get("text", ""))
        for page in chunk.get("source_pages", []):
            if page not in summary["source_pages"]:
                summary["source_pages"].append(page)
    return list(summaries.values())


@router.post("/style-references/upload")
async def upload_style_reference(
    output_type: str = Form(...),  # "ppt" | "notes"
    subject_id: Optional[int] = Form(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db), user: User = Depends(require_role("teacher")),
):
    """Upload a real past PPT (.pptx) or notes (.docx) file. The system
    extracts real structural statistics from it — never a guessed or
    templated style — and stores that as this teacher's real style profile
    for this output type."""
    from app.models.models import StyleReference
    from app.core.content_extraction import extract_ppt_style, extract_notes_style
    from app.core.file_storage import upload_file
    import io
    import json as _json

    ext = file.filename.lower().rsplit(".", 1)[-1]
    if output_type == "ppt" and ext != "pptx":
        raise HTTPException(status_code=400, detail="Please upload a real .pptx file for PPT style")
    if output_type == "notes" and ext != "docx":
        raise HTTPException(status_code=400, detail="Please upload a real .docx file for Notes style")

    stored_name, _ = _save_teacher_file(file, f"style_{output_type}")
    contents = await file.read()

    try:
        profile = extract_ppt_style(io.BytesIO(contents)) if output_type == "ppt" else extract_notes_style(io.BytesIO(contents))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read this file's real structure: {str(e)}")

    upload_file(f"teacher_uploads/{stored_name}", contents)

    ref = StyleReference(
        faculty_id=user.faculty_id, subject_id=subject_id, output_type=output_type,
        filename=file.filename, stored_filename=stored_name, style_profile=_json.dumps(profile),
    )
    db.add(ref)
    db.commit()
    db.refresh(ref)
    return {"id": ref.id, "filename": ref.filename, "style_profile": profile}


@router.get("/style-references")
def list_style_references(output_type: Optional[str] = None, subject_id: Optional[int] = None, db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    from app.models.models import StyleReference
    import json as _json
    q = db.query(StyleReference).filter(StyleReference.faculty_id == user.faculty_id)
    if output_type:
        q = q.filter(StyleReference.output_type == output_type)
    if subject_id:
        q = q.filter(StyleReference.subject_id == subject_id)
    rows = q.all()
    return [{"id": r.id, "filename": r.filename, "output_type": r.output_type,
             "style_profile": _json.loads(r.style_profile) if r.style_profile else None} for r in rows]


@router.delete("/style-references/{ref_id}")
def delete_style_reference(ref_id: int, db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    from app.models.models import StyleReference
    r = db.query(StyleReference).filter(StyleReference.id == ref_id, StyleReference.faculty_id == user.faculty_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Not found")
    db.delete(r)
    db.commit()
    return {"message": "Deleted"}


@router.post("/content-sources/upload")
async def upload_content_source(
    subject_id: Optional[int] = Form(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db), user: User = Depends(require_role("teacher")),
):
    """Upload a real textbook (.pdf or .docx). Real text is extracted and
    split into real chapters/modules when real heading patterns exist in
    the document; otherwise honestly falls back to fixed-size sections and
    reports that via chapters_detected=False."""
    from app.models.models import ContentSource
    from app.core.content_extraction import detect_chapters
    from app.core.file_storage import upload_file
    import json as _json
    import tempfile

    ext = file.filename.lower().rsplit(".", 1)[-1]
    if ext not in ("pdf", "docx", "txt", "pptx"):
        raise HTTPException(status_code=400, detail="Please upload a real .pdf or .docx textbook file")

    stored_name, _ = _save_teacher_file(file, "textbook")
    contents = await file.read()

    # detect_chapters' .txt branch needs a real path (the other formats
    # accept an in-memory stream) — a short-lived temp file covers every
    # format uniformly without touching content_extraction.py.
    with tempfile.NamedTemporaryFile(suffix=f".{ext}", delete=False) as tmp:
        tmp.write(contents)
        tmp_path = tmp.name
    try:
        result = detect_chapters(tmp_path, file.filename)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read this file's real content: {str(e)}")
    finally:
        os.remove(tmp_path)

    upload_file(f"teacher_uploads/{stored_name}", contents)

    source = ContentSource(
        faculty_id=user.faculty_id, subject_id=subject_id, filename=file.filename,
        stored_filename=stored_name, chapters=_json.dumps(result["chapters"]), chapters_detected=result["chapters_detected"],
    )
    db.add(source)
    db.commit()
    db.refresh(source)
    logger.info("PPT content upload '%s': %d pages, %d characters, %d extracted sections", file.filename, result.get("page_count", 0), result.get("extracted_characters", 0), len(result["chapters"]))
    return {
        "id": source.id, "filename": source.filename, "chapters_detected": source.chapters_detected,
        "page_count": result.get("page_count", 0), "extracted_characters": result.get("extracted_characters", 0),
        "chapters": _chapter_summaries(result["chapters"]),
    }


@router.get("/content-sources")
def list_content_sources(subject_id: Optional[int] = None, db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    from app.models.models import ContentSource
    import json as _json
    q = db.query(ContentSource).filter(ContentSource.faculty_id == user.faculty_id)
    if subject_id:
        q = q.filter(ContentSource.subject_id == subject_id)
    rows = q.all()
    return [{
        "id": r.id, "filename": r.filename, "chapters_detected": r.chapters_detected,
        "chapters": _chapter_summaries(_json.loads(r.chapters)) if r.chapters else [],
    } for r in rows]


@router.delete("/content-sources/{source_id}")
def delete_content_source(source_id: int, db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    from app.models.models import ContentSource
    r = db.query(ContentSource).filter(ContentSource.id == source_id, ContentSource.faculty_id == user.faculty_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Not found")
    db.delete(r)
    db.commit()
    return {"message": "Deleted"}


def _build_style_summary(db, faculty_id, output_type, subject_id):
    """Real, aggregated style guidance from ALL of this teacher's uploaded
    real reference files for this output type — never a single arbitrary
    example, averaged/combined honestly across whatever was uploaded."""
    from app.models.models import StyleReference
    import json as _json
    q = db.query(StyleReference).filter(StyleReference.faculty_id == faculty_id, StyleReference.output_type == output_type)
    if subject_id:
        q = q.filter(StyleReference.subject_id == subject_id)
    refs = q.all()
    if not refs:
        return None, 0
    profiles = [_json.loads(r.style_profile) for r in refs if r.style_profile]
    if output_type == "ppt":
        avg_bullets = sum(p.get("avg_bullets_per_slide", 0) for p in profiles) / len(profiles)
        avg_words = sum(p.get("avg_words_per_bullet", 0) for p in profiles) / len(profiles)
        samples = [h for p in profiles for h in p.get("heading_samples", [])][:8]
        summary = (
            f"Based on {len(refs)} real past presentation(s) from this teacher: "
            f"average {avg_bullets:.1f} bullet points per slide, average {avg_words:.1f} words per bullet. "
            f"Real example slide titles this teacher has used: {'; '.join(samples)}."
        )
    else:
        avg_words = sum(p.get("avg_paragraph_words", 0) for p in profiles) / len(profiles)
        samples = [h for p in profiles for h in p.get("heading_samples", [])][:8]
        summary = (
            f"Based on {len(refs)} real past notes document(s) from this teacher: "
            f"average paragraph length {avg_words:.1f} words. "
            f"Real example section headings this teacher has used: {'; '.join(samples)}."
        )
    return summary, len(refs)


class ModuleMappingIn(BaseModel):
    content_source_id: int
    module_name: str
    chapter_titles: list  # real chapter titles from that content source, chosen by the teacher


@router.post("/module-mappings")
def create_module_mapping(payload: ModuleMappingIn, db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    """Saves a teacher's real, one-time decision about which real textbook
    chapters make up a syllabus module. This is never auto-guessed — a
    textbook's chapters and a department's syllabus modules are independent
    structures with no reliable automatic mapping between them."""
    from app.models.models import ContentSource, ModuleMapping
    import json as _json

    source = db.query(ContentSource).filter(ContentSource.id == payload.content_source_id, ContentSource.faculty_id == user.faculty_id).first()
    if not source:
        raise HTTPException(status_code=404, detail="Content source not found or not yours")

    real_titles = {c["title"] for c in _json.loads(source.chapters)}
    invalid = [t for t in payload.chapter_titles if t not in real_titles]
    if invalid:
        raise HTTPException(status_code=400, detail=f"These chapters don't exist in this content source: {invalid}")
    if not payload.chapter_titles:
        raise HTTPException(status_code=400, detail="Select at least one real chapter for this module")

    mapping = ModuleMapping(
        faculty_id=user.faculty_id, content_source_id=payload.content_source_id,
        module_name=payload.module_name, chapter_titles=_json.dumps(payload.chapter_titles),
    )
    db.add(mapping)
    db.commit()
    db.refresh(mapping)
    return {"id": mapping.id, "module_name": mapping.module_name, "chapter_titles": payload.chapter_titles}


@router.get("/module-mappings")
def list_module_mappings(content_source_id: Optional[int] = None, db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    from app.models.models import ModuleMapping
    import json as _json
    q = db.query(ModuleMapping).filter(ModuleMapping.faculty_id == user.faculty_id)
    if content_source_id:
        q = q.filter(ModuleMapping.content_source_id == content_source_id)
    rows = q.all()
    return [{"id": m.id, "module_name": m.module_name, "chapter_titles": _json.loads(m.chapter_titles), "content_source_id": m.content_source_id} for m in rows]


@router.delete("/module-mappings/{mapping_id}")
def delete_module_mapping(mapping_id: int, db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    from app.models.models import ModuleMapping
    m = db.query(ModuleMapping).filter(ModuleMapping.id == mapping_id, ModuleMapping.faculty_id == user.faculty_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Not found")
    db.delete(m)
    db.commit()
    return {"message": "Deleted"}


class StyledGenerationRequest(BaseModel):
    output_type: str  # "ppt" | "notes"
    content_source_id: int
    chapter_title: Optional[str] = None                 # a single real chapter, OR
    module_mapping_id: Optional[int] = None              # a saved real multi-chapter module, OR
    selected_chapter_titles: Optional[list] = None       # an ad-hoc multi-chapter selection (not saved as a module)
    subject_id: Optional[int] = None
    style_reference_id: Optional[int] = None
    num_slides: int = 8              # only used for ppt when automatic_slide_count is False
    automatic_slide_count: bool = True
    audience: str = "Beginner"
    exam_orientation: str = "High"
    content_depth: str = "Detailed"
    include_examples: bool = True
    include_diagrams: bool = True
    include_exam_questions: bool = True
    include_revision: bool = True
    force_new_version: bool = False  # regenerate even if an identical past generation exists


def _settings_directives(payload: "StyledGenerationRequest") -> str:
    """Turns the teacher's real generation-settings toggles into concrete
    prompt directives, so each control actually changes the AI's output
    instead of being decorative UI with no effect on generation."""
    depth_line = {
        "Detailed": "Go deep: fully explain mechanisms, edge cases, and reasoning, not just definitions.",
        "Balanced": "Cover the core mechanism and one supporting detail per point — not exhaustive, not bare definitions.",
        "Concise": "Keep every bullet short and high-level; state the key fact, skip elaboration.",
    }.get(payload.content_depth, "")
    exam_line = {
        "High": "This content is exam-critical: surface likely exam angles, precise definitions, and any formula/algorithm exactly as given in the source.",
        "Medium": "Balance conceptual understanding with exam relevance.",
        "Low": "Prioritize conceptual understanding over exam phrasing.",
    }.get(payload.exam_orientation, "")
    directives = [f"Audience level: {payload.audience}.", depth_line, exam_line]
    directives.append("Include a genuine worked example in step_by_step_example where the source supports one." if payload.include_examples
                       else "Do not include step_by_step_example content; leave it empty.")
    directives.append("Populate diagram_description/process_steps whenever the content has a real structure or sequence worth visualizing." if payload.include_diagrams
                       else "Leave diagram_description and process_steps empty — do not suggest a visual for this generation.")
    directives.append("Where naturally supported by the source, phrase at least one bullet as the kind of question this content would be examined on." if payload.include_exam_questions
                       else "Do not phrase bullets as exam questions.")
    return " ".join(d for d in directives if d)


@router.post("/generate-styled-content")
def generate_styled_content(payload: StyledGenerationRequest, db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    """The real, complete pipeline: pulls this teacher's real style profile
    (from uploaded past PPTs/notes) and the real chapter text — a single
    real chapter, an ad-hoc multi-chapter selection, or the COMBINED real
    text of every chapter in a saved module mapping — and asks the LLM to
    generate new content grounded in it, formatted the way this teacher
    actually formats things. Honestly reports 'not connected' with zero
    fake content if no API key. Identical repeat requests (same real
    chapters + same settings) are served from a saved past generation
    instead of spending another AI call, unless force_new_version is set."""
    from app.models.models import ContentSource, ModuleMapping, GeneratedPresentation
    from app.core.llm_client import generate_slides_from_chunks, generate_notes, plan_slide_allocation, SLIDE_PROMPT_VERSION
    from app.core.content_extraction import extract_images_from_pdf
    import json as _json
    import hashlib

    source = db.query(ContentSource).filter(ContentSource.id == payload.content_source_id, ContentSource.faculty_id == user.faculty_id).first()
    if not source:
        raise HTTPException(status_code=404, detail="Content source not found or not yours")
    real_chapters = _json.loads(source.chapters)

    if payload.module_mapping_id:
        mapping = db.query(ModuleMapping).filter(ModuleMapping.id == payload.module_mapping_id, ModuleMapping.faculty_id == user.faculty_id).first()
        if not mapping:
            raise HTTPException(status_code=404, detail="Module mapping not found or not yours")
        wanted_titles = _json.loads(mapping.chapter_titles)
        matched = [c for c in real_chapters if c["title"] in wanted_titles]
        if not matched:
            raise HTTPException(status_code=404, detail="None of this module's saved chapters exist in the content source anymore")
        selected_chunks = matched
        topic_name = mapping.module_name
    elif payload.selected_chapter_titles:
        matched = [c for c in real_chapters if c["title"] in payload.selected_chapter_titles]
        if not matched:
            raise HTTPException(status_code=404, detail="None of the selected chapters exist in this content source anymore")
        selected_chunks = matched
        topic_name = " / ".join(payload.selected_chapter_titles)
    elif payload.chapter_title:
        chapter = next((c for c in real_chapters if c["title"] == payload.chapter_title), None)
        if not chapter:
            raise HTTPException(status_code=404, detail=f"'{payload.chapter_title}' not found in this content source")
        selected_chunks = [chapter]
        topic_name = chapter["title"]
    else:
        raise HTTPException(status_code=400, detail="Provide chapter_title, selected_chapter_titles, or module_mapping_id")

    real_text_length = sum(len(c.get("text", "")) for c in selected_chunks)
    if real_text_length < 150:
        raise HTTPException(
            status_code=400,
            detail=(
                f"The selected real content only has {real_text_length} extractable characters — too little to "
                "generate anything meaningful from. This usually means the source PDF is scanned/image-based "
                "with no real body text. Delete this content source and re-upload a text-based PDF or .docx."
            ),
        )

    style_summary, ref_count = _build_style_summary(db, user.faculty_id, payload.output_type, payload.subject_id)

    if payload.output_type == "ppt":
        settings = {
            "chapter_titles": sorted(c["title"] for c in selected_chunks),
            "prompt_version": SLIDE_PROMPT_VERSION,
            "style_reference_id": payload.style_reference_id,
            "num_slides": payload.num_slides, "automatic_slide_count": payload.automatic_slide_count,
            "audience": payload.audience, "exam_orientation": payload.exam_orientation, "content_depth": payload.content_depth,
            "include_examples": payload.include_examples, "include_diagrams": payload.include_diagrams,
            "include_exam_questions": payload.include_exam_questions, "include_revision": payload.include_revision,
        }
        fingerprint_source = _json.dumps(settings, sort_keys=True) + "".join(c["text"] for c in selected_chunks)
        fingerprint = hashlib.sha256(fingerprint_source.encode("utf-8")).hexdigest()
        planned_slide_count = sum(plan_slide_allocation(selected_chunks, payload.num_slides, payload.automatic_slide_count))

        if not payload.force_new_version:
            existing = (db.query(GeneratedPresentation)
                        .filter(GeneratedPresentation.faculty_id == user.faculty_id, GeneratedPresentation.request_fingerprint == fingerprint)
                        .order_by(GeneratedPresentation.version.desc()).first())
            if existing:
                return {
                    "slides": _json.loads(existing.slides), "connected": True, "message": None, "reused": True,
                    "style_references_used": ref_count, "chapters_detected": source.chapters_detected,
                    "topic": topic_name, "planned_slide_count": existing.slide_count,
                }

        # Real figures straight from the uploaded textbook, when the PDF's
        # images are in an extractable format (JPEG/JPEG2000) — never an
        # AI-generated stand-in. Scanned textbooks (CCITT-compressed page
        # images) are honestly skipped rather than guessed at; see
        # content_extraction.extract_images_from_pdf.
        if source.filename.lower().endswith(".pdf"):
            import base64
            import io
            from app.core.file_storage import get_file
            try:
                source_bytes = get_file(f"teacher_uploads/{source.stored_filename}")
                images_by_page = extract_images_from_pdf(io.BytesIO(source_bytes))
            except FileNotFoundError:
                images_by_page = {}
            except Exception:
                images_by_page = {}
            for chunk in selected_chunks:
                for page_number in chunk.get("source_pages", []):
                    image = images_by_page.get(page_number)
                    if image:
                        chunk["textbook_image_base64"] = base64.b64encode(image["data"]).decode("ascii")
                        chunk["textbook_image_ext"] = image["ext"]
                        break

        combined_instructions = " ".join(filter(None, [
            style_summary or "No past style reference uploaded yet — using a clean default format.",
            _settings_directives(payload),
        ]))
        result = generate_slides_from_chunks(
            topic=topic_name, num_slides=payload.num_slides, audience=payload.audience,
            tone="Professional", instructions=combined_instructions,
            chunks=selected_chunks, automatic_slide_count=payload.automatic_slide_count,
        )
        if result.get("connected") and not result.get("error") and result.get("slides"):
            slides = result["slides"]
            if not payload.include_revision:
                slides = [s for s in slides if "revis" not in str(s.get("slide_type", "")).lower()]
            existing_version = (db.query(GeneratedPresentation)
                                 .filter(GeneratedPresentation.faculty_id == user.faculty_id, GeneratedPresentation.content_source_id == source.id, GeneratedPresentation.title == topic_name)
                                 .order_by(GeneratedPresentation.version.desc()).first())
            record = GeneratedPresentation(
                faculty_id=user.faculty_id, content_source_id=source.id, style_reference_id=payload.style_reference_id,
                title=topic_name, source_filename=source.filename, request_fingerprint=fingerprint,
                settings=_json.dumps(settings), slides=_json.dumps(slides), slide_count=len(slides),
                version=(existing_version.version + 1) if existing_version else 1,
            )
            db.add(record)
            db.commit()
            result = {**result, "slides": slides}
        return {
            "slides": result["slides"], "connected": result["connected"], "message": result.get("message"),
            "error": result.get("error", False), "reused": False,
            "style_references_used": ref_count, "chapters_detected": source.chapters_detected,
            "topic": topic_name, "planned_slide_count": planned_slide_count,
        }
    else:
        result = generate_notes(
            topic=topic_name, style_instructions=style_summary or "No past style reference uploaded yet — using a clean default format.",
            context="\n\n---\n\n".join(c["text"] for c in selected_chunks),
        )
        return {
            "notes": result.get("notes", ""), "connected": result["connected"], "message": result.get("message"),
            "style_references_used": ref_count, "chapters_detected": source.chapters_detected, "topic": topic_name,
        }


@router.get("/generated-presentations")
def list_generated_presentations(db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    """Every real AI-generated deck this teacher has produced, so a past
    generation can be reopened without spending another AI call."""
    from app.models.models import GeneratedPresentation
    rows = (db.query(GeneratedPresentation)
            .filter(GeneratedPresentation.faculty_id == user.faculty_id)
            .order_by(GeneratedPresentation.created_at.desc()).all())
    return [{
        "id": r.id, "title": r.title, "source_filename": r.source_filename,
        "slide_count": r.slide_count, "version": r.version, "created_at": str(r.created_at),
    } for r in rows]


@router.get("/generated-presentations/{presentation_id}")
def get_generated_presentation(presentation_id: int, db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    from app.models.models import GeneratedPresentation
    import json as _json
    r = db.query(GeneratedPresentation).filter(GeneratedPresentation.id == presentation_id, GeneratedPresentation.faculty_id == user.faculty_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Not found")
    return {
        "id": r.id, "title": r.title, "slides": _json.loads(r.slides),
        "style_reference_id": r.style_reference_id, "slide_count": r.slide_count, "version": r.version,
    }


@router.delete("/generated-presentations/{presentation_id}")
def delete_generated_presentation(presentation_id: int, db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    from app.models.models import GeneratedPresentation
    r = db.query(GeneratedPresentation).filter(GeneratedPresentation.id == presentation_id, GeneratedPresentation.faculty_id == user.faculty_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Not found")
    db.delete(r)
    db.commit()
    return {"message": "Deleted"}


# ---------- real file export — generates an actual downloadable .pptx / .docx ----------

class ExportPPTRequest(BaseModel):
    topic: str
    slides: list  # [{"title": str, "content": str}, ...] — may have been edited by the teacher before export


@router.post("/export-ppt")
def export_ppt(payload: ExportPPTRequest, user: User = Depends(require_role("teacher"))):
    """Builds a real, downloadable .pptx file from the given slides — these
    may have been edited by the teacher in the browser before export, so
    this always reflects exactly what they see, not the original AI draft.
    Uses a real, consistent brand theme (matching the web app's own brand
    color) instead of python-pptx's bare default layout, and surfaces the
    AI's real core_takeaway/diagram_description fields — previously
    generated by the LLM but silently dropped at export time — as an
    actual highlighted callout and a labeled suggested-visual note, rather
    than fabricating an image the model can't actually produce."""
    from pptx import Presentation
    from pptx.util import Pt, Inches, Emu
    from pptx.dml.color import RGBColor
    from pptx.enum.text import PP_ALIGN
    from pptx.enum.shapes import MSO_SHAPE
    from fastapi.responses import FileResponse
    import tempfile, re as _re

    BRAND = RGBColor(0x5B, 0x3F, 0xD9)
    BRAND_DARK = RGBColor(0x45, 0x30, 0xB0)
    BRAND_LIGHT = RGBColor(0xED, 0xEB, 0xF9)
    INK = RGBColor(0x12, 0x14, 0x1F)
    MUTED = RGBColor(0x6B, 0x72, 0x80)
    WHITE = RGBColor(0xFF, 0xFF, 0xFF)

    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)
    blank = prs.slide_layouts[6]

    # Title slide: full-bleed brand-colored background, white title + subtitle
    title_slide = prs.slides.add_slide(blank)
    bg = title_slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height)
    bg.fill.solid(); bg.fill.fore_color.rgb = BRAND; bg.line.fill.background()
    title_box = title_slide.shapes.add_textbox(Inches(1), Inches(2.9), prs.slide_width - Inches(2), Inches(1.5))
    tf = title_box.text_frame; tf.word_wrap = True
    p = tf.paragraphs[0]; p.text = payload.topic; p.font.size = Pt(40); p.font.bold = True; p.font.color.rgb = WHITE; p.font.name = "Calibri"
    subtitle_box = title_slide.shapes.add_textbox(Inches(1), Inches(4.3), prs.slide_width - Inches(2), Inches(0.6))
    sp = subtitle_box.text_frame.paragraphs[0]; sp.text = "Generated by Anviksha AI"; sp.font.size = Pt(18); sp.font.color.rgb = BRAND_LIGHT; sp.font.name = "Calibri"

    def add_bold_marked_paragraph(text_frame, raw_text, size, color, is_first, prefix=""):
        """Splits **bold**-marked text into separate bold/normal runs within
        one real paragraph, instead of one plain run — so the LLM's marked
        key terms actually render bold in the exported file, not just in
        the JSON."""
        p = text_frame.paragraphs[0] if is_first else text_frame.add_paragraph()
        if prefix:
            run = p.add_run(); run.text = prefix; run.font.size = size; run.font.color.rgb = color; run.font.name = "Calibri"
        for part in _re.split(r"(\*\*[^*]+\*\*)", raw_text):
            if not part:
                continue
            run = p.add_run()
            if part.startswith("**") and part.endswith("**"):
                run.text = part[2:-2]; run.font.bold = True
            else:
                run.text = part
            run.font.size = size; run.font.color.rgb = color; run.font.name = "Calibri"
        return p

    def add_process_flow(slide, steps, x, y, width, height):
        """Real, editable step-flow diagram built from python-pptx shapes -
        not an AI-generated image the model can't actually produce, but
        genuine boxes and connectors reflecting the LLM's real
        process_steps for this slide."""
        n = len(steps)
        gap = Inches(0.15)
        box_h = min(Inches(0.7), (height - gap * (n - 1)) / max(n, 1))
        cur_y = y
        for i, step in enumerate(steps):
            box = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, x, cur_y, width, box_h)
            box.fill.solid(); box.fill.fore_color.rgb = BRAND_LIGHT; box.line.color.rgb = BRAND; box.line.width = Pt(1)
            tf = box.text_frame; tf.word_wrap = True
            p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER
            run = p.add_run(); run.text = f"{i + 1}. {step}"; run.font.size = Pt(12); run.font.bold = True; run.font.color.rgb = BRAND_DARK; run.font.name = "Calibri"
            if i < n - 1:
                arrow_y = cur_y + box_h
                arrow = slide.shapes.add_shape(MSO_SHAPE.DOWN_ARROW, x + width / 2 - Inches(0.08), arrow_y, Inches(0.16), gap)
                arrow.fill.solid(); arrow.fill.fore_color.rgb = BRAND; arrow.line.fill.background()
            cur_y += box_h + gap

    def add_comparison_diagram(slide, points, left_label, right_label, x, y, width, height):
        """Real, editable side-by-side comparison diagram built from
        python-pptx shapes — two labeled columns of boxes reflecting the
        LLM's real comparison_points for this slide, not an AI-generated
        picture the model can't actually produce."""
        header_h = Inches(0.4)
        col_gap = Inches(0.1)
        col_width = (width - col_gap) / 2
        left_header = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, x, y, col_width, header_h)
        left_header.fill.solid(); left_header.fill.fore_color.rgb = MUTED; left_header.line.fill.background()
        lp = left_header.text_frame.paragraphs[0]; lp.alignment = PP_ALIGN.CENTER
        lr = lp.add_run(); lr.text = left_label.upper(); lr.font.size = Pt(11); lr.font.bold = True; lr.font.color.rgb = WHITE; lr.font.name = "Calibri"
        right_header = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, x + col_width + col_gap, y, col_width, header_h)
        right_header.fill.solid(); right_header.fill.fore_color.rgb = BRAND; right_header.line.fill.background()
        rp = right_header.text_frame.paragraphs[0]; rp.alignment = PP_ALIGN.CENTER
        rr = rp.add_run(); rr.text = right_label.upper(); rr.font.size = Pt(11); rr.font.bold = True; rr.font.color.rgb = WHITE; rr.font.name = "Calibri"

        n = len(points)
        row_gap = Inches(0.12)
        row_h = min(Inches(1.0), (height - header_h - row_gap * n) / max(n, 1))
        cur_y = y + header_h + row_gap
        for point in points:
            left_box = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, x, cur_y, col_width, row_h)
            left_box.fill.solid(); left_box.fill.fore_color.rgb = RGBColor(0xF8, 0xF8, 0xFB); left_box.line.color.rgb = RGBColor(0xE5, 0xE7, 0xEB); left_box.line.width = Pt(0.75)
            ltf = left_box.text_frame; ltf.word_wrap = True; ltf.margin_left = Inches(0.08); ltf.margin_right = Inches(0.08)
            llp = ltf.paragraphs[0]
            llr = llp.add_run(); llr.text = str(point.get("left", "")).strip(); llr.font.size = Pt(11); llr.font.color.rgb = INK; llr.font.name = "Calibri"

            right_box = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, x + col_width + col_gap, cur_y, col_width, row_h)
            right_box.fill.solid(); right_box.fill.fore_color.rgb = BRAND_LIGHT; right_box.line.color.rgb = BRAND; right_box.line.width = Pt(0.75)
            rtf = right_box.text_frame; rtf.word_wrap = True; rtf.margin_left = Inches(0.08); rtf.margin_right = Inches(0.08)
            rlp = rtf.paragraphs[0]
            rlr = rlp.add_run(); rlr.text = str(point.get("right", "")).strip(); rlr.font.size = Pt(11); rlr.font.color.rgb = BRAND_DARK; rlr.font.name = "Calibri"
            cur_y += row_h + row_gap

    for slide_data in payload.slides:
        slide = prs.slides.add_slide(blank)
        # accent bar under the title
        accent = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, Inches(0.12))
        accent.fill.solid(); accent.fill.fore_color.rgb = BRAND; accent.line.fill.background()

        title_box = slide.shapes.add_textbox(Inches(0.6), Inches(0.35), prs.slide_width - Inches(1.2), Inches(0.9))
        tp = title_box.text_frame.paragraphs[0]
        tp.text = slide_data.get("title", ""); tp.font.size = Pt(28); tp.font.bold = True; tp.font.color.rgb = BRAND_DARK; tp.font.name = "Calibri"

        process_steps = [s for s in (slide_data.get("process_steps") or []) if str(s).strip()][:6]
        comparison_points = [p for p in (slide_data.get("comparison_points") or []) if isinstance(p, dict) and (p.get("left") or p.get("right"))][:5]
        diagram = (slide_data.get("diagram_description") or "").strip()
        textbook_image_b64 = slide_data.get("textbook_image_base64")
        # Two-column layout when there's a real process to diagram, a real
        # comparison, a real textbook figure, or a suggested visual to note —
        # bullets get the left column instead of the full width, so the
        # slide has real visual structure rather than one long vertical stack.
        has_side_panel = bool(process_steps) or bool(comparison_points) or bool(diagram) or bool(textbook_image_b64)
        body_width = (prs.slide_width - Inches(2.2)) * (0.58 if has_side_panel else 1.0)

        body_box = slide.shapes.add_textbox(Inches(0.6), Inches(1.35), body_width, Inches(4.5))
        body = body_box.text_frame; body.word_wrap = True
        lines = [l.strip("- ").strip() for l in slide_data.get("content", "").split("\n") if l.strip()]
        for i, line in enumerate(lines):
            add_bold_marked_paragraph(body, line, Pt(18), INK, i == 0, prefix="•  ")
            body.paragraphs[-1].space_after = Pt(10)

        if has_side_panel:
            panel_x = Inches(0.6) + body_width + Inches(0.4)
            panel_width = prs.slide_width - panel_x - Inches(0.6)
            if textbook_image_b64:
                # A real figure extracted directly from the uploaded
                # textbook — takes priority over an AI-suggested visual
                # note, since it's real source content, not a suggestion.
                import base64 as _b64, io as _io
                panel_label = slide.shapes.add_textbox(panel_x, Inches(1.2), panel_width, Inches(0.3))
                panel_label.text_frame.paragraphs[0].text = "FROM THE TEXTBOOK"
                panel_label.text_frame.paragraphs[0].font.size = Pt(11); panel_label.text_frame.paragraphs[0].font.bold = True
                panel_label.text_frame.paragraphs[0].font.color.rgb = MUTED; panel_label.text_frame.paragraphs[0].font.name = "Calibri"
                image_stream = _io.BytesIO(_b64.b64decode(textbook_image_b64))
                slide.shapes.add_picture(image_stream, panel_x, Inches(1.55), width=panel_width)
            elif process_steps:
                panel_label = slide.shapes.add_textbox(panel_x, Inches(1.2), panel_width, Inches(0.3))
                panel_label.text_frame.paragraphs[0].text = "PROCESS"
                panel_label.text_frame.paragraphs[0].font.size = Pt(11); panel_label.text_frame.paragraphs[0].font.bold = True
                panel_label.text_frame.paragraphs[0].font.color.rgb = MUTED; panel_label.text_frame.paragraphs[0].font.name = "Calibri"
                add_process_flow(slide, process_steps, panel_x, Inches(1.55), panel_width, Inches(4.1))
            elif comparison_points:
                left_label = (slide_data.get("comparison_left_label") or "Before").strip()
                right_label = (slide_data.get("comparison_right_label") or "After").strip()
                add_comparison_diagram(slide, comparison_points, left_label, right_label, panel_x, Inches(1.2), panel_width, Inches(4.5))
            elif diagram:
                note_box = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, panel_x, Inches(1.35), panel_width, Inches(4.3))
                note_box.fill.solid(); note_box.fill.fore_color.rgb = RGBColor(0xF8, 0xF8, 0xFB); note_box.line.color.rgb = RGBColor(0xE5, 0xE7, 0xEB); note_box.line.width = Pt(0.75)
                ntf = note_box.text_frame; ntf.word_wrap = True; ntf.margin_left = Inches(0.15); ntf.margin_right = Inches(0.15); ntf.margin_top = Inches(0.15)
                np = ntf.paragraphs[0]
                run = np.add_run(); run.text = "📊 SUGGESTED VISUAL\n\n"; run.font.size = Pt(11); run.font.bold = True; run.font.color.rgb = MUTED; run.font.name = "Calibri"
                run2 = np.add_run(); run2.text = diagram; run2.font.size = Pt(13); run2.font.italic = True; run2.font.color.rgb = MUTED; run2.font.name = "Calibri"

        takeaway = (slide_data.get("core_takeaway") or "").strip()
        if takeaway:
            box = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.6), Inches(6.05), prs.slide_width - Inches(1.2), Inches(1.0))
            box.fill.solid(); box.fill.fore_color.rgb = BRAND_LIGHT; box.line.color.rgb = BRAND; box.line.width = Pt(0.75)
            tf2 = box.text_frame; tf2.word_wrap = True; tf2.margin_left = Inches(0.2); tf2.margin_top = Inches(0.1)
            kp = tf2.paragraphs[0]
            run = kp.add_run(); run.text = "Key takeaway: "; run.font.size = Pt(14); run.font.bold = True; run.font.color.rgb = BRAND_DARK; run.font.name = "Calibri"
            run2 = kp.add_run(); run2.text = takeaway; run2.font.size = Pt(14); run2.font.color.rgb = BRAND_DARK; run2.font.name = "Calibri"

        speaker_notes = slide_data.get("speaker_notes", "").strip()
        analogy = (slide_data.get("simple_analogy") or "").strip()
        if analogy:
            speaker_notes = f"Analogy: {analogy}\n\n{speaker_notes}" if speaker_notes else f"Analogy: {analogy}"
        if speaker_notes:
            slide.notes_slide.notes_text_frame.text = speaker_notes

    safe_name = _re.sub(r"[^A-Za-z0-9_]", "_", payload.topic)[:50]
    tmp_path = os.path.join(tempfile.gettempdir(), f"{safe_name}_{os.getpid()}.pptx")
    prs.save(tmp_path)
    return FileResponse(tmp_path, filename=f"{safe_name}.pptx", media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation")


class ExportNotesRequest(BaseModel):
    topic: str
    notes: str  # may have been edited by the teacher before export


@router.post("/export-notes")
def export_notes(payload: ExportNotesRequest, user: User = Depends(require_role("teacher"))):
    """Builds a real, downloadable .docx file from the given notes text —
    reflects exactly what the teacher edited before export."""
    import docx
    from fastapi.responses import FileResponse
    import tempfile, re as _re

    d = docx.Document()
    d.add_heading(payload.topic, level=1)
    for para in payload.notes.split("\n"):
        if para.strip():
            d.add_paragraph(para.strip())

    safe_name = _re.sub(r"[^A-Za-z0-9_]", "_", payload.topic)[:50]
    tmp_path = os.path.join(tempfile.gettempdir(), f"{safe_name}.docx")
    d.save(tmp_path)
    return FileResponse(tmp_path, filename=f"{safe_name}.docx", media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document")


# ---------- attendance (real, scoped, with real history + edit) ----------

@router.post("/attendance")
def mark_attendance(payload: AttendanceMarkRequest, db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    """Real duplicate-session prevention: unique session = Teacher + Subject +
    Session Date. Resubmitting for the same subject+date updates the
    existing session's records rather than creating a duplicate."""
    session_date = datetime.strptime(payload.date, "%Y-%m-%d").date()
    session = db.query(AttendanceSession).filter(
        AttendanceSession.subject_id == payload.subject_id,
        AttendanceSession.date == session_date,
        AttendanceSession.marked_by_faculty_id == user.faculty_id,
    ).first()

    if session:
        db.query(AttendanceRecord).filter(AttendanceRecord.session_id == session.id).delete()
    else:
        session = AttendanceSession(
            subject_id=payload.subject_id, date=session_date, marked_by_faculty_id=user.faculty_id,
        )
        db.add(session)
        db.flush()

    for student_id, present in payload.records.items():
        db.add(AttendanceRecord(session_id=session.id, student_id=int(student_id), present=bool(present)))
    db.commit()

    present_count = sum(1 for v in payload.records.values() if v)
    absent_names = []
    if present_count < len(payload.records):
        absent_ids = [int(sid) for sid, present in payload.records.items() if not present]
        absent_names = [s.name for s in db.query(Student).filter(Student.id.in_(absent_ids)).all()]

    log_activity(db, user, f"Marked attendance for subject #{payload.subject_id} on {payload.date} ({present_count}/{len(payload.records)} present)")
    return {
        "message": "Attendance recorded", "session_id": session.id,
        "present": present_count, "total": len(payload.records), "absent_names": absent_names,
        "present_pct": round(present_count / len(payload.records) * 100, 1) if payload.records else None,
    }


@router.patch("/attendance/{session_id}")
def edit_attendance(session_id: int, records: dict, db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    """Updates an existing attendance session in place rather than creating
    a duplicate — matches the 'do not create duplicate sessions' requirement."""
    session = db.query(AttendanceSession).filter(AttendanceSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Attendance session not found")
    for rec in session.records:
        if str(rec.student_id) in records:
            rec.present = bool(records[str(rec.student_id)])
    db.commit()
    total = len(session.records)
    present_count = sum(1 for r in session.records if r.present)
    log_activity(db, user, f"Edited attendance session #{session_id}")
    return {"message": "Attendance updated", "present": present_count, "total": total, "present_pct": round(present_count / total * 100, 1) if total else None}


@router.get("/attendance-history")
def attendance_history(subject_id: Optional[int] = None, db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    q = db.query(AttendanceSession).filter(AttendanceSession.marked_by_faculty_id == user.faculty_id)
    if subject_id:
        q = q.filter(AttendanceSession.subject_id == subject_id)
    sessions = q.order_by(AttendanceSession.date.desc()).all()
    out = []
    for s in sessions:
        total = len(s.records)
        present = sum(1 for r in s.records if r.present)
        subject = db.query(Subject).filter(Subject.id == s.subject_id).first()
        out.append({
            "session_id": s.id, "date": str(s.date), "subject_id": s.subject_id,
            "subject_code": subject.code if subject else None, "semester": subject.semester if subject else None,
            "total": total, "present": present, "absent": total - present,
            "present_pct": round(present / total * 100, 1) if total else None,
        })
    return out


@router.get("/attendance-analytics")
def attendance_analytics(subject_id: int, date: str, db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    """Real weekly attendance pattern for this subject (the 7 real days
    ending on the given date) plus students on a real, currently ongoing
    absence streak of 4+ sessions — both computed directly from real
    AttendanceSession/AttendanceRecord rows, never simulated."""
    from datetime import timedelta
    target_date = datetime.strptime(date, "%Y-%m-%d").date()
    week_start = target_date - timedelta(days=6)

    week_sessions = db.query(AttendanceSession).filter(
        AttendanceSession.subject_id == subject_id,
        AttendanceSession.date >= week_start, AttendanceSession.date <= target_date,
    ).order_by(AttendanceSession.date.asc()).all()
    weekly_pattern = []
    for s in week_sessions:
        total = len(s.records)
        weekly_pattern.append({"date": str(s.date), "present_pct": round(sum(1 for r in s.records if r.present) / total * 100, 1) if total else None})

    # Trailing consecutive-absence streak per student: walk sessions most-
    # recent-first and stop counting for a student the moment a real
    # "present" record is found — that's their current streak, not a
    # lifetime total.
    all_sessions = db.query(AttendanceSession).filter(AttendanceSession.subject_id == subject_id).order_by(AttendanceSession.date.desc()).all()
    streaks: dict = {}
    for session in all_sessions:
        for r in session.records:
            entry = streaks.setdefault(r.student_id, {"streak": 0, "done": False})
            if entry["done"]:
                continue
            if r.present:
                entry["done"] = True
            else:
                entry["streak"] += 1

    continuously_absent = []
    for student_id, entry in streaks.items():
        if entry["streak"] >= 4:
            student = db.query(Student).filter(Student.id == student_id).first()
            if student:
                continuously_absent.append({"student_id": student_id, "name": student.name, "usn": student.usn, "absent_streak": entry["streak"]})
    continuously_absent.sort(key=lambda r: -r["absent_streak"])

    return {"date": date, "weekly_pattern": weekly_pattern, "continuously_absent": continuously_absent}


@router.get("/attendance-session/{session_id}")
def get_attendance_session(session_id: int, db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    session = db.query(AttendanceSession).filter(AttendanceSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Not found")
    return {
        "session_id": session.id, "date": str(session.date), "subject_id": session.subject_id,
        "records": {str(r.student_id): r.present for r in session.records},
    }


@router.get("/reports/attendance")
def attendance_report(subject_id: int = None, db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    q = db.query(AttendanceSession).filter(AttendanceSession.marked_by_faculty_id == user.faculty_id)
    if subject_id:
        q = q.filter(AttendanceSession.subject_id == subject_id)
    sessions = q.all()
    return [{
        "session_id": s.id, "date": str(s.date), "subject_id": s.subject_id,
        "present": sum(1 for r in s.records if r.present), "total": len(s.records),
    } for s in sessions]


# ---------- IA marks (real, persisted) ----------

class MarksIn(BaseModel):
    student_id: int
    subject_id: int
    exam_type: str  # "IA-1" | "IA-2" | "IA-3"
    marks_obtained: float
    max_marks: float = 50


@router.get("/marks")
def get_marks(subject_id: int, semester: int, batch: Optional[str] = None, db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    """Real IA marks for this teacher's students in this subject — persisted,
    reloads exactly as saved."""
    ids = _teacher_student_ids(db, user.faculty_id, batch=batch, semester=semester)
    students = db.query(Student).filter(Student.id.in_(ids)).all() if ids else []
    all_marks = db.query(Marks).filter(Marks.subject_id == subject_id, Marks.student_id.in_(ids)).all() if ids else []

    by_student: dict = {}
    for m in all_marks:
        by_student.setdefault(m.student_id, {})[m.exam_type] = {"marks": m.marks_obtained, "max": m.max_marks}

    return [{
        "student_id": s.id, "usn": s.usn, "name": s.name,
        "ia1": by_student.get(s.id, {}).get("IA-1"),
        "ia2": by_student.get(s.id, {}).get("IA-2"),
        "ia3": by_student.get(s.id, {}).get("IA-3"),
    } for s in students]


@router.post("/marks")
def save_marks(payload: MarksIn, db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    existing = db.query(Marks).filter(
        Marks.student_id == payload.student_id, Marks.subject_id == payload.subject_id, Marks.exam_type == payload.exam_type
    ).first()
    if existing:
        existing.marks_obtained = payload.marks_obtained
        existing.max_marks = payload.max_marks
    else:
        db.add(Marks(
            student_id=payload.student_id, subject_id=payload.subject_id, exam_type=payload.exam_type,
            marks_obtained=payload.marks_obtained, max_marks=payload.max_marks,
        ))
    db.commit()
    return {"message": "Marks saved"}


# ---------- performance (real, teacher-scoped, semester-based) ----------

@router.get("/performance")
def performance_analytics(
    semester: int, mode: str = "overall", subject_id: Optional[int] = None, batch: Optional[str] = None,
    db: Session = Depends(get_db), user: User = Depends(require_role("teacher")),
):
    """Real cohort analytics scoped to THIS teacher's students in the given
    batch+semester — never college-wide. mode: 'subject' | 'overall' | 'achievements'."""
    ids = _teacher_student_ids(db, user.faculty_id, batch=batch, semester=semester)
    students = db.query(Student).filter(Student.id.in_(ids)).all() if ids else []

    cgpa_values = [s.cgpa for s in students if s.cgpa is not None]
    backlogs_count = sum(1 for s in students if (s.backlogs or 0) > 0)

    buckets = {"< 6": 0, "6 - 7": 0, "7 - 8": 0, "8 - 9": 0, "9 - 10": 0}
    for c in cgpa_values:
        if c < 6: buckets["< 6"] += 1
        elif c < 7: buckets["6 - 7"] += 1
        elif c < 8: buckets["7 - 8"] += 1
        elif c < 9: buckets["8 - 9"] += 1
        else: buckets["9 - 10"] += 1

    top = sorted([s for s in students if s.cgpa is not None], key=lambda s: s.cgpa, reverse=True)[:10]

    top_performers_achievements = None
    if mode == "achievements":
        from app.core.scoring import calculate_achievement_points
        scored = [(s, calculate_achievement_points(db, s.id)["total_achievement_points"]) for s in students]
        scored.sort(key=lambda x: x[1], reverse=True)
        top_performers_achievements = [{"usn": s.usn, "name": s.name, "achievement_points": pts} for s, pts in scored[:10]]

    if mode == "subject" and subject_id:
        marks_rows = db.query(Marks).filter(Marks.subject_id == subject_id, Marks.student_id.in_(ids)).all() if ids else []
        subj_buckets = {"0-40%": 0, "40-60%": 0, "60-75%": 0, "75-90%": 0, "90-100%": 0}
        for m in marks_rows:
            pct = (m.marks_obtained / m.max_marks) * 100 if m.max_marks else 0
            if pct < 40: subj_buckets["0-40%"] += 1
            elif pct < 60: subj_buckets["40-60%"] += 1
            elif pct < 75: subj_buckets["60-75%"] += 1
            elif pct < 90: subj_buckets["75-90%"] += 1
            else: subj_buckets["90-100%"] += 1
        distribution = [{"name": k, "value": v} for k, v in subj_buckets.items()]
        note = "Subject-wise IA marks distribution for your students in this semester." if marks_rows else "No IA marks entered yet for this subject — enter marks via IA Marks to see this populate."
    elif mode == "achievements":
        from app.core.scoring import calculate_achievement_points
        points_list = [calculate_achievement_points(db, s.id)["total_achievement_points"] for s in students]
        ach_buckets = {"0": 0, "1-199": 0, "200-499": 0, "500+": 0}
        for p in points_list:
            if p == 0: ach_buckets["0"] += 1
            elif p < 200: ach_buckets["1-199"] += 1
            elif p < 500: ach_buckets["200-499"] += 1
            else: ach_buckets["500+"] += 1
        distribution = [{"name": k, "value": v} for k, v in ach_buckets.items()]
        note = "Real achievement points distribution (Certificates=50, Hackathon=50, Hackathon Won=+100, Project=100) for your students."
    else:
        distribution = [{"name": k, "value": v} for k, v in buckets.items()]
        note = "Overall CGPA distribution for your students in this semester."

    return {
        "cohort_size": len(students),
        "students_with_cgpa": len(cgpa_values),
        "avg_cgpa": round(sum(cgpa_values) / len(cgpa_values), 2) if cgpa_values else None,
        "backlogs_count": backlogs_count,
        "distribution": distribution,
        "mode_note": note,
        "top_performers": [{"usn": s.usn, "name": s.name, "cgpa": s.cgpa} for s in top],
        "top_performers_achievements": top_performers_achievements,
    }


@router.get("/students-with-backlogs")
def students_with_backlogs(semester: int, batch: Optional[str] = None, db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    ids = _teacher_student_ids(db, user.faculty_id, batch=batch, semester=semester)
    students = db.query(Student).filter(Student.id.in_(ids), Student.backlogs > 0).all() if ids else []
    return [{"usn": s.usn, "name": s.name, "backlogs": s.backlogs, "semester": s.semester} for s in students]


@router.get("/reports/performance")
def performance_report(batch: Optional[str] = None, db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    ids = _teacher_student_ids(db, user.faculty_id)
    q = db.query(Student).filter(Student.id.in_(ids)) if ids else db.query(Student).filter(False)
    if batch:
        q = q.filter(Student.batch == batch)
    rows = q.all()
    return [{
        "USN": s.usn, "Name": s.name, "Batch": s.batch, "Status": s.status,
        "CGPA": s.cgpa, "Backlogs": s.backlogs, "Data Status": s.data_status,
    } for s in rows]


# ---------- counseling (real, scoped to this teacher's own notes) ----------

class CounselingNoteIn(BaseModel):
    student_id: int
    note: str


class CounselingBulkIn(BaseModel):
    batch: str
    semester: int
    section: Optional[str] = None
    note: str
    student_ids: Optional[list] = None  # restrict to this subset of the matched class; all of them if omitted


def _counseling_reply_fields(n: CounselingNote) -> dict:
    return {
        "reply_status": n.reply_status, "reply_description": n.reply_description,
        "replied_at": str(n.replied_at) if n.replied_at else None,
        "teacher_reply": n.teacher_reply,
        "teacher_replied_at": str(n.teacher_replied_at) if n.teacher_replied_at else None,
    }


@router.get("/counseling/{student_id}")
def get_counseling_notes(student_id: int, db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    """This teacher's own notes for this student only — a different
    teacher's private counseling notes for the same student are never
    shown here."""
    rows = db.query(CounselingNote).filter(CounselingNote.student_id == student_id, CounselingNote.faculty_id == user.faculty_id).order_by(CounselingNote.date.desc()).all()
    return [{"id": n.id, "note": n.note, "date": str(n.date), **_counseling_reply_fields(n)} for n in rows]


@router.post("/counseling")
def add_counseling_note(payload: CounselingNoteIn, db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    n = CounselingNote(student_id=payload.student_id, faculty_id=user.faculty_id, note=payload.note)
    db.add(n)
    db.commit()
    db.refresh(n)
    notify_student(db, payload.student_id, "Your mentor added a new counseling note for you.")
    return {"id": n.id, "note": n.note, "date": str(n.date)}


@router.post("/counseling/bulk")
def add_counseling_note_bulk(payload: CounselingBulkIn, db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    """Sends the same real note to every real student in this teacher's own
    batch+semester(+section) class — restricted to student_ids the caller
    actually selected, when given, so a teacher can exclude specific
    students from an otherwise class-wide note."""
    ids = _teacher_student_ids(db, user.faculty_id, batch=payload.batch, semester=payload.semester, section=payload.section)
    if payload.student_ids:
        wanted = {int(i) for i in payload.student_ids}
        ids = [i for i in ids if i in wanted]
    if not ids:
        raise HTTPException(status_code=400, detail="No students match this batch/semester/section for your teaching assignments.")
    for student_id in ids:
        db.add(CounselingNote(student_id=student_id, faculty_id=user.faculty_id, note=payload.note))
        notify_student(db, student_id, "Your mentor added a new counseling note for you.")
    db.commit()
    return {"message": f"Note sent to {len(ids)} student(s).", "count": len(ids)}


@router.get("/counseling-history")
def counseling_history(db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    """Every real counseling note this teacher has sent, across all
    students, newest first."""
    rows = db.query(CounselingNote).filter(CounselingNote.faculty_id == user.faculty_id).order_by(CounselingNote.date.desc()).all()
    out = []
    for n in rows:
        student = db.query(Student).filter(Student.id == n.student_id).first()
        out.append({"id": n.id, "note": n.note, "date": str(n.date), "student_name": student.name if student else "Unknown", "student_usn": student.usn if student else None, **_counseling_reply_fields(n)})
    return out


class CounselingEditIn(BaseModel):
    note: str


@router.patch("/counseling/{note_id}")
def edit_counseling_note(note_id: int, payload: CounselingEditIn, db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    n = db.query(CounselingNote).filter(CounselingNote.id == note_id, CounselingNote.faculty_id == user.faculty_id).first()
    if not n:
        raise HTTPException(status_code=404, detail="Note not found")
    n.note = payload.note
    db.commit()
    return {"message": "Note updated"}


@router.delete("/counseling/{note_id}")
def delete_counseling_note(note_id: int, db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    n = db.query(CounselingNote).filter(CounselingNote.id == note_id, CounselingNote.faculty_id == user.faculty_id).first()
    if not n:
        raise HTTPException(status_code=404, detail="Note not found")
    db.delete(n)
    db.commit()
    return {"message": "Note deleted"}
