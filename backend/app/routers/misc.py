"""Health, identity, organization membership, frameworks catalogue and audit log."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from ..auth import CurrentUser, get_current_user, require_admin
from ..db import get_db
from ..deps import get_engagement_or_404
from ..models import AuditLog, Invitation, User
from ..schemas import InvitationIn, RoleUpdate
from ..services.audit import audit
from ..services.frameworks import get_capabilities, get_framework, get_frameworks

router = APIRouter()
VERSION = "1.0.0"


@router.get("/", include_in_schema=False)
def root():
    return {"service": "ssdlc-assessment-api", "status": "ok", "version": VERSION,
            "health": "/api/health", "docs": "/api/docs"}


@router.get("/api/health")
def health(db: Session = Depends(get_db)):
    try:
        db.execute(text("SELECT 1"))
        db_ok = True
    except Exception:  # noqa: BLE001
        db_ok = False
    return {"status": "ok" if db_ok else "degraded", "database": "ok" if db_ok else "unavailable",
            "version": VERSION}


@router.get("/api/me")
def me(current: CurrentUser = Depends(get_current_user)):
    u = current.user
    return {"id": u.id, "email": u.email, "name": u.name, "role": u.role,
            "organization": {"id": u.org.id, "name": u.org.name}}


# --- organization ------------------------------------------------------------------------


@router.get("/api/org/members")
def members(db: Session = Depends(get_db), current: CurrentUser = Depends(get_current_user)):
    users = db.scalars(select(User).where(User.org_id == current.org_id).order_by(User.email)).all()
    invites = db.scalars(select(Invitation).where(Invitation.org_id == current.org_id,
                                                  Invitation.accepted.is_(False))).all()
    return {
        "members": [{"id": u.id, "email": u.email, "name": u.name, "role": u.role} for u in users],
        "invitations": [{"id": i.id, "email": i.email, "role": i.role} for i in invites],
    }


@router.post("/api/org/invitations", status_code=201)
def invite(body: InvitationIn, db: Session = Depends(get_db), current: CurrentUser = Depends(require_admin)):
    email = body.email.strip().lower()
    if "@" not in email:
        raise HTTPException(status_code=422, detail="Invalid e-mail address")
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status_code=409, detail="This user already has an account")
    inv = db.scalar(select(Invitation).where(Invitation.email == email))
    if inv is not None and inv.org_id != current.org_id:
        raise HTTPException(status_code=409, detail="This e-mail has a pending invitation elsewhere")
    if inv is None:
        inv = Invitation(org_id=current.org_id, email=email, role=body.role)
        db.add(inv)
    else:
        inv.role = body.role
    db.flush()
    audit(db, current, "org.invite", "invitation", inv.id, None, {"email": email, "role": body.role})
    db.commit()
    return {"id": inv.id, "email": inv.email, "role": inv.role}


@router.delete("/api/org/invitations/{invitation_id}", status_code=204)
def revoke(invitation_id: str, db: Session = Depends(get_db), current: CurrentUser = Depends(require_admin)):
    inv = db.scalar(select(Invitation).where(Invitation.id == invitation_id, Invitation.org_id == current.org_id))
    if inv is None:
        raise HTTPException(status_code=404, detail="Invitation not found")
    audit(db, current, "org.invite.revoke", "invitation", inv.id, None, {"email": inv.email})
    db.delete(inv)
    db.commit()
    return Response(status_code=204)


@router.patch("/api/org/members/{user_id}")
def change_role(user_id: str, body: RoleUpdate, db: Session = Depends(get_db),
                current: CurrentUser = Depends(require_admin)):
    user = db.scalar(select(User).where(User.id == user_id, User.org_id == current.org_id))
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == current.id and body.role != "admin":
        admins = db.scalars(select(User).where(User.org_id == current.org_id, User.role == "admin")).all()
        if len(admins) <= 1:
            raise HTTPException(status_code=409, detail="An organization needs at least one admin")
    audit(db, current, "org.role", "user", user.id, None, {"email": user.email, "from": user.role, "to": body.role})
    user.role = body.role
    db.commit()
    return {"id": user.id, "email": user.email, "role": user.role}


# --- frameworks --------------------------------------------------------------------------


@router.get("/api/frameworks")
def list_frameworks(db: Session = Depends(get_db), current: CurrentUser = Depends(get_current_user)):
    out = []
    for fw in get_frameworks(db):
        s = fw.summary()
        out.append({**{k: s[k] for k in ("key", "name", "short_name", "version", "description", "license_note",
                                         "source_url", "scale")},
                    "domain_count": len(fw.domains), "practice_count": len(fw.practices)})
    return out


@router.get("/api/frameworks/{key}")
def framework_detail(key: str, db: Session = Depends(get_db), current: CurrentUser = Depends(get_current_user)):
    fw = get_framework(db, key)
    if fw is None:
        raise HTTPException(status_code=404, detail="Framework not found")
    return fw.summary()


@router.get("/api/capabilities")
def capabilities(db: Session = Depends(get_db), current: CurrentUser = Depends(get_current_user)):
    return [{"key": k, "name": v["name"], "description": v["description"]} for k, v in get_capabilities(db).items()]


# --- audit -------------------------------------------------------------------------------


@router.get("/api/audit")
def audit_log(engagement_id: str | None = Query(default=None), limit: int = Query(default=100, ge=1, le=500),
              db: Session = Depends(get_db), current: CurrentUser = Depends(get_current_user)):
    stmt = select(AuditLog).where(AuditLog.org_id == current.org_id)
    if engagement_id:
        get_engagement_or_404(db, current, engagement_id)
        stmt = stmt.where(AuditLog.engagement_id == engagement_id)
    rows = db.scalars(stmt.order_by(AuditLog.created_at.desc()).limit(limit)).all()
    return [{"id": r.id, "action": r.action, "entity_type": r.entity_type, "entity_id": r.entity_id,
             "engagement_id": r.engagement_id, "user_email": r.user_email, "details": r.details,
             "created_at": r.created_at.isoformat()} for r in rows]
