from datetime import date
from decimal import Decimal

import pytest

from app import public_sources
from app.db import init_schema, open_pool, pool, tx


RENT_ROW = {
    "sggCd": "11440",
    "sggNm": "마포구",
    "umdNm": "공덕동",
    "jibun": "1-1",
    "aptNm": "공덕테스트",
    "excluUseAr": "59.97",
    "floor": " 12 ",
    "dealYear": "2026",
    "dealMonth": "10",
    "dealDay": "3",
    "deposit": "80,000",
    "monthlyRent": "0",
    "contractType": "신규",
    "contractTerm": "202610~202810",
    "useRRRight": "사용",
    "preDeposit": "75,000",
    "preMonthlyRent": "0",
    "buildYear": "2018",
}


def test_normalize_rent_preserves_amounts_type_and_stable_identity():
    row = public_sources.normalize_rent(RENT_ROW, {"LAWD_CD": "11440"})
    again = public_sources.normalize_rent(dict(reversed(RENT_ROW.items())), {"LAWD_CD": "11440"})

    assert row["contract_date"] == date(2026, 10, 3)
    assert row["area_m2"] == Decimal("59.97")
    assert row["deposit"] == 80000
    assert row["monthly_rent"] == 0
    assert row["rent_type"] == "jeonse"
    assert row["previous_deposit"] == 75000
    assert row["source_key"] == again["source_key"]


def test_normalize_monthly_rent_and_reject_incomplete_rows():
    monthly = public_sources.normalize_rent({**RENT_ROW, "monthlyRent": "125"}, {})
    assert monthly["rent_type"] == "monthly"

    with pytest.raises(public_sources.PublicSourceError, match="불완전"):
        public_sources.normalize_rent({"aptNm": "이름만"}, {"LAWD_CD": "11440"})


def test_normalize_kapt_building_and_subway_official_shapes():
    complex_row = public_sources.normalize_complex(
        {
            "kaptCode": "A100001",
            "kaptName": "공덕테스트",
            "doroJuso": "서울 마포구 테스트로 1",
            "codeSaleNm": "분양",
            "codeHeatNm": "지역난방",
            "kaptUsedate": "20181231",
            "kaptDongCnt": "3",
            "kaptdaCnt": "456",
            "kaptTarea": "52,345.67",
        },
        {},
    )
    building = public_sources.normalize_building(
        {
            "mgmBldrgstPk": "11440-TEST-PK",
            "bldNm": "공덕테스트",
            "mainPurpsCdNm": "공동주택",
            "strctCdNm": "철근콘크리트구조",
            "totArea": "52,345.67",
            "useAprDay": "2018-12-31",
        },
        {"sigunguCd": "11440", "bjdongCd": "10100", "bun": "0001", "ji": "0001"},
    )
    station = public_sources.normalize_subway(
        {
            "subwayStationId": "MTR123",
            "subwayStationName": "공덕",
            "subwayRouteId": "1004",
            "subwayRouteName": "5호선",
        },
        {},
    )

    assert complex_row["approval_date"] == date(2018, 12, 31)
    assert complex_row["household_count"] == 456
    assert complex_row["total_area_m2"] == Decimal("52345.67")
    assert building["source_record_id"] == "11440-TEST-PK"
    assert len(building["source_key"]) == 64
    assert building["total_area_m2"] == Decimal("52345.67")
    assert station["station_id"] == "MTR123" and station["route_name"] == "5호선"


def test_collect_and_store_reports_invalid_without_exposing_credentials(monkeypatch):
    captured = {}

    def fetcher(dataset_id, params):
        captured.update(dataset_id=dataset_id, params=params)
        return [RENT_ROW, {"aptNm": "불완전"}]

    def storer(_conn, rows):
        captured["stored"] = list(rows)
        return ["inserted"]

    monkeypatch.setitem(public_sources.STORERS, public_sources.RENT_DATASET, storer)
    result = public_sources.collect_and_store(
        object(), public_sources.RENT_DATASET, {"LAWD_CD": "11440", "DEAL_YMD": "202610"}, fetcher=fetcher
    )

    assert result == {
        "dataset_id": public_sources.RENT_DATASET,
        "received": 2,
        "valid": 1,
        "invalid": 1,
        "inserted": 1,
        "updated": 0,
        "unchanged": 0,
    }
    assert captured["params"] == {"LAWD_CD": "11440", "DEAL_YMD": "202610"}
    assert "serviceKey" not in repr(result)


def test_store_functions_are_idempotent_in_database():
    if pool.closed:
        open_pool()
    init_schema()
    rent = public_sources.normalize_rent(RENT_ROW, {"LAWD_CD": "11440"})
    complex_row = public_sources.normalize_complex(
        {"kaptCode": "A-IDEMPOTENT", "kaptName": "멱등단지", "kaptdaCnt": "100"}, {}
    )
    building = public_sources.normalize_building(
        {"mgmBldrgstPk": "B-IDEMPOTENT", "bldNm": "멱등건물"},
        {"sigunguCd": "11440", "bjdongCd": "10100"},
    )
    station = public_sources.normalize_subway(
        {"subwayStationId": "S-IDEMPOTENT", "subwayStationName": "멱등역", "subwayRouteName": "테스트선"}, {}
    )
    with tx() as conn:
        conn.execute("DELETE FROM apt_rent_trades WHERE source_key = %s", (rent["source_key"],))
        conn.execute("DELETE FROM apartment_complexes WHERE kapt_code = %s", (complex_row["kapt_code"],))
        conn.execute("DELETE FROM building_register_records WHERE source_key = %s", (building["source_key"],))
        conn.execute("DELETE FROM subway_stations WHERE source_key = %s", (station["source_key"],))
        assert public_sources.store_rents(conn, [rent]) == ["inserted"]
        assert public_sources.store_complexes(conn, [complex_row]) == ["inserted"]
        assert public_sources.store_buildings(conn, [building]) == ["inserted"]
        assert public_sources.store_subway_stations(conn, [station]) == ["inserted"]
        assert public_sources.store_rents(conn, [rent]) == ["unchanged"]
        assert public_sources.store_complexes(conn, [complex_row]) == ["unchanged"]
        assert public_sources.store_buildings(conn, [building]) == ["unchanged"]
        assert public_sources.store_subway_stations(conn, [station]) == ["unchanged"]
        assert conn.execute(
            "SELECT count(*) AS n FROM apt_rent_trades WHERE source_key = %s", (rent["source_key"],)
        ).fetchone()["n"] == 1
