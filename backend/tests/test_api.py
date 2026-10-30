"""API 통합 테스트. 컨테이너 안에서 실제 PostgreSQL(pgvector)에 대해 실행한다.

    docker compose run --rm app pytest -q
"""
from datetime import date

import pytest
from fastapi.testclient import TestClient

from app import llm, rag
from app.chunking import chunk_document
from app.main import app


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


def _login(client, email):
    r = client.post("/api/auth/login", json={"email": email, "password": "demo1234"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="session")
def agent(client):
    return _login(client, "agent@hanul.test")


@pytest.fixture(scope="session")
def admin(client):
    return _login(client, "admin@hanul.test")


@pytest.fixture(scope="session")
def other(client):
    return _login(client, "agent@other.test")


@pytest.fixture(scope="session")
def consultation_id(client, agent):
    items = client.get("/api/consultations", headers=agent).json()
    return next(c["id"] for c in items if c["customer_name"] == "김하늘")


@pytest.fixture(scope="session")
def labels(client, agent):
    items = client.get("/api/listings", headers=agent).json()["items"]
    return {l["label"]: l["id"] for l in items}


# ---------- 인증·tenant 격리 ----------

def test_health(client):
    body = client.get("/api/health").json()
    assert body["db"] == "ok" and body["vector"] == "ok"


def test_login_rejects_bad_password(client):
    assert client.post("/api/auth/login", json={"email": "agent@hanul.test", "password": "x"}).status_code == 401


def test_requires_token(client):
    r = client.get("/api/consultations")
    assert r.status_code == 401
    assert r.headers.get("X-Request-ID")


def test_other_tenant_cannot_read_consultation_or_listing(client, other, consultation_id, labels):
    assert client.get(f"/api/consultations/{consultation_id}", headers=other).status_code == 404
    other_labels = {l["id"] for l in client.get("/api/listings", headers=other).json()["items"]}
    assert labels["A"] not in other_labels
    r = client.post("/api/advise", headers=other, json={"consultation_id": consultation_id})
    assert r.status_code == 404


def test_rag_respects_tenant_acl(client, agent, other):
    mine = client.get("/api/evidence/search", params={"q": "내부 수수료 기준"}, headers=agent).json()["items"]
    assert all("연희" not in e["title"] for e in mine)
    theirs = client.get("/api/evidence/search", params={"q": "내부 수수료 기준"}, headers=other).json()["items"]
    assert any("연희" in e["title"] for e in theirs)


# ---------- 구조화 사실 ----------

def test_listing_filter_and_compare(client, agent, consultation_id, labels):
    r = client.get("/api/listings", headers=agent, params={"district": "마포구", "max_price": 80000, "min_area": 59,
                                                           "max_station_walk": 10})
    got = {l["label"] for l in r.json()["items"]}
    assert got == {"A", "B", "C", "G"}
    r = client.post("/api/compare", headers=agent, json={"consultation_id": consultation_id,
                                                         "listing_ids": [labels["A"], labels["D"]]})
    rows = r.json()["rows"]
    assert all(c["ok"] for c in rows[0]["checks"])
    assert any(c["condition"] == "예산" and not c["ok"] for c in rows[1]["checks"])
    assert rows[0]["trade_reference"]["count"] == 4


def test_listing_register_detail_update_close(client, agent, admin, other, consultation_id, labels):
    body = {"title": "망원 한강 59", "complex_name": "망원한강", "address": "서울 마포구 망원로 1", "district": "마포구",
            "price": 79000, "area_m2": 59.5, "lat": 37.556, "lng": 126.905, "floor": "7층", "station": "망원역",
            "station_walk_min": 6, "park_walk_min": 4, "description": "남향"}
    assert client.post("/api/listings", headers=agent, json={**body, "lat": 10}).status_code == 422  # 국내 좌표 아님
    r = client.post("/api/listings", headers=agent, json=body)
    assert r.status_code == 201, r.text
    created = r.json()
    assert created["mine"] and created["registered_by_name"] == "김선용" and created["source"] == "중개사 직접 등록"
    assert created["label"] and len(created["price_history"]) == 1

    mine = {l["id"] for l in client.get("/api/listings", headers=agent, params={"mine": "true"}).json()["items"]}
    admin_mine = {l["id"] for l in client.get("/api/listings", headers=admin, params={"mine": "true"}).json()["items"]}
    assert created["id"] in mine and created["id"] not in admin_mine and labels["D"] in admin_mine

    detail = client.get(f"/api/listings/{labels['A']}", headers=agent).json()
    assert detail["trade_reference"]["count"] == 4
    assert any(c["consultation_id"] == consultation_id and c["status"] == "interest" for c in detail["candidates"])

    updated = client.put(f"/api/listings/{created['id']}", headers=agent, json={**body, "price": 77000}).json()
    assert updated["price"] == 77000 and [h["price"] for h in updated["price_history"]] == [79000, 77000]

    for method, path in [("get", ""), ("post", "/close")]:
        assert getattr(client, method)(f"/api/listings/{created['id']}{path}", headers=other).status_code == 404
    assert client.put(f"/api/listings/{created['id']}", headers=other, json=body).status_code == 404

    assert client.post(f"/api/listings/{created['id']}/close", headers=agent).json()["status"] == "closed"
    ids = {l["id"] for l in client.get("/api/listings", headers=agent).json()["items"]}
    assert created["id"] not in ids
    assert client.get(f"/api/listings/{created['id']}", headers=agent).status_code == 404


def test_conditions_warnings(client, agent, consultation_id):
    r = client.put(f"/api/consultations/{consultation_id}/conditions", headers=agent,
                   json={"budget_max": 30000, "area_min": 59, "district": "마포구", "station_walk_max": 10,
                         "preferences": ["통학", "공원", "조용한 주거지"]})
    assert any("만족하는 매물이 없습니다" in w for w in r.json()["warnings"])
    r = client.put(f"/api/consultations/{consultation_id}/conditions", headers=agent,
                   json={"budget_max": 80000, "area_min": 59, "district": "마포구", "station_walk_max": 10,
                         "preferences": ["통학", "공원", "조용한 주거지"]})
    assert r.json()["warnings"] == []


# ---------- 근거 게이트 ----------

def test_ask_detects_conflict_and_not_effective(client, agent, consultation_id):
    r = client.post("/api/ask", headers=agent, json={"consultation_id": consultation_id,
                                                     "question": "마포구 생애최초 주택 구입 지원 시행일과 적용 여부",
                                                     "as_of": "2026-10-29"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["gate"]["status"] == "conflict"
    statuses = {c["status"] for c in d["claims"]}
    assert {"conflict", "unverifiable"} <= statuses
    assert sum("현재 적용 여부는 확인 불가" in c["text"] for c in d["claims"]) == 1  # 같은 시행일은 하나로 묶음
    ev = {e["chunk_id"]: e for e in d["evidence"]}
    assert any(e["source_type"] == "news" and e["state"] == "conflict" for e in ev.values())
    assert all("부산" not in e["title"] for e in ev.values())  # 지역 필터
    for c in d["claims"]:
        assert all(x in ev for x in c["citations"])  # 모든 인용은 실제 근거에 연결


def test_gate_unit_cases():
    assert rag.evidence_gate([], as_of=date(2026, 10, 29), policy_question=True)["status"] == "insufficient"
    news = {"id": 1, "document_id": 1, "source_type": "news", "title": "t", "publisher": "p", "published_at": date(2026, 10, 1),
            "effective_date": None, "location": "x", "text": "y", "url": None, "facts": {}, "score": 0.5}
    g = rag.evidence_gate([news], as_of=date(2026, 10, 29), policy_question=True)
    assert g["status"] == "insufficient" and g["evidence"]["c1"]["state"] == "warning"


def test_law_chunking_keeps_articles():
    chunks = chunk_document("제3조(신고) 본문 하나.\n제4조(금지) 본문 둘.", "law")
    assert [c.location for c in chunks] == ["제3조(신고)", "제4조(금지)"]


# ---------- /advise + 승인 흐름 ----------

def test_advise_marks_unknown_school_as_unverifiable(client, agent, consultation_id, labels):
    r = client.post("/api/advise", headers=agent, json={"consultation_id": consultation_id,
                                                        "listing_ids": [labels["A"], labels["B"], labels["C"]]})
    assert r.status_code == 200, r.text
    d = r.json()
    texts = [c["text"] for c in d["claims"]]
    assert any("후보 C의 학군" in t and "확인 불가" in t for t in texts)
    school_b = next(t for t in texts if t.startswith("후보 B 통학"))
    assert "마포공원앞" in school_b and "마포한강뷰" not in school_b
    assert any("공원 도보 3분" in t for t in texts)
    assert d["state"] == "draft" and d["version_label"] == "v0.1"


def test_approval_flow(client, agent, consultation_id):
    d = client.post("/api/advise", headers=agent, json={"consultation_id": consultation_id}).json()
    did = d["id"]
    assert client.get(f"/api/drafts/{did}/export", headers=agent).status_code == 409
    d = client.put(f"/api/drafts/{did}", headers=agent, json={"text": d["text"] + "\n- 고객 요청사항을 재확인했습니다."}).json()
    assert d["version_label"] == "v0.2"
    assert client.post(f"/api/drafts/{did}/approve", headers=agent, json={"confirm": True}).status_code == 409
    assert client.post(f"/api/drafts/{did}/review", headers=agent).json()["state"] == "review"
    assert client.post(f"/api/drafts/{did}/approve", headers=agent, json={"confirm": False}).status_code == 400
    d = client.post(f"/api/drafts/{did}/approve", headers=agent, json={"confirm": True}).json()
    assert d["state"] == "approved" and d["approved_by"] == "김선용" and d["version_label"] == "v1.0"
    assert client.put(f"/api/drafts/{did}", headers=agent, json={"text": "변경"}).status_code == 409
    export = client.get(f"/api/drafts/{did}/export", headers=agent)
    assert export.status_code == 200 and "재확인" in export.text


def test_audit_trail(client, admin, agent):
    events = client.get("/api/audit", headers=admin).json()
    names = {e["event"] for e in events}
    assert {"draft.created", "draft.edited", "draft.review_started", "draft.approved"} <= names
    assert client.get("/api/audit", headers=agent).status_code == 403


# ---------- 장애 강등 ----------

def test_llm_outage_only_stops_drafts(client, agent, consultation_id, monkeypatch):
    monkeypatch.setattr(llm, "is_enabled", lambda: True)

    def boom(*_a, **_k):
        raise llm.LLMUnavailable("테스트 장애")

    monkeypatch.setattr(llm, "generate_claims", boom)
    r = client.post("/api/ask", headers=agent, json={"consultation_id": consultation_id, "question": "생애최초 지원 대상"})
    assert r.status_code == 503
    assert client.get("/api/listings", headers=agent).status_code == 200
    assert client.get("/api/evidence/search", params={"q": "생애최초"}, headers=agent).status_code == 200


# ---------- 문서 수집·삭제 전파 ----------

def test_admin_upload_search_delete(client, admin, agent):
    files = {"file": ("memo.txt", "# 주차 안내\n하늘사무소 시험 문서: 방문 고객 주차는 건물 지하 2층을 이용합니다.".encode(), "text/plain")}
    data = {"title": "방문 주차 안내", "source_type": "office", "publisher": "하늘공인중개사사무소", "published_at": "2026-10-01"}
    assert client.post("/api/admin/documents", headers=agent, files=files, data=data).status_code == 403
    r = client.post("/api/admin/documents", headers=admin, files=files, data=data)
    assert r.status_code == 200 and r.json()["job"]["status"] == "done"
    hits = client.get("/api/evidence/search", params={"q": "방문 고객 주차 지하"}, headers=agent).json()["items"]
    doc = next(e for e in hits if e["title"] == "방문 주차 안내")
    assert client.delete(f"/api/admin/documents/{doc['document_id']}", headers=admin).status_code == 200
    hits = client.get("/api/evidence/search", params={"q": "방문 고객 주차 지하"}, headers=agent).json()["items"]
    assert all(e["title"] != "방문 주차 안내" for e in hits)
