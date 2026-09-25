"""Authentication (HS256 JWT minted by the Next.js frontend) and role checks."""

from __future__ import annotations

from dataclasses import dataclass

import jwt
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_db
from .models import Invitation, Organization, User, utcnow

MAX_TOKEN_LIFETIME_S = 15 * 60 + 60  # 15 minutes plus clock-skew allowance


@dataclass
class CurrentUser:
    user: User

    @property
    def id(self) -> str:
        return self.user.id

    @property
    def org_id(self) -> str:
        return self.user.org_id

    @property
    def role(self) -> str:
        return self.user.role

    @property
    def email(self) -> str:
        return self.user.email


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def decode_token(token: str) -> dict:
    settings = get_settings()
    if not settings.auth_secret:
        raise HTTPException(status_code=500, detail="AUTH_SECRET is not configured on the API")
    try:
        claims = jwt.decode(
            token,
            settings.auth_secret,
            algorithms=["HS256"],
            audience=settings.jwt_audience,
            issuer=settings.jwt_issuer,
            options={"require": ["exp", "iat", "sub"]},
            leeway=30,
        )
    except jwt.ExpiredSignatureError as exc:
        raise _unauthorized("Token expired") from exc
    except jwt.InvalidTokenError as exc:
        raise _unauthorized("Invalid token") from exc
    if int(claims["exp"]) - int(claims["iat"]) > MAX_TOKEN_LIFETIME_S:
        raise _unauthorized("Token lifetime too long")
    email = str(claims.get("email") or claims["sub"]).strip().lower()
    if "@" not in email or len(email) > 320:
        raise _unauthorized("Token has no valid email")
    claims["email"] = email
    return claims


def _provision_user(db: Session, email: str, name: str | None) -> User:
    invite = db.scalar(select(Invitation).where(Invitation.email == email))
    if invite is not None:
        user = User(email=email, name=name, org_id=invite.org_id, role=invite.role)
        invite.accepted = True
    else:
        org = Organization(name=f"{name or email.split('@')[0]}'s organization")
        db.add(org)
        db.flush()
        user = User(email=email, name=name, org_id=org.id, role="admin")
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        # A concurrent first request provisioned the same user; use that row.
        db.rollback()
        existing = db.scalar(select(User).where(User.email == email))
        if existing is None:
            raise
        return existing
    db.refresh(user)
    return user


def get_current_user(request: Request, db: Session = Depends(get_db)) -> CurrentUser:
    header = request.headers.get("authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise _unauthorized("Missing bearer token")
    claims = decode_token(token)
    email = claims["email"]
    user = db.scalar(select(User).where(User.email == email))
    if user is None:
        user = _provision_user(db, email, claims.get("name"))
    else:
        user.last_seen_at = utcnow()
        if claims.get("name") and not user.name:
            user.name = claims["name"]
        db.commit()
    return CurrentUser(user=user)


def require_role(*roles: str):
    def _dep(current: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if current.role not in roles:
            raise HTTPException(status_code=403, detail="Insufficient role")
        return current

    return _dep


require_writer = require_role("admin", "assessor")
require_admin = require_role("admin")
