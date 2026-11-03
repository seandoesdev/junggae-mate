"""구조화 공공데이터 수집·캐시 조회 API 계약."""

import pytest
from fastapi.testclient import TestClient

from app import api, public_catalog, public_data
from app.main import app


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as test_client:
        yield test_client


def _login(client, email):
    response = client.post("/api/auth/login", json={"email": email, "password": "demo1234"})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


@pytest.fixture(scope="session")
def admin(client):
    return _login(client, "admin@hanul.test")


@pytest.fixture(scope="session")
def agent(client):
    return _login(client, "agent@hanul.test")


def _result(dataset_id):
    return {
        "dataset_id": dataset_id,
        "received": 2,
        "valid": 2,
        "invalid": 0,
        "inserted": 1,
        "updated": 1,
        "unchanged": 0,
    }


def test_collect_routes_require_admin_and_validate(client, admin, agent, monkeypatch):
    monkeypatch.setattr(api.public_catalog, "fetch_dataset", lambda _dataset_id, _params: [])
    monkeypatch.setattr(
        api.public_sources,
        "collect_and_store",
        lambda _conn, dataset_id, _params, **_kwargs: _result(dataset_id),
    )
    assert client.post(
        "/api/admin/collect/rents", headers=agent, json={"lawd_cd": "11440", "deal_ymd": "202609"}
    ).status_code == 403
    assert client.post(
        "/api/admin/collect/rents", headers=admin, json={"lawd_cd": "1144", "deal_ymd": "202609"}
    ).status_code == 422
    assert client.post(
        "/api/admin/collect/rents", headers=admin, json={"lawd_cd": "11440", "deal_ymd": "202613"}
    ).status_code == 422
    assert client.post(
        "/api/admin/collect/complexes", headers=admin, json={"kapt_code": "A100!"}
    ).status_code == 422
    assert client.post(
        "/api/admin/collect/subway-stations", headers=admin, json={"station_name": "   "}
    ).status_code == 422
    assert client.get(
        "/api/public-data/subway-stations", headers=agent, params={"q": "   "}
    ).status_code == 422


def test_collect_routes_map_dataset_parameters(client, admin, monkeypatch):
    calls = []

    monkeypatch.setattr(api.public_catalog, "fetch_dataset", lambda _dataset_id, _params: [])

    def fake_collect(_conn, dataset_id, params, **_kwargs):
        calls.append((dataset_id, params))
        return _result(dataset_id)

    monkeypatch.setattr(api.public_sources, "collect_and_store", fake_collect)
    requests = (
        ("/api/admin/collect/rents", {"lawd_cd": "11440", "deal_ymd": "202609"}),
        ("/api/admin/collect/complexes", {"kapt_code": "A10024875"}),
        (
            "/api/admin/collect/buildings",
            {"sigungu_cd": "11440", "bjdong_cd": "10200", "plat_gb_cd": "0", "bun": "1", "ji": "2"},
        ),
        ("/api/admin/collect/subway-stations", {"station_name": " 공덕 "}),
    )
    for path, body in requests:
        response = client.post(path, headers=admin, json=body)
        assert response.status_code == 200, response.text
        assert response.json()["job"]["status"] == "done"
        assert response.json()["inserted"] == 1

    assert calls == [
        ("15126474", {"LAWD_CD": "11440", "DEAL_YMD": "202609"}),
        ("15058453", {"kaptCode": "A10024875"}),
        (
            "15134735",
            {"sigunguCd": "11440", "bjdongCd": "10200", "platGbCd": "0", "bun": "0001", "ji": "0002"},
        ),
        ("15098554", {"subwayStationName": "공덕"}),
    ]


def test_collect_failure_is_sanitized_and_job_finishes(client, admin, monkeypatch):
    def fail(*_args, **_kwargs):
        raise public_catalog.PublicDataError("serviceKey=SHOULD_NOT_LEAK https://example.test/full-url")

    monkeypatch.setattr(api.public_catalog, "fetch_dataset", fail)
    response = client.post(
        "/api/admin/collect/rents", headers=admin, json={"lawd_cd": "11440", "deal_ymd": "202609"}
    )
    assert response.status_code == 503
    assert "SHOULD_NOT_LEAK" not in response.text and "example.test" not in response.text
    jobs = client.get("/api/admin/jobs", headers=admin).json()
    job = next(row for row in jobs if row["kind"] == "public_data:15126474")
    assert job["status"] == "failed"
    assert "SHOULD_NOT_LEAK" not in job["detail"] and "example.test" not in job["detail"]


def test_legacy_trade_collect_sanitizes_exception_response_and_job(client, admin, monkeypatch):
    secret = "FAKE_SECRET_TRADE_URL"

    def fail(*_args, **_kwargs):
        raise public_data.ExternalUnavailable(f"https://example.test?serviceKey={secret}")

    monkeypatch.setattr(api.public_data, "fetch_trades", fail)
    response = client.post(
        "/api/admin/collect/trades", headers=admin, json={"lawd_cd": "11440", "deal_ymd": "202609"}
    )
    assert response.status_code == 503
    assert secret not in response.text and "example.test" not in response.text and "serviceKey" not in response.text
    job = next(row for row in client.get("/api/admin/jobs", headers=admin).json() if row["kind"] == "trades")
    assert job["status"] == "failed"
    assert secret not in job["detail"] and "example.test" not in job["detail"] and "serviceKey" not in job["detail"]


def test_cached_reads_require_auth_and_hide_raw_payload(client, agent, monkeypatch):
    complex_row = {
        "kapt_code": "A10024875",
        "name": "테스트단지",
        "source_key": "internal",
        "raw_payload": {"secret": "raw"},
    }
    monkeypatch.setattr(api.public_sources, "get_complex", lambda _conn, _code: complex_row)
    assert client.get("/api/public-data/complexes/A10024875").status_code == 401
    response = client.get("/api/public-data/complexes/A10024875", headers=agent)
    assert response.status_code == 200
    assert response.json() == {"kapt_code": "A10024875", "name": "테스트단지"}

    monkeypatch.setattr(
        api.public_sources,
        "find_subway_stations",
        lambda _conn, name, limit: [
            {"station_id": "S1", "station_name": name, "raw_payload": {"hidden": True}, "source_key": "x"}
        ][:limit],
    )
    stations = client.get("/api/public-data/subway-stations", params={"q": "공덕"}, headers=agent).json()
    assert stations == {"items": [{"station_id": "S1", "station_name": "공덕"}], "total": 1}


def test_evidence_type_is_filtered_before_search(client, agent, monkeypatch):
    seen = {}

    def fake_search(_conn, _tenant_id, _query, **kwargs):
        seen.update(kwargs)
        return []

    monkeypatch.setattr(api.rag, "search", fake_search)
    response = client.get("/api/evidence/search", params={"q": "계약 신고", "type": "law"}, headers=agent)
    assert response.status_code == 200
    assert seen["source_types"] == ["law"]
