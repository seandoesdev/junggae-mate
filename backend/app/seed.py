"""시연용 시드 데이터. 모든 문서·매물·거래는 샘플이며 실제 정책/매물과 무관하다(제목에 [샘플] 표기)."""
import logging
from datetime import date

from . import public_sources as ps
from . import rag
from .db import tx
from .security import hash_password

log = logging.getLogger("mate.seed")

EFFECTIVE_KEY = "first_home_support.effective_date"
EFFECTIVE_LABEL = "생애최초 주택 구입 지원 시행일"

AGENTS_T1 = [  # key, email, name, role
    ("kim", "agent@hanul.test", "김선용", "agent"),
    ("park", "park@hanul.test", "박지은", "agent"),
    ("lee", "lee@hanul.test", "이도현", "agent"),
    ("admin", "admin@hanul.test", "하늘 관리자", "admin"),
]

LISTINGS_T1 = [
    # label, title, complex, price(만원), area, floor, station, walk, park, lat, lng, 담당, 가격 이력
    ("A", "마포한강뷰 59", "마포한강뷰", 78000, 59.9, "7/15층", "공덕역", 7, 9, 37.5428, 126.9497, "kim", []),
    ("B", "마포공원앞 62", "마포공원앞", 75000, 62.3, "5/12층", "공덕역", 9, 3, 37.5462, 126.9568, "kim", [(77000, "2026-10-01"), (75000, "2026-10-22")]),
    ("C", "공덕역세권 59", "공덕역세권", 80000, 59.8, "12/20층", "공덕역", 4, 15, 37.5446, 126.9520, "kim", []),
    ("D", "마포래미안 84", "마포래미안", 115000, 84.9, "15/25층", "애오개역", 6, 8, 37.5530, 126.9560, "park", []),
    ("E", "아현숲 49", "아현숲", 72000, 49.5, "3/10층", "아현역", 5, 4, 37.5575, 126.9560, "kim", []),
    ("F", "도화현대 59", "도화현대", 76000, 59.5, "9/18층", "마포역", 14, 6, 37.5395, 126.9465, "park", [(78000, "2026-09-15"), (76000, "2026-10-10")]),
    ("G", "신공덕숲길 60", "신공덕숲길", 79000, 60.1, "17/22층", "공덕역", 10, 6, 37.5480, 126.9530, "kim", []),
    ("H", "염리언덕 59", "염리언덕", 68000, 59.2, "4/8층", "대흥역", 8, 5, 37.5490, 126.9440, "lee", []),
    ("I", "대흥래미안 84", "대흥래미안", 92000, 84.0, "11/19층", "대흥역", 5, 7, 37.5478, 126.9408, "lee", []),
    ("J", "용강리버뷰 59", "용강리버뷰", 83000, 59.9, "20/25층", "마포역", 6, 4, 37.5385, 126.9420, "kim", []),
    ("K", "공덕자이 74", "공덕자이", 99000, 74.5, "8/21층", "공덕역", 3, 10, 37.5432, 126.9555, "park", []),
    ("L", "마포한신 52", "마포한신", 64000, 52.0, "6/12층", "애오개역", 9, 6, 37.5515, 126.9500, "lee", []),
]
# 매물 설명 (중개사가 등록할 때 적는 내용, 샘플)
DESCRIPTIONS = {
    "A": "남향 판상형. 거실에서 한강 일부 조망. 단지 안쪽 동이라 조용한 편.",
    "B": "공원 바로 앞 단지. 저층이라 공원 산책로 소음이 조금 있음. 가격 조정됨.",
    "C": "공덕역 4번 출구 도보 4분. 2019년 준공 신축급. 주차 세대당 1.3대.",
    "D": "84㎡ 대형 평면, 방 3개 욕실 2개. 2021년 전체 수리.",
    "E": "소형 평면, 아현역 가까움. 첫 집으로 문의 많음.",
    "F": "마포역까지는 멀지만 버스 노선 많음. 동향.",
    "G": "숲길 공원 인접, 고층이라 조망 좋음. 조용한 주거지.",
    "H": "언덕 위 저층 단지, 가격 부담 적음. 엘리베이터 없음.",
    "I": "84㎡, 남향, 초등학교 도보 5분. 학군 수요 많음.",
    "J": "한강 조망 좋은 고층. 주차 여유. 마포역 도보 6분.",
    "K": "공덕역 초역세권, 2018년 준공. 남향.",
    "L": "소형, 리모델링 완료. 애오개역 도보 9분.",
}
NOTES = [  # 매물, 담당 키, 현장 메모
    ("A", "kim", "10/27 현장 확인: 남향, 오후 햇빛 좋음. 엘리베이터 교체 공사 11월 예정."),
    ("B", "kim", "매도인 이사 일정 12월 말 희망. 가격 추가 조정 여지 있음."),
    ("G", "kim", "단지 뒤 숲길 산책로 바로 연결. 밤에 조용함."),
    ("K", "park", "관리비 월 32만 원 수준(84㎡ 기준 아님, 74㎡). 하자 보수 1건 진행 중."),
]

# 시연용 공공데이터: 실제 API 응답과 같은 필드명으로 만들어 public_sources의 정규화·저장 경로를 그대로 거친다
PUBLIC_RENTS = [  # 단지, 면적, (계약일, 보증금 만원, 월세 만원)
    ("마포한강뷰", 59.9, [("2026-06-12", 52000, 0), ("2026-08-03", 53500, 0), ("2026-09-21", 30000, 95), ("2026-10-08", 54000, 0)]),
    ("마포공원앞", 62.3, [("2026-07-15", 49000, 0), ("2026-09-02", 25000, 110)]),
    ("공덕역세권", 59.8, [("2026-05-30", 55000, 0), ("2026-08-19", 56000, 0), ("2026-10-11", 57000, 0)]),
]
PUBLIC_COMPLEXES = [  # 코드, 단지명, 주소, 난방, 사용승인, 동수, 세대수
    ("A10027001", "마포한강뷰", "서울특별시 마포구 공덕동 (샘플)", "개별난방", "20140321", 6, 612),
    ("A10027002", "마포공원앞", "서울특별시 마포구 공덕동 (샘플)", "지역난방", "20090815", 4, 388),
    ("A10027003", "공덕역세권", "서울특별시 마포구 공덕동 (샘플)", "지역난방", "20190228", 3, 254),
    ("A10027004", "마포한강뷰2차", "서울특별시 마포구 도화동 (샘플)", "개별난방", "20160910", 2, 140),
]
PUBLIC_BUILDINGS = [  # 건물명, 지번, 주용도, 구조, 연면적, 세대수, 사용승인
    ("마포한강뷰", "서울특별시 마포구 공덕동 100 (샘플)", "공동주택", "철근콘크리트구조", "68420.5", 612, "20140321"),
    ("공덕역세권", "서울특별시 마포구 공덕동 220 (샘플)", "공동주택", "철근콘크리트구조", "30410.0", 254, "20190228"),
]
PUBLIC_STATIONS = [  # 역 ID, 역명, 노선 ID, 노선명
    ("MTRS15529", "공덕", "S1105", "5호선"), ("MTRS16626", "공덕", "S1106", "6호선"),
    ("MTRKRK312", "공덕", "S110K", "경의중앙선"), ("MTRAR0A06", "공덕", "S110A", "공항철도"),
    ("MTRS15530", "애오개", "S1105", "5호선"), ("MTRS15528", "마포", "S1105", "5호선"),
    ("MTRS16625", "대흥", "S1106", "6호선"), ("MTRS12241", "아현", "S1102", "2호선"),
]
SAMPLE = " (시연용 샘플)"

LISTINGS_T2 = [("A", "연희언덕집 59", "연희언덕", 69000, 59.0, "2/5층", "신촌역", 12, 5, 37.5660, 126.9300, "other", [])]

CUSTOMERS_T1 = [
    # name, 담당, phone, budget, area_min, walk, preferences, first_home
    ("김하늘", "kim", "010-****-2481", 80000, 59, 10, ["통학", "공원", "조용한 주거지"], True),
    ("박서준", "kim", "010-****-7720", 100000, 59, 15, ["역세권"], False),
    ("최유나", "park", "010-****-1104", 100000, 74, 10, [], False),
    ("정민호", "kim", "010-****-5093", 82000, 49, 10, ["역세권"], False),
    ("한소희", "lee", "010-****-3361", 70000, 52, 15, [], True),
    ("오지훈", "park", "010-****-8842", 85000, 59, 12, ["공원"], False),
    ("윤채원", "kim", "010-****-0157", 82000, 59, 10, ["공원", "통학"], True),
]

DEALS_T1 = [
    # 매물, 고객, 단계, 다음 할 일 / 무산 사유, 단계 바뀐 날
    ("A", "김하늘", "nego", "11/1 매도인에게 7.6억 제안 전달", "2026-10-28"),
    ("B", "김하늘", "visit", "11/2 14:00 2차 방문", "2026-10-26"),
    ("E", "김하늘", "dropped", "전용 59㎡ 미만", "2026-10-24"),
    ("C", "정민호", "intro", "관심 여부 전화 확인", "2026-10-29"),
    ("G", "오지훈", "contract", "11/15 중도금", "2026-10-25"),
    ("D", "박서준", "visit", "11/3 오전 방문", "2026-10-27"),
    ("K", "최유나", "nego", "관리비·하자 보수 조건 조율", "2026-10-24"),
    ("L", "한소희", "done", "10/20 잔금 완료", "2026-10-20"),
    ("I", "최유나", "intro", "평면도 전달", "2026-10-28"),
    ("J", "박서준", "intro", "조망 사진 전달", "2026-10-29"),
    ("H", "한소희", "dropped", "다른 매물 계약", "2026-10-18"),
    ("F", "오지훈", "intro", "방문 일정 조율", "2026-10-23"),
    ("A", "박서준", "intro", "조망 사진 전달", "2026-10-29"),
]

TRADES = [
    ("마포한강뷰", 59.9, [(76500, "2026-03-11"), (77000, "2026-05-20"), (76000, "2026-07-02"), (77800, "2026-09-14")]),
    ("마포공원앞", 62.3, [(74000, "2026-02-03"), (75500, "2026-06-18"), (76000, "2026-08-27")]),
    ("공덕역세권", 59.8, [(79000, "2026-04-09"), (80500, "2026-08-05")]),
    ("신공덕숲길", 60.1, [(77500, "2026-06-30")]),
]

DOCS = [
    dict(tenant=None, source_type="law", title="[샘플] 부동산 거래신고 등에 관한 법률 (발췌)", publisher="법제처 국가법령정보 (샘플 발췌)",
         published_at="2026-01-01", url="https://www.law.go.kr/", text=(
             "제3조(부동산 거래의 신고) ① 거래당사자는 부동산의 매매계약을 체결한 경우 그 실제 거래가격 등을 거래계약의 체결일부터 "
             "30일 이내에 그 권리의 대상인 부동산등의 소재지를 관할하는 시장·군수 또는 구청장에게 공동으로 신고하여야 한다.\n"
             "제3조의2(부동산 거래의 해제등 신고) ① 거래당사자는 부동산 거래 신고를 한 후 해당 거래계약이 해제, 무효 또는 취소된 경우 "
             "해제등이 확정된 날부터 30일 이내에 해당 신고관청에 공동으로 신고하여야 한다.")),
    dict(tenant=None, source_type="law", title="[샘플] 공인중개사법 (발췌)", publisher="법제처 국가법령정보 (샘플 발췌)",
         published_at="2026-01-01", url="https://www.law.go.kr/", text=(
             "제25조(중개대상물의 확인·설명) ① 개업공인중개사는 중개를 의뢰받은 경우에는 중개가 완성되기 전에 해당 중개대상물의 상태·입지 및 "
             "권리관계, 법령의 규정에 의한 거래 또는 이용제한사항 등을 확인하여 이를 권리를 취득하고자 하는 중개의뢰인에게 성실·정확하게 "
             "설명하고, 등기사항증명서 등 설명의 근거자료를 제시하여야 한다.")),
    dict(tenant=None, source_type="policy", title="[샘플] 생애최초 주택 구입 지원 안내", publisher="국토교통부 (시연용 샘플)",
         published_at="2026-09-30", effective_date="2027-03-01", url="https://www.molit.go.kr/",
         facts={EFFECTIVE_KEY: {"label": EFFECTIVE_LABEL, "value": "2027-03-01"}}, text=(
             "# 지원 대상\n생애최초로 주택을 구입하는 무주택 세대주로서 부부합산 연소득 7천만 원 이하인 경우 생애최초 주택 구입 지원 대상입니다.\n"
             "# 지원 내용\n주택가격 9억 원 이하 주택을 구입하는 경우 최대 3억 원까지 저리 구입자금 대출을 지원합니다.\n"
             "# 시행일\n생애최초 주택 구입 지원정책은 2027년 3월 1일부터 시행되며 시행일 이후 신청분부터 적용됩니다.\n"
             "# 신청 방법\n취급 은행 창구 또는 주택도시기금 누리집에서 신청하며 소득·무주택 확인 서류를 제출합니다.")),
    dict(tenant=None, source_type="policy", title="[샘플] 생애최초 주택 구입 지원 자주 묻는 질문", publisher="국토교통부 (시연용 샘플)",
         published_at="2026-10-01", effective_date="2027-03-01",
         facts={EFFECTIVE_KEY: {"label": EFFECTIVE_LABEL, "value": "2027-03-01"}}, text=(
             "Q. 과거에 주택을 보유한 적이 있으면 신청할 수 있나요? 세대 구성원 전원이 과거 주택을 소유한 사실이 없어야 생애최초 지원 대상입니다.\n"
             "Q. 서울 지역 아파트도 지원 대상인가요? 지역과 관계없이 주택가격 9억 원 이하이면 동일하게 적용됩니다.\n"
             "Q. 시행일 전에 계약하면 지원을 받을 수 있나요? 시행일인 2027년 3월 1일 이후 신청분부터 적용되므로 시행 전 신청은 지원 대상이 아닙니다.")),
    dict(tenant=None, source_type="policy", title="[샘플] 서울시 생애최초 주택 구입 지원 연계 보도자료", publisher="서울특별시 (시연용 샘플)",
         published_at="2026-10-02", effective_date="2027-03-01", region="서울",
         facts={EFFECTIVE_KEY: {"label": EFFECTIVE_LABEL, "value": "2027-03-01"}}, text=(
             "# 보도 내용\n서울시는 국토교통부 생애최초 주택 구입 지원정책 시행(2027년 3월 1일)에 맞춰 시민 상담 창구를 운영한다고 밝혔습니다. "
             "자치구 주거복지센터에서 신청 서류 안내를 받을 수 있습니다.")),
    dict(tenant=None, source_type="policy", title="[샘플] 부산시 주택 구입 지원 안내", publisher="부산광역시 (시연용 샘플)",
         published_at="2026-09-01", region="부산", text=(
             "# 지원 내용\n부산시에 주민등록을 둔 신혼부부가 부산 소재 주택을 구입하는 경우 대출 이자 일부를 지원합니다.")),
    dict(tenant=None, source_type="news", title="[샘플] 서울 주택시장 동향 기사", publisher="샘플경제신문 (이용 허용 기사 · 제공 요약)",
         published_at="2026-10-21", region="서울", license="제목·제공 요약·링크만 사용 (본문 미저장)",
         facts={EFFECTIVE_KEY: {"label": EFFECTIVE_LABEL, "value": "2027-02-15"}}, text=(
             "# 기사 요약\n생애최초 주택 구입 지원정책이 내년 2월 15일부터 시행된다고 보도되었습니다. 마포구 등 서울 서북권 아파트 매수 문의가 "
             "늘었다는 내용입니다. (제공 요약이며 기사 본문이 아닙니다)")),
    dict(tenant=1, source_type="office", title="하늘공인중개사 매수 상담 확인 절차", publisher="하늘공인중개사사무소 (내부 문서 · 승인본 v3)",
         published_at="2026-08-01", text=(
             "# 상담 전 확인\n아파트 매수 상담 전에는 등기사항증명서로 권리관계를, 건축물대장으로 위반건축물 여부와 사용승인일을 확인합니다. "
             "최근 실거래가와 현재 호가를 구분해서 설명합니다.\n"
             "# 학군 안내 원칙\n배정 학교는 관할 교육지원청 학구도 안내 서비스로 확인한 경우에만 안내하며 확인되지 않은 학군은 단정하지 않습니다.\n"
             "# 후보 단지 통학 메모\n마포한강뷰 아파트는 2026년 학구도 기준 마포초 배정 구역입니다(교육지원청 학구도 확인, 2026-03). "
             "마포공원앞 아파트는 공덕초 배정 구역입니다(학구도 확인, 2026-03).")),
    dict(tenant=2, source_type="office", title="연희공인중개사 내부 수수료 기준", publisher="연희공인중개사사무소 (내부 문서)",
         published_at="2026-07-01", text=(
             "# 수수료 기준\n이 문서는 연희공인중개사사무소 전용 내부 수수료 협의 기준입니다. 다른 사무소에는 노출되면 안 됩니다.")),
]


def seed_public(conn) -> None:
    """시연용 공공 원천 캐시. 실제 수집(/api/admin/collect/*)과 같은 정규화·저장 함수를 쓴다."""
    rents = []
    for cx, area, deals in PUBLIC_RENTS:
        for i, (d, deposit, monthly) in enumerate(deals):
            y, m, dd = d.split("-")
            rents.append(ps.normalize_rent({"sggCd": "11440", "sggNm": "마포구", "umdNm": "공덕동", "aptNm": cx,
                                            "excluUseAr": str(area), "floor": str(4 + i), "dealYear": y, "dealMonth": m,
                                            "dealDay": dd, "deposit": f"{deposit:,}", "monthlyRent": str(monthly)},
                                           {"LAWD_CD": "11440"}))
    for r in rents:
        r["source"] += SAMPLE
    ps.store_rents(conn, rents)
    cxs = [ps.normalize_complex({"kaptCode": c, "kaptName": n, "kaptAddr": a, "codeHeatNm": h, "kaptUsedate": u,
                                 "kaptDongCnt": str(dong), "kaptdaCnt": str(hh), "codeSaleNm": "분양"}, {})
           for c, n, a, h, u, dong, hh in PUBLIC_COMPLEXES]
    for c in cxs:
        c["source"] += SAMPLE
    ps.store_complexes(conn, cxs)
    bld = [ps.normalize_building({"mgmBldrgstPk": f"11440-SAMPLE-{i}", "bldNm": n, "platPlc": addr, "mainPurpsCdNm": mp,
                                  "strctCdNm": st, "totArea": area, "hhldCnt": str(hh), "useAprDay": u, "regstrKindCdNm": "총괄표제부"},
                                 {"sigunguCd": "11440", "bjdongCd": "10200", "bun": str(100 + i), "ji": "0"})
           for i, (n, addr, mp, st, area, hh, u) in enumerate(PUBLIC_BUILDINGS)]
    for b in bld:
        b["source"] += SAMPLE
    ps.store_buildings(conn, bld)
    sts = [ps.normalize_subway({"subwayStationId": sid, "subwayStationName": name, "subwayRouteId": rid, "subwayRouteName": rn}, {})
           for sid, name, rid, rn in PUBLIC_STATIONS]
    for st in sts:
        st["source"] += SAMPLE
    ps.store_subway_stations(conn, sts)


def seed() -> None:
    with tx() as conn:
        conn.execute("SELECT pg_advisory_xact_lock(4243)")
        if conn.execute("SELECT 1 FROM tenants LIMIT 1").fetchone():
            return
        log.info("시드 데이터 생성")
        t1 = conn.execute("INSERT INTO tenants (name) VALUES ('하늘공인중개사사무소') RETURNING id").fetchone()["id"]
        t2 = conn.execute("INSERT INTO tenants (name) VALUES ('연희공인중개사사무소') RETURNING id").fetchone()["id"]
        pw = hash_password("demo1234")
        users = {}
        for key, email, name, role in AGENTS_T1:
            users[key] = conn.execute("INSERT INTO users (tenant_id, email, name, role, password_hash) VALUES (%s,%s,%s,%s,%s) RETURNING id",
                                      (t1, email, name, role, pw)).fetchone()["id"]
        users["other"] = conn.execute("INSERT INTO users (tenant_id, email, name, role, password_hash) VALUES (%s,%s,%s,%s,%s) RETURNING id",
                                      (t2, "agent@other.test", "이연희", "agent", pw)).fetchone()["id"]

        ids = {}
        for tenant, rows in [(t1, LISTINGS_T1), (t2, LISTINGS_T2)]:
            district = "마포구" if tenant == t1 else "서대문구"
            for i, (label, title, cx, price, area, floor, st, walk, park, lat, lng, agent, hist) in enumerate(rows):
                lid = conn.execute(
                    """INSERT INTO listings (tenant_id, agent_id, label, title, complex_name, address, district, price, area_m2,
                                             floor, station, station_walk_min, park_walk_min, lat, lng, description, source,
                                             source_date, created_at)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
                    (tenant, users[agent], label, title, cx, f"서울 {district} {cx}로 {10 + len(cx)}", district, price, area, floor,
                     st, walk, park, lat, lng, DESCRIPTIONS.get(label, "") + " (시연용 샘플 매물)" if tenant == t1
                     else "시연용 샘플 매물입니다. 실제 매물이 아닙니다.", "중개사 직접 등록 (샘플)",
                     "2026-10-28", f"2026-10-{1 + i:02d} 10:00+09"),
                ).fetchone()["id"]
                ids[(tenant, label)] = lid
                for p, at in hist or [(price, "2026-10-01")]:
                    conn.execute("INSERT INTO listing_price_history (listing_id, price, changed_at) VALUES (%s,%s,%s)", (lid, p, at))

        for label, agent, text in NOTES:
            conn.execute("INSERT INTO listing_notes (listing_id, user_id, text, created_at) VALUES (%s,%s,%s,'2026-10-28 18:00+09')",
                         (ids[(t1, label)], users[agent], text))

        cust = {}
        for name, agent, phone, budget, area_min, walk, prefs, first_home in CUSTOMERS_T1:
            cust[name] = conn.execute(
                """INSERT INTO customers (tenant_id, agent_id, name, deal_type, phone, budget_max, area_min, district,
                                          station_walk_max, preferences, first_home, created_at)
                   VALUES (%s,%s,%s,'아파트 매수',%s,%s,%s,'마포구',%s,%s,%s,'2026-10-15 10:00+09') RETURNING id""",
                (t1, users[agent], name, phone, budget, area_min, walk, prefs, first_home)).fetchone()["id"]
        other_c = conn.execute(
            """INSERT INTO customers (tenant_id, agent_id, name, deal_type, budget_max, area_min, district)
               VALUES (%s,%s,'이도윤','아파트 매수',70000,59,'서대문구') RETURNING id""", (t2, users["other"])).fetchone()["id"]

        agent_of = {name: users[agent] for name, agent, *_ in CUSTOMERS_T1}
        for label, name, stage, note, changed in DEALS_T1:
            dropped = stage == "dropped"
            did = conn.execute(
                """INSERT INTO deals (tenant_id, listing_id, customer_id, agent_id, stage, next_action, dropped_reason,
                                      stage_changed_at, created_at)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
                (t1, ids[(t1, label)], cust[name], agent_of[name], stage, None if dropped else note,
                 note if dropped else None, f"{changed} 10:00+09", "2026-10-15 10:00+09")).fetchone()["id"]
            conn.execute("INSERT INTO deal_events (deal_id, from_stage, to_stage, user_id, at) VALUES (%s, NULL, %s, %s, %s)",
                         (did, stage, agent_of[name], f"{changed} 10:00+09"))
        conn.execute("""INSERT INTO deals (tenant_id, listing_id, customer_id, agent_id, stage, next_action)
                        VALUES (%s,%s,%s,%s,'visit','주말 방문')""", (t2, ids[(t2, "A")], other_c, users["other"]))

        for text, at in [("1차 상담. 예산 8억, 전용 59㎡ 이상, 통학·공원 중요", "2026-10-17 14:00+09"),
                         ("2차 상담. E 아현숲 제외(면적 부족)", "2026-10-24 15:00+09"),
                         ("A 마포한강뷰 방문→협의", "2026-10-28 11:00+09")]:
            conn.execute("INSERT INTO activities (customer_id, user_id, text, at) VALUES (%s,%s,%s,%s)",
                         (cust["김하늘"], users["kim"], text, at))

        for cx, area, deals in TRADES:
            for i, (price, d) in enumerate(deals):
                conn.execute(
                    """INSERT INTO apt_trades (lawd_cd, district, dong, complex_name, area_m2, price, deal_date, floor, source)
                       VALUES ('11440','마포구','공덕동',%s,%s,%s,%s,%s,%s)""",
                    (cx, area, price, d, 5 + i, "국토교통부 아파트 매매 실거래가 (시연용 샘플)"),
                )

        seed_public(conn)
        # 연결 샘플: A는 단지·역을 확정해 둔다. 나머지 매물은 상세 화면에서 후보를 골라 확정해 보도록 둔다
        for kind, key, label in [("complex", "A10027001", "마포한강뷰"), ("station", "공덕", "공덕 (5호선·6호선·경의중앙선·공항철도)")]:
            conn.execute("""INSERT INTO entity_links (tenant_id, listing_id, kind, entity_key, label, match_method, confidence, confirmed_by)
                            VALUES (%s,%s,%s,%s,%s,'suggested',1.0,%s)""", (t1, ids[(t1, "A")], kind, key, label, users["kim"]))

        tenants = {None: None, 1: t1, 2: t2}
        for d in DOCS:
            rag.ingest_document(
                conn, tenant_id=tenants[d["tenant"]], source_type=d["source_type"], title=d["title"], publisher=d["publisher"],
                published_at=date.fromisoformat(d["published_at"]), text=d["text"],
                effective_date=date.fromisoformat(d["effective_date"]) if d.get("effective_date") else None,
                region=d.get("region"), url=d.get("url"), license=d.get("license", "시연용 샘플"), facts=d.get("facts"),
            )
        conn.execute("INSERT INTO ingest_jobs (tenant_id, kind, status, detail, finished_at) VALUES (NULL,'seed','done',%s, now())",
                     (f"시드 문서 {len(DOCS)}건 인덱싱",))
