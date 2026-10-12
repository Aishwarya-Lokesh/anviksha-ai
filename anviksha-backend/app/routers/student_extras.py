"""Student endpoints the app's screens call that were never implemented:
resume file upload, education details for the Resume Builder, and replying
to a mentor's counseling note."""
import re
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.file_links import signed
from app.core.file_storage import delete_file, upload_file
from app.core.notifications import notify_user
from app.core.security import require_role
from app.models.models import CounselingNote, Student, User

router = APIRouter(prefix="/student", tags=["student"])

RESUME_DIR = "resume_files"
RESUME_EXT = (".pdf", ".doc", ".docx")
MAX_RESUME_SIZE = 5 * 1024 * 1024
REPLY_STATUSES = ("Completed", "Pending", "Done", "Following")   # the choices the reply form offers
MAX_EDUCATION_ROWS = 8


def resume_file_url(student: Student) -> Optional[str]:
    return signed(f"/resume-files/{student.resume_file}") if student.resume_file else None


def _student_or_404(db: Session, user: User) -> Student:
    student = db.query(Student).filter(Student.id == user.student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student record not found")
    return student


# ---------- resume file ----------

@router.post("/profile/resume")
async def upload_resume(file: UploadFile = File(...), db: Session = Depends(get_db), user: User = Depends(require_role("student"))):
    if not (file.filename or "").lower().endswith(RESUME_EXT):
        raise HTTPException(status_code=400, detail="Upload your resume as a PDF or Word document")
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="That file is empty")
    if len(contents) > MAX_RESUME_SIZE:
        raise HTTPException(status_code=400, detail="File too large (max 5MB)")

    student = _student_or_404(db, user)
    ext = file.filename.rsplit(".", 1)[-1].lower()
    # The timestamp makes the address change on every upload, so a browser
    # never keeps showing the previous resume from its cache.
    stored_name = f"{re.sub(r'[^A-Za-z0-9]', '', student.usn)}_resume_{int(datetime.utcnow().timestamp())}.{ext}"
    upload_file(f"{RESUME_DIR}/{stored_name}", contents)
    if student.resume_file and student.resume_file != stored_name:
        delete_file(f"{RESUME_DIR}/{student.resume_file}")
    student.resume_file = stored_name
    db.commit()
    return {"resume_file_url": resume_file_url(student)}


@router.delete("/profile/resume")
def delete_resume(db: Session = Depends(get_db), user: User = Depends(require_role("student"))):
    student = _student_or_404(db, user)
    if student.resume_file:
        delete_file(f"{RESUME_DIR}/{student.resume_file}")
        student.resume_file = None
        db.commit()
    return {"resume_file_url": None}


# ---------- education (Resume Builder) ----------

class EducationRow(BaseModel):
    level: str
    institution: Optional[str] = ""
    city: Optional[str] = ""
    score_type: str = "percentage"   # "percentage" | "cgpa"
    score: Optional[float] = None
    year: Optional[int] = None


class EducationIn(BaseModel):
    education: List[EducationRow]


@router.patch("/education")
def update_education(payload: EducationIn, db: Session = Depends(get_db), user: User = Depends(require_role("student"))):
    if len(payload.education) > MAX_EDUCATION_ROWS:
        raise HTTPException(status_code=400, detail=f"At most {MAX_EDUCATION_ROWS} education entries")
    for row in payload.education:
        if row.year is not None and not (1980 <= row.year <= datetime.utcnow().year + 6):
            raise HTTPException(status_code=400, detail=f"Year {row.year} doesn't look right")
        if row.score_type not in ("percentage", "cgpa"):
            raise HTTPException(status_code=400, detail="Score type must be percentage or cgpa")
        limit = 10 if row.score_type == "cgpa" else 100
        if row.score is not None and not (0 <= row.score <= limit):
            raise HTTPException(status_code=400, detail=f"A {row.score_type} score must be between 0 and {limit}")
    student = _student_or_404(db, user)
    student.education = [row.dict() for row in payload.education]
    db.commit()
    return {"education": student.education}


# ---------- counseling: the student's response to a mentor's note ----------

class StudentReplyIn(BaseModel):
    status: str
    description: Optional[str] = None


def _my_note_or_404(db: Session, user: User, note_id: int) -> CounselingNote:
    note = db.query(CounselingNote).filter(CounselingNote.id == note_id, CounselingNote.student_id == user.student_id).first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    return note


@router.patch("/counseling/{note_id}/reply")
def reply_to_note(note_id: int, payload: StudentReplyIn, db: Session = Depends(get_db), user: User = Depends(require_role("student"))):
    status = payload.status.strip()
    if status not in REPLY_STATUSES:
        raise HTTPException(status_code=400, detail=f"Status must be one of: {', '.join(REPLY_STATUSES)}")
    note = _my_note_or_404(db, user, note_id)
    note.reply_status = status
    note.reply_description = (payload.description or "").strip() or None
    note.replied_at = datetime.utcnow()
    db.commit()
    mentor = db.query(User).filter(User.faculty_id == note.faculty_id, User.faculty_id.isnot(None)).first()
    if mentor:
        notify_user(db, mentor.id, "A student responded to your counseling note.")
    return {"id": note.id, "reply_status": note.reply_status, "reply_description": note.reply_description,
            "replied_at": str(note.replied_at)}


@router.delete("/counseling/{note_id}/reply")
def delete_reply(note_id: int, db: Session = Depends(get_db), user: User = Depends(require_role("student"))):
    note = _my_note_or_404(db, user, note_id)
    note.reply_status = None
    note.reply_description = None
    note.replied_at = None
    db.commit()
    return {"id": note.id, "reply_status": None}
