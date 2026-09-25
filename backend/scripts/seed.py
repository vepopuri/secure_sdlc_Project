"""Seed (or refresh) the framework catalogue from backend/frameworks/*.yaml.

Usage:  DATABASE_URL=... python -m scripts.seed
"""

from __future__ import annotations

from app.db import get_db
from app.services.frameworks import seed_frameworks


def main() -> None:
    gen = get_db()
    db = next(gen)
    try:
        result = seed_frameworks(db)
        print(f"Seeded {result['frameworks']} frameworks and {result['capabilities']} capabilities")
    finally:
        gen.close()


if __name__ == "__main__":
    main()
