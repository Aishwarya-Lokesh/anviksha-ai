from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import verify_password, create_access_token, get_current_user, normalize_role
from app.models.models import User
from app.models.schemas import LoginRequest, TokenResponse

router = APIRouter(prefix="/auth", tags=["auth"])


# Characters a phone or a chat app adds without anyone seeing them: spaces,
# non-breaking spaces, zero-width characters, a byte-order mark.
_INVISIBLE = "".join([" ", "​", "‌", "‍", "⁠", "﻿"])


def _clean(text: str) -> str:
    return (text or "").strip().strip(_INVISIBLE).strip()


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    # Emails are stored in lower case. A phone often capitalises the first
    # letter, and pasting from a message can bring a trailing space along,
    # so the address is matched without those. The password itself is never
    # changed or loosened; only a space or invisible character around it,
    # which no password here contains, is ignored.
    email = "".join(ch for ch in _clean(payload.email) if ch not in _INVISIBLE).lower()
    user = db.query(User).filter(func.lower(User.email) == email).first()
    password_ok = bool(user) and (verify_password(payload.password, user.hashed_password)
                                  or (_clean(payload.password) != payload.password and verify_password(_clean(payload.password), user.hashed_password)))
    if not password_ok:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if user.is_active is False:
        raise HTTPException(status_code=403, detail="This account has been deactivated. Contact the administrator.")
    role = normalize_role(user.role)
    token = create_access_token({"sub": str(user.id), "role": role})
    return TokenResponse(access_token=token, role=role)


@router.get("/me")
def me(user: User = Depends(get_current_user)):
    return {"id": user.id, "email": user.email, "role": user.role}
