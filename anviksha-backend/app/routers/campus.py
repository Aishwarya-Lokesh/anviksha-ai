"""Everyday campus features shared across roles: a student's own planner and
calendar, announcements, and a teacher's view of their students' placements."""
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.activity_log import log_activity
from app.core.database import get_db
from app.core.security import get_current_user, require_role
from app.models.models import (
    Announcement, Department, Faculty, Notification, Note, PlannerItem, Student, TeachingAssignment, User,
)

router = APIRouter(tags=["campus"])

PRIORITIES = ("low", "medium", "high")
KINDS = ("note", "deadline")
AUDIENCES = ("students", "faculty", "everyone")
MAX_NOTIFY = 600


# ------------------------------------------------------------------ student planner

class PlannerIn(BaseModel):
    kind: Optional[str] = None
    title: Optional[str] = None
    body: Optional[str] = None
    subject: Optional[str] = None
    due_at: Optional[str] = None        # "YYYY-MM-DDTHH:MM"
    priority: Optional[str] = None
    remind: Optional[bool] = None
    done: Optional[bool] = None


def _planner_out(i: PlannerItem) -> dict:
    return {"id": i.id, "kind": i.kind, "title": i.title, "body": i.body or "", "subject": i.subject,
            "due_at": i.due_at.strftime("%Y-%m-%dT%H:%M") if i.due_at else None, "priority": i.priority,
            "remind": bool(i.remind), "done": bool(i.done),
            "updated_at": str(i.updated_at)[:16] if i.updated_at else None}


def _parse_due(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    for fmt in ("%Y-%m-%dT%H:%M", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(value.strip(), fmt)
        except ValueError:
            continue
    raise HTTPException(status_code=400, detail="That date and time could not be read")


def _apply_planner(item: PlannerItem, payload: PlannerIn, creating: bool) -> None:
    sent = payload.dict(exclude_unset=True)
    if creating or "kind" in sent:
        if (payload.kind or "") not in KINDS:
            raise HTTPException(status_code=400, detail="Choose note or deadline")
        item.kind = payload.kind
    if creating or "title" in sent:
        title = (payload.title or "").strip()
        if not title:
            raise HTTPException(status_code=400, detail="A title is required")
        if len(title) > 200:
            raise HTTPException(status_code=400, detail="Title is too long (200 characters at most)")
        item.title = title
    if "body" in sent:
        if len(payload.body or "") > 20000:
            raise HTTPException(status_code=400, detail="That note is too long")
        item.body = payload.body or None
    if "subject" in sent:
        item.subject = (payload.subject or "").strip()[:120] or None
    if "priority" in sent:
        if payload.priority and payload.priority not in PRIORITIES:
            raise HTTPException(status_code=400, detail="Priority must be low, medium or high")
        item.priority = payload.priority or None
    if "due_at" in sent:
        item.due_at = _parse_due(payload.due_at)
    if "remind" in sent:
        item.remind = bool(payload.remind)
    if "done" in sent:
        item.done = bool(payload.done)
    if item.kind == "deadline" and not item.due_at:
        raise HTTPException(status_code=400, detail="A deadline needs a date and time")
    if item.kind == "note":
        item.due_at, item.remind, item.done = None, False, False


def _my_item(db: Session, user: User, item_id: int) -> PlannerItem:
    item = db.query(PlannerItem).filter(PlannerItem.id == item_id, PlannerItem.student_id == user.student_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Not found")
    return item


@router.get("/student/planner")
def my_planner(db: Session = Depends(get_db), user: User = Depends(require_role("student"))):
    rows = db.query(PlannerItem).filter(PlannerItem.student_id == user.student_id).order_by(PlannerItem.updated_at.desc(), PlannerItem.id.desc()).all()
    deadlines = sorted((r for r in rows if r.kind == "deadline"), key=lambda r: (r.done, r.due_at or datetime.max))
    return {"notes": [_planner_out(r) for r in rows if r.kind == "note"], "deadlines": [_planner_out(r) for r in deadlines]}


@router.post("/student/planner")
def add_planner_item(payload: PlannerIn, db: Session = Depends(get_db), user: User = Depends(require_role("student"))):
    item = PlannerItem(student_id=user.student_id)
    _apply_planner(item, payload, creating=True)
    db.add(item)
    db.commit()
    db.refresh(item)
    return _planner_out(item)


@router.patch("/student/planner/{item_id}")
def edit_planner_item(item_id: int, payload: PlannerIn, db: Session = Depends(get_db), user: User = Depends(require_role("student"))):
    item = _my_item(db, user, item_id)
    _apply_planner(item, payload, creating=False)
    db.commit()
    db.refresh(item)
    return _planner_out(item)


@router.delete("/student/planner/{item_id}")
def delete_planner_item(item_id: int, db: Session = Depends(get_db), user: User = Depends(require_role("student"))):
    db.delete(_my_item(db, user, item_id))
    db.commit()
    return {"message": "Deleted"}


@router.get("/student/calendar")
def my_calendar(db: Session = Depends(get_db), user: User = Depends(require_role("student"))):
    """Everything with a date, in one list: the student's own deadlines and the
    deadlines teachers posted to their classes."""
    from app.routers.notes import my_notes_and_deadlines

    events = []
    for i in db.query(PlannerItem).filter(PlannerItem.student_id == user.student_id, PlannerItem.kind == "deadline").all():
        events.append({"id": f"mine-{i.id}", "source": "mine", "title": i.title, "subject": i.subject, "date": i.due_at.strftime("%Y-%m-%d"),
                       "time": i.due_at.strftime("%H:%M"), "priority": i.priority, "done": bool(i.done), "remind": bool(i.remind)})
    for d in my_notes_and_deadlines(db=db, user=user)["deadlines"]:
        if d.get("due_date"):
            events.append({"id": f"class-{d['id']}", "source": "class", "title": d["title"], "subject": d.get("subject"), "date": d["due_date"],
                           "time": None, "priority": None, "done": False, "remind": True, "teacher": d.get("teacher_name")})
    events.sort(key=lambda e: (e["date"], e["time"] or "23:59"))
    today = datetime.now().strftime("%Y-%m-%d")
    soon = (datetime.now() + timedelta(days=7)).strftime("%Y-%m-%d")
    due_soon = [e for e in events if not e["done"] and today <= e["date"] <= soon]
    overdue = [e for e in events if not e["done"] and e["date"] < today and e["source"] == "mine"]
    return {"events": events, "due_soon": due_soon, "overdue": overdue, "today": today}


# ------------------------------------------------------------------ announcements

class AnnouncementIn(BaseModel):
    title: str
    body: str
    audience: str = "students"
    batch: Optional[str] = None
    semester: Optional[int] = None
    department_id: Optional[int] = None     # admin only; None = every department


def _author_name(db: Session, user: User) -> str:
    if user.role == "teacher" and user.faculty_id:
        f = db.query(Faculty).filter(Faculty.id == user.faculty_id).first()
        if f:
            return f.name
    if user.role == "hod":
        return user.display_name or user.hod_title or "Head of Department"
    return user.display_name or "Administrator"


def _announcement_out(a: Announcement, user: User) -> dict:
    return {"id": a.id, "title": a.title, "body": a.body, "kind": a.kind, "audience": a.audience, "batch": a.batch, "semester": a.semester,
            "author_name": a.author_name, "author_role": a.author_role, "created_at": str(a.created_at)[:16] if a.created_at else None,
            "mine": a.author_user_id == user.id, "can_delete": a.author_user_id == user.id or user.role == "admin"}


def recipients(db: Session, a: Announcement) -> list[int]:
    """User ids who should be told about this announcement."""
    ids: set[int] = set()
    if a.audience in ("students", "everyone"):
        q = db.query(User.id).join(Student, Student.id == User.student_id).filter(Student.status == "active")
        if a.department_id:
            q = q.filter(Student.department_id == a.department_id)
        if a.batch:
            q = q.filter(Student.batch == a.batch)
        if a.semester:
            q = q.filter(Student.semester == a.semester)
        ids.update(r[0] for r in q.all())
    if a.audience in ("faculty", "everyone"):
        q = db.query(User.id).join(Faculty, Faculty.id == User.faculty_id)
        if a.department_id:
            q = q.filter(Faculty.department_id == a.department_id)
        ids.update(r[0] for r in q.all())
    ids.discard(a.author_user_id)
    return sorted(ids)


def publish(db: Session, a: Announcement) -> int:
    db.add(a)
    db.flush()
    targets = recipients(db, a)[:MAX_NOTIFY]
    for user_id in targets:
        db.add(Notification(user_id=user_id, message=f"New announcement: {a.title}"))
    db.commit()
    db.refresh(a)
    return len(targets)


@router.post("/announcements")
def post_announcement(payload: AnnouncementIn, db: Session = Depends(get_db), user: User = Depends(require_role("teacher", "hod", "admin"))):
    title, body = payload.title.strip(), payload.body.strip()
    if not title or not body:
        raise HTTPException(status_code=400, detail="A title and a message are required")
    if len(title) > 160 or len(body) > 5000:
        raise HTTPException(status_code=400, detail="That announcement is too long")
    if payload.audience not in AUDIENCES:
        raise HTTPException(status_code=400, detail="Audience must be students, faculty or everyone")

    a = Announcement(author_user_id=user.id, author_name=_author_name(db, user), author_role=user.role, title=title, body=body,
                     audience=payload.audience, batch=(payload.batch or "").strip() or None, semester=payload.semester, kind="notice")
    if user.role == "teacher":
        # A teacher writes to students of a class they teach — nobody else.
        faculty = db.query(Faculty).filter(Faculty.id == user.faculty_id).first()
        classes = db.query(TeachingAssignment).filter(TeachingAssignment.faculty_id == user.faculty_id, TeachingAssignment.passed_out == False).all()  # noqa: E712
        match = [c for c in classes if (not a.batch or c.batch == a.batch) and (not a.semester or c.semester == a.semester)]
        if not a.batch or not a.semester or not match:
            raise HTTPException(status_code=400, detail="Choose one of your classes (batch and semester) to announce to")
        a.audience, a.department_id = "students", faculty.department_id if faculty else None
    elif user.role == "hod":
        if not user.department_id:
            raise HTTPException(status_code=403, detail="This HOD account isn't linked to a department yet")
        a.department_id = user.department_id
    else:
        a.department_id = payload.department_id
        if a.department_id and not db.query(Department).filter(Department.id == a.department_id).first():
            raise HTTPException(status_code=400, detail="Department not found")
    notified = publish(db, a)
    log_activity(db, user, f"Posted announcement: {a.title}")
    return {**_announcement_out(a, user), "notified": notified}


@router.get("/announcements")
def announcements_for_me(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    q = db.query(Announcement)
    if user.role == "student":
        s = db.query(Student).filter(Student.id == user.student_id).first()
        if not s:
            return []
        q = q.filter(Announcement.audience.in_(("students", "everyone")),
                     or_(Announcement.department_id.is_(None), Announcement.department_id == s.department_id),
                     or_(Announcement.batch.is_(None), Announcement.batch == s.batch),
                     or_(Announcement.semester.is_(None), Announcement.semester == s.semester))
    elif user.role == "teacher":
        f = db.query(Faculty).filter(Faculty.id == user.faculty_id).first()
        dept = f.department_id if f else None
        q = q.filter(or_(Announcement.author_user_id == user.id,
                         (Announcement.audience.in_(("faculty", "everyone"))) & or_(Announcement.department_id.is_(None), Announcement.department_id == dept)))
    elif user.role == "hod":
        q = q.filter(or_(Announcement.author_user_id == user.id, Announcement.department_id.is_(None), Announcement.department_id == user.department_id))
    rows = q.order_by(Announcement.created_at.desc(), Announcement.id.desc()).limit(100).all()
    return [_announcement_out(a, user) for a in rows]


@router.delete("/announcements/{announcement_id}")
def delete_announcement(announcement_id: int, db: Session = Depends(get_db), user: User = Depends(require_role("teacher", "hod", "admin"))):
    a = db.query(Announcement).filter(Announcement.id == announcement_id).first()
    if not a or (a.author_user_id != user.id and user.role != "admin"):
        raise HTTPException(status_code=404, detail="Announcement not found")
    db.delete(a)
    db.commit()
    log_activity(db, user, f"Deleted announcement: {a.title}")
    return {"message": "Deleted"}


# ------------------------------------------------------------------ teacher: my students' placements

@router.get("/teacher/placements")
def my_students_placements(db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    from app.core.assistant_tools import t_placements
    return t_placements(db, user)
