"""Teacher endpoints the app's screens call that were never implemented:
extra-work status, bulk IA marks, deleting an attendance session, replying
to a student's counseling response."""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.activity_log import log_activity
from app.core.database import get_db
from app.core.notifications import notify_student
from app.core.security import require_role
from app.models.models import (
    AttendanceRecord, AttendanceSession, CounselingNote, Faculty, Marks, Subject, TeachingAssignment, User,
)

router = APIRouter(prefix="/teacher", tags=["teacher"])

EXAM_TYPES = {"IA-1", "IA-2", "IA-3"}
EXTRA_WORK_STATUSES = {"pending", "completed"}


def _faculty_or_404(db: Session, user: User) -> Faculty:
    faculty = db.query(Faculty).filter(Faculty.id == user.faculty_id).first()
    if not faculty:
        raise HTTPException(status_code=404, detail="Faculty record not found")
    return faculty


def _teaches_subject(db: Session, faculty_id: int, subject_id: int) -> bool:
    if db.query(Subject.id).filter(Subject.id == subject_id, Subject.faculty_id == faculty_id).first():
        return True
    return db.query(TeachingAssignment.id).filter(
        TeachingAssignment.faculty_id == faculty_id, TeachingAssignment.subject_id == subject_id
    ).first() is not None


# ---------- extra work (assigned by the HOD, acknowledged by the teacher) ----------

@router.get("/extra-work")
def my_extra_work(db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    faculty = _faculty_or_404(db, user)
    if not faculty.extra_work:
        return {"extra_work": None, "status": None}
    return {"extra_work": faculty.extra_work, "status": faculty.extra_work_status or "pending"}


class ExtraWorkStatusIn(BaseModel):
    status: str


@router.patch("/extra-work/status")
def update_extra_work_status(payload: ExtraWorkStatusIn, db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    if payload.status not in EXTRA_WORK_STATUSES:
        raise HTTPException(status_code=400, detail="Status must be 'pending' or 'completed'")
    faculty = _faculty_or_404(db, user)
    if not faculty.extra_work:
        raise HTTPException(status_code=404, detail="No extra work is assigned to you")
    faculty.extra_work_status = payload.status
    db.commit()
    log_activity(db, user, f"Marked extra work '{faculty.extra_work}' as {payload.status}")
    return {"extra_work": faculty.extra_work, "status": faculty.extra_work_status}


@router.delete("/extra-work")
def clear_extra_work(db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    faculty = _faculty_or_404(db, user)
    cleared = faculty.extra_work
    faculty.extra_work = None
    faculty.extra_work_status = None
    db.commit()
    if cleared:
        log_activity(db, user, f"Cleared extra work '{cleared}'")
    return {"extra_work": None, "status": None}


# ---------- IA marks, many at once ----------

class MarkIn(BaseModel):
    student_id: int
    subject_id: int
    exam_type: str
    marks_obtained: float
    max_marks: float = 50


@router.post("/marks/bulk")
def save_marks_bulk(payload: List[MarkIn], db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    """Saves every edited cell of the IA marks grid in one request. Nothing is
    saved unless every row is valid, so a grid is never left half-written."""
    from app.routers.teacher import _teacher_student_ids

    if not payload:
        return {"count": 0}
    my_students = set(_teacher_student_ids(db, user.faculty_id))
    allowed_subjects: dict[int, bool] = {}
    for row in payload:
        if row.exam_type not in EXAM_TYPES:
            raise HTTPException(status_code=400, detail=f"Unknown exam '{row.exam_type}'")
        if row.max_marks <= 0 or row.marks_obtained < 0 or row.marks_obtained > row.max_marks:
            raise HTTPException(status_code=400, detail=f"Marks must be between 0 and {row.max_marks:g}")
        if row.subject_id not in allowed_subjects:
            allowed_subjects[row.subject_id] = _teaches_subject(db, user.faculty_id, row.subject_id)
        if not allowed_subjects[row.subject_id]:
            raise HTTPException(status_code=403, detail="You can only enter marks for subjects you teach")
        if row.student_id not in my_students:
            raise HTTPException(status_code=403, detail="You can only enter marks for your own students")

    for row in payload:
        existing = db.query(Marks).filter(
            Marks.student_id == row.student_id, Marks.subject_id == row.subject_id, Marks.exam_type == row.exam_type
        ).first()
        if existing:
            existing.marks_obtained, existing.max_marks = row.marks_obtained, row.max_marks
        else:
            db.add(Marks(student_id=row.student_id, subject_id=row.subject_id, exam_type=row.exam_type,
                         marks_obtained=row.marks_obtained, max_marks=row.max_marks))
    db.commit()
    log_activity(db, user, f"Saved {len(payload)} IA mark(s)")
    return {"count": len(payload)}


# ---------- attendance ----------

@router.delete("/attendance/{session_id}")
def delete_attendance_session(session_id: int, db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    """Removes a session the teacher marked by mistake, with its records."""
    session = db.query(AttendanceSession).filter(AttendanceSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Attendance session not found")
    if session.marked_by_faculty_id != user.faculty_id:
        raise HTTPException(status_code=403, detail="You can only delete attendance sessions you marked")
    db.query(AttendanceRecord).filter(AttendanceRecord.session_id == session.id).delete(synchronize_session=False)
    db.delete(session)
    db.commit()
    log_activity(db, user, f"Deleted attendance session #{session_id}")
    return {"message": "Attendance session deleted"}


# ---------- counseling: teacher's follow-up to a student's reply ----------

class TeacherReplyIn(BaseModel):
    reply: Optional[str] = None


@router.patch("/counseling/{note_id}/reply")
def reply_to_student(note_id: int, payload: TeacherReplyIn, db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    note = db.query(CounselingNote).filter(CounselingNote.id == note_id, CounselingNote.faculty_id == user.faculty_id).first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    text = (payload.reply or "").strip()
    note.teacher_reply = text or None
    note.teacher_replied_at = datetime.utcnow() if text else None
    db.commit()
    if text:
        notify_student(db, note.student_id, "Your mentor replied to your counseling response.")
    return {"id": note.id, "teacher_reply": note.teacher_reply,
            "teacher_replied_at": str(note.teacher_replied_at) if note.teacher_replied_at else None}
