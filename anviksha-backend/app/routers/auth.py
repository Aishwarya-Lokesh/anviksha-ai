from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import verify_password, create_access_token, get_current_user, normalize_role
from app.models.models import User
from app.models.schemas import LoginRequest, TokenResponse

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()
    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if user.is_active is False:
        raise HTTPException(status_code=403, detail="This account has been deactivated. Contact the administrator.")
    role = normalize_role(user.role)
    token = create_access_token({"sub": str(user.id), "role": role})
    return TokenResponse(access_token=token, role=role)


@router.get("/me")
def me(user: User = Depends(get_current_user)):
    return {"id": user.id, "email": user.email, "role": user.role}
