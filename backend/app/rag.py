"""문서 근거 경로(경로 B): 수집 → 청킹 → 임베딩 → 권한 필터 → 하이브리드 검색 → 재정렬 → 근거 게이트."""
import hashlib
from datetime import date
from typing import Any

from .chunking import chunk_document
from .config import settings
from .db import Jsonb, vec_literal
from .embedding import EMBED_MODEL, embed

AUTHORITY = {"law": 1, "policy": 2, "office": 3, "news": 4}
TYPE_LABEL = {"law": "법령", "policy": "정책", "office": "사무소", "news": "기사", "data": "데이터"}
POLICY_KEYWORDS = ("정책", "지원", "대출", "규제", "세금", "취득세", "법", "시행", "적용", "요건", "대상", "신고", "의무")


# ---------- 수집 ----------

def ingest_document(conn, *, tenant_id: int | None, source_type: str, title: str, publisher: str,
                    published_at: date | str, text: str, effective_date: date | str | None = None,
                    region: str | None = None, url: str | None = None, license: str | None = None,
                    facts: dict | None = None, raw: bytes | None = None, ext: str = "txt") -> tuple[int, bool]:
    """문서를 저장하고 청크를 인덱싱한다. 같은 내용이 이미 있으면 (기존 id, False)."""
    if source_type not in AUTHORITY:
        raise ValueError(f"지원하지 않는 문서 유형: {source_type}")
    content_hash = hashlib.sha256(text.encode()).hexdigest()
    existing = conn.execute(
        "SELECT id FROM documents WHERE content_hash = %s AND COALESCE(tenant_id, 0) = %s",
        (content_hash, tenant_id or 0),
    ).fetchone()
    if existing:
        return existing["id"], False

    raw_path = None
    try:
        folder = settings.raw_dir / (str(tenant_id) if tenant_id else "public")
        folder.mkdir(parents=True, exist_ok=True)
        raw_file = folder / f"{content_hash}.{ext}"
        raw_file.write_bytes(raw if raw is not None else text.encode())
        raw_path = str(raw_file)
    except OSError:
        raw_path = None  # 원문 보관 실패는 인덱싱을 막지 않는다 (작업 상세에 남김)

    doc = conn.execute(
        """INSERT INTO documents (tenant_id, source_type, title, publisher, url, published_at, effective_date,
                                  region, license, facts, content_hash, raw_path, embed_model)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
        (tenant_id, source_type, title, publisher, url, published_at, effective_date, region, license,
         Jsonb(facts or {}), content_hash, raw_path, EMBED_MODEL),
    ).fetchone()
    for i, chunk in enumerate(chunk_document(text, source_type)):
        conn.execute(
            """INSERT INTO chunks (document_id, tenant_id, ord, location, text, embedding)
               VALUES (%s,%s,%s,%s,%s,%s::vector)""",
            (doc["id"], tenant_id, i, chunk.location, chunk.text, vec_literal(embed(f"{title} {chunk.text}"))),
        )
    return doc["id"], True


# ---------- 검색 ----------

_SEARCH_SQL = """
SELECT c.id, c.document_id, c.location, c.text, d.title, d.publisher, d.source_type, d.published_at,
       d.effective_date, d.region, d.url, d.facts,
       1 - (c.embedding <=> %(qv)s::vector) AS vscore,
       word_similarity(%(qt)s, c.text) AS kscore
FROM chunks c JOIN documents d ON d.id = c.document_id
WHERE (c.tenant_id IS NULL OR c.tenant_id = %(tenant)s)          -- 검색 전에 tenant ACL 적용
  AND (d.region IS NULL OR d.region = '전국' OR %(region)s::text IS NULL OR %(region)s::text LIKE d.region || '%%')
  AND d.published_at <= %(as_of)s
ORDER BY 0.6 * (1 - (c.embedding <=> %(qv)s::vector)) + 0.4 * word_similarity(%(qt)s, c.text) DESC
LIMIT 30
"""


def search(conn, tenant_id: int, query: str, *, region: str | None = None, as_of: date | None = None,
           k: int = 6) -> list[dict]:
    rows = conn.execute(_SEARCH_SQL, {
        "qv": vec_literal(embed(query)), "qt": query, "tenant": tenant_id,
        "region": region, "as_of": as_of or date.today(),
    }).fetchall()
    hits = []
    for r in rows:
        score = 0.6 * float(r["vscore"]) + 0.4 * float(r["kscore"])
        if score < settings.min_evidence_score:
            continue
        # 재정렬: 관련도 + 권위(법령 > 정책 > 사무소 > 뉴스) 소폭 가산
        r["score"] = round(score + (4 - AUTHORITY[r["source_type"]]) * 0.02, 4)
        hits.append(r)
    hits.sort(key=lambda h: h["score"], reverse=True)
    # 같은 문서 조각이 결과를 독점하지 않도록 문서당 최대 2개
    per_doc: dict[int, int] = {}
    out = []
    for h in hits:
        if per_doc.get(h["document_id"], 0) >= 2:
            continue
        per_doc[h["document_id"]] = per_doc.get(h["document_id"], 0) + 1
        out.append(h)
        if len(out) >= k:
            break
    return out


def to_evidence(hit: dict) -> dict[str, Any]:
    """문서 조각 → 화면에 보여 줄 출처 하나 (docs/API.md evidence)."""
    st = hit["source_type"]
    return {
        "id": f"c{hit['id']}",
        "kind": "chunk",
        "type": st,
        "type_label": TYPE_LABEL[st],
        "title": hit["title"],
        "org": hit["publisher"],
        "date": str(hit["published_at"]),
        "effective_date": str(hit["effective_date"]) if hit.get("effective_date") else None,
        "location": hit["location"],
        "snippet": hit["text"],
        "url": hit.get("url"),
        "document_id": hit["document_id"],
        "score": hit.get("score"),
        "state": "warning" if st == "news" else "ok",
        "note": "기사는 시장 상황을 설명하는 보조 자료입니다. 정책 적용 여부의 근거로 쓰지 않습니다." if st == "news" else None,
    }


# ---------- 근거 게이트 ----------

def is_policy_question(text: str) -> bool:
    return any(k in text for k in POLICY_KEYWORDS)


def evidence_gate(hits: list[dict], *, as_of: date, policy_question: bool) -> dict:
    """검색 결과의 충분성·충돌·시점을 판정한다.

    반환: {status, messages, evidence, findings}
      findings: 초안에 결정론적으로 들어갈 항목 [{kind: conflict|not_effective|insufficient|news_only, ...}]
    """
    evidence = {f"c{h['id']}": to_evidence(h) for h in hits}
    messages: list[str] = []
    findings: list[dict] = []
    status = "ok"

    official = [h for h in hits if AUTHORITY[h["source_type"]] <= 2]
    if not hits:
        status = "insufficient"
        messages.append("질문과 관련된 근거 문서를 찾지 못했습니다. 답변은 확인 불가로 남깁니다.")
        findings.append({"kind": "insufficient", "citations": []})
    elif policy_question and not official:
        status = "insufficient"
        messages.append("법령·공식 정책 원문 근거가 없습니다. 뉴스나 사무소 문서만으로 정책 적용 여부를 단정하지 않습니다.")
        findings.append({"kind": "insufficient", "citations": []})

    # 같은 사실 키에 서로 다른 값이 있으면 충돌. 권위가 높은 자료를 기준값으로 삼는다.
    by_key: dict[str, list[tuple[dict, dict]]] = {}
    for h in hits:
        for key, fact in (h.get("facts") or {}).items():
            by_key.setdefault(key, []).append((h, fact))
    for key, items in by_key.items():
        values = {str(f["value"]) for _, f in items}
        if len(values) < 2:
            continue
        items.sort(key=lambda it: AUTHORITY[it[0]["source_type"]])
        ref_hit, ref_fact = items[0]
        for h, fact in items[1:]:
            if str(fact["value"]) == str(ref_fact["value"]):
                continue
            status = "conflict" if status == "ok" else status
            evidence[f"c{h['id']}"].update(state="conflict",
                                           note=f"{ref_fact.get('label', key)}이(가) 공식 자료({ref_fact['value']})와 다르게 적혀 있습니다 ({fact['value']}).")
            label = ref_fact.get("label", key)
            messages.append(
                f"자료 간 불일치 · {label}: {ref_hit['title']}({TYPE_LABEL[ref_hit['source_type']]})는 {ref_fact['value']}, "
                f"{h['title']}({TYPE_LABEL[h['source_type']]})는 {fact['value']}. 공식 자료를 우선 인용합니다."
            )
            findings.append({"kind": "conflict", "label": label, "ref_value": ref_fact["value"], "ref_title": ref_hit["title"],
                             "other_value": fact["value"], "other_title": h["title"],
                             "citations": [f"c{ref_hit['id']}", f"c{h['id']}"]})

    # 시행 전 자료: 같은 시행일끼리 묶어 확인 불가 항목 하나로 만든다
    pending: dict[date, list[dict]] = {}
    for h in official:
        eff = h.get("effective_date")
        if eff and eff > as_of:
            pending.setdefault(eff, []).append(h)
    for eff, group in sorted(pending.items()):
        seen_docs, cites, titles = set(), [], []
        for h in group:
            evidence[f"c{h['id']}"].update(state="warning", note=f"{eff} 시행 예정. 기준일({as_of}) 현재 시행 전입니다.")
            if h["document_id"] not in seen_docs:
                seen_docs.add(h["document_id"])
                cites.append(f"c{h['id']}")
                titles.append(h["title"])
        title = titles[0] + (f" 외 {len(titles) - 1}건" if len(titles) > 1 else "")
        messages.append(f"{title}의 시행일({eff})이 기준일({as_of}) 이후입니다. 현재 적용 여부는 확인 불가입니다.")
        findings.append({"kind": "not_effective", "title": title, "effective_date": str(eff), "citations": cites})

    return {"status": status, "messages": messages, "evidence": evidence, "findings": findings}
