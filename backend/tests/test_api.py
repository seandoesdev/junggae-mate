"""API 통합 테스트 (실제 PostgreSQL + pgvector, 테스트 전용 DB). 실행: docker compose run --rm app python -m pytest -q"""
import re
from datetime import date

import pytest
from fastapi.testclient import TestClient

from app import llm, rag
from app.chunking import chunk_document
from app.db import tx
from app.main import app


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


def test_cors_allows_configured_frontend_origins_only(client):
    """화면을 Cloudflare 등 다른 주소에서 내려줄 때: 허용한 화면만 API를 부를 수 있다 (Bearer 헤더, 쿠키 없음)"""
    origin = "https://app.example.test"
    pre = client.options("/api/listings", headers={
        "Origin": origin, "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization, content-type"})
    assert pre.status_code == 200, pre.text
    assert pre.headers["access-control-allow-origin"] == origin
    assert {"authorization", "content-type"} <= {h.strip().lower() for h in pre.headers["access-control-allow-headers"].split(",")}
    assert "access-control-allow-credentials" not in pre.headers

    got = client.get("/api/health", headers={"Origin": origin})
    assert got.headers["access-control-allow-origin"] == origin
    assert "x-request-id" in got.headers["access-control-expose-headers"].lower()
    # 끝의 /를 붙여 적어도 같은 주소로 본다
    assert client.get("/api/health", headers={"Origin": "https://admin.example.test"}).headers[
        "access-control-allow-origin"] == "https://admin.example.test"
    # 미리보기 배포 주소는 정규식으로 허용
    preview = "https://feature-x.preview.example.test"
    assert client.get("/api/health", headers={"Origin": preview}).headers["access-control-allow-origin"] == preview
    # 그 밖의 주소에는 허용 헤더를 주지 않는다
    assert "access-control-allow-origin" not in client.get("/api/health", headers={"Origin": "https://evil.example"}).headers
    bad = client.options("/api/listings", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"})
    assert bad.status_code == 400


def test_cors_headers_on_error_responses(client):
    """401 같은 오류 응답에도 CORS 헤더가 붙어야 화면이 '다시 로그인' 같은 실제 오류를 읽을 수 있다"""
    r = client.get("/api/me", headers={"Origin": "https://app.example.test"})
    assert r.status_code == 401
    assert r.headers["access-control-allow-origin"] == "https://app.example.test"


def test_signup_creates_isolated_office_admin(client):
    """회원가입 = 새 사무소 + 그 관리자. 바로 로그인 상태가 되고, 다른 사무소의 자료는 보이지 않는다"""
    r = client.post("/api/auth/signup", json={
        "office_name": " 새봄공인중개사사무소 ", "name": "최새봄", "email": " Spring@New.test ", "password": "spring-1234"})
    assert r.status_code == 201, r.text
    body = r.json()
    u = body["user"]
    assert (u["role"], u["email"], u["tenant_name"], u["name"]) == ("admin", "spring@new.test", "새봄공인중개사사무소", "최새봄")
    h = {"Authorization": f"Bearer {body['access_token']}"}
    assert client.get("/api/me", headers=h).json()["tenant_name"] == "새봄공인중개사사무소"
    assert client.get("/api/customers", headers=h).json() == []      # 시드 사무소의 고객이 보이지 않는다
    assert client.post("/api/auth/login", json={"email": "spring@new.test", "password": "spring-1234"}).status_code == 200

    # 같은 이메일(대소문자 무관)은 다시 가입할 수 없다
    dup = client.post("/api/auth/signup", json={
        "office_name": "다른사무소", "name": "누구", "email": "SPRING@new.test", "password": "another-1234"})
    assert dup.status_code == 409
    # 비밀번호 8자 미만, 이메일 형식 오류, 빈 사무소 이름은 받지 않는다
    for bad in ({"password": "short"}, {"email": "not-an-email"}, {"office_name": "  "}):
        payload = {"office_name": "검증사무소", "name": "검증", "email": "check@new.test", "password": "check-1234", **bad}
        assert client.post("/api/auth/signup", json=payload).status_code == 422, bad


def _login(client, email):
    r = client.post("/api/auth/login", json={"email": email, "password": "demo1234"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="session")
def kim(client):
    return _login(client, "agent@hanul.test")


@pytest.fixture(scope="session")
def park(client):
    return _login(client, "park@hanul.test")


@pytest.fixture(scope="session")
def lee(client):
    return _login(client, "lee@hanul.test")


@pytest.fixture(scope="session")
def admin(client):
    return _login(client, "admin@hanul.test")


@pytest.fixture(scope="session")
def other(client):
    return _login(client, "agent@other.test")


@pytest.fixture(scope="session")
def L(client, kim):
    """라벨 → 매물 id"""
    return {l["label"]: l["id"] for l in client.get("/api/listings", headers=kim).json()["items"]}


@pytest.fixture(scope="session")
def C(client, kim):
    """고객 이름 → id"""
    return {c["name"]: c["id"] for c in client.get("/api/customers", headers=kim).json()}


def _deal(client, h, listing_id, customer_name):
    return next(d for d in client.get(f"/api/listings/{listing_id}", headers=h).json()["deals"] if d["customer_name"] == customer_name)


def _tokens(text):
    return re.findall(r"\[([cltrkbs]\d+)\]", text)


# ---------- 인증·격리 ----------

def test_health_and_auth(client):
    assert client.get("/api/health").json()["vector"] == "ok"
    assert client.post("/api/auth/login", json={"email": "agent@hanul.test", "password": "x"}).status_code == 401
    r = client.get("/api/listings")
    assert r.status_code == 401 and r.headers.get("X-Request-ID")


def test_tenant_isolation(client, other, L, C):
    assert client.get(f"/api/listings/{L['A']}", headers=other).status_code == 404
    assert client.get(f"/api/customers/{C['김하늘']}", headers=other).status_code == 404
    assert client.post(f"/api/customers/{C['김하늘']}/reports", headers=other, json={"kind": "compare"}).status_code == 404
    assert all(c["name"] != "김하늘" for c in client.get("/api/customers", headers=other).json())


def test_library_respects_acl(client, kim, other):
    mine = client.get("/api/evidence/search", params={"q": "내부 수수료 기준"}, headers=kim).json()["items"]
    assert all("연희" not in e["title"] for e in mine)
    theirs = client.get("/api/evidence/search", params={"q": "내부 수수료 기준"}, headers=other).json()["items"]
    assert any("연희" in e["title"] for e in theirs)


# ---------- 매물·지도 ----------

def test_listing_stage_and_scope(client, kim, park):
    items = {l["label"]: l for l in client.get("/api/listings", headers=kim).json()["items"]}
    assert len(items) == 12
    assert (items["A"]["stage"], items["A"]["active_deals"]) == ("nego", 2)
    assert items["G"]["stage"] == "contract" and items["L"]["stage"] == "done" and items["E"]["stage"] == "available"
    assert items["A"]["agent_name"] == "김선용" and items["A"]["mine"] and not items["D"]["mine"]
    mine = {l["label"] for l in client.get("/api/listings", params={"mine": "true"}, headers=kim).json()["items"]}
    assert mine == {"A", "B", "C", "E", "G", "J"}
    assert {l["label"] for l in client.get("/api/listings", params={"mine": "true"}, headers=park).json()["items"]} == {"D", "F", "K"}


def test_listing_checks_use_documents(client, kim, L):
    a = client.get(f"/api/listings/{L['A']}", headers=kim).json()
    checks = {c["key"]: c for c in a["checks"]}
    assert len(a["deals"]) == 2 and a["trade_reference"]["count"] == 4
    assert checks["registry"]["sources"] and any(s["type"] == "law" for s in checks["registry"]["sources"])
    assert "마포초" in checks["school"]["text"] and checks["school"]["sources"][0]["type"] == "office"
    assert checks["first_home_conflict"]["level"] == "warn"
    assert {s["type"] for s in checks["first_home_conflict"]["sources"]} == {"policy", "news"}
    assert "report" not in checks  # 협의 단계에서는 거래 신고 항목 없음

    g = {c["key"]: c for c in client.get(f"/api/listings/{L['G']}", headers=kim).json()["checks"]}
    assert g["report"]["level"] == "urgent" and "30일" in g["report"]["sources"][0]["snippet"]
    c = {c["key"]: c for c in client.get(f"/api/listings/{L['C']}", headers=kim).json()["checks"]}
    assert c["school"]["level"] == "warn" and c["school"]["sources"] == []
    d = {c["key"]: c for c in client.get(f"/api/listings/{L['D']}", headers=kim).json()["checks"]}
    assert "초과" in d["first_home"]["text"] and "first_home_conflict" not in d

    r = client.put(f"/api/listings/{L['A']}/checks/registry", headers=kim, json={"checked": True})
    assert r.json()["checked"] and r.json()["checked_by"] == "김선용"
    assert client.put(f"/api/listings/{L['A']}/checks/nope", headers=kim, json={"checked": True}).status_code == 404


def test_listing_register_edit_close_permissions(client, kim, park, admin):
    body = {"title": "망원한강 59", "complex_name": "망원한강", "address": "서울 마포구 망원로 1", "district": "마포구",
            "price": 79000, "area_m2": 59.5, "lat": 37.556, "lng": 126.905, "station": "망원역", "station_walk_min": 6}
    assert client.post("/api/listings", headers=kim, json={**body, "lat": 10}).status_code == 422
    new = client.post("/api/listings", headers=kim, json=body).json()
    assert new["mine"] and new["stage"] == "available" and new["label"] == "M"
    assert client.put(f"/api/listings/{new['id']}", headers=park, json=body).status_code == 403
    upd = client.put(f"/api/listings/{new['id']}", headers=admin, json={**body, "price": 77000}).json()
    assert [h["price"] for h in upd["price_history"]] == [79000, 77000]
    assert client.post(f"/api/listings/{new['id']}/close", headers=kim).json()["status"] == "closed"
    assert client.get(f"/api/listings/{new['id']}", headers=kim).status_code == 404


# ---------- 고객 ----------

def test_customers(client, kim, park, C):
    assert len(client.get("/api/customers", headers=kim).json()) == 7
    assert {c["name"] for c in client.get("/api/customers", params={"mine": "true"}, headers=park).json()} == {"최유나", "오지훈"}
    d = client.get(f"/api/customers/{C['김하늘']}", headers=kim).json()
    assert d["customer"]["top_stage"] == "nego" and d["customer"]["first_home"]
    assert {x["listing"]["label"] for x in d["deals"]} == {"A", "B", "E"}
    assert d["activities"]
    m = {l["label"] for l in client.get(f"/api/customers/{C['김하늘']}/matches", headers=kim).json()["items"]}
    assert m == {"A", "B", "C", "G", "H"}  # 거래 완료(L)·조건 밖 매물 제외, 동료 매물(H) 포함

    new = client.post("/api/customers", headers=kim, json={"name": "테스트고객", "budget_max": 30000, "area_min": 59,
                                                           "district": "마포구", "preferences": [" 공원 ", ""]}).json()
    assert new["agent_name"] == "김선용" and new["preferences"] == ["공원"]
    r = client.put(f"/api/customers/{new['id']}", headers=kim, json={"name": "테스트고객", "budget_max": 30000, "area_min": 59,
                                                                      "district": "마포구"}).json()
    assert any("만족하는 매물이 없습니다" in w for w in r["warnings"])
    assert client.post(f"/api/customers/{new['id']}/activities", headers=kim, json={"text": "전화 상담"}).status_code == 201


# ---------- 거래 ----------

def test_deal_flow_and_permissions(client, kim, lee, C, L):
    d = client.post("/api/deals", headers=kim, json={"listing_id": L["C"], "customer_id": C["윤채원"]})
    assert d.status_code == 201 and d.json()["stage"] == "intro" and d.json()["agent_name"] == "김선용"
    assert client.post("/api/deals", headers=kim, json={"listing_id": L["C"], "customer_id": C["윤채원"]}).status_code == 409

    deal = _deal(client, kim, L["A"], "김하늘")
    assert client.post(f"/api/deals/{deal['id']}/stage", headers=lee, json={"stage": "contract"}).status_code == 403
    assert client.post(f"/api/deals/{deal['id']}/stage", headers=kim, json={"stage": "dropped"}).status_code == 422
    r = client.post(f"/api/deals/{deal['id']}/stage", headers=kim, json={"stage": "contract"}).json()
    assert r["deal"]["stage"] == "contract" and r["deal"]["days_in_stage"] == 0
    assert r["warnings"] and "1건" in r["warnings"][0]  # 같은 매물의 박서준 거래는 자동 무산하지 않음
    a = client.get(f"/api/listings/{L['A']}", headers=kim).json()
    assert a["listing"]["stage"] == "contract" and any(c["key"] == "report" for c in a["checks"])
    acts = client.get(f"/api/customers/{C['김하늘']}", headers=kim).json()["activities"]
    assert "협의→계약" in acts[0]["text"]
    assert any(x["stage"] == "contract" for x in client.get("/api/deals", params={"mine": "true"}, headers=kim).json())


# ---------- 고객 자료 ----------

def test_compare_report_lifecycle(client, kim, park, C):
    r = client.post(f"/api/customers/{C['김하늘']}/reports", headers=kim, json={"kind": "compare"})
    assert r.status_code == 201, r.text
    rep = r.json()
    assert rep["state"] == "draft" and rep["version"] == "0.1" and rep["title"] == "매물 비교표"
    assert {l["label"] for l in rep["listings"]} == {"A", "B"}  # 무산된 E 제외
    ids = {s["id"] for s in rep["sources"]}
    used = set(_tokens(rep["opinion"] + " ".join(rep["to_check"])))
    assert used and used <= ids  # 본문의 모든 출처 표시는 실제 출처에 연결
    assert {i[0] for i in ids} >= {"l", "t", "c"}
    assert "마포초" in rep["opinion"] and "생애최초" in rep["opinion"]
    assert "AI" not in rep["opinion"] and "확인 불가" not in rep["opinion"]
    assert any("시행 이후" in t for t in rep["to_check"]) and any("방문해서 확인" in t for t in rep["to_check"])

    rid = rep["id"]
    assert client.get(f"/api/reports/{rid}/export", headers=kim).status_code == 409
    edited = client.put(f"/api/reports/{rid}", headers=kim, json={"opinion": rep["opinion"] + " 주말 방문을 권해 드립니다."}).json()
    assert edited["version"] == "0.2" and edited["opinion"].endswith("권해 드립니다.")
    assert client.post(f"/api/reports/{rid}/approve", headers=kim, json={"confirm": True}).status_code == 409
    assert client.post(f"/api/reports/{rid}/review", headers=kim).json()["state"] == "review"
    assert client.post(f"/api/reports/{rid}/approve", headers=park, json={"confirm": True}).status_code == 403
    ok = client.post(f"/api/reports/{rid}/approve", headers=kim, json={"confirm": True}).json()
    assert ok["state"] == "approved" and ok["version"] == "1.0" and ok["approved_by"] == "김선용"
    assert client.put(f"/api/reports/{rid}", headers=kim, json={"opinion": "변경"}).status_code == 409

    html = client.get(f"/api/reports/{rid}/export", headers=kim)
    assert html.status_code == 200 and "<sup>1)</sup>" in html.text and "주말 방문" in html.text

    shared = client.post(f"/api/reports/{rid}/share", headers=kim).json()
    assert shared["state"] == "shared" and shared["share"]["views"] == 0
    token = shared["share"]["url"].rsplit("/", 1)[1]
    pub = client.get(f"/r/{token}")
    assert pub.status_code == 200 and "김하늘 고객님께" in pub.text and "print()" not in pub.text
    again = client.get(f"/api/reports/{rid}", headers=kim).json()
    assert again["share"]["views"] == 1
    assert "링크를 열람" in client.get(f"/api/customers/{C['김하늘']}", headers=kim).json()["activities"][0]["text"]
    with tx() as conn:
        conn.execute("UPDATE reports SET share_expires_at = now() - interval '1 minute' WHERE id = %s", (rid,))
    assert client.get(f"/r/{token}").status_code == 404
    assert client.get("/r/not-a-token").status_code == 404


def test_answer_report_and_quote(client, kim, C):
    r = client.post(f"/api/customers/{C['김하늘']}/reports", headers=kim,
                    json={"kind": "answer", "question": "마포구 아파트를 사면 생애최초 주택 구입 지원을 받을 수 있나요?"}).json()
    assert r["kind"] == "answer" and r["gate"]["status"] == "conflict"
    assert "공식" in r["opinion"] and any("시행 이후" in t for t in r["to_check"])
    assert any(s["type"] == "news" and s["state"] == "conflict" for s in r["sources"])
    assert set(_tokens(r["opinion"])) <= {s["id"] for s in r["sources"]}

    hit = client.get("/api/evidence/search", params={"q": "학구도 배정", "type": "office"}, headers=kim).json()["items"][0]
    q = client.post(f"/api/customers/{C['김하늘']}/reports", headers=kim,
                    json={"kind": "answer", "question": "배정 학교가 어디인가요?", "quote_id": hit["id"]}).json()
    assert _tokens(q["opinion"])[0] == hit["id"]
    assert client.post(f"/api/customers/{C['김하늘']}/reports", headers=kim,
                       json={"kind": "answer", "question": "x", "quote_id": "c999999"}).status_code == 404
    assert client.post(f"/api/customers/{C['김하늘']}/reports", headers=kim, json={"kind": "answer"}).status_code == 422


def test_compare_needs_linked_listings(client, kim):
    new = client.post("/api/customers", headers=kim, json={"name": "빈고객"}).json()
    r = client.post(f"/api/customers/{new['id']}/reports", headers=kim, json={"kind": "compare"})
    assert r.status_code == 422 and "연결" in r.json()["detail"]


# ---------- 자료실 ----------

def test_library(client, kim):
    docs = client.get("/api/documents", headers=kim).json()
    assert docs[0]["type"] == "law" and all(d["first_chunk"] for d in docs)
    assert {d["type"] for d in client.get("/api/documents", params={"type": "news"}, headers=kim).json()} == {"news"}
    news = client.get("/api/evidence/search", params={"q": "생애최초 시행", "type": "news"}, headers=kim).json()["items"]
    assert news and all(e["type"] == "news" and e["note"] for e in news)
    one = client.get(f"/api/evidence/{docs[0]['first_chunk']}", headers=kim).json()
    assert one["kind"] == "chunk" and one["snippet"]


def test_korean_particles():
    from app.drafting import josa
    cases = [("시행일", "이가", "시행일이"), ("2026-10-15", "으로", "2026-10-15로"), ("7.5억", "으로", "7.5억으로"),
             ("'조용한 주거지'", "은는", "'조용한 주거지'는"), ("'공원'", "은는", "'공원'은"), ("서울", "으로", "서울로"),
             ("2026-10-10", "으로", "2026-10-10으로")]
    assert [josa(w, p) for w, p, _ in cases] == [e for _, _, e in cases]


def test_gate_and_chunking_units():
    assert rag.evidence_gate([], as_of=date(2026, 10, 29), policy_question=True)["status"] == "insufficient"
    news = {"id": 1, "document_id": 1, "source_type": "news", "title": "t", "publisher": "p", "published_at": date(2026, 10, 1),
            "effective_date": None, "location": "x", "text": "y", "url": None, "facts": {}, "score": 0.5}
    g = rag.evidence_gate([news], as_of=date(2026, 10, 29), policy_question=True)
    assert g["status"] == "insufficient" and g["evidence"]["c1"]["state"] == "warning"
    assert [c.location for c in chunk_document("제3조(신고) 본문 하나.\n제4조(금지) 본문 둘.", "law")] == ["제3조(신고)", "제4조(금지)"]


# ---------- 장애 강등·관리 ----------

def test_llm_outage_only_stops_reports(client, kim, C, monkeypatch):
    monkeypatch.setattr(llm, "is_enabled", lambda: True)

    def boom(*_a, **_k):
        raise llm.LLMUnavailable("테스트 장애")

    monkeypatch.setattr(llm, "generate_claims", boom)
    r = client.post(f"/api/customers/{C['김하늘']}/reports", headers=kim, json={"kind": "compare"})
    assert r.status_code == 503
    assert client.get("/api/listings", headers=kim).status_code == 200
    assert client.get("/api/evidence/search", params={"q": "생애최초"}, headers=kim).status_code == 200


def test_admin_documents_and_audit(client, admin, kim):
    files = {"file": ("memo.txt", "# 주차 안내\n방문 고객 주차는 건물 지하 2층을 이용합니다.".encode(), "text/plain")}
    data = {"title": "방문 주차 안내", "source_type": "office", "publisher": "하늘공인중개사사무소", "published_at": "2026-10-01"}
    assert client.post("/api/admin/documents", headers=kim, files=files, data=data).status_code == 403
    assert client.post("/api/admin/documents", headers=admin, files=files, data=data).json()["job"]["status"] == "done"
    hits = client.get("/api/evidence/search", params={"q": "방문 고객 주차 지하"}, headers=kim).json()["items"]
    doc = next(e for e in hits if e["title"] == "방문 주차 안내")
    assert client.delete(f"/api/admin/documents/{doc['document_id']}", headers=admin).status_code == 200
    hits = client.get("/api/evidence/search", params={"q": "방문 고객 주차 지하"}, headers=kim).json()["items"]
    assert all(e["title"] != "방문 주차 안내" for e in hits)
    events = {e["event"] for e in client.get("/api/audit", headers=admin).json()}
    assert {"deal.stage_changed", "report.approved", "report.shared", "listing.check"} <= events
    assert client.get("/api/audit", headers=kim).status_code == 403


# ---------- 질문 검색 ----------

def test_parse_query_rules():
    from app.assistant import parse_query
    f = parse_query("마포구 8억 이하 59㎡ 초등학교 가까운 집")
    assert f["district"] == "마포구" and f["price_max"] == 80000 and f["price_min"] is None
    assert f["area_min"] < 59 < f["area_max"] and f["wants"] == ["학교"]
    f = parse_query("7~9억 25평 역세권 조용한 아파트")
    assert (f["price_min"], f["price_max"]) == (70000, 90000) and f["walk_max"] == 10
    assert 55 < f["area_min"] < 62 < f["area_max"] and "조용한" in f["wants"]
    assert parse_query("8억 5천 이상")["price_min"] == 85000
    assert parse_query("8억대 마포")["price_max"] == 89999
    assert parse_query("공덕 근처 역 5분", known_stations=["공덕역", "마포역"])["station"] == "공덕역"
    assert parse_query("생애최초로 살 수 있는 집")["first_home"] is True


def test_search_finds_listings_with_documents(client, kim, L):
    r = client.post("/api/search", headers=kim, json={"q": "마포구 8억 이하 59㎡ 학교 가까운 집"})
    assert r.status_code == 200, r.text
    res = r.json()
    labels = [l["label"] for l in res["listings"]]
    assert labels and all(l["price"] <= 80000 for l in res["listings"]) and not res["relaxed"]
    assert labels[0] in ("A", "B")  # 사무소 통학 메모에 배정 학교가 적힌 단지가 먼저
    assert {"district", "price", "area", "want:학교"} <= {c["key"] for c in res["understood"]}
    assert "마포초" in res["opinion"]
    assert set(_tokens(res["opinion"] + " ".join(res["to_check"]))) <= {s["id"] for s in res["sources"]}
    assert {s["id"][0] for s in res["sources"]} >= {"l", "c"}
    # 조건 지우기: 가격 조건을 지우면 8억 넘는 매물도 나온다
    wider = client.post("/api/search", headers=kim, json={"q": "마포구 8억 이하 59㎡ 학교 가까운 집", "drop": ["price"]}).json()
    assert any(l["price"] > 80000 for l in wider["listings"]) and "price" not in {c["key"] for c in wider["understood"]}
    # 조건을 모두 만족하는 매물이 없으면 가까운 매물
    near = client.post("/api/search", headers=kim, json={"q": "마포구 6.5억 이하 59㎡"}).json()
    assert near["relaxed"] and near["listings"] and near["listings"][0]["unmet"]
    assert "생애최초" not in near["opinion"]  # 매물만 찾는 질문에 관련 없는 정책 문장이 붙지 않는다
    assert client.post("/api/search", headers=kim, json={"q": ""}).status_code == 422


def test_search_policy_and_market_questions(client, kim):
    law = client.post("/api/search", headers=kim, json={"q": "부동산 거래 신고는 계약 후 며칠 안에 해야 하나요?"}).json()
    assert not law["listings"] and "30일" in law["opinion"]
    policy = client.post("/api/search", headers=kim, json={"q": "생애최초 지원받을 수 있는 9억 이하 아파트"}).json()
    assert policy["gate"]["status"] == "conflict" and "공식 자료인" in policy["opinion"]
    assert any("시행 이후" in t for t in policy["to_check"]) and all(l["price"] <= 90000 for l in policy["listings"])
    market = client.post("/api/search", headers=kim, json={"q": "마포구 아파트 시세 동향 어때?"}).json()
    assert any(s["id"] == "t0" for s in market["sources"])


def test_listing_notes_feed_search(client, kim, park, L):
    lid = L["H"]  # 이도현 담당 매물에도 사무소 누구나 메모를 남길 수 있다
    note = client.post(f"/api/listings/{lid}/notes", headers=kim, json={"text": "10/30 방문: 남향, 밤에 조용함"})
    assert note.status_code == 201 and note.json()["by"] == "김선용"
    assert client.get(f"/api/listings/{lid}", headers=kim).json()["notes"][0]["text"].startswith("10/30")
    res = client.post("/api/search", headers=kim, json={"q": "조용한 남향 집"}).json()
    hit = next(l for l in res["listings"] if l["id"] == lid)
    assert any("밤에 조용함" in m["text"] for m in hit["matched"])
    nid = note.json()["id"]
    assert client.delete(f"/api/listings/{lid}/notes/{nid}", headers=park).status_code == 403
    assert client.delete(f"/api/listings/{lid}/notes/{nid}", headers=kim).status_code == 200
    assert client.post(f"/api/listings/{lid}/notes", headers=kim, json={"text": ""}).status_code == 422


def test_agent_documents_feed_search(client, kim, park, other, L):
    body = {"title": "용강리버뷰 단지 확인 내용", "text": "용강리버뷰 아파트는 2026년 학구도 기준 용강초 배정 구역입니다. 단지 안 놀이터 2곳."}
    r = client.post("/api/documents", headers=kim, json=body)
    assert r.status_code == 201, r.text
    assert client.post("/api/documents", headers=kim, json=body).status_code == 409
    docs = client.get("/api/documents?type=office", headers=kim).json()
    mine = next(d for d in docs if d["id"] == r.json()["id"])
    assert mine["mine"] and mine["author"] == "김선용"
    res = client.post("/api/search", headers=kim, json={"q": "학교 가까운 아파트"}).json()
    j = next(l for l in res["listings"] if l["label"] == "J")
    assert any("용강초" in m["text"] for m in j["matched"])
    hits = client.get("/api/evidence/search", params={"q": "용강초 배정"}, headers=other).json()["items"]
    assert all("용강초" not in h["snippet"] for h in hits)  # 다른 사무소에는 보이지 않는다
    assert client.delete(f"/api/documents/{r.json()['id']}", headers=park).status_code == 403
    assert client.delete(f"/api/documents/{r.json()['id']}", headers=kim).status_code == 200


def test_search_review_regressions(client, kim, C):
    from app.assistant import normalize_region, parse_query
    stations, complexes = ["공덕역", "마포역", "애오개역"], ["마포한강뷰", "공덕자이", "마포한신"]
    f = parse_query("마포한강뷰 학교 가까운 집", stations, complexes)
    assert f["complex"] == "마포한강뷰" and f["station"] is None   # 단지 이름의 '마포'를 마포역으로 읽지 않는다
    assert parse_query("공덕자이 시세", stations, complexes)["station"] is None
    assert parse_query("공덕 근처 59㎡", stations, complexes)["station"] == "공덕역"
    res = client.post("/api/search", headers=kim, json={"q": "마포한강뷰 학교 가까운 집"}).json()
    assert [l["label"] for l in res["listings"]] == ["A"]
    none = client.post("/api/search", headers=kim, json={"q": "엘리베이터 신축 주차 넉넉한 집 수영장"}).json()
    assert all(l["matched"] for l in none["listings"])            # 확인 안 된 매물을 '맞는 매물'로 보여 주지 않는다
    wide = client.post("/api/search", headers=kim, json={"q": "마포구 8억 이하 집", "drop": ["district", "price"]}).json()
    assert len(wide["listings"]) >= 8                             # 조건을 모두 빼면 전체를 관련도 순으로
    rep = client.post(f"/api/customers/{C['박서준']}/reports", headers=kim,
                      json={"kind": "answer", "question": "마포구 8억 이하 59㎡ 집", "drop": ["price"]}).json()
    assert any(l["price"] > 80000 for l in rep["listings"])      # 화면에서 뺀 조건은 고객 자료에서도 빠진다
    assert normalize_region("마포구") == normalize_region("서울시 마포구") == "서울 마포구"
    assert normalize_region("서울특별시") == "서울" and normalize_region(" ") is None


# ---------- 지역 이름·Hood AI ----------

def test_place_search_outside_office_area(client, kim):
    r = client.post("/api/search", headers=kim, json={"q": "동탄 매물 보여줘"}).json()
    assert r["listing_intent"] and r["listings"] == []
    assert r["place"]["name"] == "동탄" and r["place"]["radius_m"] == 5000 and 37.1 < r["place"]["lat"] < 37.3
    assert any(c["key"] == "place" for c in r["understood"])
    assert "동탄" in r["opinion"] and "마포구" in r["opinion"]            # 없다고만 하지 않고 지금 있는 곳을 알려 준다
    near = client.post("/api/search", headers=kim, json={"q": "공덕동 매물"}).json()
    assert near["listings"] and all(l["district"] == "마포구" for l in near["listings"])
    assert client.post("/api/search", headers=kim, json={"q": "매물 보여줘"}).json()["listings"]   # 조건 없이도 목록
    gangnam = client.post("/api/search", headers=kim, json={"q": "강남구 아파트"}).json()
    assert gangnam["listings"] == [] and gangnam["place"]["name"] == "강남구" and "강남구에는" in gangnam["opinion"]


def test_hood_sessions_follow_up_and_history(client, kim, park):
    first = client.post("/api/search", headers=kim, json={"q": "마포구 59㎡ 집"}).json()
    sid = first["session_id"]
    follow = client.post("/api/search", headers=kim, json={"q": "그중 7.6억 이하만", "session_id": sid}).json()
    assert follow["session_id"] == sid and follow["effective_query"] == "마포구 59㎡ 집 7.6억 이하만"
    assert follow["listings"] and all(l["price"] <= 76000 for l in follow["listings"])
    again = client.post("/api/search", headers=kim, json={"q": "그중 7.6억 이하만", "session_id": sid, "drop": ["price"]}).json()
    assert again["message_id"] == follow["message_id"]                 # 조건 빼기는 같은 답을 바꾼다
    sessions = client.get("/api/ai/sessions", headers=kim).json()
    assert sessions[0]["id"] == sid and sessions[0]["messages"] == 2
    detail = client.get(f"/api/ai/sessions/{sid}", headers=kim).json()
    assert [m["question"] for m in detail["messages"]] == ["마포구 59㎡ 집", "그중 7.6억 이하만"]
    assert client.get(f"/api/ai/sessions/{sid}", headers=park).status_code == 404   # 남의 대화는 볼 수 없다
    assert client.post("/api/search", headers=park, json={"q": "x", "session_id": sid}).status_code == 404
    assert client.delete(f"/api/ai/sessions/{sid}", headers=kim).status_code == 200
    assert client.get(f"/api/ai/sessions/{sid}", headers=kim).status_code == 404


def test_hood_settings_usage_and_reports(client, kim, admin, C):
    s = client.get("/api/ai/settings", headers=kim).json()
    assert s["can_edit"] is False and s["detail_count"] == 3 and set(s["source_types"]) == {"law", "policy", "office", "news"}
    body = {"source_types": ["law", "policy", "office"], "detail_count": 2, "near_miss": False, "monthly_limit": None}
    assert client.put("/api/ai/settings", headers=kim, json=body).status_code == 403
    saved = client.put("/api/ai/settings", headers=admin, json=body).json()
    assert saved["detail_count"] == 2 and saved["updated_by"] == "하늘 관리자"
    r = client.post("/api/search", headers=kim, json={"q": "마포구 아파트 시세 동향"}).json()
    assert all(src["type"] != "news" for src in r["sources"])           # 기사를 빼면 답변에 기사가 없다
    assert not client.post("/api/search", headers=kim, json={"q": "마포구 6.5억 이하 59㎡"}).json()["relaxed"]
    used = client.get("/api/ai/settings", headers=kim).json()["month_used"]
    client.put("/api/ai/settings", headers=admin, json={**body, "monthly_limit": used})
    assert client.post("/api/search", headers=kim, json={"q": "매물 보여줘"}).status_code == 429
    client.put("/api/ai/settings", headers=admin, json={"source_types": ["law", "policy", "office", "news"], "detail_count": 3,
                                                        "near_miss": True, "monthly_limit": None})
    u = client.get("/api/ai/usage", headers=kim).json()
    assert u["month_total"] == used and len(u["daily"]) == 14 and u["daily"][-1]["date"] == u["today"]
    assert sum(x["count"] for x in u["by_user"]) == u["month_total"] and u["today_total"] <= u["month_total"]
    reps = client.get("/api/reports", headers=kim).json()
    assert reps["counts"]["all"] == len(reps["items"]) >= 1
    assert all(x["state"] in ("approved", "shared") for x in client.get("/api/reports?state=done", headers=kim).json()["items"])


# ---------- 구조화 공공데이터 evidence·매물 연결·검색 추적 ----------

def test_structured_evidence_routing(client, kim, L):
    rent = client.post("/api/search", headers=kim, json={"q": "마포한강뷰 전세 시세 어때?"}).json()
    assert "rent" in rent["routes"] and f"r{L['A']}" in {s["id"] for s in rent["sources"]}
    assert "전세 3건" in rent["opinion"] and "월세 1건" in rent["opinion"]
    src = next(s for s in rent["sources"] if s["id"] == f"r{L['A']}")
    assert src["kind"] == "structured" and src["source_id"] == "15126474" and src["value"]["jeonse_count"] == 3
    assert set(_tokens(rent["opinion"])) <= {s["id"] for s in rent["sources"]}
    # 전세 금액은 매매 가격 조건으로 쓰지 않는다
    budget = client.post("/api/search", headers=kim, json={"q": "마포구 전세 5억 이하"}).json()
    assert "price" not in {c["key"] for c in budget["understood"]}
    assert any("매매 매물 가격 조건으로 쓰지 않았습니다" in t for t in budget["to_check"])
    # 연결된 단지(K-apt)와 역(TAGO)
    cx = client.post("/api/search", headers=kim, json={"q": "마포한강뷰 세대수랑 몇 호선이야?"}).json()
    assert {"complex", "station"} <= set(cx["routes"]) and "612세대" in cx["opinion"] and "6호선" in cx["opinion"]
    assert cx["listings"][0]["public"]["complex"]["household_count"] == 612
    # 연결하지 않은 매물은 단정하지 않고 확인할 사항으로
    nolink = client.post("/api/search", headers=kim, json={"q": "공덕역세권 세대수"}).json()
    assert any("연결하지 않았습니다" in t for t in nolink["to_check"])


def test_listing_links_candidates_and_permissions(client, kim, park, other, L):
    pub = client.get(f"/api/listings/{L['C']}/public", headers=kim).json()
    assert pub["links"] == {} and pub["can_edit"] is True
    assert pub["candidates"]["complex"][0]["label"] == "공덕역세권" and pub["facts"]["rent"]["value"]["jeonse_count"] == 3
    station_key = pub["candidates"]["station"][0]["entity_key"]
    assert station_key.startswith("MTR") and "공덕" in pub["candidates"]["station"][0]["label"]
    key = pub["candidates"]["complex"][0]["entity_key"]
    assert client.put(f"/api/listings/{L['C']}/links/complex", headers=park, json={"entity_key": key}).status_code == 403
    assert client.put(f"/api/listings/{L['C']}/links/complex", headers=kim, json={"entity_key": "NOPE"}).status_code == 422
    link = client.put(f"/api/listings/{L['C']}/links/complex", headers=kim, json={"entity_key": key}).json()
    assert link["match_method"] == "suggested" and link["confirmed_by"] == "김선용"
    after = client.get(f"/api/listings/{L['C']}/public", headers=kim).json()
    assert after["facts"]["complex"]["value"]["household_count"] == 254
    assert after["facts"]["complex"]["evidence"]["id"] == f"k{L['C']}"
    station_ids = [c["entity_key"] for c in pub["candidates"]["station"] if "공덕" in c["label"]][:4]
    grouped_station_key = "station_ids:" + ",".join(station_ids)
    station_link = client.put(f"/api/listings/{L['C']}/links/station", headers=kim,
                              json={"entity_key": grouped_station_key}).json()
    assert station_link["entity_key"] == grouped_station_key
    station_fact = client.get(f"/api/listings/{L['C']}/public", headers=kim).json()["facts"]["station"]
    assert station_fact["value"]["station"] == "공덕" and len(station_fact["value"]["station_ids"]) >= 2
    assert {"5호선", "6호선"} <= set(station_fact["value"]["routes"])
    invalid_group = f"station_ids:{station_ids[0]},MTRS15530"  # 공덕 + 애오개
    assert client.put(f"/api/listings/{L['C']}/links/station", headers=kim,
                      json={"entity_key": invalid_group}).status_code == 422
    assert client.delete(f"/api/listings/{L['C']}/links/station", headers=kim).status_code == 200
    assert client.get(f"/api/listings/{L['C']}/public", headers=other).status_code == 404   # 다른 사무소
    assert client.delete(f"/api/listings/{L['C']}/links/complex", headers=kim).status_code == 200
    assert client.get(f"/api/listings/{L['C']}/public", headers=kim).json()["links"] == {}


def test_rent_evidence_uses_collected_lawd_outside_mvp_regions(client, kim):
    source_key = "test-rent-busan-haeundae"
    with tx() as conn:
        conn.execute(
            """INSERT INTO apt_rent_trades
               (source_key, lawd_cd, district, dong, complex_name, area_m2, contract_date, deposit,
                monthly_rent, rent_type, source, raw_payload)
               VALUES (%s,'26350','26350','우동','부산전국검증',59.9,current_date,42000,0,'jeonse','테스트','{}'::jsonb)""",
            (source_key,),
        )
        conn.execute(
            """INSERT INTO apt_rent_trades
               (source_key, lawd_cd, district, dong, complex_name, area_m2, contract_date, deposit,
                monthly_rent, rent_type, source, raw_payload)
               VALUES ('test-rent-busan-distractor','26440','26440','대연동','부산다른단지',59.9,
                       current_date,39000,0,'jeonse','테스트','{}'::jsonb)"""
        )
    listing = client.post("/api/listings", headers=kim, json={
        "title": "부산전국검증 59", "complex_name": "부산전국검증", "address": "부산 해운대구 우동 1",
        "district": "해운대구", "price": 70000, "area_m2": 59.9, "lat": 35.163, "lng": 129.163,
    }).json()
    try:
        rent = client.get(f"/api/listings/{listing['id']}/public", headers=kim).json()["facts"]["rent"]
        assert rent["value"]["jeonse_count"] == 1 and "4.2억" in rent["evidence"]["snippet"]
    finally:
        with tx() as conn:
            conn.execute("DELETE FROM listings WHERE id = %s", (listing["id"],))
            conn.execute("DELETE FROM apt_rent_trades WHERE source_key = %s", (source_key,))
            conn.execute("DELETE FROM apt_rent_trades WHERE source_key = 'test-rent-busan-distractor'")


def test_rent_lawd_uses_collected_dong_when_district_is_only_a_code(client, kim):
    """실제 전월세 응답은 구 이름 없이 시군구 코드만 준다. 같은 시·도 두 구에 같은 이름 단지가 있으면
    수집된 법정동이 주소에 있는 쪽을 쓰고, 판별할 수 없으면 근거를 붙이지 않는다(틀린 지역 결합 금지)."""
    rows = [("test-twin-haeundae", "26350", "우동", 42000), ("test-twin-nam", "26290", "대연동", 31000)]
    with tx() as conn:
        for key, code, dong, deposit in rows:
            conn.execute(
                """INSERT INTO apt_rent_trades (source_key, lawd_cd, district, dong, complex_name, area_m2, contract_date,
                                                deposit, monthly_rent, rent_type, source, raw_payload)
                   VALUES (%s,%s,%s,%s,'쌍둥이단지',59.9,current_date,%s,0,'jeonse','테스트','{}'::jsonb)""",
                (key, code, code, dong, deposit))
    made = []
    try:
        for address in ("부산 해운대구 우동 77", "부산 해운대구 해변로 77"):
            made.append(client.post("/api/listings", headers=kim, json={
                "title": "쌍둥이단지 59", "complex_name": "쌍둥이단지", "address": address, "district": "해운대구",
                "price": 70000, "area_m2": 59.9, "lat": 35.163, "lng": 129.163}).json()["id"])
        with_dong = client.get(f"/api/listings/{made[0]}/public", headers=kim).json()["facts"]["rent"]
        assert with_dong and "4.2억" in with_dong["evidence"]["snippet"]        # 해운대구(우동) 사례
        assert client.get(f"/api/listings/{made[1]}/public", headers=kim).json()["facts"]["rent"] is None
    finally:
        with tx() as conn:
            conn.execute("DELETE FROM listings WHERE id = ANY(%s)", (made,))
            conn.execute("DELETE FROM apt_rent_trades WHERE source_key LIKE 'test-twin-%%'")


def test_public_candidates_prefer_listing_region(client, kim, L):
    with tx() as conn:
        conn.execute(
            """INSERT INTO apartment_complexes
               (kapt_code, name, address, source, raw_payload)
               VALUES ('TEST-BUSAN-CX','공덕역세권','부산광역시 중구 공덕로 1','테스트','{}'::jsonb)"""
        )
        conn.execute(
            """INSERT INTO building_register_records
               (source_key, operation, sigungu_cd, bjdong_cd, building_name, lot_address, source, raw_payload)
               VALUES ('TEST-BUSAN-BLD','getBrTitleInfo','26110','10100','공덕역세권',
                       '부산광역시 중구 공덕로 1','테스트','{}'::jsonb)"""
        )
    try:
        candidates = client.get(f"/api/listings/{L['C']}/public", headers=kim).json()["candidates"]
        assert candidates["complex"][0]["entity_key"] != "TEST-BUSAN-CX"
        assert candidates["building"][0]["entity_key"] != "TEST-BUSAN-BLD"
        assert "마포구" in candidates["complex"][0]["detail"]
        assert "마포구" in candidates["building"][0]["detail"]
    finally:
        with tx() as conn:
            conn.execute("DELETE FROM apartment_complexes WHERE kapt_code = 'TEST-BUSAN-CX'")
            conn.execute("DELETE FROM building_register_records WHERE source_key = 'TEST-BUSAN-BLD'")


def test_stale_public_data_and_traces(client, kim, L):
    with tx() as conn:
        conn.execute("UPDATE apartment_complexes SET collected_at = now() - interval '400 days' WHERE kapt_code = 'A10027001'")
    r = client.post("/api/search", headers=kim, json={"q": "마포한강뷰 사용승인일"}).json()
    k = next(s for s in r["sources"] if s["id"] == f"k{L['A']}")
    assert k["state"] == "stale" and "다시 수집" in k["note"] and r["stale_count"] >= 1
    assert any("오래된 수집본" in t for t in r["to_check"])
    with tx() as conn:
        conn.execute("UPDATE apartment_complexes SET collected_at = now() WHERE kapt_code = 'A10027001'")
        t = conn.execute("SELECT * FROM retrieval_traces ORDER BY id DESC LIMIT 1").fetchone()
    assert "complex" in t["routes"] and t["stale_count"] >= 1 and t["latency_ms"] >= 0 and len(t["query_hash"]) == 32
    no_news = client.post("/api/search", headers=kim, json={"q": "마포구 아파트 시세 동향", "exclude_types": ["news"]}).json()
    assert all(s["type"] != "news" for s in no_news["sources"])
    u = client.get("/api/ai/usage", headers=kim).json()
    assert u["traces"] >= 1 and u["latency_avg_ms"] is not None and any(x["route"] == "complex" for x in u["by_route"])


def test_compare_report_includes_linked_complex(client, kim, C):
    rep = client.post(f"/api/customers/{C['김하늘']}/reports", headers=kim, json={"kind": "compare"}).json()
    a = next(l for l in rep["listings"] if l["label"] == "A")
    assert a["public"]["complex"]["household_count"] == 612 and "612세대" in rep["opinion"]
