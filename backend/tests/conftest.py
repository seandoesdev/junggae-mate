"""테스트는 시연 DB(mate)가 아니라 매번 새로 만드는 mate_test DB에서 실행한다.

app 모듈을 import하기 전에 DATABASE_URL을 바꿔야 하므로 conftest 최상단에서 처리한다.
"""
import os

import psycopg

_base = os.environ.get("DATABASE_URL", "postgresql://mate:mate@db:5432/mate")
_test = _base.rsplit("/", 1)[0] + "/mate_test"
with psycopg.connect(_base, autocommit=True) as conn:
    conn.execute("DROP DATABASE IF EXISTS mate_test WITH (FORCE)")
    conn.execute("CREATE DATABASE mate_test")
os.environ["DATABASE_URL"] = _test
# CORS: 화면을 다른 주소(Cloudflare 등)에서 내려주는 배포를 흉내 낸다 (test_api.py의 CORS 테스트)
os.environ["CORS_ORIGINS"] = "https://app.example.test, https://admin.example.test/"
os.environ["CORS_ORIGIN_REGEX"] = r"^https://[a-z0-9-]+\.preview\.example\.test$"
# 네이버 지도: Client ID만 화면에 알려 주고 Secret은 내보내지 않는지 본다 (test_api.py)
os.environ["NAVER_CLIENT_ID"] = "test-naver-client-id"
os.environ["NAVER_CLIENT_SECRET"] = "test-naver-secret-must-not-leak"
