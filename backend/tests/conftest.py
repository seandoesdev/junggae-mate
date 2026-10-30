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
