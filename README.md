# 중개메이트 MVP

이 MVP는 `index.html`의 사용자 워크플로우와 설계 문서(PRD 기반 화면)를 구현한 것입니다.
흐름은 매물 비교(구조화 사실) → 문서 근거 검색(RAG) → AI 초안 → 중개사 검토·승인입니다.

구성은 문서의 "MVP 실행" 항목을 따릅니다: **웹 화면 + FastAPI 애플리케이션 1개 + PostgreSQL(pgvector) 1개**.
캐시, 메시지 큐, 별도 벡터 DB는 두지 않습니다.

## 실행 (Docker)

```bash
cp .env.example .env          # 선택: ANTHROPIC_API_KEY, DATA_GO_KR_SERVICE_KEY, JWT_SECRET
docker compose up -d --build
```

- 작업대: http://localhost:8000/app.html
  - **매물 지도**(기본 화면, `#/map`): 사무소 매물을 지도 마커로 표시합니다(Leaflet + OpenStreetMap). 마커를 누르면 좌측에 매물 상세(가격 이력, 실거래가 참고, 걸린 상담)가 열리고, 지도를 클릭해 위치를 정한 뒤 **직접 등록**할 수 있습니다. 지도를 불러오지 못하면 목록과 좌표 직접 입력으로 대체합니다.
  - **상담 작업대**(`#/consult`): 고객 조건, 후보 비교·상담 초안, 정책·근거 질문, 검토·승인
- 사용자 워크플로우(설계 시안): http://localhost:8000/index.html
- API 문서(OpenAPI): http://localhost:8000/docs

시드 계정(비밀번호는 모두 `demo1234`):

| 계정 | 역할 | 사무소 |
|---|---|---|
| `agent@hanul.test` | 중개사 (김선용) | 하늘공인중개사사무소 |
| `admin@hanul.test` | 관리자 | 하늘공인중개사사무소 |
| `agent@other.test` | 중개사 | 연희공인중개사사무소 (tenant 격리 확인용) |

시드의 매물, 실거래가, 정책, 기사 문서는 모두 **시연용 샘플**이며 제목에 `[샘플]`을 붙였습니다. 실제 정책과는 무관합니다.

## 테스트

```bash
docker compose up -d db
docker compose run --rm app python -m pytest -q          # API 통합 테스트 (실제 Postgres)
python test_workflow.py                                   # 정적 워크플로우 화면 Playwright 테스트 (로컬 Chrome)
```

## 구조

```
docker-compose.yml        db(pgvector/pg16) + app(FastAPI, 정적 화면 포함)
backend/
  sql/schema.sql          테이블 (기동 시 멱등 실행)
  app/main.py             앱, request ID 미들웨어, 정적 파일 화이트리스트
  app/api.py              REST 라우트 (docs/API.md 계약)
  app/security.py         JWT 인증, tenant는 토큰의 사용자 레코드에서만 확정
  app/drafting.py         구조화 비교(경로 A), /ask·/advise 초안, 승인 버전 관리
  app/rag.py              수집·청킹·임베딩, 권한 필터 → 하이브리드 검색 → 재정렬 → 근거 게이트
  app/chunking.py         법령(조문)/정책(절)/FAQ(Q&A)/사무소/뉴스별 청킹
  app/embedding.py        384차원 문자 n-gram 해싱 임베딩 (외부 의존 없음)
  app/llm.py              Claude (선택). 실패 시 초안만 503, 나머지는 정상 동작
  app/public_data.py      실거래가 API 어댑터 (시간초과 + 회로 차단기)
  app/seed.py             시연 데이터
  tests/test_api.py       tenant 격리, 근거 게이트, 승인 흐름, LLM 장애 강등, 문서 삭제 전파
app.html / app.js / app.css   상담 작업대 (API 연동)
index.html / script.js / styles.css   사용자 워크플로우 시안 (정적)
docs/API.md               API 계약
docs/images/              화면 미리보기 (E2E 테스트가 갱신)
test_workflow.py / e2e_app.py   브라우저 테스트
```

## 설계 문서와의 대응

| 설계 원칙 | 구현 |
|---|---|
| 매물은 데이터로 비교 | `listings` / `apt_trades` SQL 필터·정렬, 조건별 ✓/✗ 체크 (벡터화하지 않음) |
| 설명은 근거와 연결 | claim마다 `citations`. 존재하지 않는 근거 id는 제거하고, 근거 없는 사실 주장은 `확인 불가`로 강등 |
| 모르면 확인 불가 | 공식 근거 없음, 뉴스만 있음, 시행 전, 자료 간 불일치를 근거 게이트가 결정론적으로 표시 |
| 승인은 사람이 수행 | `draft → review → approved` 상태 전이, 버전 이력, 승인 후 수정 불가, 승인본만 인쇄 |
| 근거 우선순위 | 법령(1) > 공식 정책(2) > 사무소 문서(3) > 뉴스(4). 충돌 시 상위 자료 기준 |
| 검색 전에 차단 | SQL `WHERE`에서 tenant ACL·지역·기준일을 먼저 적용한 뒤 순위 계산 |
| 고객 개인정보 | 공용 인덱스·감사 payload·LLM 프롬프트에 고객 이름을 넣지 않음 |
| 문서 속 명령은 데이터 | LLM 시스템 프롬프트에서 `<evidence>` 내용은 지시로 따르지 않도록 지정 |
| 삭제 전파 | 문서 삭제 시 청크 CASCADE 삭제와 원문 파일 삭제 |
| 장애 시 강등 | LLM 장애 시 `/ask`·`/advise`만 503. 매물·비교·근거 검색은 계속 동작 |
| 기본 운영 기록 | 응답마다 `X-Request-ID`, 4xx/5xx 로그, `audit_events` 테이블 |

## LLM / 임베딩

- `ANTHROPIC_API_KEY`가 없으면 **규칙 기반 초안 생성기**(`generator: "template"`)가 근거 조각에서 직접 주장을 만듭니다.
- 키를 설정하면 Claude(`LLM_MODEL`, 기본값 `claude-opus-5-5`)가 초안을 작성합니다. 이 경우에도 인용 검증과 근거 게이트 항목은 서버가 결정론적으로 덧붙입니다.
- 임베딩은 MVP용 해싱 임베딩입니다. 교체할 때는 `embedding.py`를 바꾸고 문서를 재인덱싱합니다. 모델 버전은 `documents.embed_model`에 기록됩니다.

## 관리자 기능

- `POST /api/admin/documents`: txt/md/pdf 업로드. PDF는 PyMuPDF로 쪽 단위 추출합니다. `scope=public|tenant`.
- `POST /api/admin/collect/trades` `{lawd_cd: "11440", deal_ymd: "202609"}`: 공공데이터포털 실거래가 수집. `DATA_GO_KR_SERVICE_KEY`가 필요합니다.
- `GET /api/admin/jobs`, `GET /api/admin/documents`, `DELETE /api/admin/documents/{id}`, `GET /api/audit`

## MVP 범위 밖 (설계 문서 기준)

React 재구현, Redis·Celery, Qdrant·OpenSearch, OpenTelemetry, Kubernetes, MCP 필수 연동, OCR(스캔 PDF는 업로드 시 오류), 지도 공급자 JS API(작업대는 좌표 기반 미니맵 사용), 골든 Q&A 통과 후 인덱스 원자 교체.
