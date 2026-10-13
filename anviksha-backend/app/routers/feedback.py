"""Anonymous course feedback.

A student rates each subject-and-teacher they are taught. The answers are
stored with no link to the student: a separate table records only *that* a
student has responded, so each can respond once. A teacher sees totals for
their own subjects; the HOD sees every teacher in the department.
"""
from collections import defaultdict
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.notifications import notify_user
from app.core.security import require_role
from app.models.models import (
    Faculty, Feedback, FeedbackSubmission, FeedbackWindow, Student, Subject, TeachingAssignment, User,
)

router = APIRouter(tags=["feedback"])

QUESTIONS = [
    {"key": "clarity", "label": "Explains concepts clearly"},
    {"key": "knowledge", "label": "Command of the subject"},
    {"key": "pace", "label": "Pace and syllabus coverage"},
    {"key": "support", "label": "Helpful with doubts outside class"},
    {"key": "overall", "label": "Overall teaching"},
]
QUESTION_KEYS = [q["key"] for q in QUESTIONS]
MAX_COMMENT = 1000
# With fewer responses than this, a teacher could work out who said what, so
# the breakdown and comments stay hidden until the count is reached.
MIN_RESPONSES_TO_SHOW = 3


def _courses_for(db: Session, student: Student) -> list[dict]:
    """The (subject, teacher) pairs this student is taught this semester:
    classes teachers have set up for the student's batch, plus the scheme's
    allotted teacher for any other subject of the semester."""
    from app.routers.teacher import _matching_student_ids

    pairs: dict[tuple[int, int], Subject] = {}
    assignments = db.query(TeachingAssignment).filter(
        TeachingAssignment.batch == student.batch, TeachingAssignment.semester == student.semester,
        TeachingAssignment.subject_id.isnot(None), TeachingAssignment.passed_out == False,  # noqa: E712
    ).all()
    for a in assignments:
        if a.subject and student.id in _matching_student_ids(db, [a]):
            pairs[(a.subject_id, a.faculty_id)] = a.subject
    covered = {subject_id for subject_id, _ in pairs}
    for s in db.query(Subject).filter(
        Subject.department_id == student.department_id, Subject.semester == student.semester, Subject.faculty_id.isnot(None)
    ).all():
        if s.id not in covered:
            pairs[(s.id, s.faculty_id)] = s

    faculty = {f.id: f for f in db.query(Faculty).filter(Faculty.id.in_({fid for _, fid in pairs})).all()} if pairs else {}
    done = {(r.subject_id, r.faculty_id) for r in db.query(FeedbackSubmission).filter(
        FeedbackSubmission.student_id == student.id, FeedbackSubmission.semester == student.semester).all()}
    open_now = {(w.subject_id, w.faculty_id) for w in db.query(FeedbackWindow).filter(FeedbackWindow.is_open == True).all()}  # noqa: E712
    return sorted([{
        "subject_id": subject_id, "faculty_id": faculty_id, "code": subject.code, "name": subject.name,
        "faculty_name": faculty[faculty_id].name if faculty_id in faculty else None,
        "submitted": (subject_id, faculty_id) in done,
        "open": (subject_id, faculty_id) in open_now,
    } for (subject_id, faculty_id), subject in pairs.items() if faculty_id in faculty], key=lambda c: c["code"])


@router.get("/student/feedback")
def my_feedback_list(db: Session = Depends(get_db), user: User = Depends(require_role("student"))):
    student = db.query(Student).filter(Student.id == user.student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student record not found")
    return {"semester": student.semester, "questions": QUESTIONS, "courses": _courses_for(db, student)}


class FeedbackIn(BaseModel):
    subject_id: int
    faculty_id: int
    ratings: dict[str, int]
    comment: Optional[str] = None


@router.post("/student/feedback")
def submit_feedback(payload: FeedbackIn, db: Session = Depends(get_db), user: User = Depends(require_role("student"))):
    student = db.query(Student).filter(Student.id == user.student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student record not found")
    course = next((c for c in _courses_for(db, student)
                   if c["subject_id"] == payload.subject_id and c["faculty_id"] == payload.faculty_id), None)
    if not course:
        raise HTTPException(status_code=403, detail="You can only give feedback for subjects you are taught this semester")
    if course["submitted"]:
        raise HTTPException(status_code=409, detail="You have already given feedback for this subject")
    if not course["open"]:
        raise HTTPException(status_code=403, detail="Feedback for this subject isn't open yet")
    if sorted(payload.ratings) != sorted(QUESTION_KEYS) or any(not (1 <= v <= 5) for v in payload.ratings.values()):
        raise HTTPException(status_code=400, detail="Rate every question from 1 to 5")
    comment = (payload.comment or "").strip()
    if len(comment) > MAX_COMMENT:
        raise HTTPException(status_code=400, detail=f"Comment is too long ({MAX_COMMENT} characters at most)")

    # Two unrelated rows: the answers (no student), and a tick that this
    # student has answered (no answers, no time). Nothing joins them.
    db.add(Feedback(
        subject_id=payload.subject_id, faculty_id=payload.faculty_id, batch=student.batch, semester=student.semester,
        comment=comment or None, **payload.ratings,
    ))
    db.add(FeedbackSubmission(student_id=student.id, subject_id=payload.subject_id, faculty_id=payload.faculty_id, semester=student.semester))
    db.commit()

    teacher_login = db.query(User).filter(User.faculty_id == payload.faculty_id).first()
    if teacher_login:
        notify_user(db, teacher_login.id, f"New anonymous feedback received for {course['code']}.")
    return {"message": "Thank you — your feedback was recorded anonymously."}


class WindowIn(BaseModel):
    subject_id: int
    open: bool
    faculty_id: Optional[int] = None      # HOD only: whose subject


def _teaches(db: Session, faculty_id: int, subject_id: int) -> bool:
    if db.query(Subject.id).filter(Subject.id == subject_id, Subject.faculty_id == faculty_id).first():
        return True
    return db.query(TeachingAssignment.id).filter(TeachingAssignment.faculty_id == faculty_id, TeachingAssignment.subject_id == subject_id).first() is not None


def _set_window(db: Session, user: User, faculty_id: int, subject_id: int, is_open: bool) -> dict:
    from sqlalchemy.sql import func
    if not _teaches(db, faculty_id, subject_id):
        raise HTTPException(status_code=404, detail="That subject is not taught by this faculty member")
    window = db.query(FeedbackWindow).filter(FeedbackWindow.subject_id == subject_id, FeedbackWindow.faculty_id == faculty_id).first()
    if not window:
        window = FeedbackWindow(subject_id=subject_id, faculty_id=faculty_id)
        db.add(window)
    changed = bool(window.is_open) != bool(is_open)
    window.is_open, window.changed_by, window.changed_at = bool(is_open), user.id, func.now()
    db.commit()
    if changed and is_open:
        # Tell the students who can now respond.
        subject = db.query(Subject).filter(Subject.id == subject_id).first()
        students = db.query(User.id).join(Student, Student.id == User.student_id).filter(
            Student.status == "active", Student.department_id == subject.department_id, Student.semester == subject.semester).limit(400).all()
        for (user_id,) in students:
            notify_user(db, user_id, f"Feedback is now open for {subject.code}.")
    return {"subject_id": subject_id, "faculty_id": faculty_id, "open": bool(is_open)}


def _window_rows(db: Session, faculty_id: int) -> list[dict]:
    subject_ids = {s.id for s in db.query(Subject).filter(Subject.faculty_id == faculty_id).all()}
    subject_ids |= {a.subject_id for a in db.query(TeachingAssignment).filter(TeachingAssignment.faculty_id == faculty_id).all() if a.subject_id}
    if not subject_ids:
        return []
    open_ids = {w.subject_id for w in db.query(FeedbackWindow).filter(FeedbackWindow.faculty_id == faculty_id, FeedbackWindow.is_open == True).all()}  # noqa: E712
    counts = {}
    for (sid,) in db.query(Feedback.subject_id).filter(Feedback.faculty_id == faculty_id).all():
        counts[sid] = counts.get(sid, 0) + 1
    return [{"subject_id": s.id, "code": s.code, "name": s.name, "semester": s.semester, "open": s.id in open_ids, "responses": counts.get(s.id, 0)}
            for s in db.query(Subject).filter(Subject.id.in_(subject_ids)).order_by(Subject.semester, Subject.code).all()]


@router.get("/teacher/feedback/windows")
def my_feedback_windows(db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    return _window_rows(db, user.faculty_id)


@router.put("/teacher/feedback/windows")
def set_my_feedback_window(payload: WindowIn, db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    return _set_window(db, user, user.faculty_id, payload.subject_id, payload.open)


@router.get("/hod/feedback/{faculty_id}/windows")
def faculty_feedback_windows(faculty_id: int, db: Session = Depends(get_db), user: User = Depends(require_role("hod"))):
    dept = _hod_department(db, user)
    if not db.query(Faculty).filter(Faculty.id == faculty_id, Faculty.department_id == dept.id).first():
        raise HTTPException(status_code=404, detail="Faculty not found in your department")
    return _window_rows(db, faculty_id)


@router.put("/hod/feedback/windows")
def set_faculty_feedback_window(payload: WindowIn, db: Session = Depends(get_db), user: User = Depends(require_role("hod"))):
    dept = _hod_department(db, user)
    if not payload.faculty_id or not db.query(Faculty).filter(Faculty.id == payload.faculty_id, Faculty.department_id == dept.id).first():
        raise HTTPException(status_code=404, detail="Faculty not found in your department")
    return _set_window(db, user, payload.faculty_id, payload.subject_id, payload.open)


def _average(rows: list[Feedback], key: str) -> Optional[float]:
    return round(sum(getattr(r, key) for r in rows) / len(rows), 2) if rows else None


def _summary(rows: list[Feedback], subjects: dict[int, Subject], reveal_all: bool) -> dict:
    """Totals for one teacher. `reveal_all` (HOD) skips the small-group hiding."""
    by_subject: dict[int, list[Feedback]] = defaultdict(list)
    for r in rows:
        by_subject[r.subject_id].append(r)

    def block(items: list[Feedback]) -> dict:
        shown = reveal_all or len(items) >= MIN_RESPONSES_TO_SHOW
        return {
            "responses": len(items),
            "hidden": not shown,
            "average": _average(items, "overall") if shown else None,
            "by_question": [{"key": q["key"], "label": q["label"], "average": _average(items, q["key"])} for q in QUESTIONS] if shown else [],
            "distribution": [{"rating": n, "count": sum(1 for r in items if r.overall == n)} for n in (5, 4, 3, 2, 1)] if shown else [],
            "comments": [{"text": r.comment, "rating": r.overall, "month": f"{r.created_at:%b %Y}" if r.created_at else None}
                         for r in sorted(items, key=lambda r: r.id, reverse=True) if r.comment] if shown else [],
        }

    months: dict[str, list[Feedback]] = defaultdict(list)
    for r in rows:
        if r.created_at:
            months[f"{r.created_at:%Y-%m}"].append(r)
    overall_shown = reveal_all or len(rows) >= MIN_RESPONSES_TO_SHOW
    return {
        "responses": len(rows),
        "hidden": not overall_shown,
        "average": _average(rows, "overall") if overall_shown else None,
        "min_responses": MIN_RESPONSES_TO_SHOW,
        "by_question": [{"key": q["key"], "label": q["label"], "average": _average(rows, q["key"])} for q in QUESTIONS] if overall_shown else [],
        "subjects": sorted([{
            "subject_id": sid, "code": subjects[sid].code if sid in subjects else "—", "name": subjects[sid].name if sid in subjects else "",
            **block(items),
        } for sid, items in by_subject.items()], key=lambda s: s["code"]),
        "trend": [{"label": f"{items[0].created_at:%b %Y}", "average": _average(items, "overall"), "responses": len(items)}
                  for m, items in sorted(months.items()) if reveal_all or len(items) >= MIN_RESPONSES_TO_SHOW],
    }


def _subject_map(db: Session, rows: list[Feedback]) -> dict[int, Subject]:
    ids = {r.subject_id for r in rows}
    return {s.id: s for s in db.query(Subject).filter(Subject.id.in_(ids)).all()} if ids else {}


@router.get("/teacher/feedback")
def my_feedback_results(db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    rows = db.query(Feedback).filter(Feedback.faculty_id == user.faculty_id).all()
    return {"questions": QUESTIONS, **_summary(rows, _subject_map(db, rows), reveal_all=False)}


def _hod_department(db: Session, user: User):
    from app.routers.hod import _department_or_403
    return _department_or_403(user, db)


@router.get("/hod/feedback")
def department_feedback(batch: Optional[str] = None, db: Session = Depends(get_db), user: User = Depends(require_role("hod"))):
    dept = _hod_department(db, user)
    faculty = db.query(Faculty).filter(Faculty.department_id == dept.id).order_by(Faculty.name).all()
    q = db.query(Feedback).filter(Feedback.faculty_id.in_([f.id for f in faculty])) if faculty else None
    if q is not None and batch:
        q = q.filter(Feedback.batch == batch)
    rows = q.all() if q is not None else []
    subjects = _subject_map(db, rows)
    by_faculty: dict[int, list[Feedback]] = defaultdict(list)
    for r in rows:
        by_faculty[r.faculty_id].append(r)
    return {
        "department": dept.name, "batch": batch, "questions": QUESTIONS,
        "responses": len(rows), "average": _average(rows, "overall"),
        "batches": sorted({r.batch for r in db.query(Feedback.batch).filter(Feedback.faculty_id.in_([f.id for f in faculty])).distinct()} if faculty else []),
        "faculty": [{
            "faculty_id": f.id, "name": f.name, "designation": f.designation,
            "responses": len(by_faculty[f.id]), "average": _average(by_faculty[f.id], "overall"),
            "subjects": sorted({subjects[r.subject_id].code for r in by_faculty[f.id] if r.subject_id in subjects}),
        } for f in faculty],
    }


@router.get("/hod/feedback/{faculty_id}")
def faculty_feedback_detail(faculty_id: int, batch: Optional[str] = None, db: Session = Depends(get_db), user: User = Depends(require_role("hod"))):
    dept = _hod_department(db, user)
    faculty = db.query(Faculty).filter(Faculty.id == faculty_id, Faculty.department_id == dept.id).first()
    if not faculty:
        raise HTTPException(status_code=404, detail="Faculty not found in your department")
    q = db.query(Feedback).filter(Feedback.faculty_id == faculty.id)
    if batch:
        q = q.filter(Feedback.batch == batch)
    rows = q.all()
    return {"faculty": {"id": faculty.id, "name": faculty.name, "designation": faculty.designation},
            "questions": QUESTIONS, **_summary(rows, _subject_map(db, rows), reveal_all=True)}
