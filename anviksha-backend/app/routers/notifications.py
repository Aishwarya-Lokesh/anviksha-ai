from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.models import Notification, User

router = APIRouter(prefix="/notifications", tags=["notifications"])


def link_for(role: str, message: str) -> str:
    """The page a notification is about, worked out from its wording."""
    text = (message or "").lower()
    if "the project" in text:
        return "/teacher/project-reviews" if role == "teacher" else "/student/project"
    if "announcement" in text:
        return f"/{role}/announcements"
    if "feedback" in text:
        return "/teacher/performance?view=feedback" if role == "teacher" else f"/{role}/feedback"
    if "counseling" in text:
        return f"/{role}/counseling"
    if "deadline" in text or "study note" in text:
        return f"/{role}/notes"
    if "request is now" in text:
        return "/student/documents"
    if "placed" in text or "offer" in text or "internship" in text:
        return "/student/placement" if role == "student" else f"/{role}/placements"
    return f"/{role}"


@router.get("")
def my_notifications(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.routers.campus import raise_due_reminders
    raise_due_reminders(db, user)
    rows = db.query(Notification).filter(Notification.user_id == user.id).order_by(Notification.created_at.desc()).limit(50).all()
    unread_count = db.query(Notification).filter(Notification.user_id == user.id, Notification.read == False).count()
    return {
        "unread_count": unread_count,
        "notifications": [{"id": n.id, "message": n.message, "read": bool(n.read), "created_at": n.created_at.isoformat() if n.created_at else None,
                           "link": link_for(user.role, n.message)} for n in rows],
    }


@router.patch("/{notification_id}/read")
def mark_read(notification_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    n = db.query(Notification).filter(Notification.id == notification_id, Notification.user_id == user.id).first()
    if n:
        n.read = True
        db.commit()
    return {"message": "ok"}


@router.patch("/read-all")
def mark_all_read(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    db.query(Notification).filter(Notification.user_id == user.id, Notification.read == False).update({"read": True})
    db.commit()
    return {"message": "ok"}
