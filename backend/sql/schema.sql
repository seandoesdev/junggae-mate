-- 중개메이트 스키마 v0.3 (고객·거래·고객 자료 중심). 기동 시 매번 실행되므로 모두 멱등적이어야 한다.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS tenants (
  id    SERIAL PRIMARY KEY,
  name  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  tenant_id     INT NOT NULL REFERENCES tenants(id),
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('agent', 'admin')),
  password_hash TEXT NOT NULL
);

-- 고객: 사무소 공유. agent_id는 담당 중개사
CREATE TABLE IF NOT EXISTS customers (
  id               SERIAL PRIMARY KEY,
  tenant_id        INT NOT NULL REFERENCES tenants(id),
  agent_id         INT NOT NULL REFERENCES users(id),
  name             TEXT NOT NULL,
  deal_type        TEXT NOT NULL DEFAULT '매수',
  phone            TEXT,
  budget_max       INT,
  area_min         NUMERIC(6,2),
  district         TEXT,
  station_walk_max INT,
  preferences      TEXT[] NOT NULL DEFAULT '{}',
  first_home       BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customers_tenant_idx ON customers (tenant_id);

-- 상담 기록 타임라인 (자동 기록 + 메모)
CREATE TABLE IF NOT EXISTS activities (
  id           SERIAL PRIMARY KEY,
  customer_id  INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  user_id      INT REFERENCES users(id),
  text         TEXT NOT NULL,
  at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activities_customer_idx ON activities (customer_id, at DESC);

-- 매물: 제휴 API / 사무소 DB / 중개사 직접 등록만 허용 (크롤링 금지). agent_id는 담당 중개사
CREATE TABLE IF NOT EXISTS listings (
  id               SERIAL PRIMARY KEY,
  tenant_id        INT NOT NULL REFERENCES tenants(id),
  agent_id         INT REFERENCES users(id),
  label            TEXT,
  title            TEXT NOT NULL,
  complex_name     TEXT NOT NULL,
  address          TEXT NOT NULL,
  district         TEXT NOT NULL,
  price            INT NOT NULL,
  area_m2          NUMERIC(6,2) NOT NULL,
  floor            TEXT,
  station          TEXT,
  station_walk_min INT,
  park_walk_min    INT,
  lat              DOUBLE PRECISION,
  lng              DOUBLE PRECISION,
  description      TEXT,
  source           TEXT NOT NULL,
  source_date      DATE NOT NULL,
  status           TEXT NOT NULL DEFAULT 'active',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS listings_tenant_idx ON listings (tenant_id, district);

CREATE TABLE IF NOT EXISTS listing_price_history (
  id          SERIAL PRIMARY KEY,
  listing_id  INT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  price       INT NOT NULL,
  changed_at  DATE NOT NULL
);

-- 매물별 확인할 사항 체크 상태 (항목 내용은 문서 근거 검색으로 매번 생성)
-- 현장 메모: 중개사가 직접 적는 매물 정보. 질문 검색에서 매물을 찾을 때 함께 본다
CREATE TABLE IF NOT EXISTS listing_notes (
  id          SERIAL PRIMARY KEY,
  listing_id  INT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  user_id     INT REFERENCES users(id),
  text        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS listing_notes_idx ON listing_notes (listing_id, created_at DESC);

CREATE TABLE IF NOT EXISTS listing_checks (
  listing_id  INT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  checked_by  INT REFERENCES users(id),
  checked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (listing_id, key)
);

-- 거래 건 = 매물 × 고객 × 단계
CREATE TABLE IF NOT EXISTS deals (
  id                SERIAL PRIMARY KEY,
  tenant_id         INT NOT NULL REFERENCES tenants(id),
  listing_id        INT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  customer_id       INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  agent_id          INT NOT NULL REFERENCES users(id),
  stage             TEXT NOT NULL DEFAULT 'intro'
                    CHECK (stage IN ('intro', 'visit', 'nego', 'contract', 'done', 'dropped')),
  next_action       TEXT,
  dropped_reason    TEXT,
  stage_changed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (listing_id, customer_id)
);
CREATE INDEX IF NOT EXISTS deals_tenant_idx ON deals (tenant_id, stage);

CREATE TABLE IF NOT EXISTS deal_events (
  id          SERIAL PRIMARY KEY,
  deal_id     INT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  from_stage  TEXT,
  to_stage    TEXT NOT NULL,
  user_id     INT REFERENCES users(id),
  at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 공개데이터: 아파트 매매 실거래가 (과거 신고 거래, 현재 호가 아님)
CREATE TABLE IF NOT EXISTS apt_trades (
  id            SERIAL PRIMARY KEY,
  lawd_cd       TEXT NOT NULL,
  district      TEXT NOT NULL,
  dong          TEXT,
  complex_name  TEXT NOT NULL,
  area_m2       NUMERIC(6,2) NOT NULL,
  price         INT NOT NULL,
  deal_date     DATE NOT NULL,
  floor         INT,
  source        TEXT NOT NULL,
  collected_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lawd_cd, complex_name, area_m2, price, deal_date, floor)
);

-- 문서 근거 (자료실). tenant_id NULL = 공용 공개 문서
CREATE TABLE IF NOT EXISTS documents (
  id              SERIAL PRIMARY KEY,
  tenant_id       INT REFERENCES tenants(id),
  source_type     TEXT NOT NULL CHECK (source_type IN ('law', 'policy', 'office', 'news')),
  title           TEXT NOT NULL,
  publisher       TEXT NOT NULL,
  url             TEXT,
  published_at    DATE NOT NULL,
  effective_date  DATE,
  region          TEXT,
  license         TEXT,
  facts           JSONB NOT NULL DEFAULT '{}',
  content_hash    TEXT NOT NULL,
  raw_path        TEXT,
  embed_model     TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 중개사가 자료실에 직접 추가한 사무소 자료의 작성자 (기존 DB에도 적용)
ALTER TABLE documents ADD COLUMN IF NOT EXISTS created_by INT REFERENCES users(id);
CREATE UNIQUE INDEX IF NOT EXISTS documents_hash_idx ON documents (content_hash, COALESCE(tenant_id, 0));

CREATE TABLE IF NOT EXISTS chunks (
  id           SERIAL PRIMARY KEY,
  document_id  INT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  tenant_id    INT REFERENCES tenants(id),
  ord          INT NOT NULL,
  location     TEXT NOT NULL,
  text         TEXT NOT NULL,
  embedding    vector(384) NOT NULL
);
CREATE INDEX IF NOT EXISTS chunks_trgm_idx ON chunks USING gin (text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS chunks_tenant_idx ON chunks (tenant_id);

CREATE TABLE IF NOT EXISTS ingest_jobs (
  id           SERIAL PRIMARY KEY,
  tenant_id    INT REFERENCES tenants(id),
  kind         TEXT NOT NULL,
  status       TEXT NOT NULL,
  detail       TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ
);

-- 고객 자료 (비교표·문의 답변). 작성 → 검토 → 승인 → 전달
CREATE TABLE IF NOT EXISTS reports (
  id               SERIAL PRIMARY KEY,
  tenant_id        INT NOT NULL REFERENCES tenants(id),
  customer_id      INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  kind             TEXT NOT NULL CHECK (kind IN ('compare', 'answer')),
  title            TEXT NOT NULL,
  question         TEXT,
  state            TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'review', 'approved', 'shared')),
  version          INT NOT NULL DEFAULT 1,
  listings         JSONB NOT NULL DEFAULT '[]',
  sources          JSONB NOT NULL DEFAULT '[]',
  gate             JSONB NOT NULL DEFAULT '{}',
  generator        TEXT NOT NULL,
  created_by       INT REFERENCES users(id),
  approved_by      INT REFERENCES users(id),
  approved_at      TIMESTAMPTZ,
  share_token      TEXT UNIQUE,
  share_expires_at TIMESTAMPTZ,
  share_views      INT NOT NULL DEFAULT 0,
  share_last_view  TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reports_customer_idx ON reports (customer_id);

CREATE TABLE IF NOT EXISTS report_versions (
  id          SERIAL PRIMARY KEY,
  report_id   INT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  version     INT NOT NULL,
  opinion     TEXT NOT NULL,
  to_check    JSONB NOT NULL DEFAULT '[]',
  note        TEXT NOT NULL,
  created_by  INT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (report_id, version)
);

-- 근거·수정·승인·단계 변경 이벤트. 고객 개인정보는 payload에 넣지 않는다.
CREATE TABLE IF NOT EXISTS audit_events (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   INT,
  user_id     INT,
  request_id  TEXT,
  event       TEXT NOT NULL,
  entity      TEXT NOT NULL,
  entity_id   INT,
  payload     JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_entity_idx ON audit_events (entity, entity_id);

-- Hood AI: 사무소별 설정, 질문 대화(세션)와 질문·답변 기록
CREATE TABLE IF NOT EXISTS ai_settings (
  tenant_id     INT PRIMARY KEY REFERENCES tenants(id),
  source_types  TEXT[] NOT NULL DEFAULT ARRAY['law','policy','office','news'],
  detail_count  INT NOT NULL DEFAULT 3 CHECK (detail_count BETWEEN 1 AND 5),
  near_miss     BOOLEAN NOT NULL DEFAULT true,
  monthly_limit INT CHECK (monthly_limit IS NULL OR monthly_limit > 0),
  updated_by    INT REFERENCES users(id),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_sessions (
  id          SERIAL PRIMARY KEY,
  tenant_id   INT NOT NULL REFERENCES tenants(id),
  user_id     INT NOT NULL REFERENCES users(id),
  title       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_sessions_user_idx ON ai_sessions (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS ai_messages (
  id               SERIAL PRIMARY KEY,
  session_id       INT NOT NULL REFERENCES ai_sessions(id) ON DELETE CASCADE,
  question         TEXT NOT NULL,
  effective_query  TEXT NOT NULL,           -- 이어 묻기('그중 7억 이하만')를 앞 질문과 합친 실제 질문
  dropped          TEXT[] NOT NULL DEFAULT '{}',
  result           JSONB NOT NULL,
  generator        TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_messages_session_idx ON ai_messages (session_id, id);
CREATE INDEX IF NOT EXISTS ai_messages_created_idx ON ai_messages (created_at);
