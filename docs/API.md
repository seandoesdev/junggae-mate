# 중개메이트 MVP API 계약

Base: `/api`. 인증이 필요한 모든 요청은 `Authorization: Bearer <token>` 헤더를 사용한다.
tenant(사무소)는 토큰에서만 결정되며 클라이언트가 보낸 tenant 값은 무시된다.
모든 응답 헤더에 `X-Request-ID`가 포함된다. 오류는 `{"detail": "...", "code": "..."}` 형식.

가격 단위는 **만원** (78000 = 7.8억). 날짜는 ISO 문자열.

## 인증
- `POST /api/auth/login` `{email, password}` → `{access_token, user}`
  - user: `{id, name, email, role: "agent"|"admin", tenant_id, tenant_name}`
- `GET /api/me` → user

시드 계정: `agent@hanul.test / demo1234` (김선용, 하늘공인중개사), `admin@hanul.test / demo1234` (관리자), `agent@other.test / demo1234` (다른 사무소).

## 상담·고객
- `GET /api/consultations` → `[{id, customer_name, deal_type, created_at, conditions, counts:{interest, excluded, history}}]`
- `GET /api/consultations/{id}` →
  ```
  {id, customer_name, deal_type, created_at,
   conditions: {budget_max, area_min, district, station_walk_max, preferences: [str]},
   candidates: [{listing_id, status: "interest"|"excluded"|"compare", reason, listing}],
   history: [{at, note}]}
  ```
- `PUT /api/consultations/{id}/conditions` body = conditions → `{consultation, warnings: [str]}`
  (warnings: 누락·충돌 조건 설명)
- `PUT /api/consultations/{id}/candidates/{listing_id}` `{status: "interest"|"excluded"|"compare"|"none", reason?}` → consultation

## 매물(구조화 사실)
- `GET /api/listings?district=&max_price=&min_area=&max_station_walk=&sort=price|recent&mine=true` →
  `{items: [listing], total, as_of}` (거래 중(active) 매물만. `mine=true`면 내가 등록한 매물만)
  - listing: `{id, label, title, complex_name, address, district, price, area_m2, floor, station, station_walk_min, park_walk_min, lat, lng, description, source, source_date, status, registered_by, registered_by_name, mine, created_at, price_history: [{price, changed_at}]}`
- `GET /api/listings/{id}` → `{listing, trade_reference | null, candidates: [{consultation_id, customer_name, status, reason}]}` (매물 상세. candidates는 이 매물이 후보로 걸린 상담)
- `POST /api/listings` (중개사 직접 등록) body = listing 입력 → listing (201)
  - 입력: `{title, complex_name, address, district, price, area_m2, lat, lng, floor?, station?, station_walk_min?, park_walk_min?, description?}`
  - lat 33~39, lng 124~132 범위 검증. label은 사무소 안에서 자동 부여(A, B, …).
- `PUT /api/listings/{id}` body = 같은 입력 → listing. 가격이 바뀌면 price_history에 이력 추가.
- `POST /api/listings/{id}/close` → listing (status=closed, 지도·목록에서 빠짐)
- `POST /api/compare` `{consultation_id, listing_ids: [2..5개]}` →
  `{rows: [{listing, checks: [{condition, ok, detail}], trade_reference: {median_price, count, period, source, as_of} | null}]}`

## 근거 검색 (RAG, LLM 미사용)
- `GET /api/evidence/search?q=&region=` → `{items: [evidence]}`
- `GET /api/evidence/{chunk_id}` → evidence
- evidence: `{chunk_id, document_id, title, publisher, source_type: "law"|"policy"|"office"|"news", authority: 1..4, date, effective_date, location, snippet, url, score, state: "verified"|"warning"|"conflict", badge}`

## AI 초안
- `POST /api/ask` `{consultation_id, question, as_of?}` → draft
- `POST /api/advise` `{consultation_id, listing_ids?: [..]}` → draft (listing_ids 생략 시 구조화 검색으로 2~5개 확정)
- draft:
  ```
  {id, mode: "ask"|"advise", consultation_id, question,
   state: "draft"|"review"|"approved", version, version_label ("v0.N" / 승인 시 "v1.0"),
   text, claims: [{text, status: "verified"|"warning"|"conflict"|"unverifiable", citations: [chunk_id]}],
   evidence: [evidence], gate: {status: "ok"|"insufficient"|"conflict", messages: [str]},
   generator: "anthropic"|"template", candidates: [listing] (advise),
   approved_by, approved_at, created_at,
   history: [{version_label, note, at, by}]}
  ```
- `GET /api/drafts?consultation_id=` → `[draft 요약]`
- `GET /api/drafts/{id}` → draft
- `PUT /api/drafts/{id}` `{text, note?}` → draft (새 버전). 승인된 초안은 409.
- `POST /api/drafts/{id}/review` → draft (state=review)
- `POST /api/drafts/{id}/approve` `{confirm: true}` → draft (state=approved). review 상태가 아니면 409.
- `GET /api/drafts/{id}/export` → 인쇄용 HTML. 승인본만 가능(그 외 409).

## 운영
- `GET /api/health` → `{status, db, llm, vector}`
- (admin) `POST /api/admin/documents` multipart: `file`, `title`, `source_type`, `publisher`, `published_at`, `effective_date?`, `region?`, `url?`, `scope: "public"|"tenant"` → `{job}`
- (admin) `GET /api/admin/jobs` → `[job]`
- (admin) `DELETE /api/admin/documents/{id}` → 문서·청크 삭제 전파
- (admin) `POST /api/admin/collect/trades` `{lawd_cd, deal_ymd}` → 실거래가 수집 (DATA_GO_KR_SERVICE_KEY 필요)
- `GET /api/audit?entity_id=` (admin) → 감사 이벤트
