from sqlalchemy.orm import Session
from app.models.models import Notification, User


def notify_student(db: Session, student_id: int, message: str):
    """Looks up the User account linked to this student and creates a
    notification for them. Silently no-ops if that student has no login yet."""
    user = db.query(User).filter(User.student_id == student_id, User.role == "student").first()
    if user:
        db.add(Notification(user_id=user.id, message=message))
        db.commit()


def notify_user(db: Session, user_id: int, message: str):
    db.add(Notification(user_id=user_id, message=message))
    db.commit()
