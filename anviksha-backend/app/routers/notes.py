"""Notes & Deadlines: a teacher posts a study note or a deadline to one of
their classes; the students of that class see it."""
import re
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.file_links import signed
from app.core.file_storage import delete_file, upload_file
from app.core.notifications import notify_student
from app.core.security import require_role
from app.models.models import Note, Student, TeachingAssignment, User

router = APIRouter(tags=["notes"])

NOTE_FILES_DIR = "note_files"
ALLOWED_EXT = (".pdf", ".doc", ".docx", ".ppt", ".pptx", ".jpg", ".jpeg", ".png")
MAX_FILE_SIZE = 15 * 1024 * 1024
KINDS = ("note", "deadline")


def _file_url(note: Note) -> Optional[str]:
    return signed(f"/note-files/{note.file_url}") if note.file_url else None


def _class_student_ids(db: Session, assignment: TeachingAssignment) -> list[int]:
    # Same class-membership rule the rest of the teacher module uses.
    from app.routers.teacher import _matching_student_ids
    return _matching_student_ids(db, [assignment])


@router.get("/teacher/notes")
def my_posted_notes(db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    rows = db.query(Note).filter(Note.faculty_id == user.faculty_id).order_by(Note.created_at.desc(), Note.id.desc()).all()
    out = []
    for n in rows:
        a = n.assignment
        out.append({
            "id": n.id, "kind": n.kind, "title": n.title, "description": n.description, "due_date": n.due_date,
            "file_url": _file_url(n), "created_at": str(n.created_at) if n.created_at else None,
            "teaching_assignment_id": n.teaching_assignment_id,
            "batch": a.batch if a else None, "semester": a.semester if a else None, "section": a.section if a else None,
            "subject_code": a.subject.code if a and a.subject else None,
            "subject_name": a.subject.name if a and a.subject else None,
        })
    return out


@router.post("/teacher/notes")
async def post_note(
    teaching_assignment_id: int = Form(...),
    kind: str = Form(...),
    title: str = Form(...),
    description: str = Form(""),
    due_date: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
    user: User = Depends(require_role("teacher")),
):
    if kind not in KINDS:
        raise HTTPException(status_code=400, detail="Kind must be 'note' or 'deadline'")
    if not title.strip():
        raise HTTPException(status_code=400, detail="Title is required")
    assignment = db.query(TeachingAssignment).filter(
        TeachingAssignment.id == teaching_assignment_id, TeachingAssignment.faculty_id == user.faculty_id
    ).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="That class is not one of your teaching assignments")

    if kind == "deadline":
        try:
            datetime.strptime((due_date or "").strip(), "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=400, detail="A deadline needs a valid due date")
    else:
        due_date = None

    stored_name = None
    if file is not None and file.filename:
        if not file.filename.lower().endswith(ALLOWED_EXT):
            raise HTTPException(status_code=400, detail="Attach a PDF, Word, PowerPoint, JPG or PNG file")
        contents = await file.read()
        if len(contents) > MAX_FILE_SIZE:
            raise HTTPException(status_code=400, detail="File too large (max 15MB)")
        safe = re.sub(r"[^A-Za-z0-9_.]", "_", file.filename)
        stored_name = f"note_{int(datetime.utcnow().timestamp() * 1000)}_{safe}"
        upload_file(f"{NOTE_FILES_DIR}/{stored_name}", contents)

    note = Note(
        teaching_assignment_id=assignment.id, faculty_id=user.faculty_id, kind=kind, title=title.strip(),
        description=description.strip() or None, due_date=due_date.strip() if due_date else None, file_url=stored_name,
    )
    db.add(note)
    db.commit()
    db.refresh(note)

    subject = assignment.subject.code if assignment.subject else "your class"
    message = (f"New deadline for {subject}: {note.title} (due {note.due_date})" if kind == "deadline"
               else f"New study note for {subject}: {note.title}")
    for student_id in _class_student_ids(db, assignment):
        notify_student(db, student_id, message)

    return {"id": note.id, "kind": note.kind, "title": note.title, "file_url": _file_url(note)}


@router.delete("/teacher/notes/{note_id}")
def delete_note(note_id: int, db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    note = db.query(Note).filter(Note.id == note_id, Note.faculty_id == user.faculty_id).first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    if note.file_url:
        delete_file(f"{NOTE_FILES_DIR}/{note.file_url}")
    db.delete(note)
    db.commit()
    return {"message": "Removed"}


@router.get("/student/notes")
def my_notes_and_deadlines(db: Session = Depends(get_db), user: User = Depends(require_role("student"))):
    """Everything teachers have posted to a class this student belongs to."""
    student = db.query(Student).filter(Student.id == user.student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student record not found")

    assignments = db.query(TeachingAssignment).filter(
        TeachingAssignment.batch == student.batch, TeachingAssignment.semester == student.semester
    ).all()
    mine = [a for a in assignments if student.id in _class_student_ids(db, a)]
    if not mine:
        return {"notes": [], "deadlines": []}

    rows = db.query(Note).filter(Note.teaching_assignment_id.in_([a.id for a in mine])).order_by(Note.created_at.desc()).all()
    notes, deadlines = [], []
    for n in rows:
        a = n.assignment
        item = {
            "id": n.id, "title": n.title, "description": n.description,
            "subject": f"{a.subject.code} — {a.subject.name}" if a and a.subject else None,
            "teacher_name": n.faculty.name if n.faculty else None,
            "created_at": str(n.created_at) if n.created_at else None,
            "file_url": _file_url(n),
        }
        if n.kind == "deadline":
            deadlines.append({**item, "due_date": n.due_date})
        else:
            notes.append(item)
    return {"notes": notes, "deadlines": deadlines}
