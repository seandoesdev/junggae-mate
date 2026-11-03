"""구조화 공공데이터 evidence: 매물 ↔ 단지·건축물·역 연결과, 저장된 공공 캐시를 답변 근거로 바꾸는 일.

설계서(docs/RAG_ARCHITECTURE.md) Phase 1의 '구조화 evidence와 질문·비교표 연결'을 맡는다.
- 질문 중에는 외부 API를 부르지 않는다. public_sources가 저장한 캐시만 읽는다.
- 단지·건축물·역은 후보만 제시하고, 확정은 사람이 한다(entity_links). 이름이 비슷하다고 자동으로 묶지 않는다.
- 근거 id는 매물 id를 쓴다: r{매물} 전월세, k{매물} 단지(K-apt), b{매물} 건축물대장, s{매물} 지하철역.
- 수집한 지 오래된 자료는 state='stale', 표본이 적은 통계는 state='warning'으로 표시한다(설계서 11.2).
"""
import statistics
import re
from datetime import datetime, timedelta, timezone

from . import drafting, public_data, public_sources, rag

KINDS = ("complex", "building", "station")
KIND_LABEL = {"complex": "단지(K-apt)", "building": "건축물대장", "station": "지하철역"}
# 수집 후 이 기간이 지나면 '오래된 자료'로 표시한다 (일)
STALE_DAYS = {"rent": 60, "complex": 365, "building": 365, "station": 365}
SMALL_SAMPLE = 3
PAGE = "https://www.data.go.kr/data/{}/openapi.do"


class LinkError(ValueError):
    pass


def _stem(station: str | None) -> str:
    s = (station or "").strip()
    return s[:-1] if s.endswith("역") and len(s) > 2 else s


def _is_stale(collected_at, kind: str) -> bool:
    if collected_at is None:
        return True
    return datetime.now(timezone.utc) - collected_at > timedelta(days=STALE_DAYS[kind])


def _evidence(eid: str, kind: str, *, title: str, org: str, dataset: str, collected_at, location: str,
              snippet: str, value: dict, note: str | None = None, warn: bool = False) -> dict:
    stale = _is_stale(collected_at, kind)
    as_of = collected_at.date().isoformat() if collected_at else None
    if stale:
        note = (f"{as_of} 수집본입니다. {STALE_DAYS[kind]}일이 지나 다시 수집이 필요합니다. " + (note or "")).strip()
    return rag.canonical_evidence({
        "id": eid, "kind": "structured", "type": "data", "type_label": {
            "rent": "전월세 실거래가", "complex": "공동주택 기본정보", "building": "건축물대장", "station": "지하철 노선"}[kind],
        "title": title, "org": org, "source_id": dataset, "url": PAGE.format(dataset),
        "date": as_of or "-", "collected_at": collected_at.isoformat() if collected_at else None,
        "effective_date": None, "location": location, "snippet": snippet, "value": value, "document_id": None,
        "score": None, "state": "stale" if stale else ("warning" if warn else "ok"), "note": note or None,
    })


# ---------- 연결 (후보 → 사람이 확정) ----------

def links(conn, tenant_id: int, listing_id: int) -> dict[str, dict]:
    rows = conn.execute(
        """SELECT e.kind, e.entity_key, e.label, e.match_method, e.confidence, e.confirmed_at, u.name AS confirmed_by
           FROM entity_links e LEFT JOIN users u ON u.id = e.confirmed_by
           WHERE e.tenant_id = %s AND e.listing_id = %s""", (tenant_id, listing_id)).fetchall()
    return {r["kind"]: {**r, "confidence": float(r["confidence"]) if r["confidence"] is not None else None,
                        "confirmed_at": r["confirmed_at"].isoformat()} for r in rows}


def _station_groups(conn, name: str) -> list[dict]:
    """역명은 전국에서 중복되므로 TAGO 역 ID를 연결 키로 쓴다.

    한 환승역도 노선마다 역 ID가 다르므로 후보를 노선별로 보여 주고 사람이
    물리역을 확정한다. 과거 seed가 저장한 역명 키는 confirm/_station에서 계속
    읽어 기존 연결을 깨지 않는다.
    """
    out, seen = [], set()
    for r in public_sources.find_subway_stations(conn, name, limit=40):
        if r["station_id"] in seen:
            continue
        seen.add(r["station_id"])
        route = r["route_name"] or "노선 정보 없음"
        out.append({"entity_key": r["station_id"], "label": f"{r['station_name']} ({route})",
                    "detail": f"역 ID {r['station_id']}",
                    "score": 1.0 if _stem(r["station_name"]) == _stem(name) else 0.6})
    return sorted(out, key=lambda x: (-x["score"], x["label"], x["entity_key"]))[:10]


def candidates(conn, listing: dict) -> dict[str, list[dict]]:
    """매물 이름·역 이름으로 찾은 연결 후보. 지역 일치에 가산점을 주되 확정은 사람이 한다."""
    cx = listing["complex_name"]
    district = (listing.get("district") or "").strip()
    complexes = conn.execute(
        """SELECT kapt_code AS entity_key, name, address, household_count,
                  similarity(name, %s)::float AS name_score,
                  CASE WHEN %s <> '' AND (coalesce(address, '') ILIKE '%%' || %s || '%%'
                                                OR coalesce(road_address, '') ILIKE '%%' || %s || '%%')
                       THEN 0.25 ELSE 0 END::float AS region_bonus
           FROM apartment_complexes WHERE name %% %s OR name ILIKE '%%' || %s || '%%'
           ORDER BY (similarity(name, %s) + CASE WHEN %s <> '' AND
                     (coalesce(address, '') ILIKE '%%' || %s || '%%' OR coalesce(road_address, '') ILIKE '%%' || %s || '%%')
                     THEN 0.25 ELSE 0 END) DESC, name LIMIT 10""",
        (cx, district, district, district, cx, cx, cx, district, district, district)).fetchall()
    buildings = conn.execute(
        """SELECT source_key AS entity_key, building_name, lot_address, main_purpose,
                  similarity(coalesce(building_name, ''), %s)::float AS name_score,
                  CASE WHEN %s <> '' AND (coalesce(lot_address, '') ILIKE '%%' || %s || '%%'
                                                OR coalesce(road_address, '') ILIKE '%%' || %s || '%%')
                       THEN 0.25 ELSE 0 END::float AS region_bonus
           FROM building_register_records WHERE building_name %% %s OR building_name ILIKE '%%' || %s || '%%'
           ORDER BY (similarity(coalesce(building_name, ''), %s) + CASE WHEN %s <> '' AND
                     (coalesce(lot_address, '') ILIKE '%%' || %s || '%%' OR coalesce(road_address, '') ILIKE '%%' || %s || '%%')
                     THEN 0.25 ELSE 0 END) DESC LIMIT 10""",
        (cx, district, district, district, cx, cx, cx, district, district, district)).fetchall()
    return {
        "complex": [{"entity_key": r["entity_key"], "label": r["name"],
                     "detail": " · ".join(x for x in [r["address"], f"{r['household_count']}세대" if r["household_count"] else None] if x),
                     "score": round(min(1.0, r["name_score"] + r["region_bonus"]), 3)} for r in complexes[:5]],
        "building": [{"entity_key": r["entity_key"], "label": r["building_name"] or "(이름 없음)",
                      "detail": " · ".join(x for x in [r["lot_address"], r["main_purpose"]] if x),
                      "score": round(min(1.0, r["name_score"] + r["region_bonus"]), 3)} for r in buildings[:5]],
        "station": _station_groups(conn, _stem(listing.get("station"))) if listing.get("station") else [],
    }


def _station_ids(entity_key: str) -> list[str]:
    if not entity_key.startswith("station_ids:"):
        return [entity_key]
    ids = list(dict.fromkeys(
        part.strip() for part in entity_key.removeprefix("station_ids:").split(",") if part.strip()
    ))
    if not ids or len(ids) > 10:
        raise LinkError("지하철역은 1개 이상 10개 이하의 역 ID를 선택해 주세요.")
    return ids


def confirm(conn, user, listing: dict, kind: str, entity_key: str) -> dict:
    if kind not in KINDS:
        raise LinkError("연결할 수 없는 종류입니다.")
    if kind == "complex":
        row = public_sources.get_complex(conn, entity_key)
        label = row and row["name"]
    elif kind == "building":
        row = conn.execute("SELECT building_name, lot_address FROM building_register_records WHERE source_key = %s",
                           (entity_key,)).fetchone()
        label = row and (row["building_name"] or row["lot_address"])
    else:
        requested_ids = _station_ids(entity_key)
        rows = conn.execute(
            """SELECT station_id, station_name, route_name FROM subway_stations
               WHERE station_id = ANY(%s::text[]) ORDER BY route_name""", (requested_ids,)).fetchall()
        if rows and len(rows) != len(requested_ids):
            raise LinkError("선택한 지하철역 ID 중 수집 캐시에 없는 항목이 있습니다.")
        if rows and len({r["station_name"] for r in rows}) != 1:
            raise LinkError("서로 다른 지하철역은 하나의 연결로 묶을 수 없습니다.")
        if not rows and not entity_key.startswith("station_ids:"):  # 기존 seed/운영 데이터의 역명 기반 링크 호환
            rows = conn.execute(
                """SELECT station_id, station_name, route_name FROM subway_stations
                   WHERE station_name = %s ORDER BY route_name""", (entity_key,)).fetchall()
        row = rows or None
        label = rows and f"{rows[0]['station_name']} ({'·'.join(r['route_name'] for r in rows if r['route_name'])})"
    if not row:
        raise LinkError("수집된 공공데이터에서 찾을 수 없습니다. 먼저 관리자 수집을 실행하세요.")
    match = next((c for c in candidates(conn, listing)[kind] if c["entity_key"] == entity_key), None)
    conn.execute(
        """INSERT INTO entity_links (tenant_id, listing_id, kind, entity_key, label, match_method, confidence, confirmed_by)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
           ON CONFLICT (listing_id, kind) DO UPDATE SET entity_key = EXCLUDED.entity_key, label = EXCLUDED.label,
             match_method = EXCLUDED.match_method, confidence = EXCLUDED.confidence,
             confirmed_by = EXCLUDED.confirmed_by, confirmed_at = now()""",
        (user.tenant_id, listing["id"], kind, entity_key, label, "suggested" if match else "manual",
         match["score"] if match else None, user.id))
    return links(conn, user.tenant_id, listing["id"])[kind]


def unlink(conn, tenant_id: int, listing_id: int, kind: str) -> None:
    conn.execute("DELETE FROM entity_links WHERE tenant_id = %s AND listing_id = %s AND kind = %s",
                 (tenant_id, listing_id, kind))


# ---------- 근거 ----------

def _region_key(value: str | None) -> str:
    """주소 표기의 '서울특별시/서울', 공백 차이를 비교 가능한 값으로 줄인다."""
    text = re.sub(r"\s+", "", value or "")
    for full, short in (("특별자치도", ""), ("특별자치시", ""), ("특별시", ""), ("광역시", ""), ("자치시", "")):
        text = text.replace(full, short)
    return text


def _rent_lawd_cd(conn, listing: dict) -> str | None:
    """수집 캐시에서 매물 지역과 가장 잘 맞는 법정동 5자리 코드를 찾는다.

    전국에 같은 '중구'가 여럿 있으므로 주소의 시·도와 코드 앞 두 자리를 함께
    점수화하고, 최고점이 동률이면 잘못된 지역 결합 대신 근거 없음으로 처리한다.
    """
    rows = conn.execute(
        """SELECT lawd_cd, district,
                  bool_or(complex_name = %s) AS same_complex,
                  bool_or(complex_name = %s AND area_m2 BETWEEN %s - 5 AND %s + 5) AS same_area,
                  array_agg(DISTINCT dong) FILTER (WHERE complex_name = %s AND dong IS NOT NULL) AS complex_dongs
           FROM apt_rent_trades GROUP BY lawd_cd, district""",
        (listing["complex_name"], listing["complex_name"], listing["area_m2"], listing["area_m2"],
         listing["complex_name"]),
    ).fetchall()
    wanted = _region_key(listing.get("district"))
    address = _region_key(listing.get("address"))
    scored = []
    for row in rows:
        code = str(row["lawd_cd"])
        district = row["district"] or public_data.LAWD.get(code, "")
        region = public_data.LAWD_REGION.get(code[:2], "")
        dkey, rkey = _region_key(district), _region_key(region)
        score = 0
        # 실수집 응답은 district가 코드뿐일 수 있다. 전국 정적표를 불완전하게
        # 내장하기보다 동일 단지·유사 면적이 실제 수집된 코드를 강한 신호로
        # 쓰고, 주소와 광역코드는 동명 단지의 tie-breaker로 사용한다.
        if row["same_area"]:
            score += 400
        elif row["same_complex"]:
            score += 300
        if wanted and dkey == wanted:
            score += 100
        elif wanted and (dkey.endswith(wanted) or wanted.endswith(dkey)):
            score += 60
        if address and dkey and dkey in address:
            score += 80
        elif address and wanted and wanted in address and dkey.endswith(wanted):
            score += 40
        if address and rkey and rkey in address:
            score += 80
        # 실제 전월세 응답에는 구 이름 없이 시군구 코드(sggCd)만 오는 경우가 많다. 같은 시·도의
        # 두 구에 같은 이름의 단지가 있을 때는, 그 단지가 수집된 법정동(umdNm)이 매물 주소에
        # 들어 있는 쪽을 고른다. 코드표를 추측하지 않고 실제 적재된 값만 쓴다.
        if address and any(len(d) >= 2 and re.search(r"(동|가|읍|면|리)$", d) and _region_key(d) in address
                           for d in (row["complex_dongs"] or [])):
            score += 120
        if score:
            scored.append((score, code))
    if not scored:
        return None
    scored.sort(reverse=True)
    if len(scored) > 1 and scored[0][0] == scored[1][0] and scored[0][1] != scored[1][1]:
        return None
    return scored[0][1]

def _rent(conn, l: dict) -> dict | None:
    lawd = _rent_lawd_cd(conn, l)
    if not lawd:
        return None
    rows = public_sources.rent_references(conn, lawd_cd=lawd, complex_name=l["complex_name"], area_m2=l["area_m2"])
    if not rows:
        return None
    jeonse = [r for r in rows if r["rent_type"] == "jeonse"]
    monthly = [r for r in rows if r["rent_type"] == "monthly"]
    v = {"jeonse_count": len(jeonse), "monthly_count": len(monthly), "unit": "만원",
         "jeonse_median": int(statistics.median(r["deposit"] for r in jeonse)) if jeonse else None,
         "monthly_deposit_median": int(statistics.median(r["deposit"] for r in monthly)) if monthly else None,
         "monthly_rent_median": int(statistics.median(r["monthly_rent"] for r in monthly)) if monthly else None,
         "coverage_from": str(min(r["contract_date"] for r in rows)), "coverage_to": str(max(r["contract_date"] for r in rows))}
    parts = []
    if jeonse:
        parts.append(f"전세 {len(jeonse)}건, 보증금 중위 {drafting.eok(v['jeonse_median'])}")
    if monthly:
        parts.append(f"월세 {len(monthly)}건, 보증금 중위 {drafting.eok(v['monthly_deposit_median'])}·월 {v['monthly_rent_median']}만 원")
    small = 0 < len(jeonse) < SMALL_SAMPLE or 0 < len(monthly) < SMALL_SAMPLE
    return {"value": v, "evidence": _evidence(
        f"r{l['id']}", "rent", title="아파트 전월세 실거래가", org=rows[0]["source"], dataset=public_sources.RENT_DATASET,
        collected_at=max(r["collected_at"] for r in rows),
        location=f"{l['complex_name']} 전용 {float(l['area_m2']):g}㎡ 안팎 · {v['coverage_from']} ~ {v['coverage_to']}",
        snippet=f"동일 단지·유사 면적 최근 12개월 신고 {' / '.join(parts)}.", value=v, warn=small,
        note=("표본이 적어 시세 통계가 아니라 사례로만 봐 주세요. " if small else "")
             + "신고된 과거 임대차 계약이며 현재 호가나 계약 가능 여부가 아닙니다.")}


def _complex(conn, l: dict, link: dict) -> dict | None:
    c = public_sources.get_complex(conn, link["entity_key"])
    if not c:
        return None
    v = {k: (str(c[k]) if c[k] is not None and k in ("approval_date", "total_area_m2") else c[k])
         for k in ("household_count", "building_count", "heating_type", "sale_type", "approval_date", "total_area_m2")}
    bits = [f"{c['household_count']}세대" if c["household_count"] else None,
            f"{c['building_count']}개 동" if c["building_count"] else None,
            f"난방 {c['heating_type']}" if c["heating_type"] else None,
            f"사용승인 {c['approval_date']}" if c["approval_date"] else None]
    return {"value": v, "evidence": _evidence(
        f"k{l['id']}", "complex", title=f"{c['name']} 공동주택 기본정보", org=c["source"], dataset=public_sources.KAPT_DATASET,
        collected_at=c["collected_at"], location=f"단지코드 {c['kapt_code']} · {c['address'] or ''}".strip(" ·"),
        snippet=f"{c['name']}: " + ", ".join(b for b in bits if b) + ".", value=v)}


def _building(conn, l: dict, link: dict) -> dict | None:
    b = conn.execute(
        """SELECT building_name, lot_address, main_purpose, structure, total_area_m2, household_count, approval_date,
                  source, collected_at FROM building_register_records WHERE source_key = %s""", (link["entity_key"],)).fetchone()
    if not b:
        return None
    v = {"main_purpose": b["main_purpose"], "structure": b["structure"],
         "total_area_m2": str(b["total_area_m2"]) if b["total_area_m2"] is not None else None,
         "approval_date": str(b["approval_date"]) if b["approval_date"] else None}
    bits = [f"주용도 {b['main_purpose']}" if b["main_purpose"] else None, f"구조 {b['structure']}" if b["structure"] else None,
            f"연면적 {float(b['total_area_m2']):,.0f}㎡" if b["total_area_m2"] else None,
            f"사용승인 {b['approval_date']}" if b["approval_date"] else None]
    return {"value": v, "evidence": _evidence(
        f"b{l['id']}", "building", title=f"{b['building_name'] or l['complex_name']} 건축물대장 표제부", org=b["source"],
        dataset=public_sources.BUILDING_DATASET, collected_at=b["collected_at"], location=b["lot_address"] or "-",
        snippet=", ".join(x for x in bits if x) + ".", value=v,
        note="건축물대장 요약입니다. 위반건축물 여부와 권리관계는 계약 전 원본 대장·등기사항증명서로 확인하세요.")}


def _station(conn, l: dict, link: dict) -> dict | None:
    station_ids = _station_ids(link["entity_key"])
    rows = conn.execute(
        """SELECT station_id, station_name, route_name, source, collected_at FROM subway_stations
           WHERE station_id = ANY(%s::text[]) ORDER BY route_name NULLS LAST""", (station_ids,)).fetchall()
    if not rows and not link["entity_key"].startswith("station_ids:"):  # 역명을 키로 저장한 기존 연결 호환
        rows = conn.execute(
            """SELECT station_id, station_name, route_name, source, collected_at FROM subway_stations
               WHERE station_name = %s ORDER BY route_name NULLS LAST""", (link["entity_key"],)).fetchall()
    if not rows:
        return None
    routes = [r["route_name"] for r in rows if r["route_name"]]
    station_name = rows[0]["station_name"]
    v = {"station": station_name, "routes": routes, "station_ids": [r["station_id"] for r in rows]}
    return {"value": v, "evidence": _evidence(
        f"s{l['id']}", "station", title=f"{station_name} 노선 정보", org=rows[0]["source"],
        dataset=public_sources.SUBWAY_DATASET, collected_at=max(r["collected_at"] for r in rows),
        location=f"역 ID {', '.join(v['station_ids'][:4])}", snippet=f"{station_name}: {'·'.join(routes) or '노선 정보 없음'}.",
        value=v, note="노선 정보입니다. 도보 거리·시간은 매물 등록 정보를 따릅니다.")}


def facts(conn, tenant_id: int, listing: dict) -> dict:
    """매물 하나의 구조화 근거. {rent, complex, building, station}: {value, evidence} 또는 None, links: 확정된 연결"""
    lk = links(conn, tenant_id, listing["id"])
    return {
        "links": lk,
        "rent": _rent(conn, listing),
        "complex": _complex(conn, listing, lk["complex"]) if "complex" in lk else None,
        "building": _building(conn, listing, lk["building"]) if "building" in lk else None,
        "station": _station(conn, listing, lk["station"]) if "station" in lk else None,
    }


def public_summary(f: dict) -> dict:
    """비교표·보고서 스냅샷에 넣을 짧은 값 (근거 id 포함)."""
    out = {}
    for k in ("rent", "complex", "building", "station"):
        if f.get(k):
            out[k] = {**f[k]["value"], "evidence_id": f[k]["evidence"]["id"], "state": f[k]["evidence"]["state"]}
    return out
