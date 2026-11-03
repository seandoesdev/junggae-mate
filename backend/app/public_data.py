"""공개데이터 직접 API 어댑터 (MCP 없이 동작). 시간초과 + 간단한 회로 차단기로 외부 장애를 격리한다."""
import time
import xml.etree.ElementTree as ET
from datetime import date
from urllib.parse import unquote

import httpx

from .config import settings

TRADE_URL = "https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev"
TRADE_SOURCE = "국토교통부 아파트 매매 실거래가 (data.go.kr 15126468)"
TRADE_PAGE_SIZE = 1000
MAX_TRADE_PAGES = 100
TRADE_UNAVAILABLE_MESSAGE = "실거래가 수집에 실패했습니다. 승인 상태와 요청 조건을 확인해 주세요."

# 시연 데이터와 매매 파서가 사람이 읽을 수 있는 이름을 만들 때 쓰는 알려진 코드다.
# 전월세 근거 조회는 이 목록에 의존하지 않고 DB에 실제 적재된 법정동 코드를
# 매물 주소와 대조한다(see structured._rent_lawd_cd).
LAWD = {"11440": "마포구", "11410": "서대문구", "11170": "용산구", "11560": "영등포구"}

# 법정동 코드 앞 두 자리의 광역자치단체. 구 이름이 전국에서 중복될 때 매물
# 주소의 시·도와 함께 안전하게 코드를 고르는 용도다. 강원/전북의 구·신 코드도
# 모두 받아 이미 수집된 과거 자료와 현재 자료를 함께 처리한다.
LAWD_REGION = {
    "11": "서울", "26": "부산", "27": "대구", "28": "인천", "29": "광주", "30": "대전",
    "31": "울산", "36": "세종", "41": "경기", "42": "강원", "43": "충북", "44": "충남",
    "45": "전북", "46": "전남", "47": "경북", "48": "경남", "50": "제주", "51": "강원",
    "52": "전북",
}


class ExternalUnavailable(RuntimeError):
    pass


class CircuitBreaker:
    def __init__(self, threshold: int = 3, cooldown: float = 60.0):
        self.threshold, self.cooldown = threshold, cooldown
        self.failures, self.opened_at = 0, 0.0

    def check(self) -> None:
        if self.failures >= self.threshold and time.monotonic() - self.opened_at < self.cooldown:
            raise ExternalUnavailable("외부 기관 연동이 일시 차단되었습니다(회로 차단기). 잠시 후 다시 시도하세요.")

    def success(self) -> None:
        self.failures = 0

    def failure(self) -> None:
        self.failures += 1
        if self.failures >= self.threshold:
            self.opened_at = time.monotonic()


trade_breaker = CircuitBreaker()


def _int(text: str | None) -> int | None:
    try:
        return int(str(text).replace(",", "").strip())
    except (TypeError, ValueError):
        return None


def _float(text: str | None) -> float | None:
    try:
        return float(str(text).replace(",", "").strip())
    except (TypeError, ValueError):
        return None


def _api_error(root: ET.Element) -> str | None:
    """정상 응답 헤더와 게이트웨이 인증 오류 응답을 같은 방식으로 읽는다."""
    code = (root.findtext(".//resultCode") or "").strip()
    if code and code not in {"00", "000", "0"}:
        return (root.findtext(".//resultMsg") or f"결과코드 {code}").strip()

    gateway_error = (root.findtext(".//cmmMsgHeader/errMsg") or "").strip()
    if gateway_error:
        auth_message = (root.findtext(".//cmmMsgHeader/returnAuthMsg") or "").strip()
        return " / ".join(part for part in (gateway_error, auth_message) if part)
    return None


def _parse_trade_page(xml_text: str, lawd_cd: str) -> tuple[list[dict], int | None, int]:
    root = ET.fromstring(xml_text)
    if error := _api_error(root):
        raise ExternalUnavailable(f"실거래가 API 오류: {error}")

    out = []
    item_count = 0
    for item in root.iter("item"):
        item_count += 1
        # 해제된 계약을 현재 유효한 실거래 사례처럼 집계하지 않는다.
        if (item.findtext("cdealType") or "").strip():
            continue
        y, m, d = _int(item.findtext("dealYear")), _int(item.findtext("dealMonth")), _int(item.findtext("dealDay"))
        price, area = _int(item.findtext("dealAmount")), _float(item.findtext("excluUseAr"))
        if not (y and m and d and price and area is not None):
            continue
        try:
            deal_date = date(y, m, d)
        except ValueError:
            continue
        out.append({
            "lawd_cd": lawd_cd, "district": LAWD.get(lawd_cd, lawd_cd), "dong": (item.findtext("umdNm") or "").strip(),
            "complex_name": (item.findtext("aptNm") or "").strip(), "area_m2": float(area), "price": price,
            "deal_date": deal_date, "floor": _int(item.findtext("floor")), "source": TRADE_SOURCE,
        })
    return out, _int(root.findtext(".//totalCount")), item_count


def parse_trades(xml_text: str, lawd_cd: str) -> list[dict]:
    """단일 응답을 파싱한다. 기존 호출부와 테스트 호환을 위한 공개 함수다."""
    return _parse_trade_page(xml_text, lawd_cd)[0]


def fetch_trades(lawd_cd: str, deal_ymd: str) -> list[dict]:
    if not settings.data_go_kr_key:
        raise ExternalUnavailable("DATA_GO_KR_SERVICE_KEY가 설정되지 않았습니다.")
    trade_breaker.check()
    try:
        # 포털은 Encoding/Decoding 키를 함께 보여준다. params에 넣기 전 한 번
        # 디코딩하면 httpx가 정확히 한 번만 URL 인코딩한다.
        service_key = unquote(settings.data_go_kr_key.strip())
        rows: list[dict] = []
        page_no = 1
        while page_no <= MAX_TRADE_PAGES:
            resp = httpx.get(
                TRADE_URL,
                params={"serviceKey": service_key, "LAWD_CD": lawd_cd, "DEAL_YMD": deal_ymd,
                        "numOfRows": TRADE_PAGE_SIZE, "pageNo": page_no},
                timeout=settings.external_timeout,
            )
            # HTTP 401도 XML 게이트웨이 오류 본문을 주므로 먼저 파싱해 유용한
            # 원인을 남기고, XML이 아닌 HTTP 오류는 raise_for_status로 처리한다.
            page_rows, total_count, item_count = _parse_trade_page(resp.text, lawd_cd)
            resp.raise_for_status()
            rows.extend(page_rows)

            if total_count is not None:
                if page_no * TRADE_PAGE_SIZE >= total_count:
                    break
            elif item_count < TRADE_PAGE_SIZE:
                break
            page_no += 1
        else:
            raise ExternalUnavailable(f"실거래가 API 페이지가 안전 한도({MAX_TRADE_PAGES})를 초과했습니다.")
    except httpx.HTTPError as e:
        # HTTPStatusError 문자열에는 serviceKey가 든 전체 요청 URL이 포함될 수
        # 있으므로 외부로 전달되는 메시지는 고정한다.
        trade_breaker.failure()
        raise ExternalUnavailable(TRADE_UNAVAILABLE_MESSAGE) from e
    except ET.ParseError as e:
        trade_breaker.failure()
        raise ExternalUnavailable(TRADE_UNAVAILABLE_MESSAGE) from e
    except ExternalUnavailable as e:
        trade_breaker.failure()
        raise ExternalUnavailable(f"실거래가 수집 실패: {e}") from e
    trade_breaker.success()
    return rows


def store_trades(conn, rows: list[dict]) -> int:
    inserted = 0
    for r in rows:
        cur = conn.execute(
            """INSERT INTO apt_trades (lawd_cd, district, dong, complex_name, area_m2, price, deal_date, floor, source)
               VALUES (%(lawd_cd)s,%(district)s,%(dong)s,%(complex_name)s,%(area_m2)s,%(price)s,%(deal_date)s,%(floor)s,%(source)s)
               ON CONFLICT DO NOTHING""",
            r,
        )
        inserted += cur.rowcount
    return inserted
