"""공공데이터포털 구조화 데이터의 정규화·멱등 저장 계층.

문서 RAG와 달리 금액·면적·코드가 중요한 API 응답은 임베딩하지 않는다.
원천 레코드를 JSONB로 보존하면서 검색에 필요한 필드만 관계형 컬럼으로 정규화한다.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Callable, Iterable, Mapping
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any

from . import public_catalog
from .db import Jsonb

RENT_DATASET = "15126474"
KAPT_DATASET = "15058453"
BUILDING_DATASET = "15134735"
SUBWAY_DATASET = "15098554"

SOURCE_NAMES = {
    RENT_DATASET: "국토교통부 아파트 전월세 실거래가 (data.go.kr 15126474)",
    KAPT_DATASET: "국토교통부 공동주택 기본정보 (data.go.kr 15058453)",
    BUILDING_DATASET: "국토교통부 건축HUB 건축물대장 (data.go.kr 15134735)",
    SUBWAY_DATASET: "국토교통부 TAGO 지하철정보 (data.go.kr 15098554)",
}

SUPPORTED_DATASETS = frozenset(SOURCE_NAMES)


class PublicSourceError(ValueError):
    """수신 레코드를 안전하게 정규화할 수 없을 때 사용한다."""


def _pick(row: Mapping[str, Any], *names: str) -> Any:
    """공공 API의 버전별 대소문자·필드명 차이를 흡수한다."""
    for name in names:
        if name in row and row[name] not in (None, ""):
            return row[name]
    lowered = {str(key).lower(): value for key, value in row.items()}
    for name in names:
        value = lowered.get(name.lower())
        if value not in (None, ""):
            return value
    return None


def _text(value: Any) -> str | None:
    if value is None:
        return None
    result = str(value).strip()
    return result or None


def _int(value: Any, *, default: int | None = None) -> int | None:
    text = _text(value)
    if text is None:
        return default
    try:
        return int(Decimal(text.replace(",", "")))
    except (InvalidOperation, ValueError):
        return default


def _decimal(value: Any) -> Decimal | None:
    text = _text(value)
    if text is None:
        return None
    try:
        return Decimal(text.replace(",", ""))
    except InvalidOperation:
        return None


def _date(value: Any) -> date | None:
    text = _text(value)
    if not text:
        return None
    digits = re.sub(r"\D", "", text)
    if len(digits) != 8:
        return None
    try:
        return date(int(digits[:4]), int(digits[4:6]), int(digits[6:8]))
    except ValueError:
        return None


def _parts_date(year: Any, month: Any, day: Any) -> date | None:
    values = (_int(year), _int(month), _int(day))
    if any(value is None for value in values):
        return None
    try:
        return date(*values)  # type: ignore[arg-type]
    except ValueError:
        return None


def _source_key(dataset_id: str, identity: Mapping[str, Any]) -> str:
    canonical = json.dumps(identity, ensure_ascii=False, sort_keys=True, default=str, separators=(",", ":"))
    return hashlib.sha256(f"{dataset_id}:{canonical}".encode()).hexdigest()


def normalize_rent(row: Mapping[str, Any], params: Mapping[str, Any]) -> dict[str, Any]:
    lawd_cd = _text(_pick(row, "sggCd", "lawdCd", "LAWD_CD")) or _text(params.get("LAWD_CD"))
    complex_name = _text(_pick(row, "aptNm", "apartmentName"))
    area = _decimal(_pick(row, "excluUseAr", "exclusiveArea"))
    contract_date = _parts_date(
        _pick(row, "dealYear", "contractYear"),
        _pick(row, "dealMonth", "contractMonth"),
        _pick(row, "dealDay", "contractDay"),
    )
    deposit = _int(_pick(row, "deposit", "depositAmount"))
    monthly_rent = _int(_pick(row, "monthlyRent", "monthlyRentAmount"), default=0)
    if not lawd_cd or not complex_name or area is None or contract_date is None or deposit is None:
        raise PublicSourceError("전월세 레코드의 지역·단지·면적·계약일·보증금이 불완전합니다.")
    district = _text(_pick(row, "sggNm", "districtName")) or lawd_cd
    identity = {
        "lawd_cd": lawd_cd,
        "dong": _text(_pick(row, "umdNm", "dongName")),
        "jibun": _text(_pick(row, "jibun")),
        "complex_name": complex_name,
        "area_m2": str(area),
        "floor": _int(_pick(row, "floor")),
        "contract_date": contract_date.isoformat(),
        "deposit": deposit,
        "monthly_rent": monthly_rent,
        "contract_type": _text(_pick(row, "contractType")),
    }
    return {
        "source_key": _source_key(RENT_DATASET, identity),
        "lawd_cd": lawd_cd,
        "dong": identity["dong"],
        "jibun": identity["jibun"],
        "complex_name": complex_name,
        "area_m2": area,
        "floor": identity["floor"],
        "contract_date": contract_date,
        "deposit": deposit,
        "monthly_rent": monthly_rent,
        "contract_type": identity["contract_type"],
        "district": district,
        "rent_type": "monthly" if monthly_rent and monthly_rent > 0 else "jeonse",
        "contract_term": _text(_pick(row, "contractTerm")),
        "renewal_right_used": _text(_pick(row, "useRRRight", "renewalRightUsed")),
        "previous_deposit": _int(_pick(row, "preDeposit", "previousDeposit")),
        "previous_rent": _int(_pick(row, "preMonthlyRent", "previousMonthlyRent")),
        "build_year": _int(_pick(row, "buildYear")),
        "source": SOURCE_NAMES[RENT_DATASET],
        "raw_payload": dict(row),
    }


def normalize_complex(row: Mapping[str, Any], _params: Mapping[str, Any]) -> dict[str, Any]:
    kapt_code = _text(_pick(row, "kaptCode"))
    name = _text(_pick(row, "kaptName"))
    if not kapt_code or not name:
        raise PublicSourceError("K-apt 레코드의 단지코드 또는 단지명이 없습니다.")
    return {
        "kapt_code": kapt_code,
        "name": name,
        "address": _text(_pick(row, "kaptAddr", "bjdCode", "address")),
        "road_address": _text(_pick(row, "doroJuso", "roadAddress")),
        "sale_type": _text(_pick(row, "codeSaleNm", "saleType")),
        "heating_type": _text(_pick(row, "codeHeatNm", "heatingType")),
        "approval_date": _date(_pick(row, "kaptUsedate", "useAprDay", "approvalDate")),
        "building_count": _int(_pick(row, "kaptDongCnt", "buildingCount")),
        "household_count": _int(_pick(row, "kaptdaCnt", "householdCount")),
        "total_area_m2": _decimal(_pick(row, "kaptTarea", "totalArea")),
        "source": SOURCE_NAMES[KAPT_DATASET],
        "raw_payload": dict(row),
    }


def normalize_building(row: Mapping[str, Any], params: Mapping[str, Any]) -> dict[str, Any]:
    sigungu_cd = _text(_pick(row, "sigunguCd")) or _text(params.get("sigunguCd"))
    bjdong_cd = _text(_pick(row, "bjdongCd")) or _text(params.get("bjdongCd"))
    if not sigungu_cd or not bjdong_cd:
        raise PublicSourceError("건축물대장 레코드의 시군구·법정동 코드가 없습니다.")
    operation = _text(params.get("operation")) or "getBrTitleInfo"
    mgm_pk = _text(_pick(row, "mgmBldrgstPk", "managementBuildingRegisterPk"))
    identity = {
        "operation": operation,
        "mgm_pk": mgm_pk,
        "sigungu_cd": sigungu_cd,
        "bjdong_cd": bjdong_cd,
        "plat_gb_cd": _text(_pick(row, "platGbCd")) or _text(params.get("platGbCd")),
        "bun": _text(_pick(row, "bun")) or _text(params.get("bun")),
        "ji": _text(_pick(row, "ji")) or _text(params.get("ji")),
        "register_kind": _text(_pick(row, "regstrKindCd", "regstrKindCdNm")),
    }
    source_key = _source_key(BUILDING_DATASET, identity)
    return {
        "source_key": source_key,
        "source_record_id": mgm_pk,
        **{key: value for key, value in identity.items() if key != "mgm_pk"},
        "building_name": _text(_pick(row, "bldNm", "buildingName")),
        "lot_address": _text(_pick(row, "platPlc", "lotAddress")),
        "road_address": _text(_pick(row, "newPlatPlc", "roadAddress")),
        "main_purpose": _text(_pick(row, "mainPurpsCdNm", "mainPurpose")),
        "structure": _text(_pick(row, "strctCdNm", "structureName")),
        "total_area_m2": _decimal(_pick(row, "totArea", "totalArea")),
        "floor_area_m2": _decimal(_pick(row, "vlRatEstmTotArea", "floorArea")),
        "household_count": _int(_pick(row, "hhldCnt", "householdCount")),
        "approval_date": _date(_pick(row, "useAprDay", "approvalDate")),
        "source": SOURCE_NAMES[BUILDING_DATASET],
        "raw_payload": dict(row),
    }


def normalize_subway(row: Mapping[str, Any], _params: Mapping[str, Any]) -> dict[str, Any]:
    station_id = _text(_pick(row, "subwayStationId", "stationId"))
    station_name = _text(_pick(row, "subwayStationName", "stationName"))
    route_id = _text(_pick(row, "subwayRouteId", "routeId"))
    route_name = _text(_pick(row, "subwayRouteName", "routeName", "subwayRouteNm"))
    if not station_id or not station_name:
        raise PublicSourceError("지하철 레코드의 역 ID 또는 역명이 없습니다.")
    identity = {"station_id": station_id, "route_id": route_id or "", "route_name": route_name or ""}
    return {
        "source_key": _source_key(SUBWAY_DATASET, identity),
        "station_id": station_id,
        "station_name": station_name,
        "route_id": route_id,
        "route_name": route_name,
        "source": SOURCE_NAMES[SUBWAY_DATASET],
        "raw_payload": dict(row),
    }


NORMALIZERS: dict[str, Callable[[Mapping[str, Any], Mapping[str, Any]], dict[str, Any]]] = {
    RENT_DATASET: normalize_rent,
    KAPT_DATASET: normalize_complex,
    BUILDING_DATASET: normalize_building,
    SUBWAY_DATASET: normalize_subway,
}


def _result_stats(received: int, valid: int, outcomes: Iterable[str]) -> dict[str, int]:
    counts = {"inserted": 0, "updated": 0, "unchanged": 0}
    for outcome in outcomes:
        counts[outcome] += 1
    return {"received": received, "valid": valid, "invalid": received - valid, **counts}


def _outcome(row: Mapping[str, Any] | None) -> str:
    if row is None:
        return "unchanged"
    return "inserted" if row["inserted"] else "updated"


def store_rents(conn: Any, rows: Iterable[Mapping[str, Any]]) -> list[str]:
    outcomes = []
    for row in rows:
        saved = conn.execute(
            """INSERT INTO apt_rent_trades
               (source_key, lawd_cd, district, dong, jibun, complex_name, area_m2, floor, contract_date,
                deposit, monthly_rent, rent_type, contract_type, contract_term, renewal_right_used,
                previous_deposit, previous_rent, build_year, source, raw_payload)
               VALUES (%(source_key)s,%(lawd_cd)s,%(district)s,%(dong)s,%(jibun)s,%(complex_name)s,%(area_m2)s,
                       %(floor)s,%(contract_date)s,%(deposit)s,%(monthly_rent)s,%(rent_type)s,%(contract_type)s,
                       %(contract_term)s,%(renewal_right_used)s,%(previous_deposit)s,%(previous_rent)s,
                       %(build_year)s,%(source)s,%(raw_payload)s)
               ON CONFLICT (source_key) DO UPDATE SET
                 district=EXCLUDED.district, contract_type=EXCLUDED.contract_type,
                 contract_term=EXCLUDED.contract_term, renewal_right_used=EXCLUDED.renewal_right_used,
                 previous_deposit=EXCLUDED.previous_deposit, previous_rent=EXCLUDED.previous_rent,
                 build_year=EXCLUDED.build_year, raw_payload=EXCLUDED.raw_payload, collected_at=now()
               WHERE apt_rent_trades.raw_payload IS DISTINCT FROM EXCLUDED.raw_payload
               RETURNING (xmax = 0) AS inserted""",
            {**row, "raw_payload": Jsonb(row["raw_payload"])},
        ).fetchone()
        outcomes.append(_outcome(saved))
    return outcomes


def store_complexes(conn: Any, rows: Iterable[Mapping[str, Any]]) -> list[str]:
    outcomes = []
    for row in rows:
        saved = conn.execute(
            """INSERT INTO apartment_complexes
               (kapt_code, name, address, road_address, sale_type, heating_type, approval_date,
                building_count, household_count, total_area_m2, source, raw_payload)
               VALUES (%(kapt_code)s,%(name)s,%(address)s,%(road_address)s,%(sale_type)s,%(heating_type)s,
                       %(approval_date)s,%(building_count)s,%(household_count)s,%(total_area_m2)s,%(source)s,%(raw_payload)s)
               ON CONFLICT (kapt_code) DO UPDATE SET
                 name=EXCLUDED.name, address=EXCLUDED.address, road_address=EXCLUDED.road_address,
                 sale_type=EXCLUDED.sale_type, heating_type=EXCLUDED.heating_type,
                 approval_date=EXCLUDED.approval_date, building_count=EXCLUDED.building_count,
                 household_count=EXCLUDED.household_count, total_area_m2=EXCLUDED.total_area_m2,
                 source=EXCLUDED.source, raw_payload=EXCLUDED.raw_payload, collected_at=now()
               WHERE apartment_complexes.raw_payload IS DISTINCT FROM EXCLUDED.raw_payload
               RETURNING (xmax = 0) AS inserted""",
            {**row, "raw_payload": Jsonb(row["raw_payload"])},
        ).fetchone()
        outcomes.append(_outcome(saved))
    return outcomes


def store_buildings(conn: Any, rows: Iterable[Mapping[str, Any]]) -> list[str]:
    outcomes = []
    for row in rows:
        saved = conn.execute(
            """INSERT INTO building_register_records
               (source_key, source_record_id, operation, sigungu_cd, bjdong_cd, plat_gb_cd, bun, ji, register_kind,
                building_name, lot_address, road_address, main_purpose, structure, total_area_m2,
                floor_area_m2, household_count, approval_date, source, raw_payload)
               VALUES (%(source_key)s,%(source_record_id)s,%(operation)s,%(sigungu_cd)s,%(bjdong_cd)s,%(plat_gb_cd)s,%(bun)s,%(ji)s,
                       %(register_kind)s,%(building_name)s,%(lot_address)s,%(road_address)s,%(main_purpose)s,
                       %(structure)s,%(total_area_m2)s,%(floor_area_m2)s,%(household_count)s,%(approval_date)s,
                       %(source)s,%(raw_payload)s)
               ON CONFLICT (source_key) DO UPDATE SET
                 source_record_id=EXCLUDED.source_record_id, operation=EXCLUDED.operation,
                 building_name=EXCLUDED.building_name,
                 lot_address=EXCLUDED.lot_address, road_address=EXCLUDED.road_address,
                 main_purpose=EXCLUDED.main_purpose, structure=EXCLUDED.structure,
                 total_area_m2=EXCLUDED.total_area_m2, floor_area_m2=EXCLUDED.floor_area_m2,
                 household_count=EXCLUDED.household_count, approval_date=EXCLUDED.approval_date,
                 source=EXCLUDED.source, raw_payload=EXCLUDED.raw_payload, collected_at=now()
               WHERE building_register_records.raw_payload IS DISTINCT FROM EXCLUDED.raw_payload
               RETURNING (xmax = 0) AS inserted""",
            {**row, "raw_payload": Jsonb(row["raw_payload"])},
        ).fetchone()
        outcomes.append(_outcome(saved))
    return outcomes


def store_subway_stations(conn: Any, rows: Iterable[Mapping[str, Any]]) -> list[str]:
    outcomes = []
    for row in rows:
        saved = conn.execute(
            """INSERT INTO subway_stations
               (source_key, station_id, station_name, route_id, route_name, source, raw_payload)
               VALUES (%(source_key)s,%(station_id)s,%(station_name)s,%(route_id)s,%(route_name)s,%(source)s,%(raw_payload)s)
               ON CONFLICT (source_key) DO UPDATE SET
                 station_name=EXCLUDED.station_name, route_id=EXCLUDED.route_id, route_name=EXCLUDED.route_name,
                 source=EXCLUDED.source, raw_payload=EXCLUDED.raw_payload, collected_at=now()
               WHERE subway_stations.raw_payload IS DISTINCT FROM EXCLUDED.raw_payload
               RETURNING (xmax = 0) AS inserted""",
            {**row, "raw_payload": Jsonb(row["raw_payload"])},
        ).fetchone()
        outcomes.append(_outcome(saved))
    return outcomes


STORERS: dict[str, Callable[[Any, Iterable[Mapping[str, Any]]], list[str]]] = {
    RENT_DATASET: store_rents,
    KAPT_DATASET: store_complexes,
    BUILDING_DATASET: store_buildings,
    SUBWAY_DATASET: store_subway_stations,
}


def collect_and_store(
    conn: Any,
    dataset_id: str,
    params: dict[str, str | int],
    *,
    fetcher: Callable[..., list[dict[str, Any]]] = public_catalog.fetch_dataset,
) -> dict[str, Any]:
    """한 데이터셋을 수집·정규화·저장하고 키를 제외한 요약만 반환한다."""
    if dataset_id not in SUPPORTED_DATASETS:
        raise PublicSourceError(f"저장을 지원하지 않는 데이터셋입니다: {dataset_id}")
    raw_rows = fetcher(dataset_id, params)
    normalized = []
    for raw in raw_rows:
        try:
            normalized.append(NORMALIZERS[dataset_id](raw, params))
        except PublicSourceError:
            continue
    outcomes = STORERS[dataset_id](conn, normalized)
    return {"dataset_id": dataset_id, **_result_stats(len(raw_rows), len(normalized), outcomes)}


def rent_references(
    conn: Any,
    *,
    lawd_cd: str,
    complex_name: str,
    area_m2: Decimal | float,
    months: int = 12,
    limit: int = 30,
) -> list[dict[str, Any]]:
    """동일 단지·유사 면적의 최근 전월세 사례를 전세/월세 원천값 그대로 반환한다."""
    return conn.execute(
        """SELECT id, lawd_cd, district, dong, complex_name, area_m2, floor, contract_date,
                  deposit, monthly_rent, rent_type, contract_type, contract_term, source, collected_at
           FROM apt_rent_trades
           WHERE lawd_cd = %s AND complex_name = %s AND area_m2 BETWEEN %s - 5 AND %s + 5
             AND contract_date >= current_date - (%s * interval '1 month')
           ORDER BY contract_date DESC, id DESC LIMIT %s""",
        (lawd_cd, complex_name, area_m2, area_m2, months, limit),
    ).fetchall()


def get_complex(conn: Any, kapt_code: str) -> dict[str, Any] | None:
    return conn.execute(
        """SELECT kapt_code, name, address, road_address, sale_type, heating_type, approval_date,
                  building_count, household_count, total_area_m2, source, collected_at
           FROM apartment_complexes WHERE kapt_code = %s""",
        (kapt_code,),
    ).fetchone()


def find_buildings(
    conn: Any, *, sigungu_cd: str, bjdong_cd: str, bun: str | None = None, ji: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    return conn.execute(
        """SELECT source_record_id, operation, sigungu_cd, bjdong_cd, plat_gb_cd, bun, ji, register_kind,
                  building_name, lot_address, road_address, main_purpose, structure, total_area_m2,
                  floor_area_m2, household_count, approval_date, source, collected_at
           FROM building_register_records
           WHERE sigungu_cd = %s AND bjdong_cd = %s
             AND (%s::text IS NULL OR bun = %s) AND (%s::text IS NULL OR ji = %s)
           ORDER BY building_name NULLS LAST, source_key LIMIT %s""",
        (sigungu_cd, bjdong_cd, bun, bun, ji, ji, limit),
    ).fetchall()


def find_subway_stations(conn: Any, name: str, limit: int = 20) -> list[dict[str, Any]]:
    return conn.execute(
        """SELECT station_id, station_name, route_id, route_name, source, collected_at
           FROM subway_stations
           WHERE station_name %% %s OR station_name ILIKE '%%' || %s || '%%'
           ORDER BY similarity(station_name, %s) DESC, route_name NULLS LAST LIMIT %s""",
        (name, name, name, limit),
    ).fetchall()
