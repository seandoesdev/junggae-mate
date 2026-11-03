from urllib.parse import parse_qs

import httpx
import pytest

from app import public_catalog


def client_for(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_missing_key_is_explicit():
    with pytest.raises(public_catalog.PublicDataError, match="DATA_GO_KR_SERVICE_KEY"):
        public_catalog.fetch_dataset(
            "15126468", {"LAWD_CD": "11440", "DEAL_YMD": "202609"}, service_key=""
        )


def test_planned_dataset_is_not_called():
    with pytest.raises(public_catalog.PublicDataError, match="아직 직접 호출이 활성화되지 않았습니다"):
        public_catalog.fetch_dataset("15057358", {}, service_key="secret")


def test_xml_pagination_and_encoded_key():
    requests = []

    def handler(request: httpx.Request):
        requests.append(request)
        query = parse_qs(request.url.query.decode())
        page = int(query["pageNo"][0])
        items = (
            "<item><aptNm>A</aptNm></item><item><aptNm>B</aptNm></item>"
            if page == 1
            else "<item><aptNm>C</aptNm></item>"
        )
        return httpx.Response(
            200,
            text=f"<response><header><resultCode>00</resultCode></header>"
            f"<body><items>{items}</items><totalCount>3</totalCount></body></response>",
        )

    with client_for(handler) as client:
        rows = public_catalog.fetch_dataset(
            "15126468",
            {"LAWD_CD": "11440", "DEAL_YMD": "202609"},
            service_key="abc%2B%2F%3D",
            page_size=2,
            client=client,
        )
    assert [row["aptNm"] for row in rows] == ["A", "B", "C"]
    assert len(requests) == 2
    assert parse_qs(requests[0].url.query.decode())["serviceKey"] == ["abc+/="]


def test_xml_gateway_error_is_preserved():
    def handler(_request: httpx.Request):
        return httpx.Response(
            401,
            text="<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE KEY IS NOT REGISTERED ERROR.</errMsg>"
            "<returnAuthMsg>등록되지 않은 서비스키</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>",
        )

    with client_for(handler) as client, pytest.raises(public_catalog.PublicDataError, match="등록되지 않은 서비스키"):
        public_catalog.fetch_dataset(
            "15126468", {"LAWD_CD": "11440", "DEAL_YMD": "202609"}, service_key="bad", client=client
        )


def test_required_parameters_are_validated_before_network():
    with pytest.raises(public_catalog.PublicDataError, match="DEAL_YMD"):
        public_catalog.fetch_dataset("15126468", {"LAWD_CD": "11440"}, service_key="secret")


def test_kapt_uses_documented_service_key_casing():
    seen = {}

    def handler(request: httpx.Request):
        seen.update(parse_qs(request.url.query.decode()))
        return httpx.Response(
            200,
            json={
                "response": {
                    "header": {"resultCode": "00", "resultMsg": "NORMAL SERVICE"},
                    "body": {
                        "items": {"item": [{"kaptCode": "A1001"}]},
                        "totalCount": 1,
                    },
                }
            },
        )

    with client_for(handler) as client:
        rows = public_catalog.fetch_dataset(
            "15058453", {"kaptCode": "A1001"}, service_key="key", client=client
        )
    assert rows == [{"kaptCode": "A1001"}]
    assert seen["ServiceKey"] == ["key"]
    assert "serviceKey" not in seen


def test_subway_parses_json_response():
    def handler(_request: httpx.Request):
        return httpx.Response(
            200,
            json={
                "response": {
                    "header": {"resultCode": "00", "resultMsg": "NORMAL SERVICE."},
                    "body": {
                        "items": {
                            "item": [
                                {
                                    "subwayStationId": "MTR123",
                                    "subwayStationName": "공덕",
                                    "subwayRouteName": "5호선",
                                }
                            ]
                        },
                        "totalCount": 1,
                    },
                }
            },
        )

    with client_for(handler) as client:
        rows = public_catalog.fetch_dataset(
            "15098554", {"subwayStationName": "공덕"}, service_key="key", client=client
        )
    assert rows == [
        {"subwayStationId": "MTR123", "subwayStationName": "공덕", "subwayRouteName": "5호선"}
    ]
