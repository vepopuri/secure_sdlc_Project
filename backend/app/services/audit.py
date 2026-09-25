from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from ..auth import CurrentUser
from ..models import AuditLog


def audit(
    db: Session,
    current: CurrentUser,
    action: str,
    entity_type: str,
    entity_id: str | None = None,
    engagement_id: str | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    """Add an audit record to the session; the caller's commit persists it atomically
    with the change it describes."""
    db.add(
        AuditLog(
            org_id=current.org_id,
            user_id=current.id,
            user_email=current.email,
            engagement_id=engagement_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            details=details or {},
        )
    )
