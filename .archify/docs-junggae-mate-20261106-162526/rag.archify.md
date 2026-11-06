# Hood AI의 RAG는 어떻게 설계되었나요? {#junggae-mate-rag}

Hood AI는 근거를 **두 경로**로 찾습니다. 공공데이터와 매물은 SQL로 정확한 값을 읽고(경로 A), 법령·정책·사무소 자료·기사는 조각으로 나눠 하이브리드 검색으로 찾습니다(경로 B). 그다음 **근거 게이트**가 근거의 부족·충돌·시행 전 여부를 규칙으로 판정합니다.

- 금액·면적·코드가 중요한 공공데이터는 임베딩하지 않고 표의 열로 정규화해 저장합니다.[](source:public-store)
- 문서 조각은 벡터 점수 0.6과 키워드 점수 0.4를 더해 순위를 매기고, 법령·정책에 가산점을 줍니다.[](source:rag-search)
- Claude는 근거를 문장으로 다듬기만 합니다. 출처가 없는 문장은 확인할 사항으로 내려갑니다.[](source:verify-citations)

@answer scope="ccc8778 기준 · 임베딩은 외부 모델 없는 해시 n-gram(384차원) · 문서 기본 자료는 시연용 샘플"
@meta locale=ko repo_url=https://github.com/seandoesdev/junggae-mate.git repo_revision=ccc8778e03ff6f94b7cd92850e1b4cdf6a70c525
@source public-store title="공공데이터 정규화 저장 (임베딩하지 않음)" path=backend/app/public_sources.py lines=1:5
@source upload title="문서 등록 API (PDF 추출)" path=backend/app/api.py lines=795:834
@source ingest title="문서 수집·청킹·임베딩 ingest_document()" path=backend/app/rag.py lines=39:78
@source chunk-limits title="유형별 청킹 규칙" path=backend/app/chunking.py lines=8:14
@source chunk-doc title="chunk_document()" path=backend/app/chunking.py lines=62:78
@source embed title="해시 n-gram 임베딩" path=backend/app/embedding.py lines=1:33
@source rag-search title="하이브리드 검색·재정렬" path=backend/app/rag.py lines=83:132
@source gate title="근거 게이트 evidence_gate()" path=backend/app/rag.py lines=163:228
@source routing title="질문 경로 고르기 (단어 목록)" path=backend/app/assistant.py lines=36:45
@source answer title="답변 조립 answer()" path=backend/app/assistant.py lines=455:506
@source stale title="공공데이터 오래됨 기준" path=backend/app/structured.py lines=15:36
@source candidates title="매물↔공공데이터 연결 후보" path=backend/app/structured.py lines=84:119
@source trade-ref title="같은 단지 실거래 중위가" path=backend/app/drafting.py lines=129:146
@source verify-citations title="게이트 반영·출처 검증" path=backend/app/drafting.py lines=261:293
@source llm-rules title="Claude 지시문 (근거 규칙)" path=backend/app/llm.py lines=20:25
@source trace title="검색 추적 저장" path=backend/app/hood.py lines=72:81
@source schema-docs title="documents·chunks 표" path=backend/sql/schema.sql lines=235:266
@source seed-docs title="시연용 기본 문서" path=backend/app/seed.py lines=121:170

## 자료는 미리 어떻게 쌓이나요? {#ingest-pipeline}

@workflow id=ingest-flow title="수집 파이프라인 (질문 전에 미리)"
| lane docs | 경로 B · 문서 |
| lane public | 경로 A · 공공데이터 |
| upload | 문서 등록 | frontend | docs |
| extract | 텍스트 추출 | backend | docs |
| dedupe | 중복 확인 | backend | docs |
| split | 유형별 청킹 | backend | docs |
| vectorize | 임베딩 | backend | docs |
| chunkstore | chunks 저장 | database | docs |
| collect | 관리자 수집 | frontend | public |
| portal | 공공데이터포털 | external | public |
| normalize | 정규화 | backend | public |
| tables | 표에 upsert | database | public |
| confirm | 매물 연결 확정 | frontend | public |
| upload > extract | PDF·텍스트 | |
| extract > dedupe | 본문 | |
| dedupe > split | 새 문서 | emphasis |
| split > vectorize | 조각 | |
| vectorize > chunkstore | 384차원 | emphasis |
| collect > portal | serviceKey | security |
| portal > normalize | XML·JSON | |
| normalize > tables | source_key | emphasis |
| tables > confirm | 후보 | |

@steps id=ingest-steps
| i1 | 문서 등록 | 관리자는 PDF·텍스트 파일을 올리고, 중개사는 자료실에 사무소 자료를 직접 적습니다. | ingest-flow | upload |
| i2 | 텍스트 추출 | PDF는 PyMuPDF로 쪽마다 `# N쪽` 표시를 남기며 합칩니다. 글자가 없는 스캔 문서는 422로 거절합니다. | ingest-flow | extract |
| i3 | 중복 확인 | 본문의 SHA-256 해시가 같은 사무소 범위에 이미 있으면 새로 넣지 않습니다. 원문은 `/data/raw/<해시>.<확장자>`에 보관합니다. | ingest-flow | dedupe |
| i4 | 유형별 청킹 | 조문·소제목·FAQ 단위로 자르고 원문 위치(`location`)를 함께 저장합니다. | ingest-flow | split |
| i5 | 임베딩 | "제목 + 조각"을 384차원 벡터로 바꿔 `chunks.embedding`에 넣습니다. | ingest-flow | vectorize |
| i6 | 관리자 수집 | 관리자가 지역 코드·연월·단지 코드로 수집을 요청합니다. 질문할 때는 외부 API를 부르지 않습니다. | ingest-flow | collect |
| i7 | 정규화 | 금액·면적·날짜·코드를 열로 바꾸고 원본 응답은 JSONB로 함께 보존합니다. | ingest-flow | normalize |
| i8 | 매물 연결 확정 | 이름 유사도에 지역 일치 가산 0.25를 더해 후보를 보여 주고, 담당 중개사가 하나를 고릅니다. | ingest-flow | confirm |

문서 수집은 `ingest_document()`[](source:ingest), 업로드 처리는 문서 등록 API[](source:upload), 연결 후보는 `candidates()`[](source:candidates)에 있습니다.

## 어떤 데이터를 근거로 쓰나요? {#data-sources}

| 데이터 | 경로 | 저장 위치 | 쓰는 방식 | 신선도 기준 |
| --- | --- | --- | --- | --- |
| 법령 (`law`) {#ds-law} | B | `documents`·`chunks` | 하이브리드 검색, 권위 1순위 | 시행일이 기준일 뒤면 확인 불가 |
| 정책 (`policy`) {#ds-policy} | B | `documents`·`chunks` | 하이브리드 검색, 권위 2순위 | 시행일이 기준일 뒤면 확인 불가 |
| 사무소 자료 (`office`) {#ds-office} | B | `documents`·`chunks` (사무소 전용) | 하이브리드 검색, 권위 3순위, 단지 이름 언급도 찾음 | 게시일이 기준일 이전인 것만 |
| 기사 (`news`) {#ds-news} | B | `documents`·`chunks` | 시장 분위기 보조 자료 {caution:정책 근거 불가} | 게시일이 기준일 이전인 것만 |
| 아파트 매매 실거래가 (15126468) {#ds-trade} | A | `apt_trades` | 같은 단지·면적 ±5㎡·최근 12개월 중위가, 구 단위 중위가 | 최근 12개월 신고분 |
| 아파트 전월세 실거래가 (15126474) {#ds-rent} | A | `apt_rent_trades` | 전세·월세 사례, 3건 미만이면 적은 표본으로 표시 | 수집 후 60일 |
| 공동주택 기본정보 K-apt (15058453) {#ds-kapt} | A | `apartment_complexes` | 세대수·난방·사용승인일 | 수집 후 365일 |
| 건축물대장 표제부 (15134735) {#ds-building} | A | `building_register_records` | 주용도·구조 | 수집 후 365일 |
| TAGO 지하철정보 (15098554) {#ds-subway} | A | `subway_stations` | 역·노선 (역명 중복은 TAGO 역 ID로 구분) | 수집 후 365일 |
| 매물·현장 메모 {#ds-listing} | A | `listings`·`listing_notes` | 가격·면적·역 거리 조건, 바라는 점(학교·공원·남향 등) 확인 | 등록 상태가 `active`인 매물 |

신선도 기준을 넘긴 공공데이터는 근거에 "다시 수집이 필요합니다"라고 표시하고, 답변 추적에 오래된 근거 수로 남깁니다.[](source:stale) 실거래 참고값은 과거 신고 거래이며 현재 호가가 아닙니다.[](source:trade-ref)

@callout level=note title="지금 들어 있는 문서는 시연용 샘플입니다"
기본 데이터에는 `[샘플]` 표시가 붙은 법령 발췌 2건, 정책 4건, 기사 1건과 사무소별 내부 문서가 들어 있습니다.
운영에서는 `SEED_ON_START=0`으로 두고, 관리자가 실제 법령·정책 원문을 올려야 합니다. 법제처 현행법령 API(15057358)는 별도 인증값이 필요해 아직 연결하지 않았습니다.

기본 문서 목록은 seed 파일에 있습니다.[](source:seed-docs)

## 문서는 어떻게 나누고 벡터로 바꾸나요? {#chunking}

| 문서 유형 | 나누는 단위 | 조각 최대 크기 | 겹침 |
| --- | --- | --- | --- |
| 법령 | 조문(`제N조`, `제N조의M`) | 700토큰 | 없음 |
| 정책 | FAQ가 있으면 질문마다, 없으면 소제목(`#`)마다 | 1000토큰 | 12% {caution:FAQ는 겹침 없음} |
| 사무소 자료 | 소제목마다 | 800토큰 | 없음 |
| 기사 | 소제목마다 | 400토큰 | 없음 |

토큰 수는 한국어 기준 "글자 수 ÷ 2"로 어림합니다. 한도를 넘는 단위는 문장 끝(`.`, `다`, `요`)에서 다시 나누고, 위치를 `제3조 (2/3)`처럼 남깁니다.[](source:chunk-limits) 나누는 순서는 `chunk_document()`에 있습니다.[](source:chunk-doc)

@facts
| 임베딩 모델 이름 | `hash-ngram-v1-384` |
| 차원 | 384 |
| 특징 | 어절(가중치 1.5)과 어절 안 2·3글자 조각을 해싱해 더한 뒤 길이를 1로 맞춤 |
| 장점 | 외부 모델·키·네트워크가 필요 없고, 조사가 바뀌어도 글자 조각이 겹쳐 비슷하게 나옴 |
| 버전 추적 | 문서마다 `embed_model`을 저장하고, 검색은 같은 모델로 만든 조각만 비교 |

해시 임베딩의 구현은 `embedding.py`에 있습니다.[](source:embed) 저장 표 구조는 스키마에서 확인할 수 있습니다.[](source:schema-docs)

## 질문하면 어떤 순서로 근거를 찾나요? {#query-flow}

@workflow id=answer-flow title="질문 한 건의 처리 순서"
| lane understand | 질문 이해 |
| lane retrieve | 근거 찾기 |
| lane respond | 답하기 |
| ask | 질문 | frontend | understand |
| parse | 조건 추출 | backend | understand |
| route | 경로 고르기 | backend | understand |
| sql | 매물·공공데이터 SQL | database | retrieve |
| docs | 문서 검색 | database | retrieve |
| gate | 근거 게이트 | security | retrieve |
| compose | 근거 문장 | backend | respond |
| polish | Claude | external | respond |
| verify | 출처 검증 | security | respond |
| ask > parse | 이어 묻기 | |
| parse > route | 조건 | |
| route > sql | 매물·전세·세대수 | emphasis |
| route > docs | 정책·시세 | emphasis |
| sql > compose | 구조화 근거 | |
| docs > gate | 상위 8개 | |
| gate > compose | 판정 | emphasis |
| compose > polish | 키 있을 때 | dashed |
| polish > verify | claims | |

@steps id=answer-steps
| a1 | 질문 | "그중 7억 이하만" 같은 이어 묻기는 앞 질문과 합쳐 하나의 질문으로 바꿉니다. 월 질문 한도도 여기서 확인합니다. | answer-flow | ask |
| a2 | 조건 추출 | 규칙으로 구, 가격(억·천·만), 면적(평·㎡), 역과 도보 분, 바라는 점을 뽑고 화면에 "이렇게 이해했습니다"로 보여 줍니다. | answer-flow | parse |
| a3 | 경로 고르기 | 단어로 경로를 고릅니다. 매물 단어는 매물 경로, 정책·대출·세금은 문서 경로, 전세·세대수·호선은 해당 공공데이터만 읽습니다. | answer-flow | route |
| a4 | 문서 검색 | 권한·지역·시점 필터를 먼저 걸고 점수를 매깁니다. 아래 "순위는 어떻게 매기나요?"를 보세요. | answer-flow | docs |
| a5 | 근거 게이트 | 부족·충돌·시행 전을 판정해 본문과 확인할 사항에 규칙으로 반영합니다. | answer-flow | gate |
| a6 | 근거 문장 | 모든 문장에 근거 번호를 붙입니다. 키가 없으면 이 문장이 최종 답변입니다. | answer-flow | compose |
| a7 | 출처 검증 | Claude 답변에서 없는 근거 번호는 지웁니다. 출처가 없거나 기사만 근거인 문장은 확인할 사항으로 내립니다. 최대 8문장입니다. | answer-flow | verify |

경로를 고르는 단어 목록은 `assistant.py`에 있고[](source:routing), 전체 순서는 `answer()`에 있습니다.[](source:answer)

## 순위는 어떻게 매기나요? {#ranking}

| 단계 | 규칙 |
| --- | --- |
| 1. 권한 필터 | 조각과 문서 모두 공용(`tenant_id` 없음)이거나 우리 사무소 것만 |
| 2. 지역·시점 필터 | 문서 지역이 없거나 `전국`이거나 질문 지역으로 시작하는 것, 게시일이 기준일 이전인 것만 |
| 3. 점수 | `0.6 × 벡터 유사도(1 − 코사인 거리) + 0.4 × 키워드 유사도(word_similarity)`, 상위 30개 |
| 4. 문턱 | 점수가 0.12(`MIN_EVIDENCE_SCORE`) 미만이면 버림 |
| 5. 권위 가산 | `(4 − 권위) × 0.02` → 법령 +0.06, 정책 +0.04, 사무소 +0.02, 기사 0 |
| 6. 다양성 | 한 문서에서 최대 2조각, Hood AI는 8개까지 |

계산 예: 벡터 유사도 0.5, 키워드 유사도 0.3인 법령 조각은 0.6 × 0.5 + 0.4 × 0.3 = 0.42이고, 가산 0.06을 더해 **0.48**입니다. 같은 점수의 기사 조각은 0.42로 그보다 뒤에 섭니다.

검색 SQL과 재정렬은 `rag.search()`에 있습니다.[](source:rag-search)

## 근거 게이트는 무엇을 막나요? {#evidence-gate}

| 판정 | 조건 | 답변에 생기는 일 |
| --- | --- | --- |
| 근거 부족 `insufficient` {#gate-empty} | 찾은 조각이 없음 | "관련 공식 자료를 찾지 못했습니다. 담당 기관에 직접 확인"을 확인할 사항에 넣음 {bad:단정하지 않음} |
| 공식 근거 없음 `insufficient` {#gate-no-official} | 정책 질문인데 법령·정책 조각이 없음 | 기사나 사무소 자료만으로 정책 적용 여부를 단정하지 않음 |
| 충돌 `conflict` {#gate-conflict} | 두 문서의 같은 사실 키(`facts`) 값이 다름 | 권위가 높은 자료 값으로 안내하고, 다른 자료에 충돌 표시 {caution:공식 자료 우선} |
| 시행 전 `not_effective` {#gate-pending} | 법령·정책의 시행일이 기준일 뒤 | "시행 이후 적용 여부 다시 확인"을 확인할 사항에 넣음 |
| 기사 경고 {#gate-news} | 기사 조각은 항상 | "보조 자료입니다. 정책 적용 여부의 근거로 쓰지 않습니다" 표시 |

정책 질문은 "정책, 지원, 대출, 규제, 세금, 취득세, 시행, 요건, 대상" 같은 단어나 생애최초 질문으로 판단합니다. 게이트 결과는 Claude 사용 여부와 관계없이 규칙으로 답변에 들어갑니다.[](source:gate)

## Claude는 어디까지 관여하나요? {#llm-role}

- Claude는 `ANTHROPIC_API_KEY`가 있고 근거가 하나 이상일 때만 부릅니다. 키가 없으면 규칙 기반 문장(`template`)으로 답합니다.
- 보내는 내용은 질문, 이해한 조건, 매물 요약, 근거 조각입니다. 고객 이름·연락처는 보내지 않습니다.
- 근거 조각은 `<evidence>` 안의 데이터로 보내고, 그 안의 지시문은 따르지 않게 합니다.[](source:llm-rules)
- 돌아온 문장마다 근거 번호를 검사해, 근거가 없는 문장은 본문이 아니라 확인할 사항으로 보냅니다.[](source:verify-citations)

## 어떻게 추적하고 점검하나요? {#tracing}

질문마다 `retrieval_traces`에 한 줄을 남깁니다. 질문 원문 대신 해시를 저장합니다.[](source:trace)

| 남기는 값 | 쓰는 곳 |
| --- | --- |
| 실행 경로 (`listing`, `trade`, `document`) | 경로별 질문 수 |
| 사용한 근거 ID, 게이트 판정 | 근거가 부족했던 질문 찾기 |
| 응답 시간 (ms) | 평균·p95 응답 시간 (`GET /api/ai/usage`) |
| 오래된 공공데이터 근거 수 | 다시 수집할 데이터 찾기 |
| 생성 방식 (`template`, `anthropic`) | Claude 사용량 확인 |

@callout level=warning title="지금 설계의 한계"
해시 임베딩은 글자가 겹치지 않는 동의어("전세 대출"과 "임차 보증금 융자")를 잘 잇지 못합니다. 실제 임베딩 모델로 바꾸면 `embed_model` 값이 달라지므로 기존 문서를 다시 색인해야 합니다.
`chunks.embedding`에는 아직 벡터 색인(HNSW 등)이 없어 조각 수가 늘면 검색 시간이 함께 늘어납니다. 키워드 쪽은 pg_trgm GIN 색인을 씁니다.
