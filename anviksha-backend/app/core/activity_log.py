from sqlalchemy.orm import Session
from app.models.models import ActivityLog, User


def log_activity(db: Session, user: User, action: str):
    db.add(ActivityLog(actor_email=user.email, actor_role=user.role, action=action))
    db.commit()
