from __future__ import annotations

import hashlib

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import CurrentUser, get_current_user, require_writer
from ..config import get_settings
from ..db import get_db
from ..deps import get_engagement_or_404
from ..models import Chunk, Document, Engagement
from ..schemas import BlobIngest, DocumentOut, InterviewIn
from ..services.audit import audit
from ..services.blob import BlobFetchError, fetch_blob
from ..services.chunking import chunk_text
from ..services.parsing import UnsupportedFileError, classify, parse_file, safe_filename
from ..services.redaction import redact
from ..services.search import search_chunks

router = APIRouter(prefix="/api/engagements/{engagement_id}", tags=["evidence"])


def _store_document(db: Session, current: CurrentUser, eng: Engagement, doc: Document, text: str) -> Document:
    redacted, n = redact(text)
    doc.text = redacted
    doc.redactions = n
    db.add(doc)
    db.flush()
    pieces = chunk_text(redacted, default_heading=doc.title)
    for i, piece in enumerate(pieces):
        db.add(Chunk(org_id=eng.org_id, engagement_id=eng.id, document_id=doc.id, ordinal=i,
                     heading=piece.heading, text=piece.text))
    return doc


def _to_out(doc: Document, chunk_count: int) -> DocumentOut:
    out = DocumentOut.model_validate(doc)
    out.chunk_count = chunk_count
    return out


def _ingest_file(db: Session, current: CurrentUser, eng: Engagement, filename: str, data: bytes,
                 via: str) -> DocumentOut:
    filename = safe_filename(filename)
    try:
        classify(filename)
        parsed = parse_file(filename, data)
    except UnsupportedFileError as exc:
        raise HTTPException(status_code=415, detail=str(exc)) from exc
    if not parsed.text.strip():
        raise HTTPException(status_code=422, detail="No text could be extracted from the file")
    digest = hashlib.sha256(data).hexdigest()
    dup = db.scalar(select(Document.id).where(Document.engagement_id == eng.id, Document.sha256 == digest))
    if dup:
        raise HTTPException(status_code=409, detail="This file has already been uploaded to the engagement")
    doc = Document(org_id=eng.org_id, engagement_id=eng.id, kind="file", title=filename.rsplit(".", 1)[0],
                   filename=filename, content_type=parsed.content_type, size_bytes=len(data), sha256=digest,
                   created_by=current.id)
    _store_document(db, current, eng, doc, parsed.text)
    audit(db, current, "evidence.upload", "document", doc.id, eng.id,
          {"filename": filename, "size_bytes": len(data), "via": via, "redactions": doc.redactions})
    db.commit()
    count = db.scalar(select(func.count()).select_from(Chunk).where(Chunk.document_id == doc.id)) or 0
    return _to_out(doc, count)


@router.get("/documents", response_model=list[DocumentOut])
def list_documents(engagement_id: str, db: Session = Depends(get_db),
                   current: CurrentUser = Depends(get_current_user)):
    eng = get_engagement_or_404(db, current, engagement_id)
    docs = db.scalars(select(Document).where(Document.engagement_id == eng.id).order_by(Document.created_at)).all()
    counts = dict(
        db.execute(
            select(Chunk.document_id, func.count()).where(Chunk.engagement_id == eng.id).group_by(Chunk.document_id)
        ).all()
    )
    return [_to_out(d, counts.get(d.id, 0)) for d in docs]


@router.post("/documents", response_model=DocumentOut, status_code=201)
async def upload_document(engagement_id: str, file: UploadFile = File(...), db: Session = Depends(get_db),
                          current: CurrentUser = Depends(require_writer)):
    eng = get_engagement_or_404(db, current, engagement_id)
    settings = get_settings()
    limit = int(settings.max_direct_upload_mb * 1024 * 1024)
    try:
        classify(file.filename or "")
    except UnsupportedFileError as exc:
        raise HTTPException(status_code=415, detail=str(exc)) from exc
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(status_code=413, detail=f"Files larger than {settings.max_direct_upload_mb:g} MB "
                                                    "must be uploaded through Vercel Blob")
    return _ingest_file(db, current, eng, file.filename or "upload", data, "direct")


@router.post("/documents/from-blob", response_model=DocumentOut, status_code=201)
def ingest_blob(engagement_id: str, body: BlobIngest, db: Session = Depends(get_db),
                current: CurrentUser = Depends(require_writer)):
    eng = get_engagement_or_404(db, current, engagement_id)
    settings = get_settings()
    try:
        classify(body.filename)
        data = fetch_blob(body.url, settings.blob_host_suffixes, int(settings.max_blob_upload_mb * 1024 * 1024))
    except UnsupportedFileError as exc:
        raise HTTPException(status_code=415, detail=str(exc)) from exc
    except BlobFetchError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _ingest_file(db, current, eng, body.filename, data, "blob")


@router.post("/interviews", response_model=DocumentOut, status_code=201)
def add_interview(engagement_id: str, body: InterviewIn, db: Session = Depends(get_db),
                  current: CurrentUser = Depends(require_writer)):
    eng = get_engagement_or_404(db, current, engagement_id)
    doc = Document(org_id=eng.org_id, engagement_id=eng.id, kind="interview", title=body.title.strip(),
                   interviewee_role=body.interviewee_role.strip() or None, interview_date=body.interview_date,
                   content_type="text/markdown", size_bytes=len(body.notes.encode()), created_by=current.id)
    _store_document(db, current, eng, doc, body.notes)
    audit(db, current, "evidence.interview.create", "document", doc.id, eng.id,
          {"title": doc.title, "interviewee_role": doc.interviewee_role, "redactions": doc.redactions})
    db.commit()
    count = db.scalar(select(func.count()).select_from(Chunk).where(Chunk.document_id == doc.id)) or 0
    return _to_out(doc, count)


@router.put("/interviews/{document_id}", response_model=DocumentOut)
def update_interview(engagement_id: str, document_id: str, body: InterviewIn, db: Session = Depends(get_db),
                     current: CurrentUser = Depends(require_writer)):
    eng = get_engagement_or_404(db, current, engagement_id)
    doc = db.scalar(select(Document).where(Document.id == document_id, Document.engagement_id == eng.id,
                                           Document.kind == "interview"))
    if doc is None:
        raise HTTPException(status_code=404, detail="Interview not found")
    doc.chunks.clear()
    db.flush()
    doc.title = body.title.strip()
    doc.interviewee_role = body.interviewee_role.strip() or None
    doc.interview_date = body.interview_date
    doc.size_bytes = len(body.notes.encode())
    _store_document(db, current, eng, doc, body.notes)
    audit(db, current, "evidence.interview.update", "document", doc.id, eng.id,
          {"title": doc.title, "redactions": doc.redactions})
    db.commit()
    count = db.scalar(select(func.count()).select_from(Chunk).where(Chunk.document_id == doc.id)) or 0
    return _to_out(doc, count)


@router.get("/documents/{document_id}")
def get_document(engagement_id: str, document_id: str, db: Session = Depends(get_db),
                 current: CurrentUser = Depends(get_current_user)):
    eng = get_engagement_or_404(db, current, engagement_id)
    doc = db.scalar(select(Document).where(Document.id == document_id, Document.engagement_id == eng.id))
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return {
        **_to_out(doc, len(doc.chunks)).model_dump(mode="json"),
        "text": doc.text,
        "chunks": [{"id": c.id, "ordinal": c.ordinal, "heading": c.heading, "text": c.text} for c in doc.chunks],
    }


@router.delete("/documents/{document_id}", status_code=204)
def delete_document(engagement_id: str, document_id: str, db: Session = Depends(get_db),
                    current: CurrentUser = Depends(require_writer)):
    eng = get_engagement_or_404(db, current, engagement_id)
    doc = db.scalar(select(Document).where(Document.id == document_id, Document.engagement_id == eng.id))
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")
    audit(db, current, "evidence.delete", "document", doc.id, eng.id, {"title": doc.title, "kind": doc.kind})
    db.delete(doc)
    db.commit()
    return Response(status_code=204)


@router.get("/search")
def search(engagement_id: str, q: str = Query(min_length=1, max_length=200), db: Session = Depends(get_db),
           current: CurrentUser = Depends(get_current_user)):
    eng = get_engagement_or_404(db, current, engagement_id)
    return search_chunks(db, current.org_id, eng.id, q)
