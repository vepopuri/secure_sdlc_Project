from __future__ import annotations

import math

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import CurrentUser, get_current_user, require_writer
from ..db import get_db
from ..deps import get_engagement_or_404
from ..models import PracticeAssessment, ScoreOverride
from ..schemas import OverrideIn
from ..services.audit import audit
from ..services.frameworks import get_framework
from ..services.scoring import build_results

router = APIRouter(prefix="/api/engagements/{engagement_id}", tags=["results"])


@router.get("/results/{framework_key}")
def get_results(engagement_id: str, framework_key: str, db: Session = Depends(get_db),
                current: CurrentUser = Depends(get_current_user)):
    eng = get_engagement_or_404(db, current, engagement_id)
    fw = get_framework(db, framework_key)
    if fw is None:
        raise HTTPException(status_code=404, detail="Framework not found")
    return build_results(db, eng, fw)


@router.put("/overrides/{framework_key}/{practice_id}")
def set_override(engagement_id: str, framework_key: str, practice_id: str, body: OverrideIn,
                 db: Session = Depends(get_db), current: CurrentUser = Depends(require_writer)):
    eng = get_engagement_or_404(db, current, engagement_id)
    fw = get_framework(db, framework_key)
    if fw is None or fw.practice(practice_id) is None:
        raise HTTPException(status_code=404, detail="Practice not found")
    if math.isnan(body.score) or not fw.scale_min <= body.score <= fw.scale_max:
        raise HTTPException(status_code=422,
                            detail=f"Score must be between {fw.scale_min:g} and {fw.scale_max:g}")
    reason = body.reason.strip()
    if len(reason) < 3:
        raise HTTPException(status_code=422, detail="A written reason is required")
    machine = db.scalar(select(PracticeAssessment.score).where(
        PracticeAssessment.engagement_id == eng.id, PracticeAssessment.framework_key == fw.key,
        PracticeAssessment.practice_id == practice_id))
    row = db.scalar(select(ScoreOverride).where(
        ScoreOverride.engagement_id == eng.id, ScoreOverride.framework_key == fw.key,
        ScoreOverride.practice_id == practice_id))
    previous = row.score if row else None
    if row is None:
        row = ScoreOverride(org_id=eng.org_id, engagement_id=eng.id, framework_key=fw.key,
                            practice_id=practice_id, score=body.score, reason=reason, created_by=current.id)
        db.add(row)
    else:
        row.score, row.reason, row.created_by = body.score, reason, current.id
    db.flush()
    audit(db, current, "score.override", "score_override", row.id, eng.id,
          {"framework": fw.key, "practice": practice_id, "machine_score": machine,
           "previous_override": previous, "score": body.score, "reason": reason})
    db.commit()
    return {"framework_key": fw.key, "practice_id": practice_id, "score": row.score, "reason": row.reason}


@router.delete("/overrides/{framework_key}/{practice_id}", status_code=204)
def clear_override(engagement_id: str, framework_key: str, practice_id: str, db: Session = Depends(get_db),
                   current: CurrentUser = Depends(require_writer)):
    eng = get_engagement_or_404(db, current, engagement_id)
    row = db.scalar(select(ScoreOverride).where(
        ScoreOverride.engagement_id == eng.id, ScoreOverride.framework_key == framework_key,
        ScoreOverride.practice_id == practice_id))
    if row is None:
        raise HTTPException(status_code=404, detail="Override not found")
    audit(db, current, "score.override.clear", "score_override", row.id, eng.id,
          {"framework": framework_key, "practice": practice_id, "score": row.score, "reason": row.reason})
    db.delete(row)
    db.commit()
    return Response(status_code=204)
