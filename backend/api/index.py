"""Vercel Python function entrypoint: exposes the FastAPI ASGI app.

vercel.json rewrites every path to this function, so the app answers at "/" and "/api/*".
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.main import app  # noqa: E402

__all__ = ["app"]
