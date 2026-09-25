"""Analysis runs. The browser creates a run, then calls one endpoint per framework domain so
every request stays within serverless time limits."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import CurrentUser, get_current_user, require_writer
from ..config import get_settings
from ..db import get_db
from ..deps import get_engagement_or_404
from ..models import AnalysisRun, Chunk, Document, PracticeAssessment, utcnow
from ..schemas import RunCreate
from ..services.analysis import (
    AnalyzerError,
    build_evidence,
    claude_analyze,
    heuristic_analyze,
    render_evidence,
    validate_domain_output,
)
from ..services.audit import audit
from ..services.frameworks import get_capabilities, get_framework

router = APIRouter(tags=["analysis"])


def _run_out(run: AnalysisRun, domains: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    out = {
        "id": run.id,
        "framework_key": run.framework_key,
        "analyzer": run.analyzer,
        "model": run.model,
        "status": run.status,
        "domains_total": run.domains_total,
        "domains_done": run.domains_done or [],
        "error": run.error,
        "usage": run.usage or {},
        "created_at": run.created_at.isoformat() if run.created_at else None,
        "finished_at": run.finished_at.isoformat() if run.finished_at else None,
    }
    if domains is not None:
        out["domains"] = domains
    return out


@router.get("/api/analyzer")
def analyzer_info(current: CurrentUser = Depends(get_current_user)):
    s = get_settings()
    return {"analyzer": "claude" if s.anthropic_api_key else "heuristic",
            "model": s.anthropic_model if s.anthropic_api_key else None}


@router.get("/api/engagements/{engagement_id}/analysis/runs")
def list_runs(engagement_id: str, db: Session = Depends(get_db), current: CurrentUser = Depends(get_current_user)):
    eng = get_engagement_or_404(db, current, engagement_id)
    runs = db.scalars(
        select(AnalysisRun).where(AnalysisRun.engagement_id == eng.id).order_by(AnalysisRun.created_at.desc()).limit(50)
    ).all()
    return [_run_out(r) for r in runs]


@router.post("/api/engagements/{engagement_id}/analysis/runs", status_code=201)
def create_run(engagement_id: str, body: RunCreate, db: Session = Depends(get_db),
               current: CurrentUser = Depends(require_writer)):
    eng = get_engagement_or_404(db, current, engagement_id)
    fw = get_framework(db, body.framework_key)
    if fw is None:
        raise HTTPException(status_code=404, detail="Framework not found")
    n_chunks = db.scalar(select(func.count()).select_from(Chunk).where(Chunk.engagement_id == eng.id)) or 0
    if n_chunks == 0:
        raise HTTPException(status_code=422, detail="Upload evidence or add interview notes before running analysis")
    s = get_settings()
    analyzer = "claude" if s.anthropic_api_key else "heuristic"
    run = AnalysisRun(org_id=eng.org_id, engagement_id=eng.id, framework_key=fw.key, analyzer=analyzer,
                      model=s.anthropic_model if analyzer == "claude" else None,
                      domains_total=len(fw.domains), domains_done=[], created_by=current.id, usage={})
    db.add(run)
    db.flush()
    audit(db, current, "analysis.start", "analysis_run", run.id, eng.id,
          {"framework": fw.key, "analyzer": analyzer, "model": run.model})
    db.commit()
    domains = [{"id": d.id, "name": d.name, "practice_count": len(d.practices)} for d in fw.domains]
    return _run_out(run, domains)


@router.post("/api/engagements/{engagement_id}/analysis/runs/{run_id}/domains/{domain_id}")
def run_domain(engagement_id: str, run_id: str, domain_id: str, db: Session = Depends(get_db),
               current: CurrentUser = Depends(require_writer)):
    eng = get_engagement_or_404(db, current, engagement_id)
    run = db.scalar(select(AnalysisRun).where(AnalysisRun.id == run_id, AnalysisRun.engagement_id == eng.id))
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")
    fw = get_framework(db, run.framework_key)
    domain = fw.domain(domain_id) if fw else None
    if fw is None or domain is None:
        raise HTTPException(status_code=404, detail="Domain not found")

    s = get_settings()
    capabilities = get_capabilities(db)
    rows = db.execute(
        select(Chunk, Document).join(Document, Document.id == Chunk.document_id).where(Chunk.engagement_id == eng.id)
    ).all()
    keywords = sorted({kw for p in fw.practices for c in p.capabilities for kw in capabilities[c]["keywords"]})
    evidence = build_evidence([(c, d) for c, d in rows], s.evidence_char_budget, keywords)
    usage: dict[str, Any] = {}
    try:
        if run.analyzer == "claude":
            context = (
                f"Engagement: client '{eng.client_name}', application '{eng.app_name}'"
                + (f", business unit '{eng.business_unit}'" if eng.business_unit else "")
                + f".\nAssessment scope: {eng.scope or 'not specified'}"
            )
            raw, usage = claude_analyze(s, fw, domain, render_evidence(evidence), context)
        else:
            raw = heuristic_analyze(fw, domain, evidence, capabilities)
    except AnalyzerError as exc:
        run.error = f"{domain.id}: {exc}"
        db.commit()
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    results, stats = validate_domain_output(fw, domain, raw, evidence)
    existing = {
        a.practice_id: a
        for a in db.scalars(
            select(PracticeAssessment).where(
                PracticeAssessment.engagement_id == eng.id,
                PracticeAssessment.framework_key == fw.key,
                PracticeAssessment.domain_id == domain.id,
            )
        )
    }
    for r in results:
        row = existing.get(r["practice_id"])
        if row is None:
            row = PracticeAssessment(org_id=eng.org_id, engagement_id=eng.id, framework_key=fw.key,
                                     practice_id=r["practice_id"], domain_id=domain.id)
            db.add(row)
        # Overrides live in score_overrides and are never touched here.
        row.run_id = run.id
        row.score = r["score"]
        row.confidence = r["confidence"]
        row.rationale = r["rationale"]
        row.citations = r["citations"]
        row.gaps = r["gaps"]
        row.recommendations = r["recommendations"]
        row.source = run.analyzer
        row.updated_at = utcnow()

    done = list(dict.fromkeys([*(run.domains_done or []), domain.id]))
    run.domains_done = done
    total_usage = dict(run.usage or {})
    for k, v in usage.items():
        if isinstance(v, int):
            total_usage[k] = total_usage.get(k, 0) + v
    run.usage = total_usage
    run.error = None
    if len(done) >= run.domains_total:
        run.status = "completed"
        run.finished_at = utcnow()
        audit(db, current, "analysis.complete", "analysis_run", run.id, eng.id,
              {"framework": fw.key, "analyzer": run.analyzer, "usage": total_usage})
    if eng.status == "draft":
        eng.status = "in_progress"
        audit(db, current, "engagement.status", "engagement", eng.id, eng.id,
              {"status": {"from": "draft", "to": "in_progress"}, "trigger": "analysis"})
    db.commit()
    return {
        "run": _run_out(run),
        "domain_id": domain.id,
        "practices": len(results),
        "stats": {**stats, "evidence_chunks": len(evidence.items), "evidence_truncated": evidence.truncated},
    }
