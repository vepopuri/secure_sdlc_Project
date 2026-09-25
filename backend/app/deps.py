from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth import CurrentUser
from .models import Engagement


def get_engagement_or_404(db: Session, current: CurrentUser, engagement_id: str) -> Engagement:
    """Organization-scoped lookup: records from another organization are indistinguishable
    from records that do not exist."""
    eng = db.scalar(
        select(Engagement).where(Engagement.id == engagement_id, Engagement.org_id == current.org_id)
    )
    if eng is None:
        raise HTTPException(status_code=404, detail="Engagement not found")
    return eng
