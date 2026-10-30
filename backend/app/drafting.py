"""업무 로직: 구조화 비교(경로 A) + 문서 근거(경로 B) + 상담 문맥 → 근거가 연결된 AI 초안."""
import re
import statistics
from datetime import date, timedelta
from typing import Any

from . import llm, rag
from .audit import record
from .db import Jsonb

CITY = "서울"  # MVP: 서울 소재 사무소 기준. 지역 필터는 "서울 {구}" 형태로 문서 region과 맞춘다.


class DomainError(ValueError):
    def __init__(self, message: str, status: int = 422):
        super().__init__(message)
        self.status = status


def eok(price: int | None) -> str:
    if price is None:
        return "-"
    v = price / 10000
    return f"{v:.2f}".rstrip("0").rstrip(".") + "억"


def region_of(district: str | None) -> str | None:
    return f"{CITY} {district}" if district else None


# ---------- 매물 (구조화 사실) ----------

_LISTING_COLS = """l.id, l.label, l.title, l.complex_name, l.address, l.district, l.price, l.area_m2::float AS area_m2,
                   l.floor, l.station, l.station_walk_min, l.park_walk_min, l.lat, l.lng, l.description, l.source,
                   l.source_date, l.status, l.registered_by, u.name AS registered_by_name, l.created_at"""


def _serialize_listing(row: dict, history: list[dict], user_id: int | None) -> dict:
    out = dict(row)
    out["source_date"] = str(row["source_date"])
    out["created_at"] = row["created_at"].isoformat()
    out["mine"] = user_id is not None and row["registered_by"] == user_id
    out["price_history"] = [{"price": h["price"], "changed_at": str(h["changed_at"])} for h in history]
    return out


def fetch_listings(conn, tenant_id: int, *, ids: list[int] | None = None, district: str | None = None,
                   max_price: int | None = None, min_area: float | None = None,
                   max_station_walk: int | None = None, sort: str = "price", user_id: int | None = None,
                   mine: bool = False, include_closed: bool = False) -> list[dict]:
    where, params = ["l.tenant_id = %s"], [tenant_id]
    if not include_closed:
        where.append("l.status = 'active'")
    if ids is not None:
        where.append("l.id = ANY(%s)")
        params.append(ids)
    if mine and user_id is not None:
        where.append("l.registered_by = %s")
        params.append(user_id)
    if district:
        where.append("l.district = %s")
        params.append(district)
    if max_price is not None:
        where.append("l.price <= %s")
        params.append(max_price)
    if min_area is not None:
        where.append("l.area_m2 >= %s")
        params.append(min_area)
    if max_station_walk is not None:
        where.append("l.station_walk_min <= %s")
        params.append(max_station_walk)
    order = "l.created_at DESC, l.id DESC" if sort == "recent" else "l.price, l.id"
    rows = conn.execute(f"SELECT {_LISTING_COLS} FROM listings l LEFT JOIN users u ON u.id = l.registered_by "
                        f"WHERE {' AND '.join(where)} ORDER BY {order}", params).fetchall()
    if not rows:
        return []
    hist = conn.execute(
        "SELECT listing_id, price, changed_at FROM listing_price_history WHERE listing_id = ANY(%s) ORDER BY changed_at",
        ([r["id"] for r in rows],),
    ).fetchall()
    by_listing: dict[int, list[dict]] = {}
    for h in hist:
        by_listing.setdefault(h["listing_id"], []).append(h)
    return [_serialize_listing(r, by_listing.get(r["id"], []), user_id) for r in rows]


def next_label(conn, tenant_id: int) -> str:
    used = {r["label"] for r in conn.execute("SELECT label FROM listings WHERE tenant_id = %s", (tenant_id,))}
    for ch in "ABCDEFGHIJKLMNOPQRSTUVWXYZ":
        if ch not in used:
            return ch
    n = 27
    while f"#{n}" in used:
        n += 1
    return f"#{n}"


def condition_checks(listing: dict, cond: dict) -> list[dict]:
    checks = []
    if cond.get("budget_max"):
        ok = listing["price"] <= cond["budget_max"]
        detail = f"{eok(listing['price'])} {'≤' if ok else '>'} 예산 {eok(cond['budget_max'])}"
        checks.append({"condition": "예산", "ok": ok, "detail": detail})
    if cond.get("area_min"):
        ok = listing["area_m2"] >= float(cond["area_min"])
        checks.append({"condition": "면적", "ok": ok, "detail": f"전용 {listing['area_m2']:g}㎡ (기준 {float(cond['area_min']):g}㎡ 이상)"})
    if cond.get("district"):
        ok = listing["district"] == cond["district"]
        checks.append({"condition": "지역", "ok": ok, "detail": f"{listing['district']} (희망 {cond['district']})"})
    if cond.get("station_walk_max") and listing.get("station_walk_min") is not None:
        ok = listing["station_walk_min"] <= cond["station_walk_max"]
        checks.append({"condition": "역 도보", "ok": ok,
                       "detail": f"{listing['station']} 도보 {listing['station_walk_min']}분 (기준 {cond['station_walk_max']}분 이내)"})
    if "공원" in (cond.get("preferences") or []) and listing.get("park_walk_min") is not None:
        ok = listing["park_walk_min"] <= 10
        checks.append({"condition": "공원 선호", "ok": ok, "detail": f"공원 도보 {listing['park_walk_min']}분"})
    return checks


def trade_reference(conn, listing: dict) -> dict | None:
    """같은 단지·유사 면적의 최근 12개월 실거래가. 과거 신고 거래이며 현재 호가가 아니다."""
    since = date.fromisoformat(listing["source_date"]) - timedelta(days=365)
    rows = conn.execute(
        """SELECT price, deal_date, source, collected_at FROM apt_trades
           WHERE complex_name = %s AND abs(area_m2 - %s) <= 5 AND deal_date >= %s ORDER BY deal_date""",
        (listing["complex_name"], listing["area_m2"], since),
    ).fetchall()
    if not rows:
        return None
    return {
        "median_price": int(statistics.median(r["price"] for r in rows)),
        "count": len(rows),
        "period": f"{rows[0]['deal_date']} ~ {rows[-1]['deal_date']}",
        "source": rows[-1]["source"],
        "as_of": str(max(r["collected_at"] for r in rows).date()),
    }


def condition_warnings(conn, tenant_id: int, cond: dict) -> list[str]:
    warnings = []
    if not cond.get("budget_max"):
        warnings.append("예산 상한이 비어 있습니다. 필터 조건으로 사용할 수 없습니다.")
    if not cond.get("area_min"):
        warnings.append("최소 면적이 비어 있습니다.")
    if not cond.get("district"):
        warnings.append("희망 지역이 비어 있습니다. 근거 문서의 적용 지역을 판단할 수 없습니다.")
    prefs = cond.get("preferences") or []
    if "역세권" in prefs and (cond.get("station_walk_max") or 0) > 15:
        warnings.append(f"'역세권' 선호와 역 도보 {cond['station_walk_max']}분 조건이 서로 맞지 않습니다.")
    if cond.get("budget_max") and cond.get("district"):
        matches = fetch_listings(conn, tenant_id, district=cond["district"], max_price=cond["budget_max"],
                                 min_area=cond.get("area_min"), max_station_walk=cond.get("station_walk_max"))
        if not matches:
            warnings.append("현재 조건을 모두 만족하는 매물이 없습니다. 예산·면적·도보 조건 중 하나를 조정해 보세요.")
    return warnings


# ---------- 근거 → claim ----------

def _lead(text: str, limit: int = 170) -> str:
    text = re.sub(r"^\[[^\]]+\]\s*", "", text.strip())
    text = re.sub(r"\s+", " ", text)
    sentences = re.split(r"(?<=[.다])\s+", text)
    out = ""
    for s in sentences:
        if out and len(out) + len(s) > limit:
            break
        out = f"{out} {s}".strip()
    return out[:limit + 40]


def template_doc_claims(hits: list[dict], gate: dict, limit: int = 3) -> list[dict]:
    claims = []
    ordered = sorted(hits, key=lambda h: (rag.AUTHORITY[h["source_type"]], -h["score"]))
    for h in ordered:
        cid = f"c{h['id']}"
        ev = gate["evidence"][cid]
        if ev["state"] == "conflict" or ev["badge"] == "시행 전":
            continue
        if h["source_type"] == "news":
            claims.append({"text": f"참고(보조 자료) · {h['title']}: {_lead(h['text'], 110)} 시장 맥락 설명용이며 정책 사실의 근거가 아닙니다.",
                           "status": "warning", "citations": [cid]})
        else:
            claims.append({"text": f"{_lead(h['text'])} ({rag.TYPE_LABEL[h['source_type']]} · {h['title']} · {h['location']})",
                           "status": "verified", "citations": [cid]})
        if len(claims) >= limit:
            break
    return claims


def gate_claims(gate: dict) -> list[dict]:
    out = []
    for f in gate["findings"]:
        if f["kind"] == "insufficient":
            out.append({"text": "확인 불가: 질문에 직접 답할 수 있는 공식 근거(법령·정책 원문)를 찾지 못했습니다. 담당 기관의 최신 자료를 추가로 확인하세요.",
                        "status": "unverifiable", "citations": []})
        elif f["kind"] == "conflict":
            out.append({"text": f"자료 간 불일치: {f['label']} — {f['ref_title']}에는 {f['ref_value']}, {f['other_title']}에는 {f['other_value']}로 "
                                f"기재되어 있습니다. 공식 자료를 우선 인용하며 상담 전 다시 확인하세요.",
                        "status": "conflict", "citations": f["citations"]})
        elif f["kind"] == "not_effective":
            out.append({"text": f"현재 적용 여부는 확인 불가: {f['title']}의 시행일은 {f['effective_date']}로 기준일 이후입니다. "
                                f"시행일 이후 담당 기관에 다시 확인하세요.",
                        "status": "unverifiable", "citations": f["citations"]})
    return out


def verify_citations(claims: list[dict], evidence: dict[str, dict]) -> list[dict]:
    """주장별 인용 검증: 존재하지 않는 근거 id는 제거하고, 근거 없는 사실 주장은 확인 불가로 낮춘다."""
    out = []
    for c in claims:
        cites = [x for x in c.get("citations", []) if x in evidence]
        status = c.get("status", "verified")
        if status not in ("verified", "warning", "unverifiable", "conflict"):
            status = "warning"
        text = str(c["text"]).strip()
        if status == "verified" and not cites:
            status, text = "unverifiable", f"확인 불가(근거 미연결): {text}"
        elif status == "verified" and all(evidence[x]["source_type"] == "news" for x in cites):
            status = "warning"  # 뉴스만으로는 사실 확정 불가
        out.append({"text": text, "status": status, "citations": cites})
    return out


def doc_claims(task: str, context: str, hits: list[dict], gate: dict, *, limit: int = 3) -> tuple[list[dict], str]:
    if llm.is_enabled():
        usable = [e for e in gate["evidence"].values()]
        claims = llm.generate_claims(task, context, usable)  # LLMUnavailable은 호출자에게 전파
        return verify_citations(claims, gate["evidence"])[:6], "anthropic"
    return template_doc_claims(hits, gate, limit), "template"


# ---------- /ask ----------

def run_ask(conn, user, consultation: dict, question: str, as_of: date | None) -> int:
    as_of = as_of or date.today()
    region = region_of(consultation.get("district"))
    hits = rag.search(conn, user.tenant_id, question, region=region, as_of=as_of)
    gate = rag.evidence_gate(hits, as_of=as_of, policy_question=rag.is_policy_question(question))
    context = f"질문 기준일 {as_of}, 지역 {region or '미지정'}, 고객 조건: {_cond_summary(consultation)}"
    claims, generator = doc_claims(f"중개사 질문에 답하는 초안: {question}", context, hits, gate)
    claims = claims + gate_claims(gate)
    return save_draft(conn, user, consultation["id"], "ask", question, claims, list(gate["evidence"].values()),
                      gate, [], generator, {})


# ---------- /advise ----------

def _cond_summary(c: dict) -> str:
    """LLM에 보내는 상담 문맥. 고객 이름 등 개인 식별 정보는 넣지 않는다."""
    parts = []
    if c.get("budget_max"):
        parts.append(f"예산 {eok(c['budget_max'])} 이하")
    if c.get("area_min"):
        parts.append(f"전용 {float(c['area_min']):g}㎡ 이상")
    if c.get("district"):
        parts.append(c["district"])
    if c.get("station_walk_max"):
        parts.append(f"역 도보 {c['station_walk_max']}분 이내")
    if c.get("preferences"):
        parts.append("선호: " + ", ".join(c["preferences"]))
    return " · ".join(parts) or "조건 없음"


def _listing_evidence(l: dict) -> dict:
    snippet = (f"가격 {eok(l['price'])} · 전용 {l['area_m2']:g}㎡ · {l['station']} 도보 {l['station_walk_min']}분 · "
               f"공원 도보 {l['park_walk_min']}분 · 주소 {l['address']}")
    if len(l["price_history"]) > 1:
        snippet += " · 가격 이력 " + " → ".join(f"{eok(h['price'])}({h['changed_at']})" for h in l["price_history"])
    return {"chunk_id": f"l{l['id']}", "document_id": None, "title": f"후보 {l['label']} · {l['title']}",
            "publisher": l["source"], "source_type": "listing", "type_label": "매물 데이터", "authority": 0,
            "date": l["source_date"], "effective_date": None, "location": f"매물 #{l['id']}", "snippet": snippet,
            "url": None, "score": None, "state": "verified", "badge": "매물 데이터"}


def _trade_evidence(l: dict, ref: dict) -> dict:
    return {"chunk_id": f"t{l['id']}", "document_id": None, "title": f"{l['complex_name']} 실거래가",
            "publisher": ref["source"], "source_type": "trade", "type_label": "실거래가", "authority": 0,
            "date": ref["as_of"], "effective_date": None, "location": f"{ref['period']} · {ref['count']}건",
            "snippet": f"동일 단지·유사 면적 최근 12개월 실거래 {ref['count']}건, 중위 {eok(ref['median_price'])} ({ref['period']}). "
                       "과거 신고 거래이며 현재 판매 매물·호가·거래 가능 상태가 아닙니다.",
            "url": "https://www.data.go.kr/data/15126468/openapi.do", "score": None, "state": "verified", "badge": "실거래가"}


def pick_candidates(conn, user, consultation: dict, listing_ids: list[int] | None) -> list[dict]:
    if listing_ids:
        if not 1 <= len(listing_ids) <= 5:
            raise DomainError("비교 후보는 1~5개까지 선택할 수 있습니다.")
        found = fetch_listings(conn, user.tenant_id, ids=listing_ids)
        if len(found) != len(set(listing_ids)):
            raise DomainError("선택한 매물 중 이 사무소에서 조회할 수 없는 항목이 있습니다.", 404)
        return found
    excluded = {r["listing_id"]: r["status"] for r in conn.execute(
        "SELECT listing_id, status FROM consultation_candidates WHERE consultation_id = %s", (consultation["id"],))}
    found = fetch_listings(conn, user.tenant_id, district=consultation.get("district"),
                           max_price=consultation.get("budget_max"), min_area=consultation.get("area_min"),
                           max_station_walk=consultation.get("station_walk_max"))
    rank = {"interest": 0, "compare": 1}
    found = [l for l in found if excluded.get(l["id"]) != "excluded"]
    found.sort(key=lambda l: (rank.get(excluded.get(l["id"]), 2), l["price"]))
    if not found:
        raise DomainError("상담 조건에 맞는 후보가 없습니다. 조건을 조정하거나 후보를 직접 선택하세요.")
    return found[:3]


def run_advise(conn, user, consultation: dict, listing_ids: list[int] | None) -> int:
    as_of = date.today()
    cond = consultation
    region = region_of(cond.get("district"))
    candidates = pick_candidates(conn, user, consultation, listing_ids)
    prefs = cond.get("preferences") or []

    evidence: dict[str, dict] = {}
    claims: list[dict] = []
    checks_by_listing: dict[str, list[dict]] = {}
    for l in candidates:
        lid = f"l{l['id']}"
        evidence[lid] = _listing_evidence(l)
        checks = condition_checks(l, cond)
        checks_by_listing[str(l["id"])] = checks
        met = [c["condition"] for c in checks if c["ok"]]
        unmet = [c for c in checks if not c["ok"]]
        claims.append({"text": f"후보 {l['label']}({l['title']})는 {eok(l['price'])} · 전용 {l['area_m2']:g}㎡이며 "
                               f"{', '.join(met) if met else '확인된'} 조건을 충족합니다.",
                       "status": "verified", "citations": [lid]})
        for c in unmet:
            claims.append({"text": f"후보 {l['label']} 조건 차이 · {c['condition']}: {c['detail']}", "status": "warning", "citations": [lid]})
        if "공원" in prefs and l.get("park_walk_min") is not None and l["park_walk_min"] <= 10:
            claims.append({"text": f"후보 {l['label']}는 공원 도보 {l['park_walk_min']}분으로 고객 선호 '공원'과 연결됩니다.",
                           "status": "verified", "citations": [lid]})
        if len(l["price_history"]) > 1:
            first, last = l["price_history"][0], l["price_history"][-1]
            claims.append({"text": f"후보 {l['label']} 가격 변경: {eok(first['price'])} → {eok(last['price'])} ({last['changed_at']} 변경).",
                           "status": "verified", "citations": [lid]})
        ref = trade_reference(conn, l)
        if ref:
            tid = f"t{l['id']}"
            evidence[tid] = _trade_evidence(l, ref)
            claims.append({"text": f"후보 {l['label']} 단지의 최근 실거래 중위가는 {eok(ref['median_price'])}({ref['count']}건)입니다. "
                                   "과거 신고 거래이며 현재 호가가 아닙니다.", "status": "verified", "citations": [tid]})
        if any(p in prefs for p in ("통학", "학군")):
            school_hits = [h for h in rag.search(conn, user.tenant_id, f"{l['complex_name']} 배정 학교 통학 학군", region=region, as_of=as_of)
                           if l["complex_name"] in h["text"]]
            if school_hits:
                h = school_hits[0]
                evidence[f"c{h['id']}"] = rag.to_evidence(h)
                sentence = next((s for s in re.split(r"(?<=[.다])\s+", h["text"]) if l["complex_name"] in s), _lead(h["text"]))
                claims.append({"text": f"후보 {l['label']} 통학: {sentence.strip()}", "status": "verified", "citations": [f"c{h['id']}"]})
            else:
                claims.append({"text": f"확인 불가: 후보 {l['label']}의 학군 배정 — 현재 검색된 자료만으로는 배정 학교를 확정할 수 없습니다. "
                                       "관할 교육지원청의 최신 자료를 추가로 확인하세요.", "status": "unverifiable", "citations": []})

    unstructured = [p for p in prefs if p not in ("공원", "통학", "학군", "역세권")]
    for p in unstructured:
        claims.append({"text": f"현장 확인 필요: '{p}' 선호는 보유한 구조화 데이터로 확인할 수 없습니다.", "status": "unverifiable", "citations": []})

    # 후보 확정 후 지역 정책·확인 절차 문서 검색 (RAG는 추천 점수를 만들지 않고 이유·확인 사항만 쓴다)
    query = f"{region or ''} 아파트 매수 상담 확인 절차 주택 구입 지원 정책"
    hits = rag.search(conn, user.tenant_id, query, region=region, as_of=as_of, k=5)
    gate = rag.evidence_gate(hits, as_of=as_of, policy_question=False)
    for cid, ev in gate["evidence"].items():
        evidence[cid] = ev
    context = f"고객 조건: {_cond_summary(cond)}. 후보: " + "; ".join(
        f"{l['label']} {l['title']} {eok(l['price'])} {l['area_m2']:g}㎡" for l in candidates)
    if llm.is_enabled():
        extra = llm.generate_claims("후보별 추천 이유와 상담 전 확인 사항을 정리한 초안", context, list(evidence.values()))
        claims += verify_citations(extra, evidence)[:6]
        generator = "anthropic"
    else:
        claims += template_doc_claims(hits, gate, limit=2)
        generator = "template"
    claims += gate_claims(gate)

    merged_gate = {"status": gate["status"], "messages": gate["messages"]}
    if any(c["status"] == "unverifiable" for c in claims) and merged_gate["status"] == "ok":
        merged_gate["messages"] = merged_gate["messages"] + ["일부 항목은 근거가 부족해 확인 불가로 표시했습니다."]
    return save_draft(conn, user, consultation["id"], "advise", None, claims, list(evidence.values()),
                      merged_gate, candidates, generator, checks_by_listing)


# ---------- 초안 저장·조회 ----------

def claims_to_text(claims: list[dict]) -> str:
    return "\n".join(f"- {c['text']}" for c in claims)


def save_draft(conn, user, consultation_id: int, mode: str, question: str | None, claims: list[dict],
               evidence: list[dict], gate: dict, candidates: list[dict], generator: str,
               checks_by_listing: dict) -> int:
    gate_payload = {"status": gate["status"], "messages": gate["messages"], "checks_by_listing": checks_by_listing}
    row = conn.execute(
        """INSERT INTO drafts (tenant_id, consultation_id, mode, question, claims, evidence, gate, candidates, generator, created_by)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
        (user.tenant_id, consultation_id, mode, question, Jsonb(claims), Jsonb(evidence), Jsonb(gate_payload),
         Jsonb(candidates), generator, user.id),
    ).fetchone()
    conn.execute(
        "INSERT INTO draft_versions (draft_id, version, text, note, created_by) VALUES (%s, 1, %s, %s, %s)",
        (row["id"], claims_to_text(claims), f"AI 초안 생성 ({'LLM' if generator == 'anthropic' else '규칙 기반'})", user.id),
    )
    conn.execute("INSERT INTO consultation_logs (consultation_id, note) VALUES (%s, %s)",
                 (consultation_id, f"/{mode} 초안 #{row['id']} 생성"))
    record(conn, tenant_id=user.tenant_id, user_id=user.id, event="draft.created", entity="draft", entity_id=row["id"],
           payload={"mode": mode, "generator": generator, "gate": gate["status"],
                    "evidence": [e["chunk_id"] for e in evidence],
                    "claims": {s: sum(1 for c in claims if c["status"] == s) for s in ("verified", "warning", "conflict", "unverifiable")}})
    return row["id"]


def version_label(state: str, version: int) -> str:
    return "v1.0" if state == "approved" else f"v0.{version}"


def load_draft(conn, tenant_id: int, draft_id: int) -> dict[str, Any] | None:
    d = conn.execute(
        """SELECT d.*, a.name AS approved_by_name FROM drafts d LEFT JOIN users a ON a.id = d.approved_by
           WHERE d.id = %s AND d.tenant_id = %s""",
        (draft_id, tenant_id),
    ).fetchone()
    if not d:
        return None
    versions = conn.execute(
        """SELECT v.version, v.text, v.note, v.created_at, u.name AS by FROM draft_versions v
           LEFT JOIN users u ON u.id = v.created_by WHERE v.draft_id = %s ORDER BY v.version DESC""",
        (draft_id,),
    ).fetchall()
    history = [{"version_label": f"v0.{v['version']}", "note": v["note"], "at": v["created_at"].isoformat(), "by": v["by"]}
               for v in versions]
    if d["state"] == "approved":
        history.insert(0, {"version_label": "v1.0", "note": "최종 승인", "at": d["approved_at"].isoformat(), "by": d["approved_by_name"]})
    gate = dict(d["gate"])
    checks = gate.pop("checks_by_listing", {})
    return {
        "id": d["id"], "mode": d["mode"], "consultation_id": d["consultation_id"], "question": d["question"],
        "state": d["state"], "version": d["version"], "version_label": version_label(d["state"], d["version"]),
        "text": versions[0]["text"], "claims": d["claims"], "evidence": d["evidence"], "gate": gate,
        "checks_by_listing": checks, "generator": d["generator"], "candidates": d["candidates"],
        "approved_by": d["approved_by_name"], "approved_at": d["approved_at"].isoformat() if d["approved_at"] else None,
        "created_at": d["created_at"].isoformat(), "history": history,
    }
