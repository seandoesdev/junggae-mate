"""문서 유형별 청킹. 의미 단위(조문·절·FAQ)를 끊지 않고 원문 위치(location)를 보존한다.

토큰 수는 한국어 기준 대략 글자수/2로 근사한다.
"""
import re
from dataclasses import dataclass

ARTICLE = re.compile(r"^(제\s*\d+\s*조(?:의\s*\d+)?(?:\s*\([^)]*\))?)", re.M)
HEADING = re.compile(r"^#{1,3}\s+(.+)$", re.M)
FAQ_Q = re.compile(r"^(?:Q[.:]|질문[.:]?)\s*", re.M)

# 유형별 (최대 토큰, 겹침 비율)
LIMITS = {"law": (700, 0.0), "policy": (1000, 0.12), "office": (800, 0.0), "news": (400, 0.0)}


@dataclass
class Chunk:
    location: str
    text: str


def _tokens(text: str) -> int:
    return max(1, len(text) // 2)


def _split_long(text: str, max_tokens: int, overlap: float) -> list[str]:
    if _tokens(text) <= max_tokens:
        return [text]
    sentences = re.split(r"(?<=[.다요])\s+", text)
    parts, cur = [], ""
    for s in sentences:
        if cur and _tokens(cur + " " + s) > max_tokens:
            parts.append(cur.strip())
            tail = cur[-int(len(cur) * overlap):] if overlap else ""
            cur = tail + " " + s
        else:
            cur = f"{cur} {s}" if cur else s
    if cur.strip():
        parts.append(cur.strip())
    return parts


def _sections(text: str, pattern: re.Pattern, default_label: str) -> list[tuple[str, str]]:
    matches = list(pattern.finditer(text))
    if not matches:
        return [(default_label, text.strip())]
    out = []
    if text[: matches[0].start()].strip():
        out.append(("서문", text[: matches[0].start()].strip()))
    for i, m in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        label = m.group(1).strip()
        body = text[m.start():end].strip()
        if pattern is HEADING:
            body = body.split("\n", 1)[1].strip() if "\n" in body else ""
            body = f"[{label}] {body}"
        out.append((label, body))
    return [(label, body) for label, body in out if body]


def chunk_document(text: str, source_type: str, page_of: dict[int, int] | None = None) -> list[Chunk]:
    max_tokens, overlap = LIMITS.get(source_type, (800, 0.0))
    if source_type == "law":
        sections = _sections(text, ARTICLE, "본문")
    elif FAQ_Q.search(text) and source_type == "policy":
        blocks = [b.strip() for b in FAQ_Q.split(text) if b.strip()]
        sections = [(f"FAQ {i + 1}", "Q. " + b) for i, b in enumerate(blocks)]
        overlap = 0.0
    else:
        sections = _sections(text, HEADING, "본문")

    chunks: list[Chunk] = []
    for label, body in sections:
        parts = _split_long(body, max_tokens, overlap)
        for j, part in enumerate(parts):
            loc = label if len(parts) == 1 else f"{label} ({j + 1}/{len(parts)})"
            chunks.append(Chunk(location=loc, text=part))
    return chunks


def pages_to_text(pages: list[str]) -> str:
    """PDF 페이지 목록을 하나의 텍스트로 합치면서 쪽 표시를 남긴다."""
    return "\n".join(f"# {i + 1}쪽\n{p.strip()}" for i, p in enumerate(pages) if p.strip())
