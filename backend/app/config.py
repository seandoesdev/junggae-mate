import os
from dataclasses import dataclass, field
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    database_url: str = os.getenv("DATABASE_URL", "postgresql://mate:mate@db:5432/mate")
    jwt_secret: str = os.getenv("JWT_SECRET", "dev-only-change-me")
    jwt_ttl_minutes: int = int(os.getenv("JWT_TTL_MINUTES", "480"))
    # anthropic | none. none이면 규칙 기반(template) 초안 생성기를 사용한다.
    llm_provider: str = os.getenv("LLM_PROVIDER", "anthropic" if os.getenv("ANTHROPIC_API_KEY") else "none")
    llm_model: str = os.getenv("LLM_MODEL", "claude-opus-5-5")
    llm_timeout: float = float(os.getenv("LLM_TIMEOUT_SECONDS", "40"))
    anthropic_api_key: str = os.getenv("ANTHROPIC_API_KEY", "")
    data_go_kr_key: str = os.getenv("DATA_GO_KR_SERVICE_KEY", "")
    external_timeout: float = float(os.getenv("EXTERNAL_TIMEOUT_SECONDS", "8"))
    raw_dir: Path = Path(os.getenv("RAW_DOCS_DIR", "/data/raw"))
    static_dir: Path = Path(os.getenv("STATIC_DIR", str(Path(__file__).resolve().parents[2])))
    seed_on_start: bool = os.getenv("SEED_ON_START", "1") == "1"
    # 회원가입(새 사무소 만들기)을 받을지. 0이면 기존 계정만 로그인
    signup_enabled: bool = os.getenv("SIGNUP_ENABLED", "1") == "1"
    # 근거 게이트: 이 점수 미만이면 근거로 쓰지 않는다
    min_evidence_score: float = float(os.getenv("MIN_EVIDENCE_SCORE", "0.12"))
    # 화면을 다른 곳(예: Cloudflare)에서 내려줄 때 API를 부를 수 있는 화면 주소. 쉼표로 여러 개, 끝의 /는 무시
    cors_origins: list[str] = field(default_factory=lambda: [
        o.strip().rstrip("/") for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()])
    # 미리보기 배포처럼 주소가 바뀌는 화면용 정규식 (예: ^https://[a-z0-9-]+-junggae-mate\.example\.workers\.dev$)
    cors_origin_regex: str | None = os.getenv("CORS_ORIGIN_REGEX") or None
    # 고객 공유 링크(/r/{token})에 쓸 API 서버의 공개 주소. 비우면 요청 주소를 쓴다 (프록시 뒤라면 https 주소를 적는다)
    public_base_url: str = os.getenv("PUBLIC_BASE_URL", "").rstrip("/")
    # 네이버 클라우드 Maps 애플리케이션의 Client ID. 화면의 지도 스크립트(ncpKeyId)에 그대로 실리는 공개 값이다.
    # 짝인 NAVER_CLIENT_SECRET은 서버 전용 REST API(지오코딩 등)용이라 화면에 내보내지 않는다
    naver_client_id: str = os.getenv("NAVER_CLIENT_ID", "").strip()
    # 연락처·출입 정보 암호화 키 (Fernet). 비우면 JWT_SECRET에서 파생한 키를 쓴다 (vault.py)
    data_encryption_key: str = os.getenv("DATA_ENCRYPTION_KEY", "").strip()


settings = Settings()
