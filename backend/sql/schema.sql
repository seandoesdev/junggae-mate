-- 중개메이트 MVP 스키마. 기동 시 매번 실행되므로 모두 멱등적이어야 한다.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS tenants (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  tenant_id     INT NOT NULL REFERENCES tenants(id),
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('agent', 'admin')),
  password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS consultations (
  id               SERIAL PRIMARY KEY,
  tenant_id        INT NOT NULL REFERENCES tenants(id),
  agent_id         INT REFERENCES users(id),
  customer_name    TEXT NOT NULL,
  deal_type        TEXT NOT NULL DEFAULT '매수',
  budget_max       INT,
  area_min         NUMERIC(6,2),
  district         TEXT,
  station_walk_max INT,
  preferences      TEXT[] NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS consultation_logs (
  id               SERIAL PRIMARY KEY,
  consultation_id  INT NOT NULL REFERENCES consultations(id) ON DELETE CASCADE,
  note             TEXT NOT NULL,
  at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 현재 매물: 제휴 API / 사무소 DB / 중개사 업로드 CSV 만 허용 (크롤링 금지)
CREATE TABLE IF NOT EXISTS listings (
  id               SERIAL PRIMARY KEY,
  tenant_id        INT NOT NULL REFERENCES tenants(id),
  label            TEXT,
  title            TEXT NOT NULL,
  complex_name     TEXT NOT NULL,
  address          TEXT NOT NULL,
  district         TEXT NOT NULL,
  price            INT NOT NULL,
  area_m2          NUMERIC(6,2) NOT NULL,
  station          TEXT,
  station_walk_min INT,
  park_walk_min    INT,
  lat              DOUBLE PRECISION,
  lng              DOUBLE PRECISION,
  source           TEXT NOT NULL,
  source_date      DATE NOT NULL,
  status           TEXT NOT NULL DEFAULT 'active'
);
CREATE INDEX IF NOT EXISTS listings_tenant_idx ON listings (tenant_id, district);
-- 중개사 직접 등록 정보
ALTER TABLE listings ADD COLUMN IF NOT EXISTS registered_by INT REFERENCES users(id);
ALTER TABLE listings ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE listings ADD COLUMN IF NOT EXISTS floor TEXT;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS description TEXT;

CREATE TABLE IF NOT EXISTS listing_price_history (
  id          SERIAL PRIMARY KEY,
  listing_id  INT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  price       INT NOT NULL,
  changed_at  DATE NOT NULL
);

CREATE TABLE IF NOT EXISTS consultation_candidates (
  consultation_id INT NOT NULL REFERENCES consultations(id) ON DELETE CASCADE,
  listing_id      INT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  status          TEXT NOT NULL CHECK (status IN ('interest', 'excluded', 'compare')),
  reason          TEXT,
  PRIMARY KEY (consultation_id, listing_id)
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

-- 문서 근거. tenant_id NULL = 공용 공개 문서, 값이 있으면 해당 사무소 전용
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

CREATE TABLE IF NOT EXISTS drafts (
  id               SERIAL PRIMARY KEY,
  tenant_id        INT NOT NULL REFERENCES tenants(id),
  consultation_id  INT NOT NULL REFERENCES consultations(id) ON DELETE CASCADE,
  mode             TEXT NOT NULL CHECK (mode IN ('ask', 'advise')),
  question         TEXT,
  state            TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'review', 'approved')),
  version          INT NOT NULL DEFAULT 1,
  claims           JSONB NOT NULL DEFAULT '[]',
  evidence         JSONB NOT NULL DEFAULT '[]',
  gate             JSONB NOT NULL DEFAULT '{}',
  candidates       JSONB NOT NULL DEFAULT '[]',
  generator        TEXT NOT NULL,
  created_by       INT REFERENCES users(id),
  approved_by      INT REFERENCES users(id),
  approved_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS draft_versions (
  id          SERIAL PRIMARY KEY,
  draft_id    INT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  version     INT NOT NULL,
  text        TEXT NOT NULL,
  note        TEXT NOT NULL,
  created_by  INT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (draft_id, version)
);

-- 근거·수정·승인 이벤트. 고객 개인정보는 payload에 넣지 않는다.
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
