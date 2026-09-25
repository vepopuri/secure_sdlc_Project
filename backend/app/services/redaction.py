"""Redact e-mail addresses and phone numbers from evidence text."""

from __future__ import annotations

import re

EMAIL_TOKEN = "[REDACTED EMAIL]"  # noqa: S105
PHONE_TOKEN = "[REDACTED PHONE]"  # noqa: S105

_EMAIL_RE = re.compile(
    r"(?<![\w.+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![\w-])"
)

# Grouped numbers: +1 (555) 123-4567, 555-123-4567, 020 7946 0958, +44 20 7946 0958
_PHONE_GROUPED_RE = re.compile(
    r"(?<![\w.\-/:])"
    r"(?:\+\d{1,3}[\s.\-]?)?"
    r"(?:\(\d{1,4}\)[\s.\-]?)?"
    r"\d{2,4}(?:[\s.\-]\d{2,4}){1,4}"
    r"(?![\w\-/:]|\.\d)"
)
# International contiguous: +15551234567
_PHONE_PLUS_RE = re.compile(r"(?<![\w+])\+\d{10,14}(?!\d)")
_IPV4_RE = re.compile(r"^\d{1,3}(?:\.\d{1,3}){3}$")
_DATE_RE = re.compile(r"^\d{4}[-./]\d{1,2}[-./]\d{1,2}$|^\d{1,2}[-./]\d{1,2}[-./]\d{2,4}$")


def _is_phone(candidate: str) -> bool:
    stripped = candidate.strip()
    digits = re.sub(r"\D", "", stripped)
    if not 9 <= len(digits) <= 15:
        return False
    if _IPV4_RE.match(stripped) or _DATE_RE.match(stripped):
        return False
    # Pure dotted sequences (version numbers, section refs) are not phone numbers.
    if "." in stripped and not re.search(r"[\s\-()+]", stripped):
        return False
    # Plain space-separated short integers ("10 20 30 40") need a leading + or parenthesis
    # or at least one hyphen / 3+ digit groups to look like a phone number.
    groups = re.findall(r"\d+", stripped)
    if not stripped.startswith(("+", "(")) and "-" not in stripped and "." not in stripped:
        if max(len(g) for g in groups) < 3:
            return False
    return True


def redact(text: str) -> tuple[str, int]:
    """Return (redacted_text, number_of_redactions)."""
    count = 0

    def _email(_: re.Match[str]) -> str:
        nonlocal count
        count += 1
        return EMAIL_TOKEN

    text = _EMAIL_RE.sub(_email, text)

    def _phone(m: re.Match[str]) -> str:
        nonlocal count
        if _is_phone(m.group(0)):
            count += 1
            return PHONE_TOKEN
        return m.group(0)

    text = _PHONE_PLUS_RE.sub(_phone, text)
    text = _PHONE_GROUPED_RE.sub(_phone, text)
    return text, count
