from __future__ import annotations

import re
from datetime import date

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import CurrentUser, get_current_user, require_writer
from ..config import get_settings
from ..db import get_db
from ..deps import get_engagement_or_404
from ..models import AnalysisRun, Chunk, Document, Engagement, ReportTemplate, ScoreOverride
from ..schemas import BlobIngest
from ..services.audit import audit
from ..services.blob import BlobFetchError, fetch_blob
from ..services.frameworks import get_frameworks
from ..services.report import (
    ReportContext,
    build_aliases,
    build_default_deck,
    build_sample_template,
    fill_template,
    find_tokens,
    make_executive_summary,
)
from ..services.scoring import build_results, collect_gaps_and_roadmap, engagement_frameworks

router = APIRouter(tags=["reports"])
PPTX_MEDIA = "application/vnd.openxmlformats-officedocument.presentationml.presentation"


def build_context(db: Session, eng: Engagement) -> ReportContext:
    fws = engagement_frameworks(db, eng)
    results = [build_results(db, eng, fw) for fw in fws]
    gaps, roadmap = collect_gaps_and_roadmap(results)
    docs = db.scalars(select(Document).where(Document.engagement_id == eng.id).order_by(Document.created_at)).all()
    counts = dict(db.execute(select(Chunk.document_id, func.count()).where(Chunk.engagement_id == eng.id)
                             .group_by(Chunk.document_id)).all())
    analyzers = db.scalars(select(AnalysisRun.analyzer).where(AnalysisRun.engagement_id == eng.id).distinct()).all()
    runs_models = db.scalars(select(AnalysisRun.model).where(AnalysisRun.engagement_id == eng.id,
                                                             AnalysisRun.model.is_not(None)).distinct()).all()
    labels = []
    for a in analyzers:
        labels.append(f"Claude ({', '.join(runs_models)})" if a == "claude" else "keyword heuristic")
    overrides = db.scalar(select(func.count()).select_from(ScoreOverride)
                          .where(ScoreOverride.engagement_id == eng.id)) or 0
    ctx = ReportContext(
        client_name=eng.client_name,
        app_name=eng.app_name,
        business_unit=eng.business_unit,
        scope=eng.scope,
        status=eng.status,
        report_date=date.today(),
        results=results,
        gaps=gaps,
        roadmap=roadmap,
        documents=[
            {"title": d.title, "kind": d.kind, "filename": d.filename, "interviewee_role": d.interviewee_role,
             "date": (d.interview_date or d.created_at.date()).isoformat(), "chunks": counts.get(d.id, 0)}
            for d in docs
        ],
        analyzers=labels,
        override_count=overrides,
        framework_aliases=build_aliases(get_frameworks(db)),
    )
    ctx.executive_summary = make_executive_summary(ctx)
    return ctx


def _filename(eng: Engagement, suffix: str) -> str:
    base = re.sub(r"[^A-Za-z0-9]+", "-", f"{eng.client_name}-{eng.app_name}").strip("-")[:80] or "report"
    return f"{base}-{suffix}.pptx"


@router.get("/api/engagements/{engagement_id}/report")
def download_report(engagement_id: str, template_id: str | None = Query(default=None),
                    db: Session = Depends(get_db), current: CurrentUser = Depends(get_current_user)):
    eng = get_engagement_or_404(db, current, engagement_id)
    ctx = build_context(db, eng)
    if template_id:
        tpl = db.scalar(select(ReportTemplate).where(ReportTemplate.id == template_id,
                                                     ReportTemplate.org_id == current.org_id))
        if tpl is None:
            raise HTTPException(status_code=404, detail="Template not found")
        data = fill_template(tpl.data, ctx)
        name = _filename(eng, "report")
    else:
        data = build_default_deck(ctx)
        name = _filename(eng, "ssdlc-assessment")
    audit(db, current, "report.download", "engagement", eng.id, eng.id,
          {"template_id": template_id, "frameworks": [r["framework"]["key"] for r in ctx.results]})
    db.commit()
    return Response(content=data, media_type=PPTX_MEDIA,
                    headers={"Content-Disposition": f'attachment; filename="{name}"',
                             "Cache-Control": "no-store"})


@router.get("/api/engagements/{engagement_id}/report/summary")
def report_summary(engagement_id: str, db: Session = Depends(get_db),
                   current: CurrentUser = Depends(get_current_user)):
    eng = get_engagement_or_404(db, current, engagement_id)
    ctx = build_context(db, eng)
    return {"executive_summary": ctx.executive_summary, "gaps": ctx.gaps, "roadmap": ctx.roadmap,
            "overall": ctx.overall_text(), "document_count": ctx.document_count,
            "interview_count": ctx.interview_count}


# --- templates ---------------------------------------------------------------------------


def _template_out(t: ReportTemplate) -> dict:
    return {"id": t.id, "name": t.name, "size_bytes": t.size_bytes, "tokens": t.tokens,
            "created_at": t.created_at.isoformat()}


def _store_template(db: Session, current: CurrentUser, name: str, data: bytes) -> dict:
    if not name.lower().endswith(".pptx"):
        raise HTTPException(status_code=415, detail="Templates must be .pptx files")
    if not data.startswith(b"PK"):
        raise HTTPException(status_code=415, detail="File is not a valid .pptx")
    from ..services.parsing import UnsupportedFileError, _check_zip

    try:
        _check_zip(data)
        tokens = find_tokens(data)
    except UnsupportedFileError as exc:
        raise HTTPException(status_code=415, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=415, detail="Could not open the PowerPoint template") from exc
    tpl = ReportTemplate(org_id=current.org_id, name=name[:300], size_bytes=len(data), tokens=tokens, data=data,
                         created_by=current.id)
    db.add(tpl)
    db.flush()
    audit(db, current, "template.upload", "report_template", tpl.id, None, {"name": tpl.name, "tokens": tokens})
    db.commit()
    return _template_out(tpl)


@router.get("/api/templates")
def list_templates(db: Session = Depends(get_db), current: CurrentUser = Depends(get_current_user)):
    rows = db.scalars(select(ReportTemplate).where(ReportTemplate.org_id == current.org_id)
                      .order_by(ReportTemplate.created_at.desc())).all()
    return [_template_out(t) for t in rows]


@router.post("/api/templates", status_code=201)
async def upload_template(file: UploadFile = File(...), db: Session = Depends(get_db),
                          current: CurrentUser = Depends(require_writer)):
    limit = int(get_settings().max_direct_upload_mb * 1024 * 1024)
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(status_code=413, detail="Template too large for direct upload; use Blob upload")
    return _store_template(db, current, file.filename or "template.pptx", data)


@router.post("/api/templates/from-blob", status_code=201)
def upload_template_blob(body: BlobIngest, db: Session = Depends(get_db),
                         current: CurrentUser = Depends(require_writer)):
    s = get_settings()
    try:
        data = fetch_blob(body.url, s.blob_host_suffixes, int(s.max_blob_upload_mb * 1024 * 1024))
    except BlobFetchError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _store_template(db, current, body.filename, data)


@router.delete("/api/templates/{template_id}", status_code=204)
def delete_template(template_id: str, db: Session = Depends(get_db), current: CurrentUser = Depends(require_writer)):
    tpl = db.scalar(select(ReportTemplate).where(ReportTemplate.id == template_id,
                                                 ReportTemplate.org_id == current.org_id))
    if tpl is None:
        raise HTTPException(status_code=404, detail="Template not found")
    audit(db, current, "template.delete", "report_template", tpl.id, None, {"name": tpl.name})
    db.delete(tpl)
    db.commit()
    return Response(status_code=204)


@router.get("/api/templates/sample")
def sample_template(current: CurrentUser = Depends(get_current_user)):
    return Response(content=build_sample_template(), media_type=PPTX_MEDIA,
                    headers={"Content-Disposition": 'attachment; filename="ssdlc-sample-template.pptx"'})
