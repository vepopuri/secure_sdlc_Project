"""Full-text search on evidence chunks (Postgres only).

Adds a generated tsvector column and a GIN index. SQLite (local development) falls back to
LIKE matching in app/services/search.py.

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-25
"""
from __future__ import annotations

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.execute(
        "ALTER TABLE chunks ADD COLUMN tsv tsvector GENERATED ALWAYS AS "
        "(setweight(to_tsvector('english', coalesce(heading, '')), 'A') || "
        "setweight(to_tsvector('english', coalesce(text, '')), 'B')) STORED"
    )
    op.execute("CREATE INDEX ix_chunks_tsv ON chunks USING GIN (tsv)")


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.execute("DROP INDEX IF EXISTS ix_chunks_tsv")
    op.execute("ALTER TABLE chunks DROP COLUMN IF EXISTS tsv")
