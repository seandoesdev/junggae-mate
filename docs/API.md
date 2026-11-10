# 중개메이트 API 계약 v0.7

Base `/api`. 인증이 필요한 요청은 `Authorization: Bearer <token>`. tenant(사무소)는 토큰으로만 결정한다.
오류: `{"detail": "...", "code": "..."}` (입력 검증 오류 422는 `detail`이 `[{loc, msg, type}]` 배열). 모든 응답에 `X-Request-ID`.
가격 단위는 **만원**. 날짜·시각은 ISO 문자열.

## 공통 타입

- **stage**: `intro`(소개) · `visit`(방문) · `nego`(협의) · `contract`(계약) · `done`(완료) · `dropped`(무산)
- **listing_stage** (매물 표시 상태): 무산 제외 거래 중 가장 진행된 단계. 거래가 없으면 `available`.
- **evidence** (출처 하나):
  `{id, kind: "chunk"|"listing"|"trade", type: "law"|"policy"|"office"|"news"|"data", type_label, title, org, date, location, snippet, url, state: "ok"|"warning"|"conflict", note}`
  - `id`는 문자열: 문서 조각 `c12`, 매물 데이터 `l3`, 실거래가 `t3`
  - `note`: 예) "기사는 보조 자료", "시행 전", "공식 안내와 내용이 다름"

## 인증·사무소

- `POST /auth/login` `{email, password}` → `{access_token, user}`; user `{id, name, email, role: "agent"|"admin", tenant_id, tenant_name}`
- `GET /me` → user
- `GET /agents` → `[{id, name, role}]` (같은 사무소의 사용 중인 중개사)
- 정지된 계정은 로그인 403, 기존 토큰도 401 (요청마다 계정 상태를 본다)
- `GET /office/settings` → `{contact_owner_only}` · `PUT /office/settings` (관리자) `{contact_owner_only: bool}` — 켜면 고객 연락처(가림 표시 포함)는 담당 중개사·관리자만 본다
- 관리자 계정 관리:
  - `GET /admin/users` → `[{id, name, email, role, active, disabled_at, customers, listings, deals}]`
  - `POST /admin/users` (201) `{name, email, password(8자 이상), role}` → user. 이메일 중복 409
  - `POST /admin/users/{id}/disable` `{transfer_to}` → `{user, moved: {customers, listings, deals}}`. 정지하고 담당 고객·매물·진행 중 거래를 넘긴다(고객 상담 기록에 인계 기록). 자기 계정·같은 사람에게 넘기기는 422
  - `POST /admin/users/{id}/enable` → user

시드 계정 (비밀번호 `demo1234`): `agent@hanul.test` 김선용, `park@hanul.test` 박지은, `lee@hanul.test` 이도현, `admin@hanul.test` 관리자, `agent@other.test` (다른 사무소).

## 매물

listing: `{id, label, title, property_type, complex_name, address, district, price, jeonse_deposit, monthly_deposit, monthly_rent, deal_types, price_text, area_m2, supply_m2, rooms, baths, facing, maintenance_fee, maintenance_note, parking, move_in, loan_amount, floor, station, station_walk_min, park_walk_min, lat, lng, description, source, source_date, status, agent_id, agent_name, mine, stage (listing_stage), active_deals, price_history: [{price, changed_at}], created_at}`

- 금액: `price`(매매가) · `jeonse_deposit`(전세 보증금) · `monthly_deposit`+`monthly_rent`(월세). 하나 이상, 한 매물을 여러 거래 종류로 내놓을 수 있다. `deal_types`: `["sale"|"jeonse"|"monthly"]`, `price_text`: "매매 6.4억 · 전세 3.8억"
- `property_type`: `apartment` · `officetel` · `villa` · `house` · `oneroom` · `commercial`. 아파트·오피스텔은 `complex_name` 필수, 그 밖에는 비우면 `title`
- `price_history`는 대표 금액(매매가 → 전세 보증금 → 월세 보증금 순)의 변경 이력
- `GET /listings?mine=true&sort=price|recent&district=&max_price=&min_area=&deal=sale|jeonse|monthly` → `{items: [listing], total}` (거래 중 매물만). `deal`을 주면 그 종류로 내놓은 매물만, `max_price`는 그 종류의 금액(매매가·보증금)에 적용
- `GET /listings/{id}` → `{listing, trade_reference, deals: [deal], checks: [check], notes: [note]}`
- `POST /listings/{id}/notes` `{text}` → note `{id, text, by, user_id, created_at}`. 사무소 누구나. 질문 검색에서 매물을 찾을 때 함께 본다.
- `DELETE /listings/{id}/notes/{note_id}` → `{deleted}`. 쓴 사람·관리자만.
- `GET /listings/{id}/public` → `{links: {complex|building|station: {entity_key, label, match_method, confidence, confirmed_by, confirmed_at}}, candidates: {complex|building|station: [{entity_key, label, detail, score}]}, facts: {rent|complex|building|station: {value, evidence} | null}, can_edit}`. 저장된 공공 캐시만 읽는다(외부 API 호출 없음).
- `PUT /listings/{id}/links/{complex|building|station}` `{entity_key}` → link. 후보 중 하나를 사람이 확정(자동 확정 없음). 매물 담당·관리자만, 캐시에 없는 키는 422. `DELETE`로 해제.
  - trade_reference: `{median_price, count, period, source, as_of} | null` (과거 신고 거래, 현재 호가 아님)
  - **check** (확인할 사항, 문서 근거 검색으로 출처를 붙임): `{key, text, level: "normal"|"warn"|"urgent", checked, checked_by, checked_at, sources: [evidence]}`
- `PUT /listings/{id}/checks/{key}` `{checked: bool}` → check
- `POST /listings` (201) `{title, property_type?, complex_name?, address, district, price?, jeonse_deposit?, monthly_deposit?, monthly_rent?, area_m2, supply_m2?, rooms?, baths?, facing?, maintenance_fee?, maintenance_note?, parking?, move_in?, loan_amount?, lat, lng, floor?, station?, station_walk_min?, park_walk_min?, description?}` → listing (담당 = 등록한 사람). 금액이 하나도 없거나 월세 보증금·월세 중 하나만 있으면 422
- `PUT /listings/{id}` 같은 입력 → listing (대표 금액이 바뀌면 이력 추가). 담당자·관리자만.
- `POST /listings/{id}/close` → listing (status=closed). 담당자·관리자만. 그 매물의 출입 정보를 지운다.

### 의뢰인(집주인)·의뢰 조건·방문 안내

연락처·출입 정보는 암호문으로만 저장하고 응답에는 가림 표시(`***-****-1234`)나 `has_*`만 준다. 원문은 reveal로 한 번 받고, 볼 때마다 감사 기록(무엇을 봤는지만)이 남는다. 질문 검색·고객 자료·LLM에는 넣지 않는다.

- owner: `{id, name, relation, memo, phone (가림), has_phone, privacy_consent_at}`
- mandate: `{owner, kind: "general"|"exclusive", starts_on, ends_on, days_left, price_flex, move_out, occupancy: "vacant"|"owner"|"tenant", tenant_phone (가림), has_tenant_phone, visit_rule, has_access, updated_by, updated_at}`
- `GET /listings/{id}/mandate` → `{mandate | null, can_edit}` (사무소 누구나 봄)
- `PUT /listings/{id}/mandate` `{owner_id | owner: {name, phone?, relation?, memo?, privacy_consent?}, kind, starts_on?, ends_on?, price_flex?, move_out?, occupancy, tenant_phone?, visit_rule?, access?, clear_access?}` → `{mandate, can_edit}`. 매물 담당·관리자만. `tenant_phone`·`access`는 새 값을 적을 때만(비우면 유지)
- `DELETE /listings/{id}/mandate` → `{deleted}` (의뢰인 기록은 남음)
- `POST /listings/{id}/mandate/reveal` `{field: "owner_phone"|"tenant_phone"|"access"}` → `{value}`
- `GET /owners?q=` → `[owner + {listings}]` · `PUT /owners/{id}` `{name, phone?, clear_phone?, relation?, memo?, privacy_consent?}` (관리자·등록한 사람·그 의뢰인 매물의 담당)

## 고객

customer: `{id, name, deal_type, phone (가림 표시 | null), has_phone, phone_hidden, privacy_consent_at, agent_id, agent_name, budget_max, monthly_rent_max, area_min, district, station_walk_max, preferences: [str], first_home, top_stage | null, active_deals, created_at}`

- `deal_type`: 매수 · 전세 · 월세 (예전 자유 입력 '아파트 매수'도 읽는다). 전세·월세 고객의 `budget_max`는 보증금 한도, `monthly_rent_max`는 월세 한도. 맞는 매물은 그 거래 종류로 내놓은 매물만
- 연락처는 암호문으로 저장. `phone_hidden`: 사무소 설정상 이 사람에게는 보이지 않음
- `GET /customers?mine=true` → `[customer]`
- `GET /customers/{id}` → `{customer, deals: [deal], reports: [report_summary], activities: [{at, text, user_name}]}`
- `POST /customers/{id}/phone` → `{phone}` (원문, 감사 기록. 숨김 대상이면 403)
- `POST /customers` (201) `{name, deal_type?, phone?, budget_max?, monthly_rent_max?, area_min?, district?, station_walk_max?, preferences?, first_home?, privacy_consent?}` → customer (담당 = 등록한 사람). 수정 때 `phone`은 새 번호를 적을 때만(비우면 유지, 지우려면 `clear_phone: true`)
- `PUT /customers/{id}` 같은 입력 → `{customer, warnings: [str]}` (조건 누락·충돌, 맞는 매물 없음 등)
- `POST /customers/{id}/activities` `{text}` → activity (상담 메모)
- `GET /customers/{id}/matches` → `{items: [listing]}` (고객 조건에 맞는 거래 중 매물, 사무소 전체)

## 거래 (매물 × 고객)

deal: `{id, listing_id, customer_id, customer_name, agent_id, agent_name, stage, next_action, dropped_reason, days_in_stage, stage_changed_at, created_at, listing: {id, label, title, price, agent_id, agent_name}}`

- `GET /deals?mine=true` → `[deal]` (mine: 거래 담당이 나)
- `POST /deals` `{listing_id, customer_id, next_action?}` → deal (stage=intro, 담당=고객 담당). 같은 조합이 이미 있으면 409.
- `POST /deals/{id}/stage` `{stage, reason?}` → `{deal, warnings: [str]}`
  - 거래 담당·매물 담당·관리자만 (그 외 403). `dropped`는 reason 필수.
  - 계약 단계로 갈 때 같은 매물에 진행 중 거래가 있으면 warnings에 안내 (자동 무산 처리 안 함)
- `PUT /deals/{id}` `{next_action}` → deal

## 고객 자료 (비교표·문의 답변)

report:
```
{id, customer_id, customer_name, agent_id, agent_name, kind: "compare"|"answer", title, question,
 state: "draft"|"review"|"approved"|"shared", version: "0.1"…"1.0",
 listings: [listing 요약 + checks: [{condition, ok, detail}] + trade_reference],   // compare
 opinion: "본문. 출처는 [c12] [l3] 같은 표시로 문장 뒤에 붙는다",
 to_check: ["추가로 확인할 사항 (출처 표시 포함 가능)"],
 sources: [evidence], gate: {status: "ok"|"insufficient"|"conflict", messages: [str]},
 approved_by, approved_at, share: {url, expires_at, views, last_view} | null,
 history: [{version, note, at, by}], created_at}
```
report_summary: `{id, kind, title, state, version, created_at}`

- `POST /customers/{id}/reports` `{kind, listing_ids?, question?, quote_id?}` → report
  - compare: listing_ids 생략 시 그 고객의 진행 중 거래 매물 (1~5개)
  - answer: question 필수. quote_id(자료실에서 고른 출처 `c12`)를 주면 그 출처를 우선 인용
  - 초안 생성(LLM)이 실패하면 503. 매물·고객·거래 기능은 계속 동작
- `GET /reports/{id}` → report
- `PUT /reports/{id}` `{opinion, to_check?}` → report (새 판). 승인 후 409.
- `POST /reports/{id}/review` → report (draft → review)
- `POST /reports/{id}/approve` `{confirm: true}` → report (review → approved, version 1.0). 고객 담당·관리자만.
- `POST /reports/{id}/share` → report (승인본만, 7일 유효 링크 생성, state=shared)
- `GET /reports/{id}/export` → 인쇄용 HTML (승인본만)
- 공개 링크 `GET /r/{token}` (인증 없음) → 인쇄용 HTML. 만료·미승인이면 404. 열람 수 증가, 고객 상담 기록에 "고객 열람" 추가.

## 질문 검색

- `POST /search` `{q, drop?: [key], session_id?, exclude_types?: ["news", ...]}` → (대화에 저장되고 아래 필드에 `session_id, message_id, question, effective_query, dropped, asked_at`이 더해진다)
  `{query, understood: [{key, label}], relaxed, opinion, to_check: [str], sources: [evidence], related: [evidence], listings: [listing + {notes, matched: [{want, text}], unmet: [str], checks, trade_reference}], gate: {status, messages}, generator}`
  - `understood`: 질문에서 뽑은 조건. key는 `district`·`price`·`area`·`walk`·`station`·`complex`·`first_home`·`want:학교` 등. `drop`에 key를 넣으면 그 조건을 빼고 다시 찾는다.
  - `relaxed`: 조건을 모두 만족하는 매물이 없어 조건을 넓혀(가격 ±10%, 면적 ±10%, 역 +5분) 찾았는지. 이때 각 매물의 `unmet`에 차이가 적힌다.
  - `opinion`·`to_check`의 출처 표시는 고객 자료와 같다(`[l3]` 매물, `[t3]` 단지 실거래가, `[t0]` 지역 실거래가 요약, `[c12]` 문서 조각).
  - `place`: 질문한 지역 `{name, region, lat, lng, radius_m}` (동·생활권·신도시는 반경 m, 구는 반경 없음). 지도가 이 지역으로 옮겨 반경을 그린다. `listing_intent`: 매물을 찾는 질문인지.
  - `session_id`가 있고 질문이 '그중·거기서·그럼…'으로 시작하면 앞 질문에 이어 붙여 찾는다(`effective_query`). 같은 질문에서 조건만 뺀 다시 찾기는 마지막 답을 바꾼다.
  - 사무소의 월 질문 한도를 넘으면 429.
  - `routes`: 실행한 검색 경로 (`listing`, `trade`, `rent`, `complex`, `building`, `station`, `document`). 전월세·세대수·난방·사용승인·건축물대장·노선을 물을 때만 해당 공공 캐시를 읽는다.
  - 구조화 근거 id: `r{매물}` 전월세, `k{매물}` 단지(K-apt), `b{매물}` 건축물대장, `s{매물}` 지하철 노선. `kind: "structured"`, `source_id`(데이터셋 번호), `value`, `collected_at`을 가진다. 수집 후 오래되면 `state: "stale"`, 표본이 3건 미만이면 `"warning"`. `stale_count`는 답변에 쓴 오래된 근거 수.
  - 전세·월세 질문의 금액은 매매 매물 가격 조건으로 쓰지 않는다. 매물 `listings[].public`에 쓴 공공데이터 요약이 붙는다.
  - 질문마다 `retrieval_traces`에 질문 해시·경로·근거 id·게이트·응답 시간이 남는다(원문 저장 안 함).
- 고객 자료 `kind: "answer"`도 같은 엔진을 쓴다. 질문에 없는 예산·면적·지역은 고객 조건으로 채우고, 찾은 매물은 자료의 `listings`에 저장된다.

## Hood AI (대화·설정·사용량·보고서)

- `GET /ai/sessions` → `[{id, title, updated_at, messages, last_question}]` (내 대화만, 최근 30개)
- `GET /ai/sessions/{id}` → `{id, title, updated_at, messages: [POST /search 응답과 같은 모양]}` · `DELETE /ai/sessions/{id}`. 남의 대화는 404.
- `GET /ai/settings` → `{source_types, detail_count, near_miss, monthly_limit, updated_by, updated_at, month_used, can_edit, llm: {enabled, model}}`
- (관리자) `PUT /ai/settings` `{source_types: ["law"|"policy"|"office"|"news"], detail_count: 1~5, near_miss, monthly_limit|null}`: 답변에 쓸 자료, 자세히 설명할 매물 수, 조건을 넓혀 찾기, 월 질문 한도
- `GET /ai/usage?days=14` → 이번 달·오늘·내 질문 수, 매물을 찾은 답변, 고객 자료로 만든 답변, 일별 질문, 사람별, 출처 종류별, 답변당 평균 출처, 검색 추적(`traces`, `latency_avg_ms`, `latency_p95_ms`, `stale_answers`, `by_route`) (한국 시간 기준, 모두 기록에서 센 값)
- `GET /reports?state=draft|review|done` → `{items: [{id, kind, title, question, state, version, customer_name, created_by, created_at, share_views}], counts: {all, draft, review, done}}`

## 자료실 (문서 근거 검색)

- `GET /documents?type=` → `[{id, type, type_label, title, org, date, effective_date, region, chunks, first_chunk, author, mine}]`
- `POST /documents` `{title, text, region?}` → `{id, first_chunk, chunks}`. 중개사가 직접 적는 사무소 자료(우리 사무소에서만 검색). 같은 내용이면 409. 지역 `마포구`는 `서울 마포구`로 저장.
- `DELETE /documents/{id}` → `{deleted}`. 추가한 사람·관리자만.
- `GET /evidence/search?q=&type=` → `{items: [evidence], gate: {status, messages}}`
- `GET /evidence/{id}` → evidence (`c12` 형식)
- (관리자) `POST /admin/documents` multipart `file, title, source_type, publisher, published_at, effective_date?, region?, url?, scope` → `{job}`
- (관리자) `DELETE /admin/documents/{id}`, `GET /admin/jobs`, `POST /admin/collect/trades`, `GET /audit`

## 구조화 공공데이터

- (관리자) `POST /admin/collect/rents` `{lawd_cd, deal_ymd}`: 아파트 전월세(`15126474`) 수집
- (관리자) `POST /admin/collect/complexes` `{kapt_code}`: K-apt 기본정보(`15058453`) 수집
- (관리자) `POST /admin/collect/buildings` `{sigungu_cd, bjdong_cd, plat_gb_cd?, bun?, ji?}`: 건축물대장 표제부(`15134735`) 수집
- (관리자) `POST /admin/collect/subway-stations` `{station_name}`: TAGO 역 검색(`15098554`) 수집
- 공통 수집 응답: `{dataset_id, received, valid, invalid, inserted, updated, unchanged, job}`
- `GET /public-data/rents?lawd_cd=&complex_name=&area_m2=&months=&limit=`: 동일 단지·유사면적 전월세 캐시
- `GET /public-data/complexes/{kapt_code}`: K-apt 단지 캐시
- `GET /public-data/buildings?sigungu_cd=&bjdong_cd=&bun=&ji=&limit=`: 건축물대장 캐시
- `GET /public-data/subway-stations?q=&limit=`: 지하철역·노선 캐시

수집 API는 관리자만 사용할 수 있고 조회 API도 로그인이 필요하다. 원천 `raw_payload`와 내부 중복방지 키는 조회 응답에 포함하지 않는다. 사용자 질문 중에는 외부 API를 직접 호출하지 않고 이 캐시를 조회한다.
관리자 화면 `#/public`은 위 수집 API 5종과 `GET /admin/jobs`를 사용한다. 서비스키는 서버 환경변수에만 있으며 화면에서는 입력하거나 조회하지 않는다.

## 운영

- `GET /health` → `{status, db, vector, llm}`

### 공공데이터 인증 설정

- `DATA_GO_KR_SERVICE_KEY`: 공공데이터포털에서 활용신청이 승인된 REST API의 공통 서비스 키. Encoding/Decoding 키 모두 허용하며 서버에서 호출 형식에 맞게 정규화한다.
- 공통 키 하나가 있어도 API별 활용신청 승인이 자동으로 생기지는 않는다. 지원 대상과 승인 여부는 `python scripts/check_public_data_config.py`의 데이터셋 체크리스트와 공공데이터포털 마이페이지를 함께 확인한다.
- `LAW_GO_KR_OC`: 현행법령 본문(`15057358`) 조회에 사용하는 국가법령정보 공동활용 OC 기관 ID. `DATA_GO_KR_SERVICE_KEY`를 사용하지 않는다.
- `VWORLD_API_KEY`, `VWORLD_API_DOMAIN`: VWorld 지도·공간정보(`15058805`)용 별도 키와 신청 시 등록한 허용 도메인. 두 값을 함께 설정한다.
- `JUSO_API_KEY`: 도로명주소 개발자센터용 별도 키(선택).
- 진단 명령과 서버 로그는 키의 실제 값을 출력하지 않는다.
