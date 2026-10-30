from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool

from .config import settings

pool = ConnectionPool(settings.database_url, min_size=1, max_size=10, open=False, kwargs={"row_factory": dict_row})

SCHEMA_PATH = Path(__file__).resolve().parents[1] / "sql" / "schema.sql"


def open_pool() -> None:
    pool.open(wait=True, timeout=60)


@contextmanager
def tx() -> Iterator[Any]:
    """하나의 트랜잭션. 블록이 예외 없이 끝나면 commit."""
    with pool.connection() as conn:
        with conn.transaction():
            yield conn


def fetch_all(sql: str, params: Any = None) -> list[dict]:
    with pool.connection() as conn:
        return conn.execute(sql, params).fetchall()


def fetch_one(sql: str, params: Any = None) -> dict | None:
    with pool.connection() as conn:
        return conn.execute(sql, params).fetchone()


def init_schema() -> None:
    with tx() as conn:
        conn.execute("SELECT pg_advisory_xact_lock(4242)")
        conn.execute(SCHEMA_PATH.read_text(encoding="utf-8"))


def vec_literal(vector: list[float]) -> str:
    return "[" + ",".join(f"{v:.6f}" for v in vector) + "]"


__all__ = ["pool", "tx", "fetch_all", "fetch_one", "init_schema", "open_pool", "vec_literal", "Jsonb"]
