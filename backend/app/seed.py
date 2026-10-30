"""시연용 시드 데이터. 모든 문서·매물·거래는 샘플이며 실제 정책/매물과 무관하다(제목에 [샘플] 표기)."""
import logging
from datetime import date

from . import rag
from .db import tx
from .security import hash_password

log = logging.getLogger("mate.seed")

EFFECTIVE_KEY = "first_home_support.effective_date"
EFFECTIVE_LABEL = "생애최초 주택 구입 지원 시행일"

LISTINGS_T1 = [
    # label, title, complex, price(만원), area, station, walk, park, lat, lng, history
    ("A", "한강뷰 아파트", "마포한강뷰", 78000, 59.9, "공덕역", 7, 9, 37.5428, 126.9497, []),
    ("B", "공원앞 아파트", "마포공원앞", 75000, 62.3, "공덕역", 9, 3, 37.5462, 126.9568, [(77000, "2026-10-01"), (75000, "2026-10-22")]),
    ("C", "역세권 아파트", "공덕역세권", 80000, 59.8, "공덕역", 4, 15, 37.5446, 126.9520, []),
    ("D", "마포래미안 84", "마포래미안", 115000, 84.9, "애오개역", 6, 8, 37.5530, 126.9560, []),
    ("E", "아현숲 소형", "아현숲", 72000, 49.5, "아현역", 5, 4, 37.5575, 126.9560, []),
    ("F", "도화현대 59", "도화현대", 76000, 59.5, "마포역", 14, 6, 37.5395, 126.9465, [(78000, "2026-09-15"), (76000, "2026-10-10")]),
    ("G", "신공덕 숲길", "신공덕숲길", 79000, 60.1, "공덕역", 10, 6, 37.5480, 126.9530, []),
]
LISTINGS_T2 = [("A", "연희 언덕집", "연희언덕", 69000, 59.0, "신촌역", 12, 5, 37.5660, 126.9300, [])]

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
         published_at="2026-09-30", effective_date="2026-11-01", url="https://www.molit.go.kr/",
         facts={EFFECTIVE_KEY: {"label": EFFECTIVE_LABEL, "value": "2026-11-01"}}, text=(
             "# 지원 대상\n생애최초로 주택을 구입하는 무주택 세대주로서 부부합산 연소득 7천만 원 이하인 경우 생애최초 주택 구입 지원 대상입니다.\n"
             "# 지원 내용\n주택가격 9억 원 이하 주택을 구입하는 경우 최대 3억 원까지 저리 구입자금 대출을 지원합니다.\n"
             "# 시행일\n생애최초 주택 구입 지원정책은 2026년 11월 1일부터 시행되며 시행일 이후 신청분부터 적용됩니다.\n"
             "# 신청 방법\n취급 은행 창구 또는 주택도시기금 누리집에서 신청하며 소득·무주택 확인 서류를 제출합니다.")),
    dict(tenant=None, source_type="policy", title="[샘플] 생애최초 주택 구입 지원 자주 묻는 질문", publisher="국토교통부 (시연용 샘플)",
         published_at="2026-10-01", effective_date="2026-11-01",
         facts={EFFECTIVE_KEY: {"label": EFFECTIVE_LABEL, "value": "2026-11-01"}}, text=(
             "Q. 과거에 주택을 보유한 적이 있으면 신청할 수 있나요? 세대 구성원 전원이 과거 주택을 소유한 사실이 없어야 생애최초 지원 대상입니다.\n"
             "Q. 서울 지역 아파트도 지원 대상인가요? 지역과 관계없이 주택가격 9억 원 이하이면 동일하게 적용됩니다.\n"
             "Q. 시행일 전에 계약하면 지원을 받을 수 있나요? 시행일인 2026년 11월 1일 이후 신청분부터 적용되므로 시행 전 신청은 지원 대상이 아닙니다.")),
    dict(tenant=None, source_type="policy", title="[샘플] 서울시 생애최초 주택 구입 지원 연계 보도자료", publisher="서울특별시 (시연용 샘플)",
         published_at="2026-10-02", effective_date="2026-11-01", region="서울",
         facts={EFFECTIVE_KEY: {"label": EFFECTIVE_LABEL, "value": "2026-11-01"}}, text=(
             "# 보도 내용\n서울시는 국토교통부 생애최초 주택 구입 지원정책 시행(2026년 11월 1일)에 맞춰 시민 상담 창구를 운영한다고 밝혔습니다. "
             "자치구 주거복지센터에서 신청 서류 안내를 받을 수 있습니다.")),
    dict(tenant=None, source_type="policy", title="[샘플] 부산시 주택 구입 지원 안내", publisher="부산광역시 (시연용 샘플)",
         published_at="2026-09-01", region="부산", text=(
             "# 지원 내용\n부산시에 주민등록을 둔 신혼부부가 부산 소재 주택을 구입하는 경우 대출 이자 일부를 지원합니다.")),
    dict(tenant=None, source_type="news", title="[샘플] 서울 주택시장 동향 기사", publisher="샘플경제신문 (이용 허용 기사 · 제공 요약)",
         published_at="2026-10-21", region="서울", license="제목·제공 요약·링크만 사용 (본문 미저장)",
         facts={EFFECTIVE_KEY: {"label": EFFECTIVE_LABEL, "value": "2026-10-15"}}, text=(
             "# 기사 요약\n생애최초 주택 구입 지원정책이 10월 15일부터 시행된다고 보도되었습니다. 마포구 등 서울 서북권 아파트 매수 문의가 "
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
        for tenant, email, name, role in [(t1, "agent@hanul.test", "김선용", "agent"), (t1, "admin@hanul.test", "하늘 관리자", "admin"),
                                          (t2, "agent@other.test", "이연희", "agent")]:
            users[email] = conn.execute("INSERT INTO users (tenant_id, email, name, role, password_hash) VALUES (%s,%s,%s,%s,%s) RETURNING id",
                                        (tenant, email, name, role, pw)).fetchone()["id"]

        ids = {}
        # 하늘사무소 매물은 김선용(중개사)이 대부분 직접 등록, D·F는 관리자 등록 ("내가 등록한 매물" 필터 확인용)
        registrant = {t1: users["agent@hanul.test"], t2: users["agent@other.test"]}
        for tenant, rows in [(t1, LISTINGS_T1), (t2, LISTINGS_T2)]:
            for i, (label, title, cx, price, area, st, walk, park, lat, lng, hist) in enumerate(rows):
                by = users["admin@hanul.test"] if tenant == t1 and label in ("D", "F") else registrant[tenant]
                lid = conn.execute(
                    """INSERT INTO listings (tenant_id, label, title, complex_name, address, district, price, area_m2, floor,
                                             station, station_walk_min, park_walk_min, lat, lng, description, source,
                                             source_date, registered_by, created_at)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
                    (tenant, label, title, cx, f"서울 {'마포구' if tenant == t1 else '서대문구'} {cx}로 {10 + len(cx)}",
                     "마포구" if tenant == t1 else "서대문구", price, area, f"{5 + i * 2}층", st, walk, park, lat, lng,
                     f"{title} 시연용 샘플 매물입니다. 실제 매물이 아닙니다.", "중개사 직접 등록 (시연용 샘플)",
                     "2026-10-28", by, f"2026-10-{10 + i} 10:00+09"),
                ).fetchone()["id"]
                ids[(tenant, label)] = lid
                for p, at in hist:
                    conn.execute("INSERT INTO listing_price_history (listing_id, price, changed_at) VALUES (%s,%s,%s)", (lid, p, at))

        for cx, area, deals in TRADES:
            for i, (price, d) in enumerate(deals):
                conn.execute(
                    """INSERT INTO apt_trades (lawd_cd, district, dong, complex_name, area_m2, price, deal_date, floor, source)
                       VALUES ('11440','마포구','공덕동',%s,%s,%s,%s,%s,%s)""",
                    (cx, area, price, d, 5 + i, "국토교통부 아파트 매매 실거래가 (시연용 샘플)"),
                )

        c1 = conn.execute(
            """INSERT INTO consultations (tenant_id, agent_id, customer_name, deal_type, budget_max, area_min, district,
                                          station_walk_max, preferences, created_at)
               VALUES (%s,%s,'김하늘','아파트 매수',80000,59,'마포구',10,%s,'2026-10-29 09:00+09') RETURNING id""",
            (t1, users["agent@hanul.test"], ["통학", "공원", "조용한 주거지"]),
        ).fetchone()["id"]
        conn.execute(
            """INSERT INTO consultations (tenant_id, agent_id, customer_name, deal_type, budget_max, area_min, district, station_walk_max)
               VALUES (%s,%s,'박서준','아파트 매수',100000,84,'마포구',15)""", (t1, users["agent@hanul.test"]))
        conn.execute(
            """INSERT INTO consultations (tenant_id, agent_id, customer_name, deal_type, budget_max, area_min, district)
               VALUES (%s,%s,'이도윤','아파트 매수',70000,59,'서대문구')""", (t2, users["agent@other.test"]))
        for lid, status, reason in [(ids[(t1, "A")], "interest", "한강 조망 선호"), (ids[(t1, "B")], "interest", "공원 인접"),
                                    (ids[(t1, "E")], "excluded", "전용 59㎡ 미만")]:
            conn.execute("INSERT INTO consultation_candidates (consultation_id, listing_id, status, reason) VALUES (%s,%s,%s,%s)",
                         (c1, lid, status, reason))
        for note, at in [("1차 상담: 예산·면적 조건 확인", "2026-10-17 14:00+09"), ("2차 상담: 후보 E 제외(면적 부족)", "2026-10-24 15:00+09")]:
            conn.execute("INSERT INTO consultation_logs (consultation_id, note, at) VALUES (%s,%s,%s)", (c1, note, at))

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
