from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import CurrentUser, get_current_user, require_admin, require_writer
from ..db import get_db
from ..deps import get_engagement_or_404
from ..models import Document, Engagement, EngagementFramework
from ..schemas import EngagementCreate, EngagementOut, EngagementUpdate, FrameworkSelection
from ..services.audit import audit
from ..services.frameworks import get_framework

router = APIRouter(prefix="/api/engagements", tags=["engagements"])


def _counts(db: Session, engagement_ids: list[str]) -> dict[tuple[str, str], int]:
    if not engagement_ids:
        return {}
    rows = db.execute(
        select(Document.engagement_id, Document.kind, func.count())
        .where(Document.engagement_id.in_(engagement_ids))
        .group_by(Document.engagement_id, Document.kind)
    ).all()
    return {(e, k): n for e, k, n in rows}


def to_out(eng: Engagement, counts: dict[tuple[str, str], int]) -> EngagementOut:
    out = EngagementOut.model_validate(eng)
    out.document_count = counts.get((eng.id, "file"), 0)
    out.interview_count = counts.get((eng.id, "interview"), 0)
    return out


def _apply_frameworks(db: Session, eng: Engagement, selections: list[FrameworkSelection]) -> None:
    seen: set[str] = set()
    new: list[EngagementFramework] = []
    existing = {ef.framework_key: ef for ef in eng.frameworks}
    for pos, sel in enumerate(selections):
        fw = get_framework(db, sel.key)
        if fw is None:
            raise HTTPException(status_code=422, detail=f"Unknown framework '{sel.key}'")
        if fw.key in seen:
            continue
        seen.add(fw.key)
        target = fw.clamp(sel.target) if sel.target is not None else None
        ef = existing.get(fw.key)
        if ef is None:
            ef = EngagementFramework(framework_key=fw.key, target_level=target if target is not None else fw.default_target)
        elif target is not None:
            ef.target_level = target
        ef.position = pos
        new.append(ef)
    eng.frameworks = new


@router.get("", response_model=list[EngagementOut])
def list_engagements(db: Session = Depends(get_db), current: CurrentUser = Depends(get_current_user)):
    engs = db.scalars(
        select(Engagement).where(Engagement.org_id == current.org_id).order_by(Engagement.updated_at.desc())
    ).all()
    counts = _counts(db, [e.id for e in engs])
    return [to_out(e, counts) for e in engs]


@router.post("", response_model=EngagementOut, status_code=201)
def create_engagement(body: EngagementCreate, db: Session = Depends(get_db),
                      current: CurrentUser = Depends(require_writer)):
    eng = Engagement(
        org_id=current.org_id,
        client_name=body.client_name,
        app_name=body.app_name,
        business_unit=(body.business_unit or "").strip() or None,
        scope=body.scope.strip(),
        status=body.status,
        created_by=current.id,
    )
    db.add(eng)
    db.flush()
    _apply_frameworks(db, eng, body.frameworks or [FrameworkSelection(key="samm")])
    audit(db, current, "engagement.create", "engagement", eng.id, eng.id,
          {"client_name": eng.client_name, "app_name": eng.app_name,
           "frameworks": [f.framework_key for f in eng.frameworks]})
    db.commit()
    db.refresh(eng)
    return to_out(eng, {})


@router.get("/{engagement_id}", response_model=EngagementOut)
def get_engagement(engagement_id: str, db: Session = Depends(get_db),
                   current: CurrentUser = Depends(get_current_user)):
    eng = get_engagement_or_404(db, current, engagement_id)
    return to_out(eng, _counts(db, [eng.id]))


@router.patch("/{engagement_id}", response_model=EngagementOut)
def update_engagement(engagement_id: str, body: EngagementUpdate, db: Session = Depends(get_db),
                      current: CurrentUser = Depends(require_writer)):
    eng = get_engagement_or_404(db, current, engagement_id)
    changes: dict[str, object] = {}
    for field in ("client_name", "app_name", "business_unit", "scope", "status"):
        value = getattr(body, field)
        if value is not None:
            value = value.strip() if isinstance(value, str) else value
            if field in ("client_name", "app_name") and not value:
                raise HTTPException(status_code=422, detail=f"{field} must not be blank")
            if getattr(eng, field) != value:
                changes[field] = {"from": getattr(eng, field), "to": value}
                setattr(eng, field, (value or None) if field == "business_unit" else value)
    if body.frameworks is not None:
        before = [(f.framework_key, f.target_level) for f in eng.frameworks]
        _apply_frameworks(db, eng, body.frameworks)
        after = [(f.framework_key, f.target_level) for f in eng.frameworks]
        if before != after:
            changes["frameworks"] = {"from": before, "to": after}
    if changes:
        action = "engagement.status" if set(changes) == {"status"} else "engagement.update"
        audit(db, current, action, "engagement", eng.id, eng.id, changes)
    db.commit()
    db.refresh(eng)
    return to_out(eng, _counts(db, [eng.id]))


@router.delete("/{engagement_id}", status_code=204)
def delete_engagement(engagement_id: str, db: Session = Depends(get_db),
                      current: CurrentUser = Depends(require_admin)):
    eng = get_engagement_or_404(db, current, engagement_id)
    audit(db, current, "engagement.delete", "engagement", eng.id, eng.id,
          {"client_name": eng.client_name, "app_name": eng.app_name})
    db.delete(eng)
    db.commit()
    return Response(status_code=204)
