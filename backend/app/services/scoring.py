"""Effective scores, capability roll-up and cross-framework projection.

Effective score of a practice = assessor override if present, else the analyzer's score.
Frameworks that were not analyzed get *projected* scores:

    analyzed practice scores --(practice->capability weights)--> capability scores (0..1)
    capability scores --(target practice->capability weights)--> projected practice scores

Projection is pure computation over stored rows, so switching frameworks is instant.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Engagement, PracticeAssessment, ScoreOverride, User
from .frameworks import FrameworkDef, get_capabilities, get_framework, get_frameworks

PRIORITY_ORDER = {"high": 0, "medium": 1, "low": 2}
PROJECTION_CONFIDENCE_FACTOR = 0.7


@dataclass
class CapabilityScore:
    key: str
    name: str
    score: float  # normalised 0..1
    confidence: float
    sources: list[str]


def _norm(fw: FrameworkDef, score: float) -> float:
    return (fw.clamp(score) - fw.scale_min) / (fw.scale_max - fw.scale_min)


def _denorm(fw: FrameworkDef, n: float) -> float:
    return round(fw.scale_min + max(0.0, min(1.0, n)) * (fw.scale_max - fw.scale_min), 2)


def load_rows(db: Session, engagement: Engagement):
    assessments = db.scalars(
        select(PracticeAssessment).where(PracticeAssessment.engagement_id == engagement.id)
    ).all()
    overrides = db.scalars(select(ScoreOverride).where(ScoreOverride.engagement_id == engagement.id)).all()
    return assessments, overrides


def capability_scores(db: Session, assessments, overrides) -> dict[str, CapabilityScore]:
    caps = get_capabilities(db)
    acc: dict[str, list[float]] = defaultdict(lambda: [0.0, 0.0, 0.0])  # weighted score, weight, conf
    sources: dict[str, set[str]] = defaultdict(set)
    inputs: dict[tuple[str, str], tuple[float, float]] = {}
    for a in assessments:
        inputs[(a.framework_key, a.practice_id)] = (a.score, a.confidence)
    for o in overrides:
        inputs[(o.framework_key, o.practice_id)] = (o.score, 1.0)
    for (fw_key, pid), (score, conf) in inputs.items():
        fw = get_framework(db, fw_key)
        practice = fw.practice(pid) if fw else None
        if fw is None or practice is None:
            continue
        n = _norm(fw, score)
        c = max(conf, 0.05)
        for cap, w in practice.capabilities.items():
            acc[cap][0] += w * c * n
            acc[cap][1] += w * c
            acc[cap][2] += w
            sources[cap].add(fw.short_name)
    out: dict[str, CapabilityScore] = {}
    for cap, (ws, w, wraw) in acc.items():
        if w <= 0 or cap not in caps:
            continue
        out[cap] = CapabilityScore(
            key=cap,
            name=caps[cap]["name"],
            score=ws / w,
            confidence=min(1.0, w / wraw) if wraw else 0.0,
            sources=sorted(sources[cap]),
        )
    return out


def framework_target(engagement: Engagement, fw: FrameworkDef) -> float:
    for ef in engagement.frameworks:
        if ef.framework_key == fw.key:
            return fw.clamp(ef.target_level)
    return fw.default_target


def build_results(db: Session, engagement: Engagement, fw: FrameworkDef) -> dict[str, Any]:
    assessments, overrides = load_rows(db, engagement)
    caps_meta = get_capabilities(db)
    cap_scores = capability_scores(db, assessments, overrides)
    analyzed = sorted({a.framework_key for a in assessments})
    by_practice = {a.practice_id: a for a in assessments if a.framework_key == fw.key}
    ov_by_practice = {o.practice_id: o for o in overrides if o.framework_key == fw.key}
    user_ids = {o.created_by for o in ov_by_practice.values() if o.created_by}
    users = {u.id: u for u in db.scalars(select(User).where(User.id.in_(user_ids)))} if user_ids else {}
    target = framework_target(engagement, fw)

    practices_out: list[dict[str, Any]] = []
    for p in fw.practices:
        a = by_practice.get(p.id)
        item: dict[str, Any] = {
            "id": p.id,
            "name": p.name,
            "description": p.description,
            "domain_id": p.domain_id,
            "capabilities": p.capabilities,
            "levels": {str(k): v for k, v in p.levels.items()},
            "target": target,
            "override": None,
        }
        if a is not None:
            item.update(
                machine_score=a.score,
                score=a.score,
                status="assessed",
                source=a.source,
                confidence=round(a.confidence, 2),
                rationale=a.rationale,
                citations=a.citations,
                gaps=a.gaps,
                recommendations=a.recommendations,
            )
        else:
            covered = {c: w for c, w in p.capabilities.items() if c in cap_scores}
            total_w = sum(p.capabilities.values())
            if covered:
                cw = sum(covered.values())
                n = sum(cap_scores[c].score * w for c, w in covered.items()) / cw
                conf = (
                    sum(cap_scores[c].confidence * w for c, w in covered.items()) / cw
                    * (cw / total_w)
                    * PROJECTION_CONFIDENCE_FACTOR
                )
                srcs = sorted({s for c in covered for s in cap_scores[c].sources})
                weak = [c for c in p.capabilities if c not in cap_scores or cap_scores[c].score < 0.5]
                item.update(
                    machine_score=_denorm(fw, n),
                    score=_denorm(fw, n),
                    status="projected",
                    source="projection",
                    confidence=round(conf, 2),
                    rationale=(
                        "Projected through the shared capability taxonomy from "
                        + ", ".join(srcs)
                        + ": "
                        + "; ".join(f"{caps_meta[c]['name']} {cap_scores[c].score * 100:.0f}%" for c in covered)
                        + "."
                    ),
                    citations=[],
                    gaps=[
                        f"{caps_meta[c]['name']}: "
                        + ("no evidence" if c not in cap_scores else f"{cap_scores[c].score * 100:.0f}% maturity")
                        for c in weak
                    ],
                    recommendations=[
                        {
                            "text": caps_meta[c]["recommendation"],
                            "priority": "high" if c not in cap_scores or cap_scores[c].score < 0.34 else "medium",
                            "horizon": 30 if c not in cap_scores or cap_scores[c].score < 0.34 else 60,
                        }
                        for c in weak
                    ],
                )
            else:
                item.update(
                    machine_score=None,
                    score=None,
                    status="not_assessed",
                    source=None,
                    confidence=0.0,
                    rationale="No analysed evidence maps to this practice yet.",
                    citations=[],
                    gaps=[],
                    recommendations=[],
                )
        o = ov_by_practice.get(p.id)
        if o is not None:
            u = users.get(o.created_by or "")
            item["override"] = {
                "score": o.score,
                "reason": o.reason,
                "by": u.email if u else None,
                "at": o.updated_at.isoformat() if o.updated_at else None,
            }
            item["score"] = o.score
            item["status"] = "overridden"
        practices_out.append(item)

    domains_out = []
    for d in fw.domains:
        scores = [x["score"] for x in practices_out if x["domain_id"] == d.id and x["score"] is not None]
        domains_out.append(
            {
                "id": d.id,
                "name": d.name,
                "current": round(sum(scores) / len(scores), 2) if scores else None,
                "target": target,
                "practice_ids": [p.id for p in d.practices],
            }
        )
    dom_scores = [d["current"] for d in domains_out if d["current"] is not None]
    overall = round(sum(dom_scores) / len(dom_scores), 2) if dom_scores else None

    return {
        "framework": {
            "key": fw.key,
            "name": fw.name,
            "short_name": fw.short_name,
            "version": fw.version,
            "scale": {
                "min": fw.scale_min,
                "max": fw.scale_max,
                "step": fw.scale_step,
                "labels": {str(k): v for k, v in fw.labels.items()},
            },
            "license_note": fw.license_note,
        },
        "analyzed_frameworks": analyzed,
        "is_projected": fw.key not in analyzed,
        "target": target,
        "overall": overall,
        "domains": domains_out,
        "practices": practices_out,
        "capabilities": [
            {
                "key": c.key,
                "name": c.name,
                "score": round(c.score, 3),
                "confidence": round(c.confidence, 2),
                "sources": c.sources,
            }
            for c in sorted(cap_scores.values(), key=lambda c: c.score)
        ],
    }


def engagement_frameworks(db: Session, engagement: Engagement) -> list[FrameworkDef]:
    keys = [ef.framework_key for ef in engagement.frameworks]
    all_fw = {f.key: f for f in get_frameworks(db)}
    return [all_fw[k] for k in keys if k in all_fw]


def collect_gaps_and_roadmap(results: list[dict[str, Any]], limit: int = 12) -> tuple[list[dict], list[dict]]:
    """Top gaps (largest shortfall vs target) and a de-duplicated 30/60/90 roadmap."""
    gaps: list[dict[str, Any]] = []
    recs: dict[str, dict[str, Any]] = {}
    for res in results:
        fw = res["framework"]
        span = fw["scale"]["max"] - fw["scale"]["min"]
        for p in res["practices"]:
            if p["score"] is None:
                continue
            shortfall = (p["target"] - p["score"]) / span if span else 0
            if shortfall > 0:
                gaps.append(
                    {
                        "framework": fw["short_name"],
                        "practice": f"{p['id']} {p['name']}",
                        "score": p["score"],
                        "target": p["target"],
                        "shortfall": round(shortfall, 3),
                        "gap": (p["gaps"] or [p["rationale"]])[0] if (p["gaps"] or p["rationale"]) else "",
                        "status": p["status"],
                    }
                )
                for r in p["recommendations"]:
                    key = r["text"].strip().lower()
                    existing = recs.get(key)
                    entry = {
                        "text": r["text"],
                        "priority": r.get("priority", "medium"),
                        "horizon": int(r.get("horizon", 60)),
                        "practices": [f"{fw['short_name']} {p['id']}"],
                        "weight": shortfall,
                    }
                    if existing is None:
                        recs[key] = entry
                    else:
                        existing["practices"].append(entry["practices"][0])
                        existing["weight"] += shortfall
                        if PRIORITY_ORDER[entry["priority"]] < PRIORITY_ORDER[existing["priority"]]:
                            existing["priority"] = entry["priority"]
                        existing["horizon"] = min(existing["horizon"], entry["horizon"])
    gaps.sort(key=lambda g: (-g["shortfall"], g["framework"], g["practice"]))
    return gaps[:limit], sequence_roadmap(list(recs.values()))[: limit * 2]


ROADMAP_CAPACITY = {30: 6, 60: 6}  # actions a team can realistically start per horizon


def sequence_roadmap(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Capacity-based sequencing: each horizon keeps its highest-impact actions (priority,
    then weighted shortfall) and overflow moves to the next horizon (30 -> 60 -> 90)."""
    ordered = sorted(items, key=lambda r: (PRIORITY_ORDER[r["priority"]], -r["weight"], r["text"]))
    buckets: dict[int, list[dict[str, Any]]] = {30: [], 60: [], 90: []}
    for r in ordered:
        horizon = r["horizon"] if r["horizon"] in buckets else 60
        while horizon in ROADMAP_CAPACITY and len(buckets[horizon]) >= ROADMAP_CAPACITY[horizon]:
            horizon = 60 if horizon == 30 else 90
        r["horizon"] = horizon
        buckets[horizon].append(r)
    return buckets[30] + buckets[60] + buckets[90]
