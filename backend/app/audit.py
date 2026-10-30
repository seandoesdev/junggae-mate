import contextvars
import logging
from typing import Any

from .db import Jsonb

request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="-")
log = logging.getLogger("mate")


def record(conn, *, tenant_id: int | None, user_id: int | None, event: str, entity: str,
           entity_id: int | None = None, payload: dict[str, Any] | None = None) -> None:
    """감사 이벤트 기록. payload에는 식별자·버전·근거 id만 넣고 고객 개인정보는 넣지 않는다."""
    conn.execute(
        """INSERT INTO audit_events (tenant_id, user_id, request_id, event, entity, entity_id, payload)
           VALUES (%s, %s, %s, %s, %s, %s, %s)""",
        (tenant_id, user_id, request_id_var.get(), event, entity, entity_id, Jsonb(payload or {})),
    )
