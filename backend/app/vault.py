"""민감 정보(연락처·출입 정보) 암호화.

- 암호문만 DB에 둔다. 화면·목록에는 끝 4자리 가림 표시만 내보내고, 원문은 '보기'를 누를 때 한 번 내려주며 감사 기록을 남긴다.
- 키: `DATA_ENCRYPTION_KEY`(Fernet 키). 비어 있으면 JWT_SECRET에서 파생한 키를 쓴다(개발·기존 배포가 바로 동작하도록).
  복호화는 두 키를 모두 시도하므로, 나중에 DATA_ENCRYPTION_KEY를 넣어도 이미 저장된 값은 그대로 읽히고 새 값만 새 키로 저장된다.
- 이 값들은 LLM 프롬프트·질문 검색·고객 자료·감사 payload에 넣지 않는다.
"""
import base64
import hashlib
import logging
import re

from cryptography.fernet import Fernet, InvalidToken, MultiFernet

from .config import settings

log = logging.getLogger("mate.vault")


def _derived_key() -> bytes:
    return base64.urlsafe_b64encode(hashlib.sha256(b"junggae-mate:data-key:" + settings.jwt_secret.encode()).digest())


def _build() -> MultiFernet:
    keys = []
    if settings.data_encryption_key:
        try:
            keys.append(Fernet(settings.data_encryption_key))
        except ValueError as e:  # 잘못된 키로 조용히 다른 키를 쓰면 복구가 어려워진다 → 기동을 멈춘다
            raise RuntimeError("DATA_ENCRYPTION_KEY가 올바른 Fernet 키가 아닙니다 (32바이트 URL-safe base64).") from e
    keys.append(Fernet(_derived_key()))
    return MultiFernet(keys)


_box = _build()


def uses_derived_key() -> bool:
    return not settings.data_encryption_key


def seal(text: str | None) -> str | None:
    text = (text or "").strip()
    return _box.encrypt(text.encode()).decode() if text else None


def unseal(token: str | None) -> str | None:
    if not token:
        return None
    try:
        return _box.decrypt(token.encode()).decode()
    except InvalidToken:
        log.error("암호문을 풀지 못했습니다. DATA_ENCRYPTION_KEY·JWT_SECRET이 저장할 때와 같은지 확인하세요.")
        return None


def last4(phone: str | None) -> str | None:
    digits = re.sub(r"\D", "", phone or "")
    return digits[-4:] if digits else None


def masked(last: str | None) -> str | None:
    """'5678' → '***-****-5678'. 연락처가 없으면 None"""
    return f"***-****-{last}" if last else None


def migrate_plain_phones(conn) -> int:
    """예전 버전이 평문으로 저장한 고객 연락처를 암호문으로 옮기고 평문 칸을 비운다 (기동 때 매번, 멱등)."""
    rows = conn.execute("SELECT id, phone FROM customers WHERE phone IS NOT NULL").fetchall()
    for r in rows:
        conn.execute("UPDATE customers SET phone_enc = COALESCE(phone_enc, %s), phone_last4 = COALESCE(phone_last4, %s), "
                     "phone = NULL WHERE id = %s", (seal(r["phone"]), last4(r["phone"]), r["id"]))
    if rows:
        log.info("고객 연락처 %d건을 암호화해 옮겼습니다", len(rows))
    return len(rows)
