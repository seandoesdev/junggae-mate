# 중개메이트 API 계약 v0.3

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
- `GET /agents` → `[{id, name, role}]` (같은 사무소 중개사)

시드 계정 (비밀번호 `demo1234`): `agent@hanul.test` 김선용, `park@hanul.test` 박지은, `lee@hanul.test` 이도현, `admin@hanul.test` 관리자, `agent@other.test` (다른 사무소).

## 매물

listing: `{id, label, title, complex_name, address, district, price, area_m2, floor, station, station_walk_min, park_walk_min, lat, lng, description, source, source_date, status, agent_id, agent_name, mine, stage (listing_stage), active_deals, price_history: [{price, changed_at}], created_at}`

- `GET /listings?mine=true&sort=price|recent&district=&max_price=&min_area=` → `{items: [listing], total}` (거래 중 매물만)
- `GET /listings/{id}` → `{listing, trade_reference, deals: [deal], checks: [check]}`
  - trade_reference: `{median_price, count, period, source, as_of} | null` (과거 신고 거래, 현재 호가 아님)
  - **check** (확인할 사항, 문서 근거 검색으로 출처를 붙임): `{key, text, level: "normal"|"warn"|"urgent", checked, checked_by, checked_at, sources: [evidence]}`
- `PUT /listings/{id}/checks/{key}` `{checked: bool}` → check
- `POST /listings` (201) `{title, complex_name, address, district, price, area_m2, lat, lng, floor?, station?, station_walk_min?, park_walk_min?, description?}` → listing (담당 = 등록한 사람)
- `PUT /listings/{id}` 같은 입력 → listing (가격이 바뀌면 이력 추가). 담당자·관리자만.
- `POST /listings/{id}/close` → listing (status=closed). 담당자·관리자만.

## 고객

customer: `{id, name, deal_type, phone, agent_id, agent_name, budget_max, area_min, district, station_walk_max, preferences: [str], first_home, top_stage | null, active_deals, created_at}`

- `GET /customers?mine=true` → `[customer]`
- `GET /customers/{id}` → `{customer, deals: [deal], reports: [report_summary], activities: [{at, text, user_name}]}`
- `POST /customers` (201) `{name, deal_type?, phone?, budget_max?, area_min?, district?, station_walk_max?, preferences?, first_home?}` → customer (담당 = 등록한 사람)
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

## 자료실 (문서 근거 검색)

- `GET /documents?type=` → `[{id, type, type_label, title, org, date, effective_date, region, chunks}]`
- `GET /evidence/search?q=&type=` → `{items: [evidence], gate: {status, messages}}`
- `GET /evidence/{id}` → evidence (`c12` 형식)
- (관리자) `POST /admin/documents` multipart `file, title, source_type, publisher, published_at, effective_date?, region?, url?, scope` → `{job}`
- (관리자) `DELETE /admin/documents/{id}`, `GET /admin/jobs`, `POST /admin/collect/trades`, `GET /audit`

## 운영

- `GET /health` → `{status, db, vector, llm}`
