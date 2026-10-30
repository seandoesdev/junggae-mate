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
    # 근거 게이트: 이 점수 미만이면 근거로 쓰지 않는다
    min_evidence_score: float = float(os.getenv("MIN_EVIDENCE_SCORE", "0.12"))
    cors_origins: list[str] = field(default_factory=lambda: [o for o in os.getenv("CORS_ORIGINS", "").split(",") if o])


settings = Settings()
