"""Workspace profile: login, view/update profile, avatar, password.

Security model for this scope: opaque bearer token per user, verified by
the `current_user` dependency on every endpoint below; a user can only ever
read or write the row their token resolves to.
"""
import re
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User, utcnow
from ..services import auth

router = APIRouter(prefix="/api", tags=["profile"])

UPLOAD_DIR = Path(__file__).resolve().parent.parent.parent / "uploads" / "avatars"
ALLOWED_IMAGE_TYPES = {"image/png": ".png", "image/jpeg": ".jpg",
                       "image/webp": ".webp"}
MAX_AVATAR_BYTES = 2 * 1024 * 1024

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PHONE_RE = re.compile(r"^[+\d][\d\s\-()]{6,19}$")
DOB_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
ZIP_RE = re.compile(r"^[A-Za-z0-9 \-]{3,10}$")


def _profile_out(u: User) -> dict:
    return {
        "id": u.id, "name": u.name, "username": u.username, "email": u.email,
        "phone": u.phone, "date_of_birth": u.date_of_birth,
        "gender": u.gender, "address": u.address, "city": u.city,
        "state": u.state, "country": u.country, "zip_code": u.zip_code,
        "role": u.role, "status": u.status, "avatar_url": u.avatar_url,
        "created_at": u.created_at, "updated_at": u.updated_at,
    }


# ------------------------------------------------------------------ schemas

class LoginRequest(BaseModel):
    email: str
    password: str


class ProfileUpdate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    username: str = Field(min_length=3, max_length=60,
                          pattern=r"^[a-zA-Z0-9_.\-]+$")
    email: str
    phone: str = ""
    date_of_birth: str = ""
    gender: str = Field(default="", max_length=24)
    address: str = Field(default="", max_length=255)
    city: str = Field(default="", max_length=80)
    state: str = Field(default="", max_length=80)
    country: str = Field(default="", max_length=80)
    zip_code: str = ""

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        if not EMAIL_RE.match(v):
            raise ValueError("Enter a valid email address.")
        return v.lower()

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: str) -> str:
        if v and not PHONE_RE.match(v):
            raise ValueError("Enter a valid phone number.")
        return v

    @field_validator("date_of_birth")
    @classmethod
    def _dob(cls, v: str) -> str:
        if not v:
            return v
        if not DOB_RE.match(v):
            raise ValueError("Date of birth must be YYYY-MM-DD.")
        if v > f"{utcnow():%Y-%m-%d}":
            raise ValueError("Date of birth can't be in the future.")
        return v

    @field_validator("zip_code")
    @classmethod
    def _zip(cls, v: str) -> str:
        if v and not ZIP_RE.match(v):
            raise ValueError("Enter a valid ZIP / postal code.")
        return v


class PasswordChange(BaseModel):
    current_password: str
    new_password: str
    confirm_password: str


# ---------------------------------------------------------------- endpoints

@router.post("/auth/login")
def login(body: LoginRequest, db: Session = Depends(get_db)):
    user = db.execute(
        select(User).where(User.email == body.email.lower())
    ).scalar_one_or_none()
    if user is None or not auth.verify_password(body.password, user.password_hash):
        raise HTTPException(401, "Incorrect email or password.")
    if user.status != "active":
        raise HTTPException(403, "Account is inactive.")
    token = auth.issue_token(user)
    db.commit()
    return {"token": token, "user": _profile_out(user)}


@router.post("/auth/logout")
def logout(user: User = Depends(auth.current_user),
           db: Session = Depends(get_db)):
    user.api_token = None
    db.commit()
    return {"ok": True}


@router.get("/profile")
def get_profile(user: User = Depends(auth.current_user)):
    return _profile_out(user)


@router.put("/profile")
def update_profile(body: ProfileUpdate,
                   user: User = Depends(auth.current_user),
                   db: Session = Depends(get_db)):
    taken = db.execute(
        select(User.id).where(User.email == body.email, User.id != user.id)
    ).first()
    if taken:
        raise HTTPException(409, "That email is already in use.")
    for field, value in body.model_dump().items():
        setattr(user, field, value)
    db.commit()
    return _profile_out(user)


@router.post("/profile/avatar")
async def upload_avatar(file: UploadFile = File(...),
                        user: User = Depends(auth.current_user),
                        db: Session = Depends(get_db)):
    ext = ALLOWED_IMAGE_TYPES.get(file.content_type or "")
    if ext is None:
        raise HTTPException(415, "Use a PNG, JPEG or WebP image.")
    data = await file.read()
    if len(data) > MAX_AVATAR_BYTES:
        raise HTTPException(413, "Image must be 2 MB or smaller.")
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    # One file per user, name derived server-side — nothing user-controlled
    # touches the filesystem path.
    path = UPLOAD_DIR / f"{user.id}{ext}"
    path.write_bytes(data)
    user.avatar_url = f"/uploads/avatars/{path.name}"
    db.commit()
    return _profile_out(user)


@router.put("/profile/password")
def change_password(body: PasswordChange,
                    user: User = Depends(auth.current_user),
                    db: Session = Depends(get_db)):
    if not auth.verify_password(body.current_password, user.password_hash):
        raise HTTPException(401, "Current password is incorrect.")
    if body.new_password != body.confirm_password:
        raise HTTPException(422, "New passwords don't match.")
    if err := auth.password_strength_error(body.new_password):
        raise HTTPException(422, err)
    if body.new_password == body.current_password:
        raise HTTPException(422, "New password must be different.")
    user.password_hash = auth.hash_password(body.new_password)
    token = auth.issue_token(user)  # rotate the session on password change
    db.commit()
    return {"ok": True, "token": token}
