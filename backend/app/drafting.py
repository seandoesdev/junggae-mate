"""매물 조회(구조화 사실)와 고객 자료 본문 작성.

고객 자료 본문은 문장 목록으로 만든다. 각 문장은 출처 id(`c12` 문서 조각, `l3` 매물, `t3` 실거래가)를 가지며,
본문 문자열에서는 "…입니다[t3]." 처럼 마침표 앞에 표시한다. 근거가 없는 내용은 본문에 넣지 않고
"추가로 확인할 사항"(to_check)으로 보낸다.
"""
import re
import statistics
from datetime import date, timedelta

from . import llm, rag

CITY = "서울"  # MVP: 서울 소재 사무소 기준. 지역 필터는 "서울 {구}" 형태로 문서 region과 맞춘다.
STAGES = ("intro", "visit", "nego", "contract", "done")
# 시드 정책 문서(생애최초 지원 안내)의 주택가격 기준. 실제 운영에서는 문서 사실(facts)로 관리한다.
FIRST_HOME_PRICE_LIMIT = 90000


class DomainError(ValueError):
    def __init__(self, message: str, status: int = 422):
        super().__init__(message)
        self.status = status


def eok(price: int | None) -> str:
    if price is None:
        return "-"
    return f"{price / 10000:.2f}".rstrip("0").rstrip(".") + "억"


def region_of(district: str | None) -> str | None:
    return f"{CITY} {district}" if district else None


# ---------- 매물 (구조화 사실) ----------

STAGE_ORDER_SQL = "array_position(ARRAY['intro','visit','nego','contract','done'], d.stage)"
_LISTING_COLS = f"""l.id, l.label, l.title, l.complex_name, l.address, l.district, l.price, l.area_m2::float AS area_m2,
    l.floor, l.station, l.station_walk_min, l.park_walk_min, l.lat, l.lng, l.description, l.source, l.source_date,
    l.status, l.agent_id, u.name AS agent_name, l.created_at,
    COALESCE((SELECT d.stage FROM deals d WHERE d.listing_id = l.id AND d.stage <> 'dropped'
              ORDER BY {STAGE_ORDER_SQL} DESC LIMIT 1), 'available') AS stage,
    (SELECT count(*) FROM deals d WHERE d.listing_id = l.id AND d.stage <> 'dropped')::int AS active_deals"""


def _serialize_listing(row: dict, history: list[dict], user_id: int | None) -> dict:
    out = dict(row)
    out["source_date"] = str(row["source_date"])
    out["created_at"] = row["created_at"].isoformat()
    out["mine"] = user_id is not None and row["agent_id"] == user_id
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
        where.append("l.agent_id = %s")
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
    rows = conn.execute(f"SELECT {_LISTING_COLS} FROM listings l LEFT JOIN users u ON u.id = l.agent_id "
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
        checks.append({"condition": "예산", "ok": ok, "detail": f"{eok(listing['price'])} (예산 {eok(cond['budget_max'])})"})
    if cond.get("area_min"):
        ok = listing["area_m2"] >= float(cond["area_min"])
        checks.append({"condition": "면적", "ok": ok, "detail": f"전용 {listing['area_m2']:g}㎡ (기준 {float(cond['area_min']):g}㎡ 이상)"})
    if cond.get("district"):
        ok = listing["district"] == cond["district"]
        checks.append({"condition": "지역", "ok": ok, "detail": listing["district"]})
    if cond.get("station_walk_max") and listing.get("station_walk_min") is not None:
        ok = listing["station_walk_min"] <= cond["station_walk_max"]
        checks.append({"condition": "역 거리", "ok": ok, "detail": f"{listing['station']} 도보 {listing['station_walk_min']}분 (기준 {cond['station_walk_max']}분)"})
    return checks


def matches(listing: dict, cond: dict) -> bool:
    return listing["stage"] != "done" and all(c["ok"] for c in condition_checks(listing, cond))


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
        warnings.append("예산 상한이 비어 있어 맞는 매물을 고를 수 없습니다.")
    if not cond.get("area_min"):
        warnings.append("최소 면적이 비어 있습니다.")
    if not cond.get("district"):
        warnings.append("희망 지역이 비어 있어 지역별 정책을 확인할 수 없습니다.")
    prefs = cond.get("preferences") or []
    if "역세권" in prefs and (cond.get("station_walk_max") or 0) > 15:
        warnings.append(f"'역세권'과 역 도보 {cond['station_walk_max']}분 조건이 서로 맞지 않습니다.")
    if cond.get("budget_max") and cond.get("district"):
        found = fetch_listings(conn, tenant_id, district=cond["district"], max_price=cond["budget_max"],
                               min_area=cond.get("area_min"), max_station_walk=cond.get("station_walk_max"))
        if not found:
            warnings.append("지금 조건을 모두 만족하는 매물이 없습니다. 예산·면적·역 거리 중 하나를 조정해 보세요.")
    return warnings


# ---------- 출처 (매물·실거래가) ----------

def listing_evidence(l: dict) -> dict:
    snippet = (f"매도 희망가 {eok(l['price'])}, 전용 {l['area_m2']:g}㎡, {l.get('floor') or '-'}, "
               f"{l['station']} 도보 {l['station_walk_min']}분, 공원 도보 {l['park_walk_min']}분. {l['address']}")
    if len(l["price_history"]) > 1:
        snippet += " 가격 이력: " + " → ".join(f"{eok(h['price'])}({h['changed_at']})" for h in l["price_history"])
    return {"id": f"l{l['id']}", "kind": "listing", "type": "data", "type_label": "매물 정보",
            "title": f"{l['label']} {l['title']} 매물 정보", "org": f"{l['source']} · 담당 {l.get('agent_name') or '-'}",
            "date": l["source_date"], "effective_date": None, "location": f"매물 {l['label']}", "snippet": snippet,
            "url": None, "document_id": None, "score": None, "state": "ok", "note": None}


def trade_evidence(l: dict, ref: dict) -> dict:
    return {"id": f"t{l['id']}", "kind": "trade", "type": "data", "type_label": "실거래가",
            "title": "아파트 매매 실거래가", "org": ref["source"], "date": ref["as_of"], "effective_date": None,
            "location": f"{l['complex_name']} 유사 면적 · {ref['period']} · {ref['count']}건",
            "snippet": f"동일 단지·유사 면적 최근 12개월 실거래 {ref['count']}건, 중위 {eok(ref['median_price'])}.",
            "url": "https://www.data.go.kr/data/15126468/openapi.do", "document_id": None, "score": None,
            "state": "ok", "note": "신고된 과거 거래 가격입니다. 현재 매도 희망가나 거래 가능 여부를 뜻하지 않습니다."}


# ---------- 본문 문장 ----------

def _lead(text: str, limit: int = 170) -> str:
    text = re.sub(r"^\[[^\]]+\]\s*", "", text.strip())
    text = re.sub(r"^Q\.\s*", "", re.sub(r"\s+", " ", text))
    out = ""
    for s in re.split(r"(?<=[.다요])\s+", text):
        if out and len(out) + len(s) > limit:
            break
        out = f"{out} {s}".strip()
    return out[:limit + 40]


def sentence_with(text: str, complex_name: str) -> str | None:
    """문서 조각에서 단지 이름이 들어간 문장 하나. 조각 앞의 [소제목] 표시는 뗀다."""
    text = re.sub(r"^\[[^\]]+\]\s*", "", text.strip())
    return next((s.strip() for s in re.split(r"(?<=[.다)])\s+", text) if complex_name in s), None)


def with_refs(text: str, cites: list[str]) -> str:
    """'…입니다.' + [t3] → '…입니다[t3].'"""
    refs = "".join(f"[{c}]" for c in dict.fromkeys(cites))
    text = text.strip()
    if not refs:
        return text
    return f"{text[:-1]}{refs}." if text.endswith(".") else f"{text}{refs}"


class Body:
    """본문(opinion) 문장, 확인할 사항, 사용한 출처를 모은다."""

    def __init__(self):
        self.opinion: list[str] = []
        self.to_check: list[str] = []
        self.evidence: dict[str, dict] = {}

    def add(self, ev: dict) -> str:
        self.evidence.setdefault(ev["id"], ev)
        return ev["id"]

    def say(self, text: str, cites: list[str]):
        self.opinion.append(with_refs(text, cites))

    def check(self, text: str, cites: list[str] | None = None):
        self.to_check.append(with_refs(text, cites or []))

    def result(self) -> dict:
        used = list(dict.fromkeys(re.findall(r"\[([clt]\d+)\]", " ".join(self.opinion + self.to_check))))
        return {"opinion": " ".join(self.opinion), "to_check": self.to_check,
                "sources": [self.evidence[i] for i in used if i in self.evidence]}


def josa(word: str, pair: str) -> str:
    """받침에 맞는 조사. pair는 '이가', '은는', '을를', '으로' 중 하나. josa('시행일', '이가') → '시행일이'"""
    last = re.sub(r"[\s'\"」』)\]]+$", "", word)[-1:] or " "
    if last.isdigit():  # 숫자는 읽는 소리 기준: 영·일·삼·육·칠·팔은 받침, 일·칠·팔은 ㄹ 받침
        batchim, rieul = last in "013678", last in "178"
    else:
        code = ord(last) - 0xAC00
        batchim = 0 <= code < 11172 and code % 28 != 0
        rieul = batchim and code % 28 == 8
    if pair == "으로":  # ㄹ 받침과 받침 없음은 '로'
        return word + ("으로" if batchim and not rieul else "로")
    return word + (pair[0] if batchim else pair[1])


def plain_title(title: str) -> str:
    """본문 문장에 넣을 문서 제목 (목록용 [샘플] 표시는 뺀다)."""
    return re.sub(r"^\[샘플\]\s*", "", title)


def apply_gate(body: Body, gate: dict):
    """근거 게이트 결과를 결정론적으로 본문·확인할 사항에 반영한다 (LLM 사용 여부와 무관)."""
    for f in gate["findings"]:
        cites = [body.add(gate["evidence"][c]) for c in f["citations"]]
        if f["kind"] == "conflict":
            body.say(f"일부 자료에는 {josa(f['label'], '이가')} {josa(str(f['other_value']), '으로')} 나와 있으나, "
                     f"공식 자료인 「{plain_title(f['ref_title'])}」 기준({f['ref_value']})으로 안내드립니다.", cites)
        elif f["kind"] == "not_effective":
            body.check(f"{f['effective_date']} 시행 이후 적용 여부 다시 확인", cites)
        elif f["kind"] == "insufficient":
            body.check("관련 공식 자료를 찾지 못했습니다. 담당 기관에 직접 확인")


def verify_citations(claims: list[dict], evidence: dict[str, dict]) -> list[dict]:
    """주장별 인용 검증: 없는 출처 id는 지우고, 출처 없는 사실 주장·기사만 근거인 주장은 확인할 사항으로 돌린다."""
    out = []
    for c in claims:
        cites = [x for x in c.get("citations", []) if x in evidence]
        status = c.get("status", "verified")
        if status == "verified" and (not cites or all(evidence[x]["type"] == "news" for x in cites)):
            status = "unverifiable"
        out.append({"text": str(c["text"]).strip(), "status": status, "citations": cites})
    return out


def llm_body(body: Body, task: str, context: str):
    """LLM이 본문을 다시 쓴다. 출처 검증 후 근거 없는 문장은 확인할 사항으로 보낸다. 실패하면 LLMUnavailable."""
    claims = verify_citations(llm.generate_claims(task, context, list(body.evidence.values())), body.evidence)
    body.opinion = []
    for c in claims[:8]:
        (body.check if c["status"] == "unverifiable" else body.say)(c["text"], c["citations"])


def cond_summary(c: dict) -> str:
    """LLM에 보내는 고객 조건. 이름·연락처 등 개인 식별 정보는 넣지 않는다."""
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
        parts.append("원하는 점: " + ", ".join(c["preferences"]))
    if c.get("first_home"):
        parts.append("생애최초 구입")
    return " · ".join(parts) or "조건 없음"


# ---------- 비교표 ----------

def compare_listings(conn, user, customer: dict, listing_ids: list[int] | None) -> list[dict]:
    if listing_ids:
        if not 1 <= len(listing_ids) <= 5:
            raise DomainError("비교할 매물은 1~5개까지 고를 수 있습니다.")
        found = fetch_listings(conn, user.tenant_id, ids=listing_ids, user_id=user.id)
        if len(found) != len(set(listing_ids)):
            raise DomainError("고른 매물 중 이 사무소에서 볼 수 없는 매물이 있습니다.", 404)
        order = {lid: i for i, lid in enumerate(listing_ids)}
        return sorted(found, key=lambda l: order[l["id"]])
    rows = conn.execute(
        f"""SELECT d.listing_id FROM deals d JOIN listings l ON l.id = d.listing_id
            WHERE d.customer_id = %s AND d.stage <> 'dropped' AND l.status = 'active'
            ORDER BY {STAGE_ORDER_SQL} DESC, d.id LIMIT 5""", (customer["id"],)).fetchall()
    if not rows:
        raise DomainError("비교할 매물이 없습니다. 지도에서 매물을 먼저 고객과 연결하세요.")
    return compare_listings(conn, user, customer, [r["listing_id"] for r in rows])


def draft_compare(conn, user, customer: dict, listing_ids: list[int] | None) -> dict:
    as_of = date.today()
    region = region_of(customer.get("district"))
    prefs = customer.get("preferences") or []
    ls = compare_listings(conn, user, customer, listing_ids)
    body = Body()
    snapshot = []
    # 1) 매물별 사실 (매물 정보·실거래가·학구도 메모)
    for l in ls:
        lid = body.add(listing_evidence(l))
        checks = condition_checks(l, customer)
        ref = trade_reference(conn, l)
        snapshot.append({**l, "checks": checks, "trade_reference": ref})
        unmet = [c["condition"] for c in checks if not c["ok"]]
        fit = "찾으시는 조건에 맞습니다." if not unmet else f"{'·'.join(unmet)} 조건과는 차이가 있습니다."
        body.say(f"{l['label']} {l['title']}는 {eok(l['price'])}, 전용 {l['area_m2']:g}㎡로 {fit}", [lid])
        body.say(f"{l['station']}까지 걸어서 {l['station_walk_min']}분입니다.", [lid])
        if "공원" in prefs and l.get("park_walk_min") is not None:
            body.say(f"공원까지 도보 {l['park_walk_min']}분{'으로 가깝습니다' if l['park_walk_min'] <= 5 else '입니다'}.", [lid])
        if len(l["price_history"]) > 1:
            first, last = l["price_history"][0], l["price_history"][-1]
            body.say(f"가격이 {eok(first['price'])}에서 {josa(eok(last['price']), '으로')} 조정되었습니다"
                     f"({last['changed_at'][5:].replace('-', '/')}).", [lid])
        if ref:
            tid = body.add(trade_evidence(l, ref))
            body.say(f"같은 단지 비슷한 면적의 최근 실거래 중위가는 {eok(ref['median_price'])}({ref['count']}건)입니다.", [tid])
        if any(p in prefs for p in ("통학", "학군")):
            hits = [h for h in rag.search(conn, user.tenant_id, f"{l['complex_name']} 배정 학교 학구도", region=region, as_of=as_of)
                    if l["complex_name"] in h["text"]]
            sent = sentence_with(hits[0]["text"], l["complex_name"]) if hits else None
            if sent:
                body.say(sent if sent.endswith(".") else sent + ".", [body.add(rag.to_evidence(hits[0]))])
            else:
                body.check(f"{l['label']} {l['title']}의 배정 학교 (교육지원청 학구도)")

    generator = "template"
    if llm.is_enabled():
        context = f"고객 조건: {cond_summary(customer)}. 매물: " + "; ".join(
            f"{l['label']} {l['title']} {eok(l['price'])} {l['area_m2']:g}㎡" for l in ls)
        llm_body(body, "고객에게 보낼 매물 비교 의견 (중개사 1인칭, 존댓말, 사실마다 출처 id)", context)
        generator = "anthropic"

    # 2) 정책·절차 (문서 근거 검색 + 근거 게이트, 결정론적으로 덧붙임)
    gate_status, gate_messages = "ok", []
    if customer.get("first_home"):
        hits = rag.search(conn, user.tenant_id, "생애최초 주택 구입 지원 대상 주택가격 시행일", region=region, as_of=as_of, k=6)
        gate = rag.evidence_gate(hits, as_of=as_of, policy_question=True)
        gate_status, gate_messages = gate["status"], gate["messages"]
        policy = [h for h in hits if h["source_type"] == "policy" and "주택가격" in h["text"]]
        if policy:
            ok = [l["label"] for l in ls if l["price"] <= FIRST_HOME_PRICE_LIMIT]
            if ok:
                subject = "비교한 매물은 모두" if len(ok) == len(ls) else "·".join(ok) + "는"
                body.say(f"{subject} 주택가격 9억 원 이하라 생애최초 구입 지원의 가격 기준에는 해당합니다.",
                         [body.add(gate["evidence"][f"c{policy[0]['id']}"])])
            apply_gate(body, gate)
        else:
            body.check("생애최초 구입 지원 대상 여부 (취급 은행 확인)")

    proc = [h for h in rag.search(conn, user.tenant_id, "계약 전 등기사항증명서 건축물대장 확인", region=region, as_of=as_of, k=4)
            if "등기사항증명서" in h["text"]]
    body.check("계약 전 등기사항증명서·건축물대장 확인", [body.add(rag.to_evidence(proc[0]))] if proc else [])
    for p in prefs:
        if p not in ("공원", "통학", "학군", "역세권"):
            body.check(f"{josa(chr(39) + p + chr(39), '은는')} 방문해서 확인")
    return {**body.result(), "listings": snapshot, "gate": {"status": gate_status, "messages": gate_messages},
            "generator": generator, "title": "매물 비교표"}


# ---------- 문의 답변 ----------

def get_chunk(conn, tenant_id: int, chunk_id: str) -> dict | None:
    raw = chunk_id[1:] if chunk_id.startswith("c") else chunk_id
    if not raw.isdigit():
        return None
    return conn.execute(
        """SELECT c.id, c.document_id, c.location, c.text, d.title, d.publisher, d.source_type, d.published_at,
                  d.effective_date, d.region, d.url, d.facts, 1.0::float AS score
           FROM chunks c JOIN documents d ON d.id = c.document_id
           WHERE c.id = %s AND (c.tenant_id IS NULL OR c.tenant_id = %s)""",
        (int(raw), tenant_id)).fetchone()


def draft_answer(conn, user, customer: dict, question: str, quote_id: str | None) -> dict:
    as_of = date.today()
    region = region_of(customer.get("district"))
    hits = rag.search(conn, user.tenant_id, question, region=region, as_of=as_of)
    quoted = None
    if quote_id:
        quoted = get_chunk(conn, user.tenant_id, quote_id)
        if not quoted:
            raise DomainError("인용할 자료를 찾을 수 없습니다.", 404)
        hits = [quoted] + [h for h in hits if h["id"] != quoted["id"]]
    gate = rag.evidence_gate(hits, as_of=as_of, policy_question=rag.is_policy_question(question))
    body = Body()
    generator = "template"
    if llm.is_enabled():
        for ev in gate["evidence"].values():
            body.add(ev)
        llm_body(body, f"고객 문의에 대한 답변 (중개사 1인칭, 존댓말, 사실마다 출처 id): {question}",
                 f"기준일 {as_of}, 지역 {region or '미지정'}, 고객 조건: {cond_summary(customer)}")
        generator = "anthropic"
    else:
        ordered = sorted(hits, key=lambda h: (quoted is None or h["id"] != quoted["id"],
                                              rag.AUTHORITY[h["source_type"]], -h["score"]))
        for h in [h for h in ordered if h["source_type"] != "news"
                  and gate["evidence"][f"c{h['id']}"]["state"] != "conflict"][:2]:
            body.say(_lead(h["text"]), [body.add(gate["evidence"][f"c{h['id']}"])])
    apply_gate(body, gate)
    return {**body.result(), "listings": [], "gate": {"status": gate["status"], "messages": gate["messages"]},
            "generator": generator, "title": "문의 답변"}
