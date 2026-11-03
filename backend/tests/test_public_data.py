"""공공데이터포털 실거래가 어댑터 단위 테스트."""
from datetime import date
from types import SimpleNamespace

import httpx
import pytest

from app import public_data


def _xml(items: str, *, total: int = 1, page: int = 1, rows: int = 1000) -> str:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
    <response><header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header>
    <body><items>{items}</items><numOfRows>{rows}</numOfRows><pageNo>{page}</pageNo>
    <totalCount>{total}</totalCount></body></response>"""


def _item(name: str, *, day: str = "3", cancelled: str = "") -> str:
    return f"""<item><umdNm>망원동</umdNm><aptNm>{name}</aptNm><excluUseAr>59.98</excluUseAr>
    <dealYear>2026</dealYear><dealMonth>9</dealMonth><dealDay>{day}</dealDay>
    <dealAmount>123,456</dealAmount><floor>7</floor><cdealType>{cancelled}</cdealType></item>"""


def _response(body: str, status: int = 200) -> httpx.Response:
    return httpx.Response(status, text=body, request=httpx.Request("GET", public_data.TRADE_URL))


def test_parse_trades_keeps_valid_rows_and_skips_cancelled_or_malformed_rows():
    xml = _xml(_item("유효단지") + _item("해제단지", cancelled="O") + _item("오류단지", day="32"), total=3)

    rows = public_data.parse_trades(xml, "11440")

    assert rows == [{
        "lawd_cd": "11440", "district": "마포구", "dong": "망원동", "complex_name": "유효단지",
        "area_m2": 59.98, "price": 123456, "deal_date": date(2026, 9, 3), "floor": 7,
        "source": public_data.TRADE_SOURCE,
    }]


def test_fetch_trades_uses_latest_endpoint_decodes_key_and_reads_all_pages(monkeypatch):
    calls = []
    responses = [
        _response(_xml(_item("첫단지"), total=1001, page=1)),
        _response(_xml(_item("끝단지", day="4"), total=1001, page=2)),
    ]

    def fake_get(url, *, params, timeout):
        calls.append((url, params, timeout))
        return responses.pop(0)

    monkeypatch.setattr(public_data, "settings", SimpleNamespace(
        data_go_kr_key="abc%2Bdef%2Fghi%3D", external_timeout=3,
    ))
    monkeypatch.setattr(public_data.httpx, "get", fake_get)
    public_data.trade_breaker.success()

    rows = public_data.fetch_trades("11440", "202609")

    assert [row["complex_name"] for row in rows] == ["첫단지", "끝단지"]
    assert [call[1]["pageNo"] for call in calls] == [1, 2]
    assert all(call[0] == public_data.TRADE_URL for call in calls)
    assert all(call[1]["serviceKey"] == "abc+def/ghi=" for call in calls)


def test_fetch_trades_surfaces_gateway_auth_error(monkeypatch):
    error = """<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE_KEY_IS_NULL</errMsg>
    <returnAuthMsg>서비스 접근거부</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>"""
    monkeypatch.setattr(public_data, "settings", SimpleNamespace(data_go_kr_key="bad", external_timeout=3))
    monkeypatch.setattr(public_data.httpx, "get", lambda *args, **kwargs: _response(error, 401))
    public_data.trade_breaker.success()

    with pytest.raises(public_data.ExternalUnavailable, match="SERVICE_KEY_IS_NULL.*서비스 접근거부"):
        public_data.fetch_trades("11440", "202609")


def test_fetch_trades_requires_configured_key(monkeypatch):
    monkeypatch.setattr(public_data, "settings", SimpleNamespace(data_go_kr_key="", external_timeout=3))

    with pytest.raises(public_data.ExternalUnavailable, match="설정되지 않았습니다"):
        public_data.fetch_trades("11440", "202609")


def test_fetch_trades_sanitizes_http_error_url_and_service_key(monkeypatch):
    secret = "FAKE_SECRET_SHOULD_NOT_LEAK"
    request = httpx.Request("GET", f"{public_data.TRADE_URL}?serviceKey={secret}")
    response = httpx.Response(503, request=request)

    def fail(*_args, **_kwargs):
        raise httpx.HTTPStatusError("upstream failed", request=request, response=response)

    monkeypatch.setattr(public_data, "settings", SimpleNamespace(data_go_kr_key=secret, external_timeout=3))
    monkeypatch.setattr(public_data.httpx, "get", fail)
    public_data.trade_breaker.success()
    with pytest.raises(public_data.ExternalUnavailable) as caught:
        public_data.fetch_trades("11440", "202609")
    assert str(caught.value) == public_data.TRADE_UNAVAILABLE_MESSAGE
    assert secret not in str(caught.value) and "serviceKey" not in str(caught.value)
