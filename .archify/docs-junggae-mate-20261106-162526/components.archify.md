# 중개메이트의 각 구성 요소는 무엇을 하나요? {#junggae-mate-components}

중개메이트는 **Cloudflare Pages의 React 화면**과 **nginx 뒤의 FastAPI 서버 하나**로 동작하고, 모든 자료는 사무소별로 나뉜 PostgreSQL 하나에 저장됩니다.

- 화면은 서버 주소를 config.json에서 받아, 서버 주소가 바뀌어도 다시 빌드하지 않습니다.[](source:pages-config)
- 서버는 443 포트만 공개하고, nginx가 TLS를 풀어 FastAPI로 넘깁니다.[](source:nginx-conf)
- Hood AI는 매물·공공데이터(SQL)와 문서(검색)를 근거로 묶어 답하고, 근거가 부족하면 단정하지 않습니다.[](source:assistant-answer)

@answer scope="feature/ip-cert 브랜치 ccc8778 기준 · 서버 1대 · Docker Compose 배포"
@meta locale=ko repo_url=https://github.com/seandoesdev/junggae-mate.git repo_revision=ccc8778e03ff6f94b7cd92850e1b4cdf6a70c525
@source pages-config title="Pages Function /config.json" path=frontend/functions/config.json.ts lines=21:30
@source app-views title="화면 목록 (App.tsx)" path=frontend/src/App.tsx lines=16:24
@source nginx-conf title="nginx 443 분기와 프록시" path=deploy/nginx/nginx.conf lines=18:34
@source acme-entry title="acme.sh 발급·갱신 스크립트" path=deploy/acme/entrypoint.sh lines=38:63
@source main-cors title="FastAPI CORS·라우터" path=backend/app/main.py lines=64:91
@source assistant-answer title="답변 조립 answer()" path=backend/app/assistant.py lines=455:500
@source hood-ask title="Hood AI 대화 ask()" path=backend/app/hood.py lines=83:118
@source rag-search title="문서 하이브리드 검색" path=backend/app/rag.py lines=83:132
@source structured-facts title="구조화 근거 facts()" path=backend/app/structured.py lines=327:345
@source workflow-stage title="거래 단계·보고서" path=backend/app/workflow.py lines=91:121
@source public-store title="공공데이터 정규화 저장" path=backend/app/public_sources.py lines=1:5
@source schema title="DB 스키마" path=backend/sql/schema.sql lines=1:17
@source compose title="Docker Compose 서비스" path=docker-compose.yml lines=3:41

## 요청은 어떤 순서로 지나가나요? {#request-path}

@architecture id=component-map title="구성 요소 한눈에 보기"
| pages | React 화면 | frontend |
| nginx | nginx 443 | security |
| fastapi | FastAPI | backend |
| hood | Hood AI | backend |
| workflow | 거래·보고서 | backend |
| collector | 공공데이터 수집 | backend |
| db | PostgreSQL | database |
| pages > nginx | /api 요청 | emphasis |
| nginx > fastapi | 8000 프록시 | emphasis |
| fastapi > hood | 질문 | |
| fastapi > workflow | 업무 | |
| fastapi > collector | 관리자 | security |
| hood > db | 근거 조회 | |
| workflow > db | 저장 | |
| collector > db | upsert | |

@steps id=request-steps
| s1 | React 화면 | Cloudflare Pages가 화면 파일을 내려 주고, 화면은 config.json에서 서버 주소를 받습니다. | component-map | pages |
| s2 | nginx 443 | 서버로 오는 모든 연결을 받아 TLS를 풀고 FastAPI로 넘깁니다. | component-map | nginx |
| s3 | FastAPI | 로그인 토큰을 확인하고, 요청을 사무소 범위로 좁혀 각 기능에 넘깁니다. | component-map | fastapi |
| s4 | PostgreSQL | 업무 자료, 공공데이터, 문서 조각과 벡터를 함께 저장합니다. | component-map | db |

## 화면과 배포는 각각 무엇을 맡나요? {#frontend-roles}

| 구성 요소 | 하는 일 | 위치 |
| --- | --- | --- |
| React 화면 | 지도, Hood AI, 거래, 고객, 자료실, 공공데이터, 보고서 화면을 보여 줍니다. 주소의 `#/map` 같은 해시로 화면을 바꿉니다. | `frontend/src/App.tsx` |
| config.json (Pages Function) | Cloudflare에 저장한 `API_URL` 값을 `{apiUrl}`로 돌려줍니다. 서버 주소를 바꿀 때 화면을 다시 빌드하지 않아도 됩니다. | `frontend/functions/config.json.ts` |
| Cloudflare Pages | `junggae-mate.kro.kr`에서 화면 파일을 내려 줍니다. `/`는 `/app`으로 연결합니다. | `frontend/public/_redirects` |
| OpenStreetMap | 지도 화면의 바탕 타일을 내려 줍니다. 중개메이트 서버를 거치지 않습니다. | `frontend/src/features/map/leaflet.ts` |

화면 목록은 `App.tsx`의 화면 표에 있습니다.[](source:app-views)

## 서버 앞단은 무엇을 맡나요? {#edge-roles}

| 구성 요소 | 하는 일 | 위치 |
| --- | --- | --- |
| nginx 443 | TLS를 풀지 않고 ALPN만 먼저 봅니다. `acme-tls/1` 연결은 acme로, 나머지는 내부 8443에서 TLS를 풀어 `app:8000`으로 넘깁니다. | `deploy/nginx/nginx.conf` |
| nginx 80 | 인증서 확인 파일만 내려 주고, 나머지 요청은 https로 돌립니다. | `deploy/nginx/nginx.conf` |
| acme.sh | Let's Encrypt에서 인증서를 받고 갱신합니다. 서버 주소가 IP면 약 6일짜리 단기 인증서를 받습니다. 인증서가 바뀌면 nginx가 1분 안에 다시 읽습니다. | `deploy/acme/entrypoint.sh` |
| Let's Encrypt | 인증서를 발급하는 기관입니다. 443으로 들어온 확인 요청(TLS-ALPN-01)으로 서버 소유를 확인합니다. | 외부 |

인증서 처리 순서는 acme 스크립트에 있습니다.[](source:acme-entry)

## 백엔드 모듈은 각각 무엇을 하나요? {#backend-roles}

| 구성 요소 | 하는 일 | 위치 |
| --- | --- | --- |
| FastAPI (`main.py`) | 허용한 화면 주소만 CORS로 받고, 요청마다 ID를 붙이고, `/api` 라우터를 연결합니다. | `backend/app/main.py` |
| API 라우터 (`api.py`) | 59개 API의 입력을 검사하고, 로그인 사용자의 사무소 자료만 다루게 합니다. | `backend/app/api.py` |
| 보안 (`security.py`) | 비밀번호를 PBKDF2로 저장하고, JWT(HS256) 토큰을 만들고 확인합니다. 관리자 전용 API를 가립니다. | `backend/app/security.py` |
| Hood AI 대화 (`hood.py`) | 월 질문 한도를 확인하고, "그중 7억 이하만" 같은 이어 묻기를 앞 질문과 합칩니다. 대화와 검색 추적을 저장합니다. | `backend/app/hood.py` |
| 답변 조립 (`assistant.py`) | 질문에서 지역·가격·면적·역을 뽑고, 매물·실거래·공공데이터·문서 중 필요한 경로만 골라 답변을 만듭니다. | `backend/app/assistant.py` |
| 구조화 근거 (`structured.py`) | 매물을 K-apt 단지, 건축물대장, 지하철역과 연결하고, 연결된 공공데이터를 근거로 돌려줍니다. 연결 확정은 사람이 합니다. | `backend/app/structured.py` |
| 문서 검색 (`rag.py`) | 문서를 조각내 저장하고, 벡터와 키워드 점수로 찾고, 근거 게이트로 부족·충돌·시행 전을 판정합니다. | `backend/app/rag.py` |
| 초안 작성 (`drafting.py`) | 근거 번호가 붙은 문장과 확인할 사항을 만들고, LLM 문장의 출처를 검증합니다. | `backend/app/drafting.py` |
| Claude 연결 (`llm.py`) | API 키가 있을 때만 근거를 문장으로 다듬습니다. 키가 없으면 규칙 기반 문장으로 답합니다. | `backend/app/llm.py` |
| 거래·보고서 (`workflow.py`) | 거래 단계(소개→방문→협상→계약→완료), 체크리스트, 보고서 검토·승인·공유 링크를 다룹니다. | `backend/app/workflow.py` |
| 공공데이터 수집 (`public_data.py`, `public_sources.py`) | 공공데이터포털 API를 부르고, 응답을 정규화해 같은 키는 덮어쓰기(upsert)로 저장합니다. | `backend/app/public_sources.py` |
| 감사 기록 (`audit.py`) | 문서 등록, 단계 변경, 승인 같은 중요한 변경을 남깁니다. 관리자만 봅니다. | `backend/app/audit.py` |

핵심 흐름은 대화[](source:hood-ask), 답변 조립[](source:assistant-answer), 구조화 근거[](source:structured-facts), 문서 검색[](source:rag-search), 거래 단계[](source:workflow-stage)입니다.

## 데이터와 외부 서비스는 무엇을 맡나요? {#data-roles}

| 구성 요소 | 하는 일 | 위치 |
| --- | --- | --- |
| PostgreSQL 16 | 사무소, 사용자, 매물, 고객, 거래, 보고서, 대화를 저장합니다. 모든 업무 표에 `tenant_id`가 있어 사무소별로 나뉩니다. | `backend/sql/schema.sql` |
| pgvector | 문서 조각의 384차원 벡터를 저장하고 코사인 거리로 비교합니다. | `chunks.embedding` |
| pg_trgm | 문서 조각의 키워드 유사도(`word_similarity`)를 계산합니다. GIN 색인을 씁니다. | `chunks_trgm_idx` |
| 원문 보관 볼륨 | 등록한 문서 원문을 `/data/raw`에 내용 해시 이름으로 보관합니다. | `rawdocs` 볼륨 |
| 공공데이터포털 | 실거래가, 전월세, 단지 정보, 건축물대장, 지하철역 API를 제공합니다. 관리자가 수집할 때만 부릅니다. | `apis.data.go.kr` |
| Claude API | 근거를 사람이 읽는 문장으로 다듬습니다. 고객 이름·연락처는 보내지 않습니다. | `api.anthropic.com` |

서비스 구성은 Compose 파일[](source:compose), 확장과 기본 표는 스키마[](source:schema)에서 확인할 수 있습니다.
