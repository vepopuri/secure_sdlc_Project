"""Split heading-annotated text into chunks that keep their heading path for citation."""

from __future__ import annotations

import re
from dataclasses import dataclass

TARGET_CHARS = 1200
MAX_CHARS = 1800

_HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")
_SENTENCE_RE = re.compile(r"(?<=[.!?])\s+")


@dataclass
class TextChunk:
    heading: str
    text: str


def _split_long(paragraph: str) -> list[str]:
    if len(paragraph) <= MAX_CHARS:
        return [paragraph]
    pieces: list[str] = []
    buf = ""
    for sentence in _SENTENCE_RE.split(paragraph):
        while len(sentence) > MAX_CHARS:  # no sentence boundary: hard split on whitespace
            cut = sentence.rfind(" ", 0, MAX_CHARS)
            cut = cut if cut > MAX_CHARS // 2 else MAX_CHARS
            pieces.append(sentence[:cut].strip())
            sentence = sentence[cut:].strip()
        if buf and len(buf) + len(sentence) + 1 > TARGET_CHARS:
            pieces.append(buf)
            buf = sentence
        else:
            buf = f"{buf} {sentence}".strip()
    if buf:
        pieces.append(buf)
    return pieces


def chunk_text(text: str, default_heading: str = "") -> list[TextChunk]:
    path: list[tuple[int, str]] = []
    chunks: list[TextChunk] = []
    buf: list[str] = []

    def heading() -> str:
        return " > ".join(h for _, h in path) or default_heading

    def flush() -> None:
        if buf:
            body = "\n\n".join(buf).strip()
            if body:
                chunks.append(TextChunk(heading=heading()[:500], text=body))
            buf.clear()

    paragraphs = re.split(r"\n\s*\n", text)
    for para in paragraphs:
        lines = para.strip("\n").split("\n")
        rest: list[str] = []
        for line in lines:
            m = _HEADING_RE.match(line.strip())
            if m:
                if rest:
                    buf.append("\n".join(rest).strip())
                    rest = []
                flush()
                level = len(m.group(1))
                path = [(lvl, h) for lvl, h in path if lvl < level]
                path.append((level, m.group(2).strip()))
            else:
                rest.append(line)
        para_text = "\n".join(rest).strip()
        if not para_text:
            continue
        for piece in _split_long(para_text):
            current = sum(len(b) for b in buf)
            if buf and current + len(piece) > TARGET_CHARS:
                flush()
            buf.append(piece)
    flush()
    return chunks
