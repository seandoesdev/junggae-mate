"""질문 검색: 중개사가 적은 질문 하나로 매물·실거래가(SQL)와 법령·정책·사무소 자료·기사(문서 근거 검색)를 함께 찾아
답변 초안과 맞는 매물 목록을 만든다.

1) 질문 이해(parse_query): 지역·가격·면적·역 거리 같은 조건과 '학교'·'조용한' 같은 바라는 점을 규칙으로 뽑는다.
2) 매물 찾기: 조건으로 거르고(SQL), 바라는 점은 매물 설명·현장 메모·사무소 자료에서 찾아 순위를 매긴다.
   조건을 모두 만족하는 매물이 없으면 조건을 조금 넓혀 '조건에 가까운 매물'로 보여 준다.
3) 문서 근거: rag.search + 근거 게이트(자료 간 불일치·시행 전·근거 부족).
4) 답변: drafting.Body로 문장마다 출처를 붙인다. LLM이 켜져 있으면 같은 출처 안에서 다시 쓰고 인용을 검증한다.
"""
import re
import statistics
from datetime import date, timedelta

from . import drafting, llm, places, rag, structured
from .drafting import Body, eok, josa
from .embedding import embed

SEOUL_GU = ("종로구", "중구", "용산구", "성동구", "광진구", "동대문구", "중랑구", "성북구", "강북구", "도봉구", "노원구",
            "은평구", "서대문구", "마포구", "양천구", "강서구", "구로구", "금천구", "영등포구", "동작구", "관악구", "서초구",
            "강남구", "송파구", "강동구")

# 바라는 점: 이름 → (질문에서 알아보는 말, 매물 설명·메모·자료에서 찾는 말)
WANTS = {
    "학교": (("학교", "초등", "학군", "통학", "학구"), ("초 배정", "초등학교", "학교", "학구", "통학", "학군")),
    "공원": (("공원", "산책", "녹지"), ("공원", "산책", "숲길")),
    "조용한": (("조용", "한적", "소음"), ("조용", "한적")),
    "한강 조망": (("한강", "조망", "리버뷰", "강뷰"), ("한강", "조망")),
    "남향": (("남향",), ("남향",)),
    "신축": (("신축", "새 아파트", "새아파트"), ("신축", "준공", "입주 5년")),
    "주차": (("주차",), ("주차",)),
    "수리된 집": (("수리", "리모델링", "인테리어"), ("수리", "리모델링", "인테리어")),
    "고층": (("고층", "높은 층"), ()),
    "저층": (("저층", "낮은 층"), ()),
    "가격 조정": (("급매", "가격 조정", "가격 내린", "가격이 내린", "싸게"), ()),
}
LISTING_WORDS = ("매물", "집", "아파트", "단지", "찾아", "추천", "보여", "있나", "있어", "있을까", "볼 만", "살 만", "평", "㎡", "억")
# 구조화 공공데이터 라우팅 (설계서 9.2): 필요한 캐시만 읽는다
STRUCT_WORDS = {
    "rent": ("전세", "월세", "전월세", "임대", "보증금"),
    "complex": ("세대수", "몇 세대", "난방", "사용승인", "준공", "연식", "동수", "단지 정보", "단지정보"),
    "building": ("건축물대장", "주용도", "용도", "구조", "위반건축"),
    "station": ("호선", "노선", "지하철"),
}
MARKET_WORDS = ("시세", "실거래", "동향", "오르", "내리", "하락", "상승", "전망", "기사", "뉴스", "분위기", "시장")
FIRST_HOME_WORDS = ("생애최초", "생애 최초", "첫 집", "첫집", "처음 사는", "처음 집")
PYEONG_TO_M2 = 3.3058 * 0.75  # 공급 평형 → 전용면적 근사 (25평형 ≈ 전용 62㎡)

_N = r"(\d+(?:\.\d+)?)"
_AMOUNT = _N + r"\s*억(?:\s*(\d)\s*천)?(?:\s*(\d{1,4})\s*만)?"
_MIN_WORDS = ("이상", "넘는", "넘게", "초과", "부터")


def _amount(m: re.Match) -> int:
    return round(float(m.group(1)) * 10000) + int(m.group(2) or 0) * 1000 + int(m.group(3) or 0)


def _after(text: str, end: int, words: tuple[str, ...]) -> bool:
    tail = text[end:end + 6].lstrip(" 원")
    return any(tail.startswith(w) for w in words)


def parse_query(q: str, known_stations: list[str] = (), known_complexes: list[str] = ()) -> dict:
    """질문 → 조건. 규칙으로만 뽑으므로 결과를 화면에 '이렇게 이해했습니다'로 보여 주고 지울 수 있게 한다."""
    text = re.sub(r"\s+", " ", q.strip())
    f: dict = {"district": None, "price_min": None, "price_max": None, "area_min": None, "area_max": None,
               "area_note": None, "walk_max": None, "station": None, "complex": None, "place": None,
               "first_home": False, "wants": [], "deal": None, "rent_max": None}

    # 거래 종류: 월세 > 전세 > 매매. 전세·월세면 아래 금액 조건은 보증금에 적용한다
    if "월세" in text or re.search(r"월\s*\d{1,4}\s*만", text):
        f["deal"] = "monthly"
    elif "전세" in text:
        f["deal"] = "jeonse"
    elif any(w in text for w in ("매매", "매수", "구입", "사려", "살 집")):
        f["deal"] = "sale"

    for gu in sorted(SEOUL_GU, key=len, reverse=True):
        short = gu[:-1]
        if gu in text or (len(short) >= 2 and short in text):
            f["district"] = gu
            break

    # 가격: '7~9억' → 범위, '8억대' → 8억 이상 9억 미만, '7억 이상' → 하한, '8억 5천 이하'·그냥 '8억' → 상한(예산)
    if m := re.search(_N + r"\s*(?:억\s*)?[~\-–]\s*" + _N + r"\s*억", text):
        f["price_min"], f["price_max"] = round(float(m.group(1)) * 10000), round(float(m.group(2)) * 10000)
    elif m := re.search(_N + r"\s*억\s*대", text):
        f["price_min"] = round(float(m.group(1)) * 10000)
        f["price_max"] = f["price_min"] + 9999
    else:
        for m in re.finditer(_AMOUNT, text):
            if _after(text, m.end(), _MIN_WORDS):
                f["price_min"] = _amount(m)
            elif f["price_max"] is None:
                f["price_max"] = _amount(m)
    # 월세 보증금은 '보증금 5000만'처럼 억 없이 말하는 경우가 많다. 월세는 '월 60만'·'월세 60만'
    if f["price_max"] is None and (m := re.search(r"보증금\s*(\d{2,5})\s*만", text)):
        f["price_max"] = int(m.group(1))
    if f["deal"] == "monthly" and (m := re.search(r"월(?:세)?\s*(\d{1,4})\s*만", text)):
        f["rent_max"] = int(m.group(1))

    # 면적: 전용 ㎡ 또는 공급 평형
    if m := re.search(_N + r"\s*(?:㎡|m2|m²|제곱미터|평방미터)", text):
        v = float(m.group(1))
        if _after(text, m.end(), _MIN_WORDS):
            f["area_min"], f["area_note"] = v, f"전용 {v:g}㎡ 이상"
        elif _after(text, m.end(), ("이하", "미만", "까지")):
            f["area_max"], f["area_note"] = v, f"전용 {v:g}㎡ 이하"
        else:
            f["area_min"], f["area_max"], f["area_note"] = v - 3, v + 8, f"전용 {v:g}㎡ 안팎"
    elif m := re.search(r"(\d+)\s*평\s*대", text):
        p = int(m.group(1))
        f["area_min"], f["area_max"] = round(p * PYEONG_TO_M2, 1), round((p + 10) * PYEONG_TO_M2, 1)
        f["area_note"] = f"{p}평대 (전용 약 {f['area_min']:g}~{f['area_max']:g}㎡)"
    elif m := re.search(r"(\d+)\s*평(?:형)?", text):
        p = int(m.group(1))
        v = round(p * PYEONG_TO_M2, 1)
        if _after(text, m.end(), _MIN_WORDS):
            f["area_min"], f["area_note"] = v - 2, f"{p}평형 이상 (전용 약 {v:g}㎡ 이상)"
        else:
            f["area_min"], f["area_max"], f["area_note"] = v - 4, v + 4, f"{p}평형 (전용 약 {v:g}㎡)"

    # 역 거리·역 이름·단지 이름
    if m := re.search(r"(?:역|지하철)[^\d]{0,6}(\d+)\s*분", text):
        f["walk_max"] = int(m.group(1))
    elif any(w in text for w in ("역세권", "역 가까", "역에서 가까", "역이 가까", "역과 가까")):
        f["walk_max"] = 10
    for cx in sorted(known_complexes, key=len, reverse=True):
        if cx and cx in text:
            f["complex"] = cx
            break
    # 역 이름은 단지 이름을 지운 뒤 찾는다 ('마포한강뷰'의 '마포'를 마포역으로 읽지 않도록).
    # '공덕'처럼 '역'을 뺀 이름은 뒤에 '근처·쪽·에서' 등이 올 때만 역으로 본다.
    rest = text.replace(f["complex"], " ") if f["complex"] else text
    # 동·생활권·신도시 ('동탄', '공덕동', '판교'): 반경 조건. 구는 위에서 district로 잡는다
    f["place"] = places.find(rest)
    for st in sorted(known_stations, key=len, reverse=True):
        stem = st[:-1] if st.endswith("역") and len(st) > 2 else None
        if st and (st in rest or (stem and re.search(rf"{re.escape(stem)}(?=\s*(?:근처|인근|주변|쪽|부근|에서|,|$))", rest))):
            f["station"] = st
            break

    f["first_home"] = any(w in text for w in FIRST_HOME_WORDS)
    f["wants"] = [name for name, (ask, _) in WANTS.items() if any(a in text for a in ask)]
    return f


def chips(f: dict) -> list[dict]:
    """화면에 보여 줄 '이렇게 이해했습니다' 항목. key는 지우기(drop)에 쓴다."""
    out = []
    if f["district"]:
        out.append({"key": "district", "label": f["district"]})
    if f["place"]:
        out.append({"key": "place", "label": f"{f['place']['name']} 반경 {f['place']['radius_m'] / 1000:g}km"})
    if f.get("deal"):
        out.append({"key": "deal", "label": drafting.DEAL_LABEL[f["deal"]]})
    pre = "보증금 " if f.get("deal") in ("jeonse", "monthly") else ""
    if f["price_min"] and f["price_max"]:
        label = (f"{eok(f['price_min'])}대" if f["price_max"] - f["price_min"] == 9999
                 else f"{eok(f['price_min'])}~{eok(f['price_max'])}")
        out.append({"key": "price", "label": pre + label})
    elif f["price_max"]:
        out.append({"key": "price", "label": f"{pre}{drafting.won(f['price_max'])} 이하"})
    elif f["price_min"]:
        out.append({"key": "price", "label": f"{pre}{drafting.won(f['price_min'])} 이상"})
    if f.get("rent_max"):
        out.append({"key": "rent", "label": f"월세 {f['rent_max']}만 원 이하"})
    if f["area_note"]:
        out.append({"key": "area", "label": f["area_note"]})
    if f["walk_max"]:
        out.append({"key": "walk", "label": f"역 도보 {f['walk_max']}분 이내"})
    if f["station"]:
        out.append({"key": "station", "label": f["station"]})
    if f["complex"]:
        out.append({"key": "complex", "label": f["complex"]})
    if f["first_home"]:
        out.append({"key": "first_home", "label": "생애최초 구입"})
    out.extend({"key": f"want:{w}", "label": w} for w in f["wants"])
    return out


def drop(f: dict, keys: list[str]) -> dict:
    f = dict(f)
    for k in keys:
        if k == "price":
            f["price_min"] = f["price_max"] = None
        elif k == "area":
            f["area_min"] = f["area_max"] = f["area_note"] = None
        elif k == "walk":
            f["walk_max"] = None
        elif k == "deal":
            f["deal"] = None
        elif k == "rent":
            f["rent_max"] = None
        elif k == "first_home":
            f["first_home"] = False
        elif k.startswith("want:"):
            f["wants"] = [w for w in f["wants"] if w != k[5:]]
        elif k in ("district", "station", "complex", "place"):
            f[k] = None
    return f


def normalize_region(region: str | None) -> str | None:
    """중개사가 적은 지역 → 문서 지역 필터 형태. '마포구'·'서울시 마포구' → '서울 마포구', '서울특별시' → '서울'."""
    if not region or not region.strip():
        return None
    r = region.strip()
    gu = next((g for g in sorted(SEOUL_GU, key=len, reverse=True) if g in r), None)
    if gu:
        return drafting.region_of(gu)
    return drafting.CITY if r.startswith("서울") else r


def has_conditions(f: dict) -> bool:
    # 거래 종류만으로는 매물을 찾는 질문으로 보지 않는다 ('전세 시세 어때?'). 매물을 찾을 때는 거래 종류로 거른다 (_unmet)
    return any(f.get(k) for k in ("district", "place", "price_min", "price_max", "area_min", "area_max", "walk_max",
                                  "station", "complex", "rent_max"))


# ---------- 매물 찾기 ----------

def _floor_ratio(floor: str | None) -> float | None:
    m = re.match(r"\s*(\d+)\s*/\s*(\d+)", floor or "")
    return int(m.group(1)) / int(m.group(2)) if m and int(m.group(2)) else None


def _unmet(l: dict, f: dict) -> list[str]:
    out = []
    if f["district"] and l["district"] != f["district"]:
        out.append(f"지역 {l['district']}")
    mode = f.get("deal")
    if mode and mode not in drafting.offers(l):
        out.append(f"{drafting.DEAL_LABEL[mode]} 매물 아님 ({drafting.price_text(l)})")
    else:
        m = mode or "sale"
        amt, lab = drafting.amount(l, m), ("가격" if m == "sale" else "보증금")
        if (f["price_max"] or f["price_min"]) and amt is None:
            out.append(f"매매가 없음 ({drafting.price_text(l)})")
        else:
            if f["price_max"] and amt > f["price_max"]:
                out.append(f"{lab} {drafting.won(amt)} (기준 {drafting.won(f['price_max'])} 이하)")
            if f["price_min"] and amt < f["price_min"]:
                out.append(f"{lab} {drafting.won(amt)} (기준 {drafting.won(f['price_min'])} 이상)")
        if m == "monthly" and f.get("rent_max") and l["monthly_rent"] > f["rent_max"]:
            out.append(f"월세 {l['monthly_rent']}만 원 (기준 {f['rent_max']}만 원 이하)")
    if f["area_min"] and l["area_m2"] < f["area_min"]:
        out.append(f"전용 {l['area_m2']:g}㎡ (기준 {f['area_min']:g}㎡ 이상)")
    if f["area_max"] and l["area_m2"] > f["area_max"]:
        out.append(f"전용 {l['area_m2']:g}㎡ (기준 {f['area_max']:g}㎡ 이하)")
    if f["walk_max"] and (l.get("station_walk_min") is None or l["station_walk_min"] > f["walk_max"]):
        out.append(f"역 도보 {l.get('station_walk_min') if l.get('station_walk_min') is not None else '-'}분 (기준 {f['walk_max']}분)")
    if f["station"] and l.get("station") != f["station"]:
        out.append(l.get("station") or "역 정보 없음")
    if f["complex"] and l["complex_name"] != f["complex"]:
        out.append(l["complex_name"])
    if (pl := f.get("place")) and l.get("lat") is not None:
        d = places.distance_m(pl["lat"], pl["lng"], l["lat"], l["lng"])
        if d > pl["radius_m"]:
            out.append(f"{pl['name']}에서 {d / 1000:.1f}km")
    return out


def _near_miss(l: dict, f: dict) -> bool:
    """조건을 조금 넓혔을 때 들어오는 매물 (가격 ±10%, 면적 ±10%, 역 +5분). 지역·단지·역 이름은 넓히지 않는다."""
    g = dict(f)
    g["price_max"] = f["price_max"] * 1.1 if f["price_max"] else None
    g["price_min"] = f["price_min"] * 0.9 if f["price_min"] else None
    g["area_min"] = f["area_min"] * 0.9 if f["area_min"] else None
    g["area_max"] = f["area_max"] * 1.1 if f["area_max"] else None
    g["walk_max"] = f["walk_max"] + 5 if f["walk_max"] else None
    g["rent_max"] = f["rent_max"] * 1.1 if f.get("rent_max") else None
    g["place"] = {**f["place"], "radius_m": f["place"]["radius_m"] * 1.5} if f.get("place") else None
    return not _unmet(l, g)


def listing_notes(conn, ids: list[int]) -> dict[int, list[dict]]:
    if not ids:
        return {}
    rows = conn.execute(
        """SELECT n.id, n.listing_id, n.user_id, n.text, n.created_at, u.name AS by FROM listing_notes n
           LEFT JOIN users u ON u.id = n.user_id WHERE n.listing_id = ANY(%s) ORDER BY n.created_at DESC, n.id DESC""",
        (ids,)).fetchall()
    out: dict[int, list[dict]] = {}
    for r in rows:
        out.setdefault(r["listing_id"], []).append({"id": r["id"], "text": r["text"], "by": r["by"], "user_id": r["user_id"],
                                                    "created_at": r["created_at"].isoformat()})
    return out


def _docs_about(conn, tenant_id: int, complexes: list[str], as_of: date) -> list[dict]:
    """단지 이름이 들어 있는 문서 조각 (예: 사무소 통학 메모 '마포한강뷰 아파트는 마포초 배정 구역')."""
    if not complexes:
        return []
    return conn.execute(
        """SELECT c.id, c.document_id, c.location, c.text, d.title, d.publisher, d.source_type, d.published_at,
                  d.effective_date, d.region, d.url, d.facts, 1.0::float AS score, x.name AS complex
           FROM unnest(%s::text[]) AS x(name)
           JOIN chunks c ON position(x.name in c.text) > 0
           JOIN documents d ON d.id = c.document_id
           WHERE (c.tenant_id IS NULL OR c.tenant_id = %s) AND d.published_at <= %s
           ORDER BY array_position(ARRAY['law','policy','office','news'], d.source_type), d.published_at DESC""",
        (complexes, tenant_id, as_of)).fetchall()


def _sentence(text: str, must: str, terms: tuple[str, ...]) -> str | None:
    text = re.sub(r"^\[[^\]]+\]\s*", "", text.strip())
    for s in re.split(r"(?<=[.다)])\s+", text):
        if must in s and any(t in s for t in terms):
            return s.strip()
    return None


def _want_match(want: str, l: dict, notes: list[dict], docs: list[dict]) -> dict | None:
    """바라는 점 하나가 이 매물에 맞는지. 맞으면 {text(목록용), say(답변 문장), source: listing|note|doc}."""
    _, terms = WANTS[want]
    if want == "공원" and l.get("park_walk_min") is not None and l["park_walk_min"] <= 7:
        return {"text": f"공원 도보 {l['park_walk_min']}분", "say": f"공원까지 걸어서 {l['park_walk_min']}분입니다.", "source": "listing"}
    if want in ("고층", "저층"):
        r = _floor_ratio(l.get("floor"))
        if r is not None and ((want == "고층" and r >= 0.6) or (want == "저층" and r <= 0.3)):
            return {"text": l["floor"], "say": f"{josa(l['floor'], '으로')} {want}입니다.", "source": "listing"}
        return None
    if want == "가격 조정":
        h = l.get("price_history") or []
        if len(h) > 1 and h[-1]["price"] < h[0]["price"]:
            a, b = drafting.won(h[0]["price"]), drafting.won(h[-1]["price"])
            return {"text": f"{a}→{b} 조정", "say": f"가격이 {a}에서 {josa(b, '으로')} 조정되었습니다.", "source": "listing"}
        return None
    for n in notes:
        if any(t in n["text"] for t in terms):
            return {"text": n["text"][:80], "say": f"현장 메모에는 '{n['text'][:80].rstrip('.')}'라고 적혀 있습니다.", "source": "note"}
    if l.get("description") and any(t in l["description"] for t in terms):
        d = re.sub(r"\s*\(시연용 샘플 매물\)$", "", l["description"])[:80].rstrip(".")
        return {"text": d, "say": f"매물 설명에 '{d}'라고 적혀 있습니다.", "source": "listing"}
    for h in docs:
        if (s := _sentence(h["text"], l["complex_name"], terms)):
            return {"text": s, "say": s if s.endswith(".") else s + ".", "source": "doc", "hit": h}
    return None


def find_listings(conn, user, f: dict, query: str, as_of: date, *, browse: bool = False,
                  near_miss: bool = True) -> tuple[list[dict], bool]:
    """(매물 목록, 조건을 넓혔는지). 각 매물에 matched(맞는 바라는 점), unmet(차이 나는 조건), notes, score를 붙인다.

    browse: 조건 없이 매물을 보여 달라고 했거나("매물 보여줘") 중개사가 조건을 모두 뺐을 때. 글자 유사도로 거르지 않는다.
    near_miss: 조건을 모두 만족하는 매물이 없을 때 조금 넓혀 찾을지 (Hood AI 설정).
    """
    all_ls = [l for l in drafting.fetch_listings(conn, user.tenant_id, user_id=user.id) if l["stage"] != "done"]
    open_query = not has_conditions(f) and not f["wants"] and not f["first_home"] and not browse
    pool = [l for l in all_ls if not _unmet(l, f)]
    relaxed = False
    if not pool and has_conditions(f) and near_miss:
        pool = [l for l in all_ls if _near_miss(l, f)]
        relaxed = bool(pool)
    if f["first_home"] and not f["price_max"]:
        pool = [l for l in pool if l.get("price") is not None and l["price"] <= drafting.FIRST_HOME_PRICE_LIMIT]

    notes = listing_notes(conn, [l["id"] for l in pool])
    docs = _docs_about(conn, user.tenant_id, sorted({l["complex_name"] for l in pool}), as_of) if f["wants"] else []
    qv = embed(query)
    out = []
    for l in pool:
        ln = notes.get(l["id"], [])
        matched = [{"want": w, **m} for w in f["wants"]
                   if (m := _want_match(w, l, ln, [d for d in docs if d["complex"] == l["complex_name"]]))]
        text = " ".join([l["title"], l["complex_name"], l.get("description") or "", *[n["text"] for n in ln]])
        sim = max(sum(a * b for a, b in zip(qv, embed(text))), 0.0)
        score = 2.0 * len(matched) + sim - (0.5 if relaxed else 0.0)
        out.append({**l, "notes": ln, "matched": matched, "unmet": _unmet(l, f), "score": round(score, 3)})
    if f["wants"] and not has_conditions(f) and not f["first_home"]:
        out = [l for l in out if l["matched"]]  # 바라는 점만 말했으면 그 점이 확인되는 매물만 (없으면 빈 목록)
    if open_query:  # 조건도 바라는 점도 없으면 질문과 글자가 꽤 겹치는 매물만 (단지 이름·메모로 찾는 경우)
        out = [l for l in out if l["score"] >= 0.25]
    out.sort(key=lambda l: (-l["score"], drafting.primary_amount(l) or 0))
    return out[:12], relaxed


# ---------- 출처 ----------

def listing_ev(l: dict) -> dict:
    ev = drafting.listing_evidence(l)
    if l.get("description"):
        ev["snippet"] += f" 설명: {l['description']}"
    if l.get("notes"):
        ev["snippet"] += " 현장 메모: " + " / ".join(f"{n['text']} ({n['by']}, {n['created_at'][:10]})" for n in l["notes"][:3])
    return ev


def district_trades(conn, district: str, as_of: date) -> dict | None:
    rows = conn.execute(
        """SELECT complex_name, price, deal_date, source, collected_at FROM apt_trades
           WHERE district = %s AND deal_date >= %s ORDER BY deal_date""",
        (district, as_of - timedelta(days=365))).fetchall()
    if not rows:
        return None
    return {"count": len(rows), "median_price": int(statistics.median(r["price"] for r in rows)),
            "period": f"{rows[0]['deal_date']} ~ {rows[-1]['deal_date']}", "source": rows[-1]["source"],
            "as_of": str(max(r["collected_at"] for r in rows).date()), "complexes": len({r["complex_name"] for r in rows})}


def district_trade_ev(district: str, ref: dict) -> dict:
    # 'tN'은 매물 N의 단지 실거래가. 지역 전체 요약은 매물 id와 겹치지 않는 t0을 쓴다.
    return {"id": "t0", "kind": "trade", "type": "data", "type_label": "실거래가", "title": f"{district} 아파트 매매 실거래가",
            "org": ref["source"], "date": ref["as_of"], "effective_date": None,
            "location": f"{district} · {ref['period']} · {ref['count']}건 ({ref['complexes']}개 단지)",
            "snippet": f"{district} 최근 12개월 신고 실거래 {ref['count']}건, 중위 {eok(ref['median_price'])}.",
            "url": drafting.TRADE_PAGE, "document_id": None, "score": None, "state": "ok",
            "note": "신고된 과거 거래 가격입니다. 현재 매도 희망가나 거래 가능 여부를 뜻하지 않습니다."}


# ---------- 답변 ----------

def _merge_customer(f: dict, customer: dict | None, listing_intent: bool) -> dict:
    """고객 자료를 만들 때: 질문에 없는 조건은 고객 조건으로 채운다 (매물을 찾는 질문일 때만)."""
    if not customer:
        return f
    f = dict(f)
    f["first_home"] = f["first_home"] or bool(customer.get("first_home"))
    if listing_intent:
        f["district"] = f["district"] or customer.get("district")
        f["deal"] = f.get("deal") or drafting.customer_mode(customer.get("deal_type"))
        if not f["price_max"] and not f["price_min"]:
            f["price_max"] = customer.get("budget_max")
        if f["deal"] == "monthly" and not f.get("rent_max"):
            f["rent_max"] = customer.get("monthly_rent_max")
        if not f["area_min"] and not f["area_max"] and customer.get("area_min"):
            f["area_min"] = float(customer["area_min"])
            f["area_note"] = f"전용 {f['area_min']:g}㎡ 이상"
        f["walk_max"] = f["walk_max"] or customer.get("station_walk_max")
    return f


def _dedupe(hits: list[dict]) -> list[dict]:
    seen: set[int] = set()
    out = []
    for h in hits:
        if h["id"] not in seen:
            seen.add(h["id"])
            out.append(h)
    return out


BROWSE_WORDS = ("매물", "보여", "찾아", "목록", "전체", "리스트")
DEFAULT_SETTINGS = {"source_types": ["law", "policy", "office", "news"], "detail_count": 3, "near_miss": True}


def _structured_sentences(body: Body, l: dict, fx: dict, want: dict, routes: list[str]) -> None:
    """질문이 묻는 구조화 근거만 문장으로 붙인다. 연결·수집이 안 된 것은 '추가로 확인할 사항'으로 돌린다."""
    name = f"{l['label']} {l['title']}"
    if want["rent"]:
        routes.append("rent")
        if fx["rent"]:
            v, ev = fx["rent"]["value"], fx["rent"]["evidence"]
            eid = body.add(ev)
            parts = []
            if v["jeonse_count"]:
                parts.append(f"전세 {v['jeonse_count']}건, 보증금 중위 {eok(v['jeonse_median'])}")
            if v["monthly_count"]:
                parts.append(f"월세 {v['monthly_count']}건, 보증금 중위 {eok(v['monthly_deposit_median'])}·월 {v['monthly_rent_median']}만 원")
            tail = " 표본이 적어 사례로만 봐 주세요." if ev["state"] == "warning" else ""
            body.say(f"같은 단지 비슷한 면적의 최근 12개월 전월세 신고는 {', '.join(parts)}입니다.{tail}", [eid])
        else:
            body.check(f"{name}의 전월세 신고 자료가 아직 수집되지 않았습니다 (관리자 수집 필요)")
    for kind, say in (("complex", lambda v: "단지는 " + ", ".join(x for x in [
                          f"{v['household_count']}세대" if v.get("household_count") else None,
                          f"{v['building_count']}개 동" if v.get("building_count") else None,
                          f"난방 {v['heating_type']}" if v.get("heating_type") else None,
                          f"사용승인 {v['approval_date']}" if v.get("approval_date") else None] if x) + "입니다."),
                      ("building", lambda v: "건축물대장상 " + ", ".join(x for x in [
                          f"주용도 {v['main_purpose']}" if v.get("main_purpose") else None,
                          f"구조 {v['structure']}" if v.get("structure") else None,
                          f"사용승인 {v['approval_date']}" if v.get("approval_date") else None] if x) + "입니다."),
                      ("station", lambda v: f"{v['station']}에는 {'·'.join(v['routes']) or '노선 정보 없음'}이 다닙니다.")):
        if not want[kind]:
            continue
        routes.append(kind)
        if fx[kind]:
            body.say(f"{name} {say(fx[kind]['value'])}", [body.add(fx[kind]["evidence"])])
        elif kind not in fx["links"]:
            body.check(f"{name}에 {structured.KIND_LABEL[kind]}를 아직 연결하지 않았습니다. 매물 상세의 '공공데이터'에서 연결")
        else:
            body.check(f"{name}에 연결한 {structured.KIND_LABEL[kind]} 자료를 찾지 못했습니다. 다시 수집 필요")
    if any(fx[k] and fx[k]["evidence"]["state"] == "stale" for k in ("rent", "complex", "building", "station")):
        body.check(f"{name}의 공공데이터 중 오래된 수집본이 있습니다. 출처의 수집일 확인")


def _office_summary(conn, tenant_id: int) -> str:
    rows = conn.execute("""SELECT district, count(*)::int AS n FROM listings WHERE tenant_id = %s AND status = 'active'
                           GROUP BY district ORDER BY n DESC""", (tenant_id,)).fetchall()
    return ", ".join(f"{r['district']} {r['n']}건" for r in rows) or "아직 없음"


def answer(conn, user, query: str, *, customer: dict | None = None, quote_id: str | None = None,
           dropped: list[str] | None = None, settings: dict | None = None) -> dict:
    cfg = {**DEFAULT_SETTINGS, **(settings or {})}
    as_of = date.today()
    q = (query or "").strip()
    if not q:
        raise drafting.DomainError("질문을 적어 주세요.")
    names = conn.execute("SELECT DISTINCT station, complex_name FROM listings WHERE tenant_id = %s AND status = 'active'",
                         (user.tenant_id,)).fetchall()
    f = parse_query(q, [r["station"] for r in names if r["station"]], [r["complex_name"] for r in names if r["complex_name"]])
    listing_intent = has_conditions(f) or bool(f["wants"]) or any(w in q for w in LISTING_WORDS)
    f = drop(_merge_customer(f, customer, listing_intent), dropped or [])
    policy_q = rag.is_policy_question(q) or f["first_home"]
    market_q = any(w in q for w in MARKET_WORDS)
    want = {k: any(w in q for w in ws) for k, ws in STRUCT_WORDS.items()}
    # 전세·월세 질문의 금액은 보증금 조건이다 (parse_query가 거래 종류를 함께 잡아 _unmet에서 보증금과 비교).
    # 다만 금액 없이 시세를 묻는 질문('마포한강뷰 전세 시세')은 단지의 전월세 사례를 묻는 것이라 매물을 거래 종류로 거르지 않는다
    if market_q and f.get("deal") and not (f["price_max"] or f["price_min"] or f.get("rent_max")):
        f = drop(f, ["deal"])

    browse = bool(dropped) or (not has_conditions(f) and not f["wants"] and not policy_q and any(w in q for w in BROWSE_WORDS))
    listings, relaxed = (find_listings(conn, user, f, q, as_of, browse=browse, near_miss=cfg["near_miss"])
                         if listing_intent else ([], False))

    region = drafting.region_of(f["district"] or (customer or {}).get("district"))
    # 매물만 찾는 질문이면 법령·정책 문서를 붙이지 않는다 (관련 없는 정책 경고가 답변에 섞이지 않도록)
    doc_q = policy_q or market_q or bool(quote_id) or not listing_intent
    hits = (rag.search(conn, user.tenant_id, q, region=region, as_of=as_of, k=8,
                       source_types=cfg["source_types"]) if doc_q else [])
    if f["first_home"] and not any("주택가격" in h["text"] for h in hits):
        hits += rag.search(conn, user.tenant_id, "생애최초 주택가격 9억 원 이하 주택 구입 대출 지원",
                           region=region, as_of=as_of, k=6, source_types=cfg["source_types"])
    if quote_id:
        quoted = drafting.get_chunk(conn, user.tenant_id, quote_id)
        if not quoted:
            raise drafting.DomainError("인용할 자료를 찾을 수 없습니다.", 404)
        hits = [quoted] + hits
    else:
        quoted = None
    hits = [h for h in _dedupe(hits) if h is quoted or h["source_type"] in cfg["source_types"]]  # 명시 인용은 설정 밖 자료도 유지
    gate = (rag.evidence_gate(hits, as_of=as_of, policy_question=policy_q) if doc_q
            else {"status": "ok", "messages": [], "evidence": {}, "findings": []})
    ev_of = lambda h: gate["evidence"][f"c{h['id']}"]  # noqa: E731

    body = Body()
    if quoted:  # 자료실에서 인용한 조각은 답변 맨 앞에
        body.say(drafting._lead(quoted["text"]), [body.add(ev_of(quoted))])
    shown = listings[:cfg["detail_count"]]
    refs = {l["id"]: drafting.trade_reference(conn, l) for l in listings}
    facts: dict[int, dict] = {}
    routes = (["listing"] if listing_intent else []) + (["trade"] if any(refs[l["id"]] for l in shown) else []) \
        + (["document"] if doc_q else [])

    # 1) 매물 (구조화 사실 + 현장 메모 + 단지를 언급한 사무소 자료)
    if listing_intent:
        lids = [body.add(listing_ev(l)) for l in shown]
        label = " · ".join("주택가격 9억 이하" if c["key"] == "first_home" and not f["price_max"] else c["label"]
                           for c in chips(f) if not c["key"].startswith("want:"))
        wants_found = [w for w in f["wants"] if any(m["want"] == w for l in listings for m in l["matched"])]
        if listings and not relaxed and not label and wants_found:
            body.say(f"{'·'.join(wants_found)} 점이 매물 정보·현장 메모·사무소 자료에서 확인되는 매물은 "
                     f"{len(listings)}건입니다.", lids)
        elif listings and not relaxed and not label and browse:
            body.say(f"조건 없이 사무소 매물 {len(listings)}건을 보여 드립니다. 지역·가격·면적을 함께 물으면 좁혀 드립니다.", lids)
        elif listings and not relaxed:
            body.say(f"{label or '질문 내용'} 기준으로 맞는 매물은 {len(listings)}건입니다.", lids)
        elif listings:
            body.say(f"{label or '질문 내용'} 조건을 모두 만족하는 매물은 없고, 조건에 가까운 매물이 {len(listings)}건 있습니다.", lids)
        elif f["place"]:
            body.say(f"{f['place']['name']}({f['place']['region']}) 반경 {f['place']['radius_m'] / 1000:g}km 안에는 "
                     f"사무소에 등록된 매물이 없습니다. 지금 등록된 매물은 {_office_summary(conn, user.tenant_id)}입니다.", [])
            body.check(f"{f['place']['name']} 매물이 있다면 지도에서 '매물 등록'으로 올리기")
        elif f["district"] and not any(l["district"] == f["district"] for l in drafting.fetch_listings(conn, user.tenant_id)):
            body.say(f"{f['district']}에는 사무소에 등록된 매물이 없습니다. 지금 등록된 매물은 "
                     f"{_office_summary(conn, user.tenant_id)}입니다.", [])
        elif not label and f["wants"]:
            body.check(f"{'·'.join(f['wants'])} 점이 매물 정보·현장 메모·사무소 자료에서 확인되는 매물이 없습니다. "
                       "현장 메모나 자료를 추가하거나 방문해서 확인")
        else:
            body.check(f"{label or '질문 내용'} 조건에 맞는 매물이 없습니다. 조건을 넓혀 다시 찾기")
        for l, lid in zip(shown, lids):
            walk = (f", {l['station']} 도보 {l['station_walk_min']}분" if l.get("station") and l.get("station_walk_min") is not None
                    else f", {l['station']} 인근" if l.get("station") else "")
            gap = f" (차이: {', '.join(l['unmet'])})" if l["unmet"] else ""
            body.say(f"{l['label']} {josa(l['title'], '은는')} {drafting.price_text(l, f.get('deal'))}, "
                     f"전용 {l['area_m2']:g}㎡{walk}입니다{gap}.", [lid])
            for m in l["matched"]:
                body.say(m["say"], [body.add(rag.to_evidence(m["hit"])) if m["source"] == "doc" else lid])
            if refs[l["id"]]:
                ref = refs[l["id"]]
                body.say(f"같은 단지 비슷한 면적의 최근 실거래 중위가는 {eok(ref['median_price'])}({ref['count']}건)입니다.",
                         [body.add(drafting.trade_evidence(l, ref))])
            if any(want.values()):
                _structured_sentences(body, l, facts.setdefault(l["id"], structured.facts(conn, user.tenant_id, l)), want, routes)
        for w in f["wants"]:
            if listings and not any(m["want"] == w for l in shown for m in l["matched"]):
                body.check(f"{josa(chr(39) + w + chr(39), '은는')} 자료에서 확인되지 않았습니다. 방문해서 확인")

    # 2) 정책·법령 (문서 근거 검색 + 근거 게이트)
    if f["first_home"] and shown:
        policy = [h for h in hits if h["source_type"] == "policy" and "주택가격" in h["text"]]
        ok = [l["label"] for l in shown if l.get("price") is not None and l["price"] <= drafting.FIRST_HOME_PRICE_LIMIT]
        if policy and ok:
            body.say(f"{'·'.join(ok)} 매물은 주택가격 9억 원 이하라 생애최초 구입 지원의 가격 기준에는 해당합니다.",
                     [body.add(ev_of(policy[0]))])
    if policy_q or quoted or not listing_intent:
        official = sorted([h for h in hits if h["source_type"] != "news" and ev_of(h)["state"] != "conflict"
                           and h is not quoted and not (listing_intent and h["source_type"] == "office")],
                          key=lambda h: (rag.AUTHORITY[h["source_type"]], -h["score"]))
        for h in official[:2]:
            body.say(drafting._lead(h["text"]), [body.add(ev_of(h))])

    # 3) 시장 상황 (지역 실거래가 + 기사는 보조 자료로만)
    if market_q:
        district = f["district"] or (listings[0]["district"] if listings else None)
        if district and (ref := district_trades(conn, district, as_of)):
            body.say(f"{district} 최근 12개월 신고 실거래는 {ref['count']}건, 중위 {eok(ref['median_price'])}입니다.",
                     [body.add(district_trade_ev(district, ref))])
        news = [h for h in hits if h["source_type"] == "news" and ev_of(h)["state"] != "conflict"]
        if news:
            n = news[0]
            body.say(f"{n['publisher'].split(' (')[0]}({str(n['published_at'])[5:].replace('-', '/')}) 기사는 "
                     f"'{drafting._lead(n['text'], 90).rstrip('.')}'라고 전했습니다. 시장 분위기를 보여 주는 보조 자료입니다.",
                     [body.add(ev_of(n))])

    generator = "template"
    if llm.is_enabled() and body.evidence:
        for ev in gate["evidence"].values():
            body.add(ev)
        context = (f"기준일 {as_of}. 질문에서 이해한 조건: {' · '.join(c['label'] for c in chips(f)) or '없음'}. "
                   f"찾은 매물 {len(listings)}건{' (조건을 넓혀 찾음)' if relaxed else ''}: "
                   + "; ".join(f"{l['label']} {l['title']} {drafting.price_text(l, f.get('deal'))} {l['area_m2']:g}㎡"
                               for l in shown))
        if customer:
            context += f". 고객 조건: {drafting.cond_summary(customer)}"
        drafting.llm_body(body, f"중개사의 질문에 대한 답변 (중개사 1인칭, 존댓말, 사실마다 출처 id): {q}", context)
        generator = "anthropic"
    if not policy_q and not quoted:  # 정책을 묻지 않았으면 답변에 쓴 자료에 걸린 경고만 붙인다
        gate["findings"] = [x for x in gate["findings"] if any(c in body.evidence for c in x["citations"])]
    drafting.apply_gate(body, gate)
    if not body.opinion:
        body.say("질문과 관련된 매물이나 자료를 찾지 못했습니다.", [])

    cond = {"budget_max": f["price_max"], "area_min": f["area_min"], "district": f["district"], "station_walk_max": f["walk_max"],
            "deal_type": drafting.DEAL_LABEL[f["deal"]] if f.get("deal") else None, "monthly_rent_max": f.get("rent_max")}
    snapshot = [{**{k: v for k, v in l.items() if k != "score"}, "checks": drafting.condition_checks(l, cond),
                 "trade_reference": refs[l["id"]], "matched": [{"want": m["want"], "text": m["text"]} for m in l["matched"]],
                 "public": structured.public_summary(facts[l["id"]]) if l["id"] in facts else {}}
                for l in listings]
    return {**body.result(), "listings": snapshot, "gate": {"status": gate["status"], "messages": gate["messages"]},
            "generator": generator, "title": "문의 답변", "query": q, "understood": chips(f), "relaxed": relaxed,
            "related": [ev_of(h) for h in hits[:6]], "listing_intent": listing_intent,
            "routes": list(dict.fromkeys(routes)),
            "stale_count": sum(1 for s in body.result()["sources"] if s.get("state") == "stale"),
            # 지도: 질문한 지역으로 옮기고 반경을 그린다 (구는 구청 근처, 반경 없음)
            "place": f["place"] or (places.gu_center(f["district"]) if f["district"] else None)}
