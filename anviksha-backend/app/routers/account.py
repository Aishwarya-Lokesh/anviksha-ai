"""The signed-in person's own account, for every role: who they are, their
photo, the few details they may edit themselves, and changing their password."""
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.activity_log import log_activity
from app.core.database import get_db
from app.core.file_storage import delete_file, upload_file
from app.core.security import get_current_user, hash_password, verify_password
from app.models.models import Department, Faculty, Student, User

router = APIRouter(prefix="/auth", tags=["account"])

PHOTO_DIR = "profile_photos"
PHOTO_EXT = ("png", "jpg", "jpeg", "webp")
MAX_PHOTO_SIZE = 5 * 1024 * 1024
MIN_PASSWORD_LENGTH = 8
ROLE_LABELS = {"student": "Student", "teacher": "Faculty", "hod": "Head of Department", "admin": "Administrator"}


def _profile(db: Session, user: User) -> dict:
    name, subtitle, photo, details = None, ROLE_LABELS.get(user.role, user.role), user.photo_url, {}
    if user.role == "student" and user.student_id:
        s = db.query(Student).filter(Student.id == user.student_id).first()
        if s:
            name, subtitle, photo = s.name, s.usn, s.photo_url
            details = {"usn": s.usn, "batch": s.batch, "semester": s.semester, "section": s.section,
                       "department": s.department.name if s.department else None}
    elif user.role == "teacher" and user.faculty_id:
        f = db.query(Faculty).filter(Faculty.id == user.faculty_id).first()
        if f:
            name, subtitle = f.name, f.designation or "Faculty"
            details = {"designation": f.designation, "qualifications": f.qualifications,
                       "department": f.department.name if f.department else None, "contact_email": f.email}
    elif user.role == "hod":
        dept = db.query(Department).filter(Department.id == user.department_id).first() if user.department_id else None
        name = user.display_name or "Head of Department"
        subtitle = user.hod_title or (f"Head of Department, {dept.name}" if dept else "Head of Department")
        details = {"title": user.hod_title, "department": dept.name if dept else None}
    else:
        name = user.display_name or "Administrator"
    return {
        "id": user.id, "email": user.email, "role": user.role, "role_label": ROLE_LABELS.get(user.role, user.role),
        "name": name or user.email, "subtitle": subtitle, "photo_url": photo, "details": details,
        # which of the fields below this role may change for itself
        "editable": {"student": [], "teacher": ["qualifications"], "hod": ["display_name", "title"], "admin": ["display_name"]}.get(user.role, []),
    }


@router.get("/profile")
def my_profile(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return _profile(db, user)


class ProfileEdit(BaseModel):
    display_name: Optional[str] = None
    title: Optional[str] = None
    qualifications: Optional[str] = None


@router.patch("/profile")
def edit_my_profile(payload: ProfileEdit, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Only the fields a person may set about themselves. Names, USNs,
    designations and departments are institutional records and stay with the
    admin screens."""
    sent = payload.dict(exclude_unset=True)
    allowed = set(_profile(db, user)["editable"])
    refused = sorted(set(sent) - allowed)
    if refused:
        raise HTTPException(status_code=403, detail=f"You can't change {', '.join(refused)} here")
    for field, value in sent.items():
        value = (value or "").strip()
        if len(value) > 120:
            raise HTTPException(status_code=400, detail="That value is too long (120 characters at most)")
        if field == "display_name":
            if len(value) < 2:
                raise HTTPException(status_code=400, detail="Name must be at least 2 characters")
            user.display_name = value
        elif field == "title":
            user.hod_title = value or None
        elif field == "qualifications":
            f = db.query(Faculty).filter(Faculty.id == user.faculty_id).first()
            if not f:
                raise HTTPException(status_code=404, detail="Faculty record not found")
            f.qualifications = value or None
    db.commit()
    return _profile(db, user)


@router.post("/profile/photo")
async def upload_my_photo(file: UploadFile = File(...), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    ext = (file.filename or "").rsplit(".", 1)[-1].lower()
    if ext not in PHOTO_EXT:
        raise HTTPException(status_code=400, detail="Only PNG, JPG or WEBP images are allowed")
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="That file is empty")
    if len(contents) > MAX_PHOTO_SIZE:
        raise HTTPException(status_code=400, detail="Image too large (max 5MB)")

    student = db.query(Student).filter(Student.id == user.student_id).first() if user.role == "student" and user.student_id else None
    owner = student.usn if student else f"user{user.id}"
    # A new name per upload, so browsers never keep showing the old picture.
    import time
    stored_name = f"{owner}_photo_{int(time.time())}.{ext}"
    previous = (student.photo_url if student else user.photo_url) or ""
    upload_file(f"{PHOTO_DIR}/{stored_name}", contents)
    if previous:
        delete_file(f"{PHOTO_DIR}/{previous.rsplit('/', 1)[-1]}")
    url = f"/profile-photos/{stored_name}"
    if student:
        student.photo_url = url
    else:
        user.photo_url = url
    db.commit()
    return {"photo_url": url}


class PasswordChange(BaseModel):
    current_password: str
    new_password: str


@router.post("/change-password")
def change_password(payload: PasswordChange, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if not verify_password(payload.current_password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Your current password is incorrect")
    new = payload.new_password
    if len(new) < MIN_PASSWORD_LENGTH:
        raise HTTPException(status_code=400, detail=f"New password must be at least {MIN_PASSWORD_LENGTH} characters")
    if not any(c.isalpha() for c in new) or not any(c.isdigit() for c in new):
        raise HTTPException(status_code=400, detail="New password must contain both letters and numbers")
    if new == payload.current_password:
        raise HTTPException(status_code=400, detail="New password must be different from the current one")
    if len(new.encode("utf-8")) > 72:
        raise HTTPException(status_code=400, detail="New password is too long (72 characters at most)")
    user.hashed_password = hash_password(new)
    db.commit()
    log_activity(db, user, "Changed their password")
    return {"message": "Password changed"}
