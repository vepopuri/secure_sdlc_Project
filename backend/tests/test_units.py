"""Unit tests: config, redaction, parsing, chunking, framework data, blob URL allow-list."""

from __future__ import annotations

import io
import zipfile

import httpx
import pytest
from samples import SAMPLES

from app.config import normalize_database_url
from app.services.blob import BlobFetchError, fetch_blob, validate_blob_url
from app.services.chunking import MAX_CHARS, chunk_text
from app.services.frameworks import (
    FrameworkDataError,
    load_capabilities_file,
    load_framework_files,
    parse_framework,
)
from app.services.parsing import UnsupportedFileError, parse_file, safe_filename
from app.services.redaction import EMAIL_TOKEN, PHONE_TOKEN, redact


@pytest.mark.parametrize(
    "url,expected",
    [
        ("postgres://u:p@h/db", "postgresql+psycopg://u:p@h/db"),
        ("postgresql://u:p@h/db?sslmode=require", "postgresql+psycopg://u:p@h/db?sslmode=require"),
        ("postgresql+psycopg2://u@h/db", "postgresql+psycopg://u@h/db"),
        ("postgresql+psycopg://u@h/db", "postgresql+psycopg://u@h/db"),
        ("sqlite:///./x.db", "sqlite:///./x.db"),
    ],
)
def test_normalize_database_url(url, expected):
    assert normalize_database_url(url) == expected


@pytest.mark.parametrize(
    "text,expected",
    [
        ("Email jane.doe@acme.co.uk today", f"Email {EMAIL_TOKEN} today"),
        ("Call +1 (555) 123-4567.", f"Call {PHONE_TOKEN}."),
        ("Call 555-123-4567 now", f"Call {PHONE_TOKEN} now"),
        ("UK 020 7946 0958", f"UK {PHONE_TOKEN}"),
        ("Intl +44 20 7946 0958", f"Intl {PHONE_TOKEN}"),
        ("Compact +15551234567", f"Compact {PHONE_TOKEN}"),
    ],
)
def test_redaction_positive(text, expected):
    assert redact(text)[0] == expected


@pytest.mark.parametrize(
    "text",
    [
        "Server 192.168.100.200 on 2024-01-15",
        "Version 1.2.3.4 and CVE-2024-12345",
        "NIST SP 800-218 and ISO 27001:2022",
        "Ports 8080 8443",
        "Scores 10 20 30 40",
        "Ticket SEC-1234-5678",
    ],
)
def test_redaction_negative(text):
    assert redact(text) == (text, 0)


@pytest.mark.parametrize("name", sorted(SAMPLES))
def test_parse_every_supported_type(name):
    data, expected = SAMPLES[name]
    parsed = parse_file(name, data)
    assert expected in parsed.text


def test_parse_rejects_disallowed_extension():
    with pytest.raises(UnsupportedFileError):
        parse_file("malware.exe", b"MZ....")


def test_parse_rejects_mismatched_content():
    with pytest.raises(UnsupportedFileError):
        parse_file("fake.pdf", b"not a pdf")
    with pytest.raises(UnsupportedFileError):
        parse_file("fake.docx", b"not a zip")
    with pytest.raises(UnsupportedFileError):
        parse_file("binary.txt", b"\x00\x01\x02binary")


def test_parse_rejects_zip_bomb(monkeypatch):
    import app.services.parsing as parsing

    monkeypatch.setattr(parsing, "MAX_ZIP_UNCOMPRESSED", 1000)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("word/document.xml", "A" * 10_000)
    with pytest.raises(UnsupportedFileError):
        parse_file("bomb.docx", buf.getvalue())


def test_safe_filename():
    assert safe_filename("../../etc/passwd") == "passwd"
    assert safe_filename("C:\\evil\\report<script>.pdf") == "report_script_.pdf"


def test_chunking_keeps_heading_path_and_bounds_size():
    text = "# Policy\n\nIntro.\n\n## Tools\n\n" + ("Sentence about SAST tooling. " * 200) + "\n\n## Other\n\nEnd."
    chunks = chunk_text(text)
    assert chunks[0].heading == "Policy"
    assert any(c.heading == "Policy > Tools" for c in chunks)
    assert chunks[-1].heading == "Policy > Other"
    assert all(len(c.text) <= MAX_CHARS * 2 for c in chunks)
    assert sum(1 for c in chunks if c.heading == "Policy > Tools") > 1


def test_chunking_default_heading():
    assert chunk_text("just text", default_heading="Doc")[0].heading == "Doc"


def test_framework_files_are_valid():
    caps = load_capabilities_file()
    keys = {c["key"] for c in caps}
    assert 28 <= len(keys) <= 34
    for c in caps:
        assert c["keywords"] and c["recommendation"] and c["name"]
    frameworks = {f["key"]: parse_framework(f, keys) for f in load_framework_files()}
    assert set(frameworks) == {"nist_csf", "samm", "nist_ssdf", "bsimm", "owasp_asvs", "slsa", "iso_27034"}
    for fw in frameworks.values():
        assert len(fw.domains) >= 3, fw.key  # radar charts need three axes
        for p in fw.practices:
            assert p.capabilities and p.levels, (fw.key, p.id)
    assert len(frameworks["samm"].practices) == 15
    assert len(frameworks["nist_csf"].practices) == 22
    assert len(frameworks["owasp_asvs"].practices) == 17
    assert len(frameworks["bsimm"].practices) == 12
    assert frameworks["iso_27034"].raw.get("copyright_restricted") is True
    # every capability is used by at least one framework, so projection covers the taxonomy
    used = {c for fw in frameworks.values() for p in fw.practices for c in p.capabilities}
    assert used == keys


def test_framework_rejects_unknown_capability():
    data = load_framework_files()[0]
    data["domains"][0]["practices"][0]["capabilities"] = {"nope": 1}
    with pytest.raises(FrameworkDataError):
        parse_framework(data, {c["key"] for c in load_capabilities_file()})


ALLOWED = [".public.blob.vercel-storage.com"]


@pytest.mark.parametrize(
    "url",
    [
        "http://abc.public.blob.vercel-storage.com/x.pdf",
        "https://evil.com/x.pdf",
        "https://public.blob.vercel-storage.com.evil.com/x",
        "https://169.254.169.254/latest/meta-data",
        "https://user:pw@abc.public.blob.vercel-storage.com/x",
        "https://abc.public.blob.vercel-storage.com:8443/x",
        "https://public.blob.vercel-storage.com/x",
        "file:///etc/passwd",
    ],
)
def test_blob_url_rejected(url):
    with pytest.raises(BlobFetchError):
        validate_blob_url(url, ALLOWED)


def test_blob_fetch_ok_and_size_limit():
    url = "https://abc123.public.blob.vercel-storage.com/evidence-xyz.md"
    transport = httpx.MockTransport(lambda req: httpx.Response(200, content=b"# hello"))
    with httpx.Client(transport=transport) as c:
        assert fetch_blob(url, ALLOWED, 1000, client=c) == b"# hello"
    with httpx.Client(transport=transport) as c, pytest.raises(BlobFetchError):
        fetch_blob(url, ALLOWED, 3, client=c)


def test_blob_fetch_does_not_follow_redirects():
    url = "https://abc123.public.blob.vercel-storage.com/x.md"
    transport = httpx.MockTransport(
        lambda req: httpx.Response(302, headers={"location": "http://169.254.169.254/"})
    )
    with httpx.Client(transport=transport, follow_redirects=False) as c, pytest.raises(BlobFetchError):
        fetch_blob(url, ALLOWED, 1000, client=c)
