"""Authentication for the workspace profile.

Single-brand demo scope: one seeded marketer account, opaque bearer tokens
stored on the user row, PBKDF2-SHA256 password hashing from the standard
library (no extra dependency). At multi-tenant scale this becomes proper
JWT/OIDC with refresh tokens — the endpoint shapes don't change.
"""
import hashlib
import hmac
import secrets

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import SessionLocal, get_db
from ..models import User

_ITERATIONS = 120_000

DEFAULT_EMAIL = "admin@aurelia.shop"
DEFAULT_PASSWORD = "aurelia123"  # demo workspace; shown on the sign-in card


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode(), salt.encode(), _ITERATIONS).hex()
    return f"pbkdf2${_ITERATIONS}${salt}${digest}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, iterations, salt, digest = stored.split("$")
        candidate = hashlib.pbkdf2_hmac(
            "sha256", password.encode(), salt.encode(), int(iterations)).hex()
        return hmac.compare_digest(candidate, digest)
    except (ValueError, TypeError):
        return False


def password_strength_error(password: str) -> str | None:
    if len(password) < 8:
        return "Password must be at least 8 characters."
    if not any(c.isalpha() for c in password):
        return "Password must contain a letter."
    if not any(c.isdigit() for c in password):
        return "Password must contain a number."
    return None


def issue_token(user: User) -> str:
    user.api_token = secrets.token_hex(32)
    return user.api_token


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    """Bearer-token dependency for every profile endpoint."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "Sign in required.")
    token = auth.removeprefix("Bearer ").strip()
    user = db.execute(
        select(User).where(User.api_token == token)).scalar_one_or_none()
    if user is None:
        raise HTTPException(401, "Session expired — sign in again.")
    if user.status != "active":
        raise HTTPException(403, "Account is inactive.")
    return user


def ensure_default_user() -> None:
    """Idempotent: creates the workspace admin on first boot."""
    db = SessionLocal()
    try:
        if db.execute(select(User.id).limit(1)).first():
            return
        db.add(User(
            name="Aurelia Admin",
            username="aurelia-admin",
            email=DEFAULT_EMAIL,
            role="Brand admin",
            city="Mumbai",
            state="Maharashtra",
            country="India",
            password_hash=hash_password(DEFAULT_PASSWORD),
        ))
        db.commit()
    finally:
        db.close()
