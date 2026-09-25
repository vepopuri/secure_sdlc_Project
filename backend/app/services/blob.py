"""Fetch files uploaded through Vercel Blob client uploads - SSRF-safe."""

from __future__ import annotations

from urllib.parse import urlsplit

import httpx


class BlobFetchError(ValueError):
    pass


def validate_blob_url(url: str, allowed_suffixes: list[str]) -> str:
    try:
        parts = urlsplit(url)
    except ValueError as exc:
        raise BlobFetchError("Malformed URL") from exc
    if parts.scheme != "https":
        raise BlobFetchError("Only https Blob URLs are allowed")
    if parts.username or parts.password:
        raise BlobFetchError("Credentials in URL are not allowed")
    if parts.port not in (None, 443):
        raise BlobFetchError("Non-standard ports are not allowed")
    host = (parts.hostname or "").lower().rstrip(".")
    if not host:
        raise BlobFetchError("URL has no host")
    for suffix in allowed_suffixes:
        suffix = suffix.lower()
        if suffix.startswith("."):
            if host.endswith(suffix) and len(host) > len(suffix):
                return url
        elif host == suffix:
            return url
    raise BlobFetchError("Blob host is not on the allow-list")


def fetch_blob(url: str, allowed_suffixes: list[str], max_bytes: int, client: httpx.Client | None = None) -> bytes:
    validate_blob_url(url, allowed_suffixes)
    own = client is None
    client = client or httpx.Client(timeout=httpx.Timeout(30.0, connect=10.0), follow_redirects=False)
    try:
        with client.stream("GET", url) as resp:
            if resp.status_code != 200:
                raise BlobFetchError(f"Blob fetch failed with HTTP {resp.status_code}")
            declared = resp.headers.get("content-length")
            if declared and declared.isdigit() and int(declared) > max_bytes:
                raise BlobFetchError("File exceeds the maximum upload size")
            buf = bytearray()
            for part in resp.iter_bytes():
                buf.extend(part)
                if len(buf) > max_bytes:
                    raise BlobFetchError("File exceeds the maximum upload size")
            return bytes(buf)
    except httpx.HTTPError as exc:
        raise BlobFetchError("Could not download the uploaded file") from exc
    finally:
        if own:
            client.close()
