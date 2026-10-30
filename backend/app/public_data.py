"""공개데이터 직접 API 어댑터 (MCP 없이 동작). 시간초과 + 간단한 회로 차단기로 외부 장애를 격리한다."""
import time
import xml.etree.ElementTree as ET
from datetime import date

import httpx

from .config import settings

TRADE_URL = "https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade"
TRADE_SOURCE = "국토교통부 아파트 매매 실거래가 (data.go.kr 15126468)"

# 법정동 코드 앞 5자리 → 구 이름 (MVP 범위)
LAWD = {"11440": "마포구", "11410": "서대문구", "11170": "용산구", "11560": "영등포구"}


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


def parse_trades(xml_text: str, lawd_cd: str) -> list[dict]:
    root = ET.fromstring(xml_text)
    code = root.findtext(".//resultCode")
    if code not in (None, "00", "000"):
        raise ExternalUnavailable(f"실거래가 API 오류: {root.findtext('.//resultMsg')}")
    out = []
    for item in root.iter("item"):
        y, m, d = _int(item.findtext("dealYear")), _int(item.findtext("dealMonth")), _int(item.findtext("dealDay"))
        price, area = _int(item.findtext("dealAmount")), item.findtext("excluUseAr")
        if not (y and m and d and price and area):
            continue
        out.append({
            "lawd_cd": lawd_cd, "district": LAWD.get(lawd_cd, lawd_cd), "dong": (item.findtext("umdNm") or "").strip(),
            "complex_name": (item.findtext("aptNm") or "").strip(), "area_m2": float(area), "price": price,
            "deal_date": date(y, m, d), "floor": _int(item.findtext("floor")), "source": TRADE_SOURCE,
        })
    return out


def fetch_trades(lawd_cd: str, deal_ymd: str) -> list[dict]:
    if not settings.data_go_kr_key:
        raise ExternalUnavailable("DATA_GO_KR_SERVICE_KEY가 설정되지 않았습니다.")
    trade_breaker.check()
    try:
        resp = httpx.get(TRADE_URL, params={"serviceKey": settings.data_go_kr_key, "LAWD_CD": lawd_cd,
                                            "DEAL_YMD": deal_ymd, "numOfRows": 1000, "pageNo": 1},
                         timeout=settings.external_timeout)
        resp.raise_for_status()
        rows = parse_trades(resp.text, lawd_cd)
    except (httpx.HTTPError, ET.ParseError, ExternalUnavailable) as e:
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
