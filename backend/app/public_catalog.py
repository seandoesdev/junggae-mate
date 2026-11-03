"""공공데이터포털 API를 같은 키와 호출 규칙으로 다루는 공통 클라이언트.

데이터셋별 명세가 공식 문서로 확인된 항목만 ``ready`` 로 활성화한다.
명세가 바뀌거나 별도 인증이 필요한 항목을 추측한 URL로 호출하지 않는다.
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from dataclasses import dataclass
from typing import Any, Literal
from urllib.parse import unquote

import httpx

from .config import settings


class PublicDataError(RuntimeError):
    """공공데이터 설정, 명세 또는 원격 응답 오류."""


@dataclass(frozen=True)
class DatasetSpec:
    dataset_id: str
    name: str
    endpoint: str | None
    required_params: tuple[str, ...] = ()
    service_key_param: str = "serviceKey"
    response_format: Literal["xml", "json"] = "xml"
    status: Literal["ready", "planned", "separate_key"] = "planned"
    note: str = ""


DATASETS: dict[str, DatasetSpec] = {
    "15126468": DatasetSpec(
        dataset_id="15126468",
        name="국토교통부 아파트 매매 실거래가 상세 자료",
        endpoint="https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev",
        required_params=("LAWD_CD", "DEAL_YMD"),
        status="ready",
    ),
    "15126474": DatasetSpec(
        dataset_id="15126474",
        name="국토교통부 아파트 전월세 실거래가 자료",
        endpoint="https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent",
        required_params=("LAWD_CD", "DEAL_YMD"),
        status="ready",
    ),
    "15058453": DatasetSpec(
        dataset_id="15058453",
        name="국토교통부 공동주택 기본정보 서비스",
        endpoint="https://apis.data.go.kr/1613000/AptBasisInfoServiceV5/getAphusBassInfoV5",
        required_params=("kaptCode",),
        service_key_param="ServiceKey",
        response_format="json",
        status="ready",
        note="기본정보 조회. 상세정보는 getAphusDtlInfoV5 어댑터 추가 필요",
    ),
    "15134735": DatasetSpec(
        dataset_id="15134735",
        name="국토교통부 건축HUB 건축물대장정보 서비스",
        endpoint="https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo",
        required_params=("sigunguCd", "bjdongCd"),
        status="ready",
        note="표제부 조회. 총괄표제부·층별·전유공용면적은 별도 operation 어댑터 추가 필요",
    ),
    "15057358": DatasetSpec(
        dataset_id="15057358", name="법제처 현행법령 본문 조회", endpoint=None,
        status="separate_key", note="국가법령정보 공동활용 LAW_GO_KR_OC 인증값 필요",
    ),
    "15098554": DatasetSpec(
        dataset_id="15098554",
        name="국토교통부 TAGO 지하철정보",
        endpoint="https://apis.data.go.kr/1613000/SubwayInfo/GetKwrdFndSubwaySttnList",
        required_params=("subwayStationName",),
        response_format="json",
        status="ready",
        note="역명 검색. 출구별 버스·편의시설·시간표는 별도 operation 어댑터 추가 필요",
    ),
    "15058805": DatasetSpec(
        dataset_id="15058805", name="공간정보오픈플랫폼 WMS/WFS", endpoint=None,
        status="separate_key", note="VWorld 운영키와 레이어별 이용조건을 별도로 확인",
    ),
}


def dataset_support() -> list[dict[str, str | None]]:
    """관리 화면과 문서에서 사용할 안전한 지원 현황(키는 포함하지 않음)."""
    return [
        {
            "dataset_id": spec.dataset_id,
            "name": spec.name,
            "status": spec.status,
            "note": spec.note or None,
        }
        for spec in DATASETS.values()
    ]


def normalize_service_key(value: str) -> str:
    """포털의 Encoding/Decoding 키를 httpx params에 넣을 단일 값으로 정규화한다."""
    return unquote(value.strip())


def _xml_error(root: ET.Element) -> str | None:
    code = (root.findtext(".//resultCode") or "").strip()
    if code and code not in {"0", "00", "000", "NORMAL_SERVICE"}:
        return (root.findtext(".//resultMsg") or f"결과코드 {code}").strip()
    gateway = (root.findtext(".//cmmMsgHeader/errMsg") or "").strip()
    if gateway:
        auth = (root.findtext(".//cmmMsgHeader/returnAuthMsg") or "").strip()
        return " / ".join(part for part in (gateway, auth) if part)
    return None


def _parse_xml(text: str) -> tuple[list[dict[str, str | None]], int | None, int]:
    try:
        root = ET.fromstring(text)
    except ET.ParseError as exc:
        raise PublicDataError("공공데이터 XML 응답을 해석하지 못했습니다.") from exc
    if error := _xml_error(root):
        raise PublicDataError(f"공공데이터 API 오류: {error}")
    items = [{child.tag: child.text for child in item} for item in root.iter("item")]
    total_text = root.findtext(".//totalCount")
    try:
        total = int(total_text) if total_text is not None else None
    except ValueError:
        total = None
    return items, total, len(items)


def _dig(payload: Any, *path: str) -> Any:
    current = payload
    for key in path:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def _parse_json(response: httpx.Response) -> tuple[list[dict[str, Any]], int | None, int]:
    try:
        payload = response.json()
    except ValueError as exc:
        raise PublicDataError("공공데이터 JSON 응답을 해석하지 못했습니다.") from exc
    header = _dig(payload, "response", "header") or payload.get("header", {})
    code = str(header.get("resultCode", "")).strip()
    if code and code not in {"0", "00", "000", "NORMAL_SERVICE"}:
        raise PublicDataError(f"공공데이터 API 오류: {header.get('resultMsg') or code}")
    body = _dig(payload, "response", "body") or payload.get("body", {})
    raw_items = body.get("items", []) if isinstance(body, dict) else []
    if isinstance(raw_items, dict):
        raw_items = raw_items.get("item", raw_items.get("items", []))
    if isinstance(raw_items, dict):
        items = [raw_items]
    elif isinstance(raw_items, list):
        items = [item for item in raw_items if isinstance(item, dict)]
    else:
        items = []
    try:
        total = int(body["totalCount"]) if isinstance(body, dict) and body.get("totalCount") is not None else None
    except (TypeError, ValueError):
        total = None
    return items, total, len(items)


def fetch_dataset(
    dataset_id: str,
    params: dict[str, str | int],
    *,
    service_key: str | None = None,
    page_size: int = 1000,
    max_pages: int = 100,
    client: httpx.Client | None = None,
) -> list[dict[str, Any]]:
    """활성 데이터셋의 모든 페이지를 조회한다.

    ``client`` 주입은 테스트와 연결 재사용을 위한 것이며, 호출자가 넘긴 클라이언트는
    이 함수가 닫지 않는다.
    """
    spec = DATASETS.get(dataset_id)
    if spec is None:
        raise PublicDataError(f"등록되지 않은 공공데이터셋입니다: {dataset_id}")
    if spec.status != "ready" or not spec.endpoint:
        suffix = f" ({spec.note})" if spec.note else ""
        raise PublicDataError(f"{spec.name}은 아직 직접 호출이 활성화되지 않았습니다{suffix}.")
    missing = [name for name in spec.required_params if str(params.get(name, "")).strip() == ""]
    if missing:
        raise PublicDataError(f"필수 파라미터가 없습니다: {', '.join(missing)}")
    raw_key = settings.data_go_kr_key if service_key is None else service_key
    key = normalize_service_key(raw_key)
    if not key:
        raise PublicDataError("DATA_GO_KR_SERVICE_KEY가 설정되지 않았습니다.")
    if page_size < 1 or max_pages < 1:
        raise PublicDataError("page_size와 max_pages는 1 이상이어야 합니다.")

    owns_client = client is None
    http = client or httpx.Client(timeout=settings.external_timeout)
    rows: list[dict[str, Any]] = []
    try:
        for page_no in range(1, max_pages + 1):
            query = {
                **params,
                spec.service_key_param: key,
                "pageNo": page_no,
                "numOfRows": page_size,
            }
            response = http.get(spec.endpoint, params=query)
            if spec.response_format == "json":
                page_rows, total, count = _parse_json(response)
            else:
                page_rows, total, count = _parse_xml(response.text)
            response.raise_for_status()
            rows.extend(page_rows)
            if total is not None and page_no * page_size >= total:
                return rows
            if total is None and count < page_size:
                return rows
    except httpx.HTTPError as exc:
        raise PublicDataError(f"공공데이터 API 호출 실패: {exc}") from exc
    finally:
        if owns_client:
            http.close()
    raise PublicDataError(f"공공데이터 페이지가 안전 한도({max_pages})를 초과했습니다.")
