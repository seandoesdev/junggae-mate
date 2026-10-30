import hashlib
import hmac
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .config import settings
from .db import fetch_one

_ITERATIONS = 120_000
bearer = HTTPBearer(auto_error=False)


def hash_password(password: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), _ITERATIONS).hex()
    return f"pbkdf2${salt}${digest}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, salt, digest = stored.split("$")
    except ValueError:
        return False
    return hmac.compare_digest(hash_password(password, salt).split("$")[2], digest)


def create_token(user_id: int) -> str:
    now = datetime.now(timezone.utc)
    payload = {"sub": str(user_id), "iat": now, "exp": now + timedelta(minutes=settings.jwt_ttl_minutes)}
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


@dataclass(frozen=True)
class CurrentUser:
    id: int
    tenant_id: int
    tenant_name: str
    name: str
    email: str
    role: str

    def public(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "email": self.email,
            "role": self.role,
            "tenant_id": self.tenant_id,
            "tenant_name": self.tenant_name,
        }


def _unauthorized(detail: str = "인증이 필요합니다.") -> HTTPException:
    return HTTPException(status.HTTP_401_UNAUTHORIZED, detail=detail, headers={"WWW-Authenticate": "Bearer"})


def current_user(creds: HTTPAuthorizationCredentials | None = Depends(bearer)) -> CurrentUser:
    """tenant는 토큰의 사용자 레코드에서만 확정한다. 클라이언트가 보낸 tenant 값은 쓰지 않는다."""
    if creds is None:
        raise _unauthorized()
    try:
        payload = jwt.decode(creds.credentials, settings.jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise _unauthorized("토큰이 유효하지 않거나 만료되었습니다.")
    row = fetch_one(
        """SELECT u.id, u.tenant_id, t.name AS tenant_name, u.name, u.email, u.role
           FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.id = %s""",
        (int(payload["sub"]),),
    )
    if not row:
        raise _unauthorized()
    return CurrentUser(**row)


def require_admin(user: CurrentUser = Depends(current_user)) -> CurrentUser:
    if user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="관리자 권한이 필요합니다.")
    return user
