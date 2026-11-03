"""승인된 공공데이터 API 인증 상태를 키 노출 없이 확인한다.

실데이터를 저장하지 않는 운영 전용 스모크 테스트다. URL과 서비스키는 출력하지 않는다.
"""

from __future__ import annotations

import json
import re
import sys
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote

import httpx

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "backend"))

from app.config import settings  # noqa: E402 - 프로젝트 backend를 실행 경로에 추가한 뒤 import


@dataclass(frozen=True)
class Probe:
    name: str
    url: str
    key_param: str
    params: dict[str, str]


PROBES = (
    Probe(
        "15126468 sale",
        "https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev",
        "serviceKey",
        {"LAWD_CD": "11440", "DEAL_YMD": "202609"},
    ),
    Probe(
        "15126474 rent",
        "https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent",
        "serviceKey",
        {"LAWD_CD": "11440", "DEAL_YMD": "202609"},
    ),
    Probe(
        "15058453 K-apt",
        "https://apis.data.go.kr/1613000/AptBasisInfoServiceV5/getAphusBassInfoV5",
        "ServiceKey",
        {"kaptCode": "A10024875"},
    ),
    Probe(
        "15134735 building",
        "https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo",
        "serviceKey",
        {"sigunguCd": "11440", "bjdongCd": "10200", "platGbCd": "0", "bun": "0001", "ji": "0000"},
    ),
    Probe(
        "15098554 subway",
        "https://apis.data.go.kr/1613000/SubwayInfo/GetKwrdFndSubwaySttnList",
        "serviceKey",
        {"subwayStationName": "공덕"},
    ),
)


def _result(text: str) -> tuple[str, int]:
    try:
        payload = json.loads(text)
        response = payload.get("response", payload)
        header = response.get("header", {})
        body = response.get("body", {})
        items = body.get("items", []) if isinstance(body, dict) else []
        if isinstance(items, dict):
            items = items.get("item", [])
        count = len(items) if isinstance(items, list) else int(bool(items))
        return str(header.get("resultCode", "UNKNOWN")), count
    except (ValueError, TypeError, AttributeError):
        pass
    try:
        root = ET.fromstring(text)
        code = root.findtext(".//resultCode") or root.findtext(".//returnReasonCode") or "UNKNOWN"
        return code.strip(), len(list(root.iter("item")))
    except ET.ParseError:
        match = re.search(r"<resultCode>([^<]+)", text)
        return (match.group(1).strip() if match else "UNPARSEABLE"), 0


def _env_file_key() -> str:
    path = PROJECT_ROOT / ".env"
    if not path.exists():
        return ""
    for raw_line in path.read_text(encoding="utf-8-sig").splitlines():
        key, separator, value = raw_line.partition("=")
        if separator and key.strip() == "DATA_GO_KR_SERVICE_KEY":
            return value.strip().strip('"').strip("'")
    return ""


def main() -> int:
    key = unquote((settings.data_go_kr_key or _env_file_key()).strip())
    if not key:
        print("DATA_GO_KR_SERVICE_KEY: MISSING")
        return 1
    print("DATA_GO_KR_SERVICE_KEY: SET (value hidden)")
    failed = False
    with httpx.Client(timeout=settings.external_timeout) as client:
        for probe in PROBES:
            try:
                response = client.get(
                    probe.url,
                    params={probe.key_param: key, "pageNo": 1, "numOfRows": 1, **probe.params},
                )
                code, count = _result(response.text)
                ok = response.status_code == 200 and code in {"0", "00", "000", "NORMAL_SERVICE"}
                print(
                    f"{probe.name}: {'OK' if ok else 'FAIL'} "
                    f"http={response.status_code} result={code} sample_items={count}"
                )
                failed = failed or not ok
            except httpx.HTTPError as exc:
                print(f"{probe.name}: ERROR {type(exc).__name__} (request details hidden)")
                failed = True
    return int(failed)


if __name__ == "__main__":
    raise SystemExit(main())
