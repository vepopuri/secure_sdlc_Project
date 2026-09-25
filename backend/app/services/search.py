"""Full-text search over evidence chunks: Postgres GIN/tsvector, SQLite LIKE fallback."""

from __future__ import annotations

import re
from typing import Any

from sqlalchemy import and_, func, or_, select, text
from sqlalchemy.orm import Session

from ..models import Chunk, Document


def search_chunks(db: Session, org_id: str, engagement_id: str, query: str, limit: int = 20) -> list[dict[str, Any]]:
    query = query.strip()[:200]
    if not query:
        return []
    if db.get_bind().dialect.name == "postgresql":
        stmt = text(
            """
            SELECT c.id, c.document_id, c.heading, d.title,
                   ts_headline('english', c.text, q, 'MaxFragments=2, MaxWords=30, MinWords=10,
                               StartSel=<<, StopSel=>>') AS snippet,
                   ts_rank(c.tsv, q) AS rank
            FROM chunks c
            JOIN documents d ON d.id = c.document_id,
                 websearch_to_tsquery('english', :q) q
            WHERE c.org_id = :org AND c.engagement_id = :eng AND c.tsv @@ q
            ORDER BY rank DESC
            LIMIT :limit
            """
        )
        rows = db.execute(stmt, {"q": query, "org": org_id, "eng": engagement_id, "limit": limit}).all()
        return [
            {"chunk_id": r.id, "document_id": r.document_id, "heading": r.heading, "document_title": r.title,
             "snippet": r.snippet, "rank": float(r.rank)}
            for r in rows
        ]

    terms = [t for t in re.findall(r"[\w-]+", query.lower()) if len(t) > 1][:8]
    if not terms:
        return []
    conds = [func.lower(Chunk.text).contains(t, autoescape=True) for t in terms]
    stmt = (
        select(Chunk, Document.title)
        .join(Document, Document.id == Chunk.document_id)
        .where(and_(Chunk.org_id == org_id, Chunk.engagement_id == engagement_id), or_(*conds))
        .limit(500)
    )
    results = []
    for chunk, title in db.execute(stmt).all():
        low = chunk.text.lower()
        rank = sum(low.count(t) for t in terms) + 5 * sum(1 for t in terms if t in low)
        first = min((low.find(t) for t in terms if t in low), default=0)
        start = max(0, first - 80)
        snippet = ("..." if start else "") + chunk.text[start : start + 240]
        for t in terms:
            snippet = re.sub(f"({re.escape(t)})", r"<<\1>>", snippet, flags=re.I)
        results.append(
            {"chunk_id": chunk.id, "document_id": chunk.document_id, "heading": chunk.heading,
             "document_title": title, "snippet": snippet, "rank": float(rank)}
        )
    results.sort(key=lambda r: -r["rank"])
    return results[:limit]
