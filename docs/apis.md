# 중개메이트 외부 API 조사

- 조사일: 2026-10-30. 각 항목은 그날 공식 페이지를 직접 열어 확인한 내용이다.
- 이 문서는 사람이 읽는 조사 기록이다. 우리 서비스의 REST 계약서는 `docs/API.md`이다.
- **확인됨**은 공식 페이지에서 직접 읽은 것이다. **확인 필요**는 공식 페이지에서 찾지 못했거나 제3자 자료로만 본 것이다. 이 표시가 붙은 내용을 사실로 쓰면 안 된다.
- 가격은 적지 않았다. 요금은 각 공식 요금 페이지에서 확인한다(참고 링크 참조).

---

## 0. 검토 요약 (2026-10-30)

조사 결과를 다시 검토하면서 정리한 핵심 내용이다. 자세한 근거는 아래 각 절에 있다.

### 바로잡을 점

- **아파트 매매 실거래가의 데이터셋 ID는 15126469다.** 원래 설계 문서(`index.html`)와 이전 안내에는 15126468로 적혀 있었다. 공식 페이지를 직접 다시 열어 확인했다.
  - 15126469 「국토교통부_아파트 매매 실거래가 자료」 → `https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade` (현재 코드가 호출하는 API)
  - 15126468 「국토교통부_아파트 매매 실거래가 상세 자료」 → `https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev` (도로명·단지 일련번호가 추가되어 단지를 정확히 연결할 때 사용, 함께 신청 권장)
- 코드의 출처 표시(`backend/app/public_data.py`의 `TRADE_SOURCE`, `backend/app/drafting.py`의 실거래가 출처 링크)도 15126468로 되어 있어 15126469로 고쳐야 한다. (이 문서 작업에서는 코드를 고치지 않음)

### 알게 된 중요한 점

- **신청은 API마다 따로.** data.go.kr 인증키 하나로 여러 API를 쓰지만, 데이터셋 페이지마다 "활용신청"을 눌러야 열린다. 대부분 자동승인이며 개발단계 한도는 보통 하루 10,000건이다.
- **원래 설계에 빠진 것:**
  - 공동주택 기본정보(15058453)는 단지코드(`kaptCode`)가 필요하므로 **단지 목록(15057332)**을 함께 신청해야 한다.
  - 지하철(TAGO 15098554)에는 역 좌표가 없다. 역세권 계산에는 **역 좌표 파일 데이터**(15099316, 15171250)가 맞다.
  - 법령(15057358)은 LINK형이라 data.go.kr 키로 호출하지 못한다. **법제처 open.law.go.kr에 따로 신청**한다(승인 1~2일).
- **뉴스 (주의):**
  - 네이버 검색 API의 신규 신청은 **NAVER API HUB(네이버 클라우드)**로 옮겨 갔다. 기존 개발자센터 키는 HUB에서 쓸 수 없다. (네이버 클라우드 공식 가이드로 확인)
  - 조사 중 약관에 **"검색 결과를 AI에 입력 금지"** 조항이 있다고 확인됐으나, 약관 원문 페이지가 자동 조회를 막아 재검증하지 못했다. **신청 전 원문을 사람이 직접 읽고 확정한다.**
  - 이 조항이 사실이면 네이버 뉴스는 AI 답변의 근거로 쓸 수 없고, 화면에 "관련 뉴스" 링크로만 보여 줄 수 있다. 뉴스를 근거로 쓰려면 이용 허락을 받은 출처(BigKinds 제휴 등)가 필요하다.
- **등기부:** 공식 API가 없고 유료 대행만 있다. 중개사가 발급받은 PDF를 자료실에 올려 근거로 쓰는 방식을 제안한다.
- **개인정보:** 고객 정보를 해외 AI 서비스로 보내는 것은 개인정보 처리위탁·국외 이전에 해당할 수 있어 전문가 검토가 필요하다. AI에는 이름 대신 고객 번호와 필요한 조건만 보낸다.

### 바로 신청할 것 (자세한 순서와 `.env` 이름은 2절)

1. **공공데이터포털:** 실거래가 15126469(+상세 15126468), 전월세 15126474, 단지 목록 15057332, 공동주택 기본정보 15058453, 건축물대장 15134735, 법정동코드 15077871
2. **도로명주소 API + 좌표제공 API** (juso.go.kr, 키가 API별로 따로 나옴)
3. **법제처 국가법령정보** (open.law.go.kr)
4. **VWorld, 카카오 로컬, NEIS 학교정보, 한국부동산원 R-ONE**
5. **임베딩 모델 하나 선택:** Voyage, OpenAI, 또는 자체 서버의 bge-m3

### 재검증에 쓴 출처

- 국토교통부_아파트 매매 실거래가 자료 (15126469): https://www.data.go.kr/data/15126469/openapi.do
- 국토교통부_아파트 매매 실거래가 상세 자료 (15126468): https://www.data.go.kr/data/15126468/openapi.do
- NAVER API HUB 이관 가이드 (네이버 클라우드): https://guide.ncloud-docs.com/docs/apihub-migration
- 네이버 검색 API 약관 변경 2차 보도 (브런치): https://brunch.co.kr/@ainote/123

---

## 1. 요약

| # | API (제공처) | 용도 (어떤 기능에 쓰는지) | 우선순위 | 비용 | 키 발급 방식 | 상태 |
|---|---|---|---|---|---|---|
| 1 | 아파트 매매 실거래가 (국토교통부, data.go.kr 15126469) | 질문 답변의 실거래 흐름, 매물 상세의 시세 비교 | 필수 | 무료 | data.go.kr 활용신청, 자동승인 | 확인됨 |
| 2 | 아파트 매매 실거래가 **상세** (국토교통부, 15126468) | 1번에 도로명·단지 일련번호(aptSeq)·법정동코드가 더해짐. 단지 매칭용 | 권장 | 무료 | data.go.kr 자동승인 | 확인됨 |
| 3 | 아파트 전월세 실거래가 (국토교통부, 15126474) | 전세가율, 전월세 흐름, 갱신요구권 사용 여부 | 필수 | 무료 | data.go.kr 자동승인 | 확인됨 |
| 4 | 오피스텔·연립다세대·단독다가구 매매/전월세 실거래가 (국토교통부, 15126464 외) | 아파트 외 매물 | 나중 | 무료 | data.go.kr 자동승인 | 확인됨 |
| 5 | 공동주택 단지 목록 (국토교통부 K-apt, 15057332) | 법정동/시군구 → 단지코드(kaptCode) 목록 | 필수 | 무료 | data.go.kr 자동승인 | 확인됨 |
| 6 | 공동주택 기본정보 (국토교통부 K-apt, 15058453) | 단지 세대수·동수·사용승인일·난방·주차·인근 지하철/교육시설 | 필수 | 무료 | data.go.kr 자동승인 | 확인됨 |
| 7 | 건축HUB 건축물대장 (국토교통부, 15134735) | 매물 상세의 용도·구조·층·면적·사용승인일·내진설계 사실 확인 | 필수 | 무료 | data.go.kr 자동승인 | 확인됨 |
| 8 | 공동주택가격 속성조회 (VWorld 국가중점데이터, data.go.kr 15124003은 링크) | 공시가격(세금·대출 참고) | 권장 | 무료 | VWorld 인증키 | 확인됨 |
| 9 | 토지이용계획 속성조회 (VWorld) / 토지이용규제 행위제한 (국토교통부, 15058410) | 용도지역·지구, 행위제한 | 나중 | 무료 | VWorld 키 / data.go.kr | 확인됨 |
| 10 | 법정동코드 (행정안전부, 15077871) 또는 code.go.kr 전체자료 파일 | `LAWD_CD`(앞 5자리), 건축물대장 `sigunguCd`/`bjdongCd` | 필수 | 무료 | data.go.kr 자동승인 / 파일은 키 불필요 | 확인됨 |
| 11 | 도로명주소 검색 API (행정안전부, business.juso.go.kr) | 매물·고객 주소 표준화, 행정구역코드·도로명코드 확보 | 필수 | 무료 | juso.go.kr 신청 (API별 승인키) | 확인됨 |
| 12 | 좌표제공 검색 API (행정안전부, business.juso.go.kr) | 매물 좌표 (UTM-K → WGS84 변환 필요) | 필수 | 무료 | juso.go.kr 신청 (별도 승인키) | 확인됨 |
| 13 | VWorld Geocoder 2.0 / WMS·WFS (국토교통부) | 지오코딩(저장 금지), 지적·용도지역 지도 레이어 | 권장 | 무료 | VWorld 인증키 | 확인됨 |
| 14 | 카카오 로컬 API (카카오) | 매물 주변 지하철역·학교·학원·병원 등 거리 검색 | 권장 | 무료 쿼터 후 유료 | 카카오 디벨로퍼스 REST API 키 | 확인됨 (저장·표시 조건은 확인 필요) |
| 15 | TAGO 지하철정보 (국토교통부, 15098554) | 역 출구별 주변시설·시간표 | 나중 | 무료 | data.go.kr 자동승인 | 확인됨 (역 좌표 제공 여부는 확인 필요) |
| 16 | 서울교통공사 1~8호선 역사 좌표 (15099316) / 서울시 지하철역 좌표정보 (15171250) | 역 좌표를 DB에 적재 (역세권 계산) | 권장 | 무료 | 파일 다운로드 (키 불필요) | 확인됨 |
| 17 | NEIS 학교기본정보 (교육부, open.neis.go.kr) | 학교명·주소·설립·남녀공학 | 권장 | 무료 | NEIS 포털 인증키 (즉시 발급) | 확인됨 |
| 18 | 학구도(초등 통학구역·중학교 학군 등) (한국교육시설안전원, 15159265 외) | "이 매물은 어느 초등학교 배정?" | 권장 | 무료 | 파일 다운로드 (SHP/CSV, API 없음) | 확인됨 |
| 19 | 국가법령정보 공동활용 (법제처, open.law.go.kr) | 법령 검색·본문·조문 → RAG 근거 | 필수 | 무료 | open.law.go.kr 회원가입 후 활용신청, 담당자 승인 (1~2일) | 확인됨 (OC 값 의미는 확인 필요) |
| 20 | R-ONE 부동산통계 Open API (한국부동산원) | 주간/월간 가격동향, 전세가격지수 | 권장 | 무료 | R-ONE 로그인 후 인증키 | 확인됨 (호출 한도·통계표 ID는 확인 필요) |
| 21 | 네이버 검색 API 뉴스 (네이버 → NAVER API HUB) | 관련 뉴스 링크 목록 표시만 | 나중 (조건부) | 확인 필요 | 신규는 NCP NAVER API HUB (날짜는 확인 필요) | 일부 확인 (**LLM 입력 금지 조항은 신청 전 약관 원문으로 재확인**, 4-20 검토 메모) |
| 22 | BigKinds API (한국언론진흥재단) | 뉴스 본문 일부(분석용) | 나중 | 확인 필요 | 공개 신청 경로 확인 안 됨 | 확인 필요 |
| 23 | 한국주택금융공사 금리 API (u-보금자리론 15082039, 디딤돌 15082028) | 정책대출 금리 표시 | 나중 | 무료 | data.go.kr 자동승인 | 확인됨 (자격 조건 API는 없음) |
| 24 | 등기부(등기사항증명서) | 권리관계 확인 | 나중 (유료·선택) | 공식 API 없음, 제3자 유료 | — | 공식 API 없음 확인 / 제3자 조건은 확인 필요 |
| 25 | Anthropic Messages API | 질문 답변 LLM (도구 호출, 인용) | 필수 | 유료 (요금 페이지) | console 키 | 확인됨 |
| 26 | Voyage AI 임베딩 (MongoDB Atlas) | 문서 청크 임베딩 | 권장 (택1) | 유료 (요금 페이지) | Atlas model API key | 확인됨 |
| 27 | OpenAI text-embedding-3 / 로컬 bge-m3 | 임베딩 대안 | 대안 | OpenAI 유료 / bge-m3 무료(자체 서버) | OpenAI 키 / 없음 | 확인됨 |

---

## 2. 지금 바로 신청할 것 (순서대로)

data.go.kr 키 하나로 여러 API를 쓰지만, **API마다 따로 "활용신청"을 눌러야 그 API가 열린다.** 아래 1~6번은 같은 키(`DATA_GO_KR_SERVICE_KEY`)를 쓴다.

1. [ ] **data.go.kr 활용신청 (자동승인)** — 키는 이미 있음: `DATA_GO_KR_SERVICE_KEY`
   - 아파트 매매 실거래가: https://www.data.go.kr/data/15126469/openapi.do (현재 코드가 호출하는 API)
   - 아파트 매매 실거래가 상세: https://www.data.go.kr/data/15126468/openapi.do
   - 아파트 전월세 실거래가: https://www.data.go.kr/data/15126474/openapi.do
   - 공동주택 단지 목록: https://www.data.go.kr/data/15057332/openapi.do
   - 공동주택 기본정보: https://www.data.go.kr/data/15058453/openapi.do
   - 건축HUB 건축물대장: https://www.data.go.kr/data/15134735/openapi.do
   - 법정동코드: https://www.data.go.kr/data/15077871/openapi.do
2. [ ] **도로명주소 검색 API + 좌표제공 검색 API** — https://business.juso.go.kr/jst/jstAddressApiList 에서 각각 "신청하기". 승인키가 API별로 따로 나온다.
   - `JUSO_API_KEY` (검색 API)
   - `JUSO_COORD_API_KEY` (좌표제공 API) ← 새로 제안. 검색 키로는 좌표 API를 쓸 수 없다는 오류 안내(E0001)가 있다.
3. [ ] **국가법령정보 공동활용** — https://open.law.go.kr 회원가입 → OPEN API 신청. 담당자 승인까지 1~2일. 호출 서버 IP 등록 메뉴가 있으니 서버 공인 IP를 준비한다.
   - `LAW_OC`
4. [ ] **VWorld 인증키** — https://www.vworld.kr/dev/v4api.do → 인증키 발급(로그인 필요). 발급 시 입력한 도메인과 실제 호출 도메인이 다르면 `INCORRECT_KEY`.
   - `VWORLD_API_KEY`
5. [ ] **카카오 로컬** — https://developers.kakao.com 앱 생성 → [카카오맵] 사용 설정 ON → REST API 키. 무료 쿼터는 계정의 **첫 번째로 활성화한 앱**에만 준다.
   - `KAKAO_REST_API_KEY`
6. [ ] **NEIS 교육정보 개방 포털** — https://open.neis.go.kr/portal/guide/actKeyPage.do (포털 계정 로그인, 즉시 발급)
   - `NEIS_API_KEY`
7. [ ] **R-ONE 부동산통계** — https://www.reb.or.kr/r-one/portal/openapi/openApiIntroPage.do → 인증키 발급(로그인 필요)
   - `REB_API_KEY`
8. [ ] **Anthropic** — 키는 이미 있음: `ANTHROPIC_API_KEY`
9. [ ] **임베딩 (하나만 고른 뒤)** — Voyage를 고르면 MongoDB Atlas → AI Model APIs → Create model API key
   - `VOYAGE_API_KEY` (OpenAI를 고르면 `OPENAI_API_KEY`, bge-m3 로컬이면 키 없음)
10. [ ] **파일 내려받기 (키 불필요)** — 학구도 SHP/CSV(https://www.data.go.kr/data/15159265/fileData.do, 15159266), 역사 좌표 CSV(15099316, 15171250), 법정동코드 전체자료(https://www.code.go.kr/stdcode/regCodeL.do)
11. [ ] **보류** — 네이버 뉴스는 약관 문제(4-20절)를 먼저 정한 뒤 신청한다: `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`

`.env` 예시:

```dotenv
DATA_GO_KR_SERVICE_KEY=   # data.go.kr (Decoding 키 권장, 4-1 주의사항 참조)
ANTHROPIC_API_KEY=
JUSO_API_KEY=             # 도로명주소 검색 API 승인키
JUSO_COORD_API_KEY=       # 좌표제공 검색 API 승인키 (별도)
LAW_OC=                   # 법제처 OPEN API 인증값
VWORLD_API_KEY=
KAKAO_REST_API_KEY=
NEIS_API_KEY=
REB_API_KEY=
VOYAGE_API_KEY=           # 임베딩을 Voyage로 정한 경우
NAVER_CLIENT_ID=          # 보류
NAVER_CLIENT_SECRET=      # 보류
```

---

## 3. 원래 설계 문서(`index.html` "공개데이터 활용 설계")의 데이터셋 ID 점검

| 설계 문서 ID | 설계상 이름 | 실제 (2026-10-30 확인) | 조치 |
|---|---|---|---|
| 15126468 | 아파트 매매 | **"아파트 매매 실거래가 상세 자료"**, 엔드포인트 `RTMSDataSvcAptTradeDev` | **틀림.** 현재 코드가 부르는 `RTMSDataSvcAptTrade`는 **15126469**이다. `backend/app/public_data.py`의 `TRADE_SOURCE` 출처 문구("15126468")도 15126469로 바꿔야 한다 (이번 작업에서는 코드 수정 안 함). |
| 15126474 | 전월세 | 아파트 전월세 실거래가 자료, `RTMSDataSvcAptRent` | 맞음 |
| 15058453 | 공동주택 기본정보 | 공동주택 기본 정보제공 서비스 `AptBasisInfoServiceV5` | 맞음. 단, 입력값 `kaptCode`를 얻으려면 **단지 목록 15057332가 추가로 필요**하다 (설계에 빠져 있음) |
| 15134735 | 건축물대장 | 건축HUB 건축물대장정보 서비스 `BldRgstHubService` | 맞음 |
| 15058805 | WMS/WFS | 공간정보오픈플랫폼(WMS/WFS), 공공누리 제1유형(출처표시) | 맞음. 단 data.go.kr 키로 호출하지 않는다. 실제 호출은 VWorld 키로 `api.vworld.kr`에 한다 |
| 15057358 | 현행법령 본문 | 법제처 현행법령 본문 조회, API 유형 **LINK** | 맞음. 단 LINK형이라 data.go.kr 키로는 못 부른다. open.law.go.kr에서 따로 신청(`OC`)해야 한다 |
| 15098554 | 지하철 정보 (TAGO) | (TAGO) 지하철정보 `SubwayInfo`, 오퍼레이션 4개(역 검색, 출구별 버스노선, 출구별 주변시설, 시간표) | 존재함. 단 **역 좌표가 명세에 없다.** 역 위치는 15099316/15171250 파일이 더 적합하다 |

---

## 4. API별 상세

### 4-1. 공공데이터포털(data.go.kr) 공통 사항

- 신청: 각 데이터셋 페이지의 "활용신청". 조사한 국토교통부·행정안전부 API는 모두 **개발단계 자동승인**이다. 운영단계는 "자동승인 신청 가능" 또는 "심의승인 신청 가능"으로 표시된다.
- 트래픽: 대부분 **개발계정 일 10,000건**. 운영계정은 "활용사례 등록시 신청하면 트래픽 증가 가능". 예외: 공동주택 단지목록·기본정보는 개발 5,000, 토지이용규제·HF 금리 API는 개발 1,000.
- 오류코드(포털 공통 안내, 15077871 페이지): `22` 일일 호출량 초과, `23` 초당 호출량 초과, `20` 키 누락/권한 없음, `29` 차단 IP, `12` 서비스 없음/폐기.
- 출처 표시: 조사한 국토교통부 실거래가·K-apt·건축HUB는 "이용허락범위 제한 없음". 공간정보 WMS/WFS(15058805)와 서울시 파일 데이터는 "공공저작물 출처표시". 그래도 고객 자료에는 데이터셋 이름과 조회일을 항상 적는다.
- **주의 (Encoding/Decoding 키):** 포털 명세는 `serviceKey`를 "URL 인코딩된 인증키"로 적는다. 우리 코드처럼 `httpx`의 `params=`로 넘기면 라이브러리가 다시 인코딩한다. 이중 인코딩을 피하려면 **디코딩된 원문 키**를 `.env`에 넣는다. 포털 마이페이지에 Encoding/Decoding 두 형태가 표시된다는 점은 공식 FAQ 문구로 확인하지 못했다(**확인 필요**). 키 오류(`SERVICE_KEY_IS_NOT_REGISTERED_ERROR`, 코드 30)가 나면 다른 형태로 바꿔 시험한다.
- **주의 (XML 기본):** 실거래가 API는 XML만 표시된다. 건축HUB는 `_type=json` 가능(생략 시 XML). K-apt는 JSON.

### 4-2. 아파트 매매 실거래가 (15126469), 현재 코드가 쓰는 API

- 신청 페이지: https://www.data.go.kr/data/15126469/openapi.do
- 요청 URL: `GET https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade`
- 인증: 쿼리 파라미터 `serviceKey`
- 요청 파라미터(명세상 필수 3개): `serviceKey`, `LAWD_CD`(법정동코드 앞 5자리, 예 11440 마포구), `DEAL_YMD`(계약년월 6자리, 예 202609). 코드가 보내는 `pageNo`, `numOfRows`는 이 데이터셋 명세 목록에 없다(상세 15126468에는 필수로 있음). 동작 여부와 `numOfRows` 최대값은 **확인 필요**. `totalCount`를 보고 페이지를 넘기도록 만든다.
- 응답 필드: `sggCd`(지역코드), `umdNm`(법정동), `aptNm`(단지명), `jibun`, `excluUseAr`(전용면적), `dealYear`/`dealMonth`/`dealDay`, `dealAmount`(거래금액, 만원, 쉼표 포함), `floor`, `buildYear`, `cdealType`(해제여부), `cdealDay`(해제사유발생일), `dealingGbn`(중개/직거래), `estateAgentSggNm`(중개사 소재지 시군구), `rgstDate`(등기일자), `aptDong`(동), `slerGbn`/`buyerGbn`(매도자/매수자 구분), `landLeaseholdGbn`(토지임대부 여부)
- 호출 한도: 개발 10,000/일. 운영은 활용사례 등록 후 증설 신청
- 이용 조건: 이용허락범위 제한 없음, 무료. 갱신주기 "실시간"
- 승인: 개발·운영 자동승인
- 중개메이트에서 쓰는 곳: 질문 답변(`get_trades`), 매물 상세의 "최근 실거래", 고객 자료의 시세 근거표
- 주의사항:
  - **월 단위 조회**다. "최근 1년 흐름"은 구 하나에 12번 호출한다. 결과를 DB에 쌓고(현재 `apt_trades` 테이블) 질문 시에는 DB를 읽는다.
  - `LAWD_CD`는 10자리 법정동코드의 **앞 5자리**(시군구)다. 동 단위 필터는 응답의 `umdNm`으로 한다.
  - **해제 거래**: `cdealType`이 채워진 건은 계약이 해제된 거래다. 시세 계산에서 빼야 한다. 현재 `parse_trades`는 이 필드를 보지 않는다.
  - 개인정보 보호로 층만 공개된다. 동(`aptDong`)은 소유권 이전등기가 끝난 건에만 공개된다.
  - 단지 매칭: `aptNm` 문자열은 K-apt `kaptName`과 다를 수 있다. 정확히 맞추려면 상세 API(4-3)의 `aptSeq`·지번·도로명코드를 쓴다.

### 4-3. 아파트 매매 실거래가 상세 (15126468)

- 신청: https://www.data.go.kr/data/15126468/openapi.do
- 요청 URL: `GET https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev`
- 파라미터(모두 필수): `serviceKey`, `LAWD_CD`, `DEAL_YMD`, `pageNo`, `numOfRows`
- 응답 필드: 4-2의 필드에 더해 `umdCd`(법정동 읍면동코드), `landCd`, `bonbun`, `bubun`, `roadNm`, `roadNmSggCd`, `roadNmCd`, `roadNmSeq`, `roadNmbCd`, `roadNmBonbun`, `roadNmBubun`, `aptSeq`(단지 일련번호)
- 한도·조건·승인: 4-2와 같다 (개발 10,000/일, 제한 없음, 자동승인)
- 쓰는 곳: 실거래를 단지·건축물대장과 정확히 연결한다 (도로명코드 → 도로명주소 API, 본번/부번 → 건축물대장 `bun`/`ji`)
- 주의: 매매만 상세판이 있다. 전월세는 4-4 하나다. 필드가 4-2의 상위 집합이므로 4-2 대신 이것만 써도 된다.

### 4-4. 아파트 전월세 실거래가 (15126474)

- 신청: https://www.data.go.kr/data/15126474/openapi.do
- 요청 URL: `GET https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent`
- 파라미터: `serviceKey`, `LAWD_CD`, `DEAL_YMD` (`pageNo`/`numOfRows`는 4-2와 같은 이유로 **확인 필요**)
- 응답 필드: `sggCd`, `umdNm`, `aptNm`, `jibun`, `excluUseAr`, `dealYear`/`dealMonth`/`dealDay`, `deposit`(보증금, 만원), `monthlyRent`(월세, 만원; 0이면 전세), `floor`, `buildYear`, `contractTerm`(계약기간), `contractType`(신규/갱신), `useRRRight`(갱신요구권 사용), `preDeposit`, `preMonthlyRent`(종전 계약)
- 한도·조건·승인: 개발 10,000/일, 제한 없음, 자동승인
- 쓰는 곳: 질문 답변("전세가율", "갱신 계약 비중"), 매물 상세의 전세 시세
- 주의: 확정일자 자료도 포함된다(명세 설명). 동/호는 제공하지 않는다.

### 4-5. 오피스텔·연립다세대·단독다가구 (선택)

모두 같은 형태(`serviceKey`, `LAWD_CD`, `DEAL_YMD`), XML, 개발 10,000/일, 자동승인, 제한 없음.

| 데이터셋 | ID | 요청 URL |
|---|---|---|
| 오피스텔 매매 | 15126464 | `https://apis.data.go.kr/1613000/RTMSDataSvcOffiTrade/getRTMSDataSvcOffiTrade` |
| 오피스텔 전월세 | 15126475 | `https://apis.data.go.kr/1613000/RTMSDataSvcOffiRent/getRTMSDataSvcOffiRent` |
| 연립다세대 매매 | 15126467 | 서비스 URL `https://apis.data.go.kr/1613000/RTMSDataSvcRHTrade2`. 명세에 `getRTMSDataSvcRHTrade2`와 `getRTMSDataSvcRHTrade` 두 경로가 보인다. 어느 쪽이 현행인지 **확인 필요** |
| 연립다세대 전월세 | 15126473 | `https://apis.data.go.kr/1613000/RTMSDataSvcRHRent/getRTMSDataSvcRHRent` |
| 단독/다가구 매매 | 15126465 | `https://apis.data.go.kr/1613000/RTMSDataSvcSHTrade/getRTMSDataSvcSHTrade` |
| 단독/다가구 전월세 | 15126472 | `https://apis.data.go.kr/1613000/RTMSDataSvcSHRent/getRTMSDataSvcSHRent` |

오피스텔 매매 응답에는 단지명이 `aptNm` 대신 `offiNm`으로 온다.

### 4-6. 공동주택 단지 목록 (K-apt, 15057332)

- 신청: https://www.data.go.kr/data/15057332/openapi.do
- 서비스 URL: `https://apis.data.go.kr/1613000/AptListService4`
- 오퍼레이션: `/getSidoAptList4`, `/getSigunguAptList4`(`sigunguCode` 필수), `/getLegaldongAptList4`(`bjdCode` 필수, 시군구+법정동), `/getRoadnameAptList4`, `/getTotalAptList4`
- 공통 파라미터: `serviceKey`(필수), `pageNo`, `numOfRows`
- 응답 필드: `bjdCode`(법정동코드 10자리), `kaptCode`(단지코드), `kaptName`, `as1`~`as4`(시도/시군구/읍면동/리)
- 한도: 개발 **5,000**/일. 자동승인. 제한 없음. JSON
- 쓰는 곳: 매물 등록 시 단지 선택, 단지 정보 캐시의 키(`kaptCode`)
- 주의: 공동주택관리정보시스템에 가입한 단지만 나온다(명세 설명). 소규모 단지는 없을 수 있다.

### 4-7. 공동주택 기본정보 (K-apt, 15058453)

- 신청: https://www.data.go.kr/data/15058453/openapi.do
- 서비스 URL: `https://apis.data.go.kr/1613000/AptBasisInfoServiceV5`
- 오퍼레이션: `/getAphusBassInfoV5`(기본), `/getAphusDtlInfoV5`(상세). 파라미터는 둘 다 `serviceKey`, `kaptCode`
- 기본 응답 필드: `kaptName`, `kaptAddr`, `doroJuso`, `bjdCode`, `codeSaleNm`(분양형태), `codeHeatNm`(난방), `kaptTarea`(연면적), `kaptDongCnt`(동수), `kaptdaCnt`(세대수), `hoCnt`, `kaptBcompany`(시공사), `kaptAcompany`(시행사), `kaptTel`, `codeHallNm`(복도유형), `kaptUsedate`(사용승인일), `kaptMparea60`/`85`/`135`/`136`(전용면적별 세대현황), `kaptTopFloor`, `kaptBaseFloor`, `kaptdEcntp`(승강기)
- 상세 응답(명세 설명): 관리방식, 경비·청소, 건물구조, 주차대수(지상/지하), CCTV, 부대·복리시설, 버스정류장 거리, **지하철 호선/역명/거리**, 편의시설, **교육시설**, 지하 전기차 충전대수
- 한도: 개발 **5,000**/일. 자동승인. 제한 없음. JSON. 갱신주기 "실시간"
- 쓰는 곳: 매물 상세의 단지 정보, 고객 자료의 비교표, 질문 답변(`get_complex_info`)
- 주의: 단지 정보는 자주 안 바뀐다. **DB에 캐시**하고 월 1회 정도 갱신한다. 지하철·교육시설 거리는 단지 측 입력값이므로 출처를 "K-apt 단지 입력값"으로 표시한다.

### 4-8. 건축HUB 건축물대장 (15134735)

- 신청: https://www.data.go.kr/data/15134735/openapi.do
- 서비스 URL: `https://apis.data.go.kr/1613000/BldRgstHubService`
- 오퍼레이션: `/getBrTitleInfo`(표제부), `/getBrRecapTitleInfo`(총괄표제부), `/getBrBasisOulnInfo`(기본개요), `/getBrFlrOulnInfo`(층별개요), `/getBrExposPubuseAreaInfo`(전유공용면적, `dongNm`/`hoNm` 추가), `/getBrExposInfo`(전유부), `/getBrHsprcInfo`(주택가격), `/getBrJijiguInfo`(지역지구구역), `/getBrAtchJibunInfo`(부속지번), `/getBrWclfInfo`(오수정화시설)
- 파라미터: `serviceKey`·`sigunguCd`(시군구코드)·`bjdongCd`(법정동코드) 필수. 선택: `platGbCd`(0 대지/1 산/2 블록), `bun`, `ji`, `startDate`/`endDate`(YYYYMMDD), `_type`(xml|json), `numOfRows`, `pageNo`
- 표제부 주요 응답 필드: `platPlc`/`newPlatPlc`(지번/도로명 대지위치), `bldNm`, `dongNm`, `mainPurpsCdNm`(주용도), `strctCdNm`(구조), `grndFlrCnt`/`ugrndFlrCnt`, `hhldCnt`(세대수), `platArea`, `archArea`, `totArea`, `bcRat`(건폐율), `vlRat`(용적률), `useAprDay`(사용승인일), `rserthqkDsgnApplyYn`(내진설계 적용), `rideUseElvtCnt`, 주차 대수 필드들, `mgmBldrgstPk`
- 주택가격 응답 필드: `hsprc`(주택가격), `stdDay`(기준일자)
- 한도: 개발 10,000/일. 자동승인. 제한 없음. **월간** 갱신
- 쓰는 곳: 매물 상세의 "건축물대장 확인" 항목, 질문 답변("A 매물 계약할 때 주의할 점"), 고객 자료
- 주의사항:
  - 10자리 법정동코드를 앞 5자리 `sigunguCd`와 뒤 5자리 `bjdongCd`로 나눈다. `bun`/`ji`의 자리수(0을 채운 4자리인지)는 **확인 필요**.
  - 명세 설명에 따르면 건축HUB 이관으로 **건축데이터 PK가 바뀌었다**. 옛 PK를 저장했다면 첨부된 전환 규칙을 따른다.
  - 위반건축물 여부를 주는 필드는 이번 명세에서 찾지 못했다(**확인 필요**). 계약 주의사항 답변에서는 대장 원본(정부24 발급) 확인을 안내한다.
  - `getBrHsprcInfo`의 "주택가격"이 개별주택가격인지 공동주택가격인지 명세 설명만으로는 판단하지 못했다(**확인 필요**). 공동주택 공시가격은 4-9를 쓴다.

### 4-9. 공동주택가격 속성조회 (VWorld, data.go.kr 15124003은 링크)

- 신청: VWorld 인증키(4-13). data.go.kr 15124003은 API 유형 "LINK"이고 운영단계는 "심의승인"으로 표시된다.
- 요청 URL: `GET https://api.vworld.kr/ned/data/getApartHousingPriceAttr`
- 파라미터: `key`(필수), `pnu`(필수, 고유번호 8자리 이상), `stdrYear`(기준연도), `dongNm`, `hoNm`, `format`(xml|json), `numOfRows`(최대 1000), `pageNo`, `domain`
- 응답 필드: `pnu`, `ldCode`, `ldCodeNm`, `mnnmSlno`(지번), `stdrYear`, `stdrMt`, `aphusCode`, `aphusSeCodeNm`(아파트 등), `aphusNm`(공동주택명), `dongNm`, `floorNm`, `hoNm`, `prvuseAr`(전용면적), `pblntfPc`(공시가격, 원), `lastUpdtDt`
- 한도: VWorld 페이지에 "제공가능 트래픽 999,999,999"(오퍼레이션별 하루)로 표시된다. 공시기준일은 매년 1월 1일(data.go.kr 설명)
- 쓰는 곳: 매물 상세의 공시가격, 질문 답변(보유세·대출 한도 질문의 참고값)
- 주의: `pnu`는 필지고유번호다. 우리 주소 데이터에서 PNU를 만드는 규칙(자리 구성)은 VWorld 컬럼정의서로 확인한다(**확인 필요**). 호 단위 공시가격은 소유자 재산 정보에 가까우므로 고객 자료에 넣을 때 주의한다.

### 4-10. 토지이용계획 / 토지이용규제 (나중)

- **VWorld 토지이용계획 속성조회**: `GET https://api.vworld.kr/ned/data/getLandUseAttr`
  - 파라미터: `key`, `pnu`(필수), `cnflcAt`(1 포함/2 저촉/3 접합), `prposAreaDstrcCodeNm`, `format`, `numOfRows`(최대 1000), `pageNo`, `domain`
  - 응답: `prposAreaDstrcCode`/`prposAreaDstrcCodeNm`(용도지역지구 코드/명, 예 UQP110 아파트지구), `cnflcAtNm`, `registDt`, `lastUpdtDt`
- **국토교통부 토지이용규제정보서비스 (15058410)**: 서비스 URL `https://apis.data.go.kr/1613000/arLandUseInfoService`
  - `/DTarLandUseInfo`(행위제한): `serviceKey`, `areaCd`(시군구코드), `ucodeList`(지역지구코드), `landUseNm`(토지이용행위명) 모두 필수. 응답 `UNAME`, `actRegList`(행위, 가능여부, 조건·예외), 참조 법령조항
  - `/DTsearchLunCd`(토지이용행위 조회)
  - 한도: 개발 **1,000**/일, 자동승인
- 아파트 중심 MVP에서는 쓸 일이 적다. 상가·토지 매물을 다루게 되면 쓴다.

### 4-11. 법정동코드 (행정안전부, 15077871 / code.go.kr)

- 신청: https://www.data.go.kr/data/15077871/openapi.do (자동승인, 개발 10,000/일)
- 요청 URL: `GET https://apis.data.go.kr/1741000/StanReginCd/getStanReginCdList`
- 파라미터: `ServiceKey`(필수), `pageNo`(필수), `numOfRows`(필수), `type`(xml|json), `locatadd_nm`(지역주소명, 예 "서울특별시 마포구")
- 응답 필드: `region_cd`(10자리), `sido_cd`, `sgg_cd`, `umd_cd`, `ri_cd`, `locatadd_nm`, `locallow_nm`, `locathigh_cd`, `adpt_de`(생성일)
- 파일 대안: 행정표준코드관리시스템 https://www.code.go.kr/stdcode/regCodeL.do 의 "법정동 코드 전체자료" 버튼 (파일 형식은 페이지에 표시되지 않음)
- 쓰는 곳: `LAWD_CD`(앞 5자리), 건축물대장 `sigunguCd`+`bjdongCd`, K-apt `bjdCode`
- 주의: 코드는 거의 안 바뀐다. **한 번 받아 DB 테이블로 둔다.** 폐지된 코드를 어떻게 구분하는지는 기술문서로 확인한다(**확인 필요**). 현재 코드의 `LAWD` 딕셔너리(4개 구)를 이 테이블로 대체한다.

### 4-12. 도로명주소 검색 API / 좌표제공 검색 API (행정안전부, business.juso.go.kr)

**검색 API**

- 신청: https://business.juso.go.kr/jst/jstAddressApiList → "도로명주소 / 검색 API" 신청하기. 신청서에 시스템 URL(IP), 서비스망(인터넷/행정망), 서비스 용도, 신청 사유를 적는다.
- 요청 URL: `GET|POST https://business.juso.go.kr/addrlink/addrLinkApi.do` (JSONP는 `addrLinkApiJsonp.do`)
- 인증: `confmKey` 파라미터
- 파라미터: `confmKey`(필수), `currentPage`(필수, 기본 1), `countPerPage`(필수, 기본 10; 샘플 소스 주석상 0 < n <= 100), `keyword`(필수), `resultType`(xml|json, 기본 xml), `hstryYn`(변동 주소 포함, 기본 N), `firstSort`(none|road|location), `addInfoYn`(기본 N)
- 응답 필드: `roadAddr`, `roadAddrPart1`, `roadAddrPart2`, `jibunAddr`, `engAddr`, `zipNo`, **`admCd`(행정구역코드)**, **`rnMgtSn`(도로명코드)**, `bdMgtSn`(건물관리번호), `bdNm`, `bdKdcd`(1 공동주택/0 비공동주택), `siNm`, `sggNm`, `emdNm`, `liNm`, `rn`, **`udrtYn`**, **`buldMnnm`**, **`buldSlno`**, `mtYn`, `lnbrMnnm`, `lnbrSlno`
- 오류: `E0001` 승인되지 않은 키, `E0005`~`E0013` 검색어 형식 오류(두 글자 미만, 숫자만, 한글 40자/영문 80자 초과, SQL 예약어 등), `E0014` **개발승인키 기간 만료**, `E0015` 검색 결과 9천 건 초과
- 호출 한도: 공식 페이지에서 숫자를 찾지 못함(**확인 필요**). 좌표 API 오류 `E0007`("짧은 시간동안 다량의 주소검색 요청")이 있으니 일괄 처리 때는 속도를 낮춘다.
- 승인 절차·소요: 신청서 검토 방식. 소요 기간은 공식 안내를 찾지 못함(**확인 필요**). 개발승인키는 기한이 있다(`E0014`). 기한 길이는 **확인 필요**.
- 쓰는 곳: 매물 등록·고객 희망지역 입력 시 주소 표준화. 결과의 `admCd`/`rnMgtSn`/`udrtYn`/`buldMnnm`/`buldSlno`를 저장해 두면 좌표 API를 바로 부를 수 있다.
- 주의: 상세주소(동·호)는 사용자가 따로 입력하도록 구현해야 한다(공식 안내).

**좌표제공 검색 API**

- 신청: 같은 목록에서 "좌표제공 / 검색 API" 신청하기 (`uniqKey=cntcInfoCoordApi`). **검색 API 키와 별도 키**다.
- 요청 URL: `GET|POST https://business.juso.go.kr/addrlink/addrCoordApi.do`
- 파라미터: `confmKey`, `admCd`, `rnMgtSn`, `udrtYn`, `buldMnnm`(이상 필수), `buldSlno`, `resultType`
- 응답 필드: `admCd`, `rnMgtSn`, `bdMgtSn`, `udrtYn`, `buldMnnm`, `buldSlno`, **`entX`, `entY`**(출입구 좌표), `bdNm`
- 좌표계: 공식 Tech&Tips 글이 제공 좌표를 **EPSG:5179(UTM-K, GRS80)**로 보고 WGS84 변환 예제를 싣고 있다. Leaflet 지도에 찍으려면 pyproj 등으로 EPSG:4326 변환이 필요하다.
- 쓰는 곳: 매물 좌표를 **DB에 저장**하는 기본 경로로 권장 (VWorld 지오코더는 저장 금지, 4-13)
- 주의 (이용 조건, **확인 필요**): juso 개발자 게시판의 질문들이 자료제공 "안내사항"에 (가) 비공개·공개제한 시설 좌표 표시 금지, (나) 데이터 국외 반출 금지 조항이 있다고 인용한다. 원문은 이번에 확인하지 못했다. 서버·DB를 국내 리전에 두는지 확인하고, 원문 조항을 읽은 뒤 운영한다.

### 4-13. VWorld (국토교통부 공간정보 오픈플랫폼)

- 신청: https://www.vworld.kr/dev/v4api.do → 인증키 발급(로그인 필요). 키에 도메인이 묶인다. 키 유효기간·연장 규칙은 공식 페이지에서 찾지 못함(**확인 필요**).
- 라이선스: VWorld 저작권정책상 공공누리 **제1유형(출처표시)**. data.go.kr 15058805도 같은 표시.

**Geocoder API 2.0**

- 요청 URL: `GET https://api.vworld.kr/req/address?service=address&request=getCoord&key=...`
- 파라미터: `request=getCoord`(필수), `key`(필수), `type`(필수, `ROAD` 도로명 | `PARCEL` 지번), `address`(필수), `crs`(기본 EPSG:4326; EPSG:5179 등 지원), `refine`(기본 true), `simple`, `format`(json|xml), `errorFormat`, `callback`
- 응답: `status`(OK/NOT_FOUND/ERROR), `refined.text`, `refined.structure`(level0~5, detail), `result.crs`, `result.point.x`/`y`
- 한도: "일일 지오코딩 요청건수는 최대 40,000건". 초과 시 `OVER_REQUEST_LIMIT`
- **이용 조건(중요):** "API 요청은 실시간으로 사용하셔야 하며 별도의 저장장치나 데이터베이스에 저장할 수 없습니다." → **매물 좌표를 DB에 저장하는 용도로 쓰면 안 된다.** 화면에서 즉석 확인용으로만 쓴다.

**WMS / WFS**

- WMS: `https://api.vworld.kr/req/wms?key=...` 필수 `request`, `key`, `layers`, `bbox`, `width`, `height`. 선택 `service`(WMS), `version`(1.3.0), `styles`, `format`(image/png), `crs`(기본 EPSG:4326), `domain`
- WFS: `https://api.vworld.kr/req/wfs?key=...` `maxfeatures`/`count` 1~1000
- 레이어 예: `lt_c_adsido`(시도 경계), `lt_c_uq111`(도시지역), `lp_pa_cbnd_bonbun`/`lp_pa_cbnd_bubun`(연속지적도). 레이어 이름은 소문자. 한 번에 최대 4개 레이어
- 주의: EPSG:4326과 EPSG:5185~5188에서는 `bbox` 순서가 (ymin, xmin, ymax, xmax)다.
- 쓰는 곳: 지도 화면의 지적·용도지역 오버레이 (나중). 현재 지도는 Leaflet + OpenStreetMap 타일이다.

### 4-14. 카카오 로컬 API

- 신청: https://developers.kakao.com → 앱 생성 → [카카오맵] > [사용 설정] 상태 ON → REST API 키
- 인증 헤더: `Authorization: KakaoAK ${REST_API_KEY}`
- 엔드포인트 (모두 GET, `${FORMAT}`은 json|xml):
  - 주소 → 좌표: `https://dapi.kakao.com/v2/local/search/address.json` (`query` 필수, `analyze_type` similar|exact, `page` 1~45, `size` 1~30)
  - 키워드 장소 검색: `https://dapi.kakao.com/v2/local/search/keyword.json` (`query` 필수, `category_group_code`, `x`, `y`, `radius` 0~20000m, `rect`, `page` 1~45, `size` 1~15, `sort` accuracy|distance)
  - 카테고리 장소 검색: `https://dapi.kakao.com/v2/local/search/category.json` (`category_group_code` 필수, 나머지는 키워드 검색과 같음)
  - 좌표 → 행정구역: `/v2/local/geo/coord2regioncode.json` (응답 `region_type` H/B, `code`)
  - 좌표 → 주소: `/v2/local/geo/coord2address.json`
  - 좌표계 변환: `/v2/local/geo/transcoord.json` (WGS84, WTM, TM, UTM, KTM 등)
- 주요 응답 필드: 장소 `id`, `place_name`, `category_name`, `category_group_code`, `address_name`, `road_address_name`, `x`(경도), `y`(위도), `place_url`, `distance`(m, x/y를 줬을 때). 주소 검색은 `address.b_code`(법정동코드), `h_code`(행정동코드)
- 카테고리 코드: `SW8` 지하철역, `SC4` 학교, `AC5` 학원, `PS3` 어린이집·유치원, `MT1` 대형마트, `CS2` 편의점, `HP8` 병원, `PM9` 약국, `BK9` 은행, `PK6` 주차장, `CT1` 문화시설, `PO3` 공공기관, `AG2` 중개업소 등. **공원 코드는 없다** → 키워드 검색 `query=공원`으로 찾는다.
- 한도: 로컬류 REST API는 API별 **일 100,000건**, 전체 API 합산 **월 3,000,000건** 무료(페이지에 "변경될 수 있음"). 초과 시 429. 비즈월렛 연결·유료 API 설정 후 사용량 과금. 무료 쿼터는 개발자 계정의 첫 번째로 활성화한 앱에만 준다. 2026-07-21 이후 사용 방식과 무료 쿼터 제공 방식이 바뀌었다는 공지가 있다.
- 쓰는 곳: 질문 답변 `find_nearby`(가까운 역·학교·학원·병원), 매물 상세의 "주변 시설"
- 주의 (**확인 필요**): 결과를 DB에 저장해도 되는지, 카카오 지도가 아닌 지도(우리 Leaflet+OSM)에 표시해도 되는지, 출처 표기 방식은 개발 가이드 페이지에 없다. 카카오비즈니스 이용약관·운영정책을 읽고 정한다. 그 전까지는 **실시간 조회 후 화면에만 표시**하고 저장하지 않는다.

### 4-15. 지하철 (TAGO 15098554, 역사 좌표 파일)

**TAGO 지하철정보 (15098554)**

- 신청: https://www.data.go.kr/data/15098554/openapi.do (자동승인, 개발 10,000/일, 제한 없음, JSON+XML)
- 서비스 URL: `https://apis.data.go.kr/1613000/SubwayInfo` (오퍼레이션별 경로는 페이지에 없음, **확인 필요**)
- 오퍼레이션: 키워드 기반 지하철역 목록(`subwayStationName`), 출구별 버스노선, 출구별 주변 시설(`subwayStationId` 필수), 역별 시간표(`subwayStationId`, `dailyTypeCode` 01/02/03, `upDownTypeCode` U/D)
- 공통 파라미터: `serviceKey`, `pageNo`, `numOfRows`, `_type`
- 주의: **역 좌표 필드가 명세에 없다.** 역세권 거리 계산에는 아래 파일을 쓴다.

**역 좌표 파일 (권장)**

| 데이터 | ID | 형식 | 갱신 | 라이선스 |
|---|---|---|---|---|
| 서울교통공사 1~8호선 역사 좌표(위경도) | 15099316 | CSV, 276개 역 | 연간 | 이용허락범위 제한 없음 |
| 서울교통공사 9호선 2·3단계 역사 좌표 | 15099317 | CSV | **확인 필요** | **확인 필요** |
| 서울특별시 지하철역 좌표정보 | 15171250 | CSV (역명, 호선, X/Y 좌표) | 수시 | 공공저작물 출처표시 |

- 쓰는 곳: DB에 `stations` 테이블로 적재 → 매물 좌표와 직선거리 계산 → 질문 답변 "역세권" 조건, 매물 상세
- 주의: 15171250의 X/Y 좌표계는 페이지 설명에 없다(**확인 필요**). 서울교통공사 파일 설명에는 정기 갱신이 어렵다는 단서가 있다. 실제 도보시간은 경로 계산이 필요하며, 직선거리로 "도보 n분"이라고 쓰지 않는다.

### 4-16. NEIS 학교기본정보 (교육부, open.neis.go.kr)

- 신청: https://open.neis.go.kr/portal/guide/actKeyPage.do (구글·네이버·다음 등 포털 계정으로 로그인, **신청 즉시 발급**). data.go.kr 15122275는 LINK형 안내 페이지다.
- 요청 URL: `GET https://open.neis.go.kr/hub/schoolInfo`
- 기본 인자: `KEY`(필수), `Type`(xml|json), `pIndex`(기본 1), `pSize`(기본 100). 키가 없으면 샘플 5건만 나온다.
- 신청 인자(선택): `ATPT_OFCDC_SC_CODE`(시도교육청코드), `SD_SCHUL_CODE`(행정표준코드), `SCHUL_NM`, `SCHUL_KND_SC_NM`(학교종류), `LCTN_SC_NM`(시도명), `FOND_SC_NM`(설립명)
- 응답 필드: `SD_SCHUL_CODE`, `SCHUL_NM`, `SCHUL_KND_SC_NM`, `FOND_SC_NM`, `COEDU_SC_NM`(남녀공학), `ORG_RDNMA`/`ORG_RDNDA`(도로명주소), `ORG_RDNZC`, `ORG_TELNO`, `HMPG_ADRES`, `HS_SC_NM`, `FOND_YMD`, `LOAD_DTM`
- 한도: 키 사용 시 일일 한도는 공식 페이지에서 찾지 못함(**확인 필요**). 적재 주기 매주. 이용허락범위 제한 없음
- 쓰는 곳: 학교 마스터 테이블(주 1회 적재), 질문 답변 "근처 초등학교"
- 주의: **좌표가 없다.** 주소를 4-12 좌표 API로 변환해 저장하거나, 학구도 데이터의 "초중고 학교 위치"를 쓴다.

### 4-17. 학구도 (통학구역·학교군)

- **API는 없다.** 학구도안내서비스(https://schoolzone.emac.kr, 한국교육시설안전원 운영)에도 Open API 안내가 없고, 공공데이터 목록만 있다.
- 공식 파일 (data.go.kr, 한국교육시설안전원, 이용허락범위 제한 없음, 반기 갱신, 다음 예정 2027-03-31):
  - 초등학교통학구역 SHP: https://www.data.go.kr/data/15159265/fileData.do (2026-09-20 기준)
  - 학교학구도연계정보 CSV: https://www.data.go.kr/data/15159266/fileData.do
  - 학구도 안내서비스 목록에는 중학교 학구·학군, 고등학교 학교군, 초중고 학교 위치 자료도 있다(각 data.go.kr ID는 **확인 필요**).
- 예전 제공기관인 (재)한국지방교육행정연구재단 데이터셋(15099520 등)은 2025-09-22 기준이다. 새 한국교육시설안전원 판을 쓴다.
- 쓰는 곳: PostGIS 없이도 SHP를 GeoJSON으로 변환해 적재한 뒤, 매물 좌표가 어느 통학구역 폴리곤에 드는지 계산한다(PostGIS 도입 여부는 별도 결정). 질문 답변 "이 매물은 어느 초등학교 배정?"
- 주의: 통학구역은 교육청 고시로 바뀐다. 답변에는 반드시 "기준일 2026-09-20, 최종 배정은 관할 교육지원청 확인"을 붙인다. 학구도 사이트도 전주시 자료 정비 기간(2026-10-19~12-31) 동안 실제와 다를 수 있다고 공지하고 있다.

### 4-18. 국가법령정보 공동활용 (법제처, open.law.go.kr)

- 신청: https://open.law.go.kr → 회원가입 → [OPEN API 신청]에서 쓸 데이터 선택 → **담당자 승인 후 사용 (신청 후 1~2일)**. 운영 신청 시 개발한 앱을 활용사례로 등록해야 한다. 사이트에 "IP 접속이력" 메뉴가 있다. 제3자 자료들은 호출 서버 IP를 등록하지 않으면 "사용자 정보 검증에 실패"한다고 적고 있다(**확인 필요**).
- data.go.kr 15057358("현행법령 본문 조회")은 API 유형 **LINK**다. 그곳에서 받은 키로는 호출할 수 없다.
- 인증: 쿼리 파라미터 `OC`("신청한 API인증값"). 제3자 자료는 가입 이메일의 @ 앞부분이라고 설명한다. 공식 문구로는 확인하지 못했다(**확인 필요**, 신청 후 마이페이지 "API인증키관리"에서 확인).
- 엔드포인트 (공식 활용가이드 기준):

| 용도 | 요청 URL | 핵심 파라미터 |
|---|---|---|
| 현행법령(시행일) 목록 | `http://www.law.go.kr/DRF/lawSearch.do?target=eflaw` | `OC`, `type`(HTML/XML/JSON), `query`, `search`(1 법령명/2 본문), `nw`(1 연혁/2 시행예정/3 현행), `display`(기본 20, 최대 100), `page`, `sort`, `efYd`, `org`(소관부처, 국토교통부 1613000) |
| 현행법령(시행일) 본문 | `http://www.law.go.kr/DRF/lawService.do?target=eflaw` | `OC`, `type`, `ID` 또는 `MST`(+`efYd`), `JO`(6자리: 조 4 + 가지 2, 예 제10조의2 = 001002) |
| 조항호목 단위 | `http://www.law.go.kr/DRF/lawService.do?target=eflawjosub` | `OC`, `type`, `ID`/`MST`, `efYd`, `JO`(필수), `HANG`, `HO`, `MOK`(한글, URL 인코딩) |

- 응답 필드(본문): `법령ID`, `법령명_한글`, `공포일자`, `시행일자`, `소관부처`, `조문번호`, `조문가지번호`, `조문제목`, `조문시행일자`, `조문내용`, `항번호`/`항내용`, `호번호`/`호내용`, `목번호`/`목내용`, `부칙내용`, 별표 정보(`별표서식PDF파일링크` 등), `제개정이유내용`
- 목록 응답: `법령일련번호`, `법령명한글`, `법령ID`, `공포일자`, `시행일자`, `소관부처명`, `법령상세링크`
- 기타: 공식 가이드 목록에는 행정규칙, 자치법규, 판례, 법령해석례, 별표·서식 등 191개 가이드가 있다. 공식 활용방법 페이지 예시는 `https://www.law.go.kr/...`를 쓴다(https 사용 가능).
- 호출 한도: 숫자로 된 공식 한도를 찾지 못함(**확인 필요**). "트래픽 초과로 시스템에 부하가 발생할 경우" 제한될 수 있다고 적혀 있다.
- 이용 조건: 법령정보는 영리 목적을 포함해 자유 이용. 단 **출처를 표기하지 않거나 법제처 이외 기관으로 표기하면 저작권법 위반(형사처벌 가능)**이라고 명시. 법령정보 위조·변조 제공도 처벌 대상.
- 쓰는 곳: RAG 문서 근거. 공인중개사법, 주택임대차보호법, 부동산 거래신고 등에 관한 법률, 민법(임대차 부분), 소득세법·지방세법 관련 조문 등을 **조문 단위로 받아 `documents`/`chunks`에 적재**하고, 시행일자를 메타데이터로 둔다. 질문 답변에서 `search_documents`가 이 청크를 찾는다.
- 주의: 개정 추적을 위해 주 1회 목록 API로 `시행일자` 변화를 확인하고 바뀐 법령만 다시 받는다. 인용 표시는 "법제처 국가법령정보센터, 「법령명」 제n조 (시행 YYYY-MM-DD)" 형식으로 고정한다.

### 4-19. R-ONE 부동산통계 Open API (한국부동산원)

- 신청: https://www.reb.or.kr/r-one/portal/openapi/openApiIntroPage.do → 로그인 → 인증키 발급(발급내역 메뉴). data.go.kr 15134761은 LINK형이며 운영단계 "심의승인" 표시.
- 기본 URL: `https://www.reb.or.kr/r-one/openapi/`
- 엔드포인트:
  - 서비스 통계목록: `SttsApiTbl.do` (요청인자 `STATBL_ID` 선택) → `STATBL_ID`, `STATBL_NM`, `DTACYCLE_CD`(주기코드), `DTACYCLE_NM`, `DATA_START_YY`, `DATA_END_YY`, `RPSTUI_NM`(기준시점)
  - 통계 세부항목 목록: 상세주소는 페이지에서 확인하지 못함(**확인 필요**)
  - 통계 조회: `SttsApiTblData.do` → 요청인자 `STATBL_ID`(필수), `DTACYCLE_CD`(필수), `WRTTIME_IDTFR_ID`, `GRP_ID`, `CLS_ID`, `ITM_ID`, `START_WRTTIME`, `END_WRTTIME`
- 기본 인자: `KEY`(필수, 없으면 sample로 처리되어 일부만 출력), `Type`(xml|json), `pIndex`, `pSize`(기본 100)
- 응답 필드(통계 조회): `WRTTIME_IDTFR_ID`(자료작성 시점), `CLS_NM`/`CLS_FULLNM`(지역 등 분류), `ITM_NM`, `DTA_VAL`(값), `UI_NM`(단위), `WRTTIME_DESC`
- 제공 통계(설명): 전국주택가격동향조사(주간·월간), 공동주택 실거래가격지수, 지가변동률, 오피스텔가격동향, 상업용부동산 임대동향, 부동산거래현황
- 호출 한도: 공식 페이지에서 찾지 못함(**확인 필요**). data.go.kr에는 "해당 기관의 정책에 따라 트래픽 수는 상이"로만 표시.
- 쓰는 곳: 질문 답변 "마포구 아파트 매매가격지수 최근 흐름", 고객 자료의 시장 동향 그래프
- 주의: "주간 아파트 매매가격지수", "주간 전세가격지수"의 `STATBL_ID`와 주기코드는 먼저 `SttsApiTbl.do`를 호출하거나 R-ONE "통계코드 검색" 메뉴에서 찾아 설정 파일에 고정한다(**확인 필요**). 주간 통계는 발표일과 조사기준일이 다르므로 둘 다 표시한다.

### 4-20. 뉴스: 네이버 검색 API (뉴스)

- **검토 메모 (2026-10-30 재검증):** NAVER API HUB로의 이관과 "기존 개발자센터 Client ID/Secret은 API HUB에서 쓸 수 없음"은 네이버 클라우드 공식 가이드(https://guide.ncloud-docs.com/docs/apihub-migration)로 다시 확인했다. 그러나 아래의 **날짜(2026-07-30, 2027-06-30)와 "AI 입력 금지"·"21일 캐싱" 조항은 약관 원문 페이지가 자동 조회를 막아 재검증하지 못했고, 2차 보도로만 일치를 확인했다.** 신청·설계 전에 약관 원문을 사람이 직접 읽고 확정한다.
- **제공 경로 변경 (중요):** 네이버 API 이용약관(2026-10-07 개정) 부칙. 네이버 개발자센터를 통한 Search API는 **2026-07-30 24:00부터 신규 이용 신청을 받지 않는다.** 그 전에 신청한 기존 이용자만 **2027-06-30**까지 쓸 수 있다. 이후는 네이버 클라우드 플랫폼(NCP)의 **NAVER API HUB** 이용 절차와 약관을 따른다. 우리는 신규이므로 **NAVER API HUB로 신청**해야 한다.
- NAVER API HUB 뉴스 검색:
  - 요청 URL: `GET https://naverapihub.apigw.ntruss.com/search/v1/news`
  - 헤더: `X-NCP-APIGW-API-KEY-ID: {Client ID}`, `X-NCP-APIGW-API-KEY: {Client Secret}`
  - 파라미터: `query`(필수, UTF-8), `display`(1~100, 기본 10), `start`(1~1000, 기본 1), `sort`(sim|date), `format`(json|xml)
  - 응답: `lastBuildDate`, `total`, `start`, `display`, `items[]`: `title`, `originallink`, `link`, `description`(요약 패시지), `pubDate`. 제목·요약의 검색어는 `<b>` 태그로 감싸져 온다. **기사 본문은 주지 않는다.**
  - 한도: "검색 API의 하루 호출 한도는 25,000회"
  - 요금: NCP 제품 페이지에 "시간 단위 종량 요금제"라는 일반 문구만 있다. 뉴스 검색 단가·무료량은 **확인 필요**.
- (참고) 기존 개발자센터 엔드포인트: `https://openapi.naver.com/v1/search/news.json`, 헤더 `X-Naver-Client-Id` / `X-Naver-Client-Secret`, 같은 파라미터·필드, 하루 25,000회.
- **이용 조건 (개발자센터 약관 "2. 네이버 검색 API 서비스", 2026-10-07 개정판):**
  - 2.1 네이버 검색결과임을 BI 가이드에 따라 표시해야 한다.
  - 2.2 데이터를 **독립적으로, 가공 없이** 노출해야 한다. 원본 출처를 표시하고 원본 링크를 제공해야 한다.
  - 2.3 금지: 데이터(가공·파생물 포함)의 복사·저장·캐싱(2.4 예외), 제3자 제공, **"데이터를 AI에 입력하거나 학습, 개선, 평가 및 노출 등에 활용하는 행위"**, 검색결과 페이지 광고.
  - 2.4 캐싱 예외: 기기 보관은 24시간 또는 새 질의 시까지 중 짧은 기간. 서버 보관은 이력 조회 목적으로 최대 21일.
  - NAVER API HUB 약관에도 같은 조항이 있는지는 **확인 필요**.
- **중개메이트 결론:** 네이버 뉴스 결과는 **LLM 질문 답변의 근거로 넣을 수 없다**(2.3). 답변 화면 옆에 "관련 뉴스" 링크 목록을 원문 그대로 따로 보여주는 용도만 가능하다. 고객 자료(PDF)에 넣는 것은 "가공 없이 노출" 조건과 21일 보관 제한 때문에 피한다. 질문 답변에서 뉴스 근거가 꼭 필요하면 BigKinds(4-21) 등 **이용 허락을 받은 소스**가 필요하다.
- 우선순위: 나중(조건부). env는 `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`(HUB의 Client ID/Secret).

### 4-21. 뉴스: BigKinds (한국언론진흥재단)

- 공식 사이트(https://www.bigkinds.or.kr)의 메뉴와 서비스 안내에서 **일반 기업용 API 신청 경로와 요금표를 찾지 못했다**(**확인 필요**).
- 확인된 사실: 문화체육관광부 보도자료(2016-06-29)상 빅카인즈 API는 공모전 선정자에게 지원 형태로 제공됐다. 2026년 미디어 스타트업 지원사업 공고(제3자 게시)에 따르면 선정사에 **빅카인즈 API 2년 무상 지원**, **뉴스 본문은 건당 200자 이내(분석용)**로 제공된다(공고 원문은 **확인 필요**).
- 결론: 바로 쓸 수 있는 공개 API로 보기 어렵다. 필요하면 한국언론진흥재단에 직접 문의한다(제휴·비용·AI 입력 허용 여부 포함).

### 4-22. 정책·대출 (주택도시기금, 한국주택금융공사)

- **자격 조건(디딤돌·보금자리론·생애최초 등) 판정 API는 찾지 못했다.** data.go.kr에서 "주택도시기금", "생애최초"로 찾은 API 중 조건 API는 없었다. → **공식 상품안내 PDF·공고문을 수동 업로드**해 `documents`에 넣고, 문서 기준일을 메타데이터로 둔다.
- 금리 API는 있다 (한국주택금융공사, data.go.kr, 자동승인, 개발 1,000/일, 제한 없음):
  - u-보금자리론 금리 (15082039): `GET https://apis.data.go.kr/B551408/u-loan-rate/uloan-info` → `applyDy`(금리적용일), `interest_10y`/`15y`/`20y`/`30y`. 파라미터 `serviceKey`, `pageNo`, `numOfRows`, `dataType`(XML|JSON)
  - 디딤돌대출 금리 (15082028): `GET https://apis.data.go.kr/B551408/didimdol-loan-rate/didimdol-info` → `applyDy`, `interest_{10,15,20,30}y_{2000,4000,6000}`(소득구간별). 명세표상 데이터타입 파라미터 이름이 `dateType`으로 적혀 있다(오타 여부 **확인 필요**)
  - 전세자금보증상품 추천서비스 (15119396): 고객특성별 상품 추천·지역별 최대 임차보증금 등. 엔드포인트는 이번에 확인하지 못함(**확인 필요**)
- 데이터의 갱신 주기와 최신성은 **확인 필요**(샘플 데이터가 2019년 날짜). 답변에는 금리적용일을 함께 보여주고 "최종 조건은 기금·공사 공식 안내 확인"을 붙인다.
- 우선순위: 나중. "생애최초 지원 받을 수 있어?" 질문은 업로드한 공식 문서 RAG로 답한다.

### 4-23. 등기부(등기사항증명서)

- 대법원 인터넷등기소(https://www.iros.go.kr)의 **개별 부동산 등기기록 열람·발급을 외부 시스템이 호출하는 공식 공개 API는 찾지 못했다.** data.go.kr에서도 "등기" 관련 API는 실거래가·리츠 등만 나온다.
- 등기정보광장(https://data.iros.go.kr)에는 Open API 메뉴가 있지만, 보이는 데이터는 **등기 신청 현황 등 통계**다. 개별 등기사항은 아니다.
- 제3자 유료 대행(CODEF, Tilko 등)이 등기부 열람/발급 API를 판다고 알려져 있으나, 제공 범위·요금·인증 방식은 공식 문서로 확인하지 못했다(**확인 필요**).
- 등기부 인터넷 열람·발급은 건당 수수료가 있다. 금액과 인상안은 제3자 기사로만 봤다(**확인 필요**).
- 결론: **선택·유료 기능**으로 미룬다. MVP에서는 중개사가 직접 발급한 등기부 PDF를 업로드하면 문서 근거로 쓰는 방식으로 한다. 등기부에는 소유자 성명·주소 등 개인정보가 있으므로 저장·LLM 전송 범위를 따로 정한다(6절).

### 4-24. Anthropic Messages API (질문 답변 LLM)

- 신청: https://platform.claude.com (Console) → API 키 발급. env `ANTHROPIC_API_KEY` (현재 `backend/app/config.py`가 이미 읽음)
- 요청 URL: `POST https://api.anthropic.com/v1/messages`
- 인증·헤더: `x-api-key: $ANTHROPIC_API_KEY`, `anthropic-version: 2026-10-21`, `content-type: application/json`. 베타 기능은 `anthropic-beta`. Python은 공식 SDK `anthropic`을 쓴다(SDK가 헤더를 넣는다).
  - `2026-10-21` 버전에서는 `temperature`/`top_p`/`top_k`를 보내면 400이다. user 메시지 안 `text` 블록에 `citations`를 다시 넣어도 400이다.
- 모델 ID: 기본 `claude-opus-5-5`. 더 싼 대안 `claude-sonnet-5-5`, `claude-haiku-5-5` (세 ID 모두 공식 Search results 문서의 지원 모델 목록에 있음)
- 요금: 적지 않음. https://platform.claude.com/docs/en/about-claude/pricing 참조
- 도구 호출 루프(에이전트형 RAG):
  1. `tools`에 우리 도구를 `name`/`description`/`input_schema`(JSON Schema)로 정의한다. 스키마를 강제하려면 `strict: true` + `additionalProperties: false`.
  2. 응답 `stop_reason == "tool_use"`면 `tool_use` 블록들(병렬로 여러 개 올 수 있음)을 실행한다.
  3. 결과를 **한 개의 user 메시지**에 `tool_result` 블록들로 모두 담아 다시 보낸다. 실패는 `is_error: true`.
  4. `end_turn`이 나올 때까지 반복한다. Python SDK의 Tool Runner(`client.beta.messages.tool_runner`)를 쓰면 루프를 직접 짜지 않아도 된다.
- **인용 (질문 답변의 근거 표시):** 도구 결과로 `search_result` 블록(`source`, `title`, `content: [{type: "text", ...}]`, `citations: {enabled: true}`)을 돌려주면, 답변 `text` 블록에 `citations` 배열이 붙는다(`type: "search_result_location"`, `source`, `title`, `cited_text`, `start_block_index`/`end_block_index`). 베타 헤더 불필요(GA). 실거래 표·법령 조문·업로드 문서를 모두 `search_result`로 감싸면 **주장별 인용**을 API가 직접 만들어 준다. `source`에 우리 내부 ID(예 `doc:123#chunk:4`, `trade:11440:202609`)를 넣으면 고객 자료에서 원문으로 되돌아갈 수 있다.
- Claude Opus 5.5 주의: 강제 도구 선택(`tool_choice` `any`/`tool`)은 400이다. `auto`와 프롬프트 지시로 유도한다. thinking은 끌 수 없다. `output_config.effort`로 깊이를 조절하며 기본값은 `medium`이다. 거절(`stop_reason: "refusal"`)을 처리하고, 서버측 `fallbacks` 사용을 검토한다.
- 쓰는 곳: 질문 답변 전체, 고객 자료 초안 작성 (`backend/app/drafting.py`)
- 개인정보: 고객 이름·연락처·예산 같은 개인정보가 API로 전송된다(6절).

### 4-25. 임베딩 (문서 검색용)

Anthropic은 자체 임베딩 모델이 없다. 공식 문서가 Voyage AI(MongoDB)를 한 선택지로 안내한다.

| 선택지 | 모델 | 차원 | 입력 길이 | 다국어/한국어 | 호출 | pgvector 적합성 |
|---|---|---|---|---|---|---|
| **Voyage AI** | `voyage-4` (균형), `voyage-4-large` (품질), `voyage-4-lite` (비용) | 1024 기본 (256/512/2048 선택) | 32,000 토큰 | "general-purpose and multilingual retrieval" (한국어 단독 벤치마크는 **확인 필요**) | `POST https://ai.mongodb.com/v1/embeddings`, `Authorization: Bearer $VOYAGE_API_KEY`, `input_type`(query/document) 필수 권장 | 1024는 `vector(1024)` + HNSW 인덱스 가능 |
| Voyage (로컬) | `voyage-4-nano` (Apache 2.0, Hugging Face 공개 가중치) | 2048 기본 (256/512/1024) | 32,000 | 위와 같음 | 자체 서버 | 1024로 줄이면 그대로 가능 |
| OpenAI | `text-embedding-3-small` / `-large` | 1536 / 3072 (`dimensions`로 축소 가능) | 8192 (단위 표기 없음) | 다국어 (한국어 성능 **확인 필요**) | `POST https://api.openai.com/v1/embeddings` | small 1536 가능. large 3072는 `vector` 인덱스 한도(2,000)를 넘으므로 `halfvec`(4,000까지) 인덱스나 `dimensions` 축소가 필요 |
| 로컬 오픈 모델 | `BAAI/bge-m3` (MIT) | 1024 (dense) | 8192 토큰 | 100개 이상 언어, dense·sparse·multi-vector 지원 | 자체 서버(GPU 권장), 키 불필요 | `vector(1024)` 가능 |

- pgvector 한도 (공식 README): `vector` 저장 최대 16,000차원. HNSW/IVFFlat 인덱스는 `vector` 2,000차원, `halfvec` 4,000차원까지.
- 현재 상태: `chunks.embedding`은 384차원 해시 임베딩 자리표시자다. 어느 쪽을 고르든 **스키마 변경(`vector(384)` → `vector(1024)` 등) + 전체 재임베딩**이 필요하다. `documents.embed_model` 컬럼에 모델명을 이미 저장하므로, 모델이 섞이지 않게 검색 시 모델명을 필터한다.
- 권장: 외부 전송을 줄이려면 **bge-m3 로컬**(문서·고객 메모가 외부로 나가지 않음). 운영 부담을 줄이려면 **voyage-4 (1024)**. 한국어 부동산 문서로 작은 평가셋(질문 30개 정도)을 만들어 둘을 비교한 뒤 정한다.
- Voyage 요금: https://www.mongodb.com/docs/voyageai/management/billing/#model-pricing

---

## 5. 질문 답변(RAG)에서 데이터를 쓰는 방식

LLM(Claude)은 아래 도구만 부른다. 도구는 우리 백엔드 함수이고, 외부 API는 백엔드가 부른다. 모든 도구 결과는 `search_result` 블록(출처 ID, 제목, 기준일 포함)으로 돌려줘서 주장별 인용이 붙게 한다.

| 도구 (LLM이 부름) | 입력 예 | 뒤에 있는 데이터/API | 저장 방식 |
|---|---|---|---|
| `search_listings(filters)` | 지역, 면적, 예산, 단계 | 우리 DB 매물 (사무소 공유) | DB (원천) |
| `get_customer(customer_id)` | 김하늘 | 우리 DB 고객 | DB (원천). 개인정보 최소 필드만 반환 |
| `get_trades(lawd_cd, ym_from, ym_to, complex?, area?)` | 11440, 202510~202609, 공덕동 59㎡ | 실거래 매매·전월세 (4-2~4-4) | **DB 캐시.** 매일 밤 최근 3개월을 다시 받아 갱신(신고 지연·해제 반영) |
| `get_complex_info(kapt_code)` | 단지코드 | K-apt 목록·기본정보 (4-6, 4-7) | **DB 캐시**, 월 1회 갱신 |
| `get_building_info(address)` | 매물 주소 | 건축HUB 표제부·전유공용면적 (4-8) | **DB 캐시**(매물 등록 시 조회), 월 1회 갱신 |
| `get_official_price(pnu, dong, ho)` | — | VWorld 공동주택가격 (4-9) | DB 캐시, 연 1회 (공시 후) |
| `get_market_stats(region, stat)` | 마포구, 주간 매매지수 | R-ONE (4-19) | DB 캐시, 주 1회 |
| `find_nearby(lat, lng, type, radius)` | 지하철역, 학교, 학원, 공원 | 역: DB `stations`(4-15 파일). 학교: DB(NEIS+학구도). 그 외(학원·병원·공원): **카카오 로컬 실시간** (4-14) | 역·학교는 DB. 카카오 결과는 저장 안 함(조건 확인 전) |
| `get_school_zone(lat, lng)` | 매물 좌표 | 학구도 SHP (4-17) | DB (반기 적재) |
| `geocode(address)` | 새 매물 주소 | 도로명주소 검색 + 좌표제공 (4-12) | DB에 좌표 저장 (VWorld 지오코더 결과는 저장 금지) |
| `search_documents(query, kind?)` | "임대차 갱신요구권" | pgvector 청크: 법령(4-18), 정책 PDF(4-22, 수동 업로드), 사무소 문서 | DB (임베딩). 법령은 주 1회 개정 확인 |
| `search_news(query)` | "공덕동 재건축" | 네이버 뉴스 (4-20) | **LLM에 넣지 않음.** 화면의 별도 "관련 뉴스" 링크 목록으로만 표시 (약관 2.3) |

- 실시간 호출은 카카오 주변검색, 화면용 VWorld 지오코딩, (선택) 뉴스 링크뿐이다. 나머지는 밤 배치로 DB에 쌓고 질문 시에는 DB만 읽는다. 외부 장애가 답변을 막지 않고, data.go.kr 일일 한도도 지킬 수 있다.
- 기존 `public_data.py`의 회로 차단기·시간초과 패턴을 모든 외부 어댑터에 똑같이 적용한다.
- 모든 캐시 행에 `source`(데이터셋 이름/ID), `fetched_at`, 원천 기준일을 저장하고, 답변·고객 자료의 인용에 그대로 표시한다.

---

## 6. 확인하지 못한 것 / 위험

**확인 필요 목록**

1. data.go.kr 마이페이지의 Encoding/Decoding 키 표시와 어느 쪽을 써야 하는지에 대한 공식 문구
2. 실거래가 15126469·15126474가 `pageNo`/`numOfRows`를 받는지, `numOfRows` 최대값
3. 연립다세대 매매(15126467)의 현행 경로 (`RHTrade2`와 `RHTrade`)
4. 건축HUB `bun`/`ji` 자리수, 위반건축물 표시 필드 존재 여부, `getBrHsprcInfo` "주택가격"의 종류
5. VWorld PNU 구성 규칙, VWorld 인증키 유효기간·연장 규칙
6. 법정동코드에서 폐지 코드 구분 방법
7. juso.go.kr: 호출 한도, 승인 소요 기간, 개발승인키 유효기간, 자료제공 "안내사항"(국외 반출 금지·비공개시설 좌표) 원문
8. 카카오 로컬: 결과 저장 가능 여부, 비카카오 지도 표시 가능 여부, 출처 표기 의무
9. TAGO 지하철 오퍼레이션별 경로와 좌표 필드 유무, 서울시 지하철역 좌표(15171250)의 좌표계, 15099317의 갱신·라이선스
10. NEIS 키 사용 시 일일 한도
11. 학구도 중학교 학군·고교 학교군·학교 위치 데이터셋의 data.go.kr ID
12. 법제처 `OC` 값의 정확한 의미, 서버 IP 등록 필수 여부, 호출 한도
13. R-ONE 호출 한도, 세부항목 목록 엔드포인트, 주간 매매·전세 지수의 `STATBL_ID`
14. NAVER API HUB 뉴스 검색의 요금·무료량, HUB 약관에 "AI 입력 금지" 조항이 그대로 있는지
15. BigKinds 일반 기업 API 신청 경로·요금·AI 입력 허용 여부
16. HF 디딤돌 금리 API의 `dateType` 오타 여부, 금리 데이터 갱신 주기, 전세자금보증 추천 API 엔드포인트
17. 등기부: CODEF·Tilko 등 제3자 API의 범위·요금, 인터넷등기소 열람·발급 수수료 현행 금액
18. 임베딩 모델별 한국어 검색 성능 (자체 평가로 확인)

**위험**

- **뉴스 저작권·약관:** 조사 시점 약관에 따르면 네이버 검색 API는 결과를 AI에 입력하는 것을 금지하고, 캐싱도 최대 21일(서버)로 제한한다 (약관 원문 재확인 필요, 4-20 검토 메모). 언론사 기사 본문은 저작권 보호 대상이다. → 우리 DB에는 **제목·요약·링크·게시일만**, 그것도 약관이 허용하는 기간만 둔다. LLM 근거로 쓰려면 이용 허락을 받은 소스(BigKinds 제휴 등)가 필요하다.
- **개인정보 (고객 정보의 LLM 전송):** 고객 이름·연락처·예산·가족 사항을 Anthropic API로 보내면 개인정보 처리위탁·국외 이전에 해당할 수 있다(개인정보 보호법 검토 필요). 도구 결과에는 이름 대신 고객 ID와 필요한 조건만 넣고, 개인정보처리방침에 위탁·국외 이전 사실을 적는다. 법률 판단은 **확인 필요**(전문가 검토).
- **주소 데이터 국외 반출:** juso 자료의 국외 반출 금지 조항이 사실이면, 좌표·주소 DB를 해외 리전에 두면 안 된다. 현재 Docker 배포 위치를 확인한다.
- **등기부:** 소유자 개인정보, 유료, 공식 API 없음. 업로드 문서로만 다루고, 고객 공유 링크에 등기부 원문을 노출하지 않는다.
- **공시가격 호 단위 조회:** 특정 호의 공시가격은 소유자 재산 정보에 가깝다. 고객 자료에는 매물 본인 호만 쓴다.
- **VWorld 지오코더 결과 저장 금지:** 매물 좌표 저장에는 juso 좌표 API를 쓴다.
- **데이터 최신성:** 실거래가는 신고 기한 때문에 최근 1~2개월이 덜 차 있다(신고 기한 자체는 이 문서에서 확인하지 않음). 답변에 "최근 월은 신고가 덜 반영됐을 수 있음"을 붙인다. 통학구역·정책 조건은 기준일을 반드시 표시한다.
- **법령 해석:** 법령 원문 인용은 가능하지만 해석은 확정하지 않는다(원래 설계 원칙 유지). 출처 미표기는 저작권법 위반이 될 수 있다(법제처 안내).
- **OpenStreetMap 타일:** 현재 지도는 `tile.openstreetmap.org`를 직접 쓴다. 상용 트래픽에서의 타일 사용 정책은 이번에 확인하지 않았다(**확인 필요**).

---

## 7. 참고 링크 (이번 조사에서 연 공식 페이지)

**공공데이터포털 (data.go.kr)**
- 아파트 매매 실거래가: https://www.data.go.kr/data/15126469/openapi.do
- 아파트 매매 실거래가 상세: https://www.data.go.kr/data/15126468/openapi.do
- 아파트 전월세 실거래가: https://www.data.go.kr/data/15126474/openapi.do
- 오피스텔 매매/전월세: https://www.data.go.kr/data/15126464/openapi.do, https://www.data.go.kr/data/15126475/openapi.do
- 연립다세대 매매/전월세: https://www.data.go.kr/data/15126467/openapi.do, https://www.data.go.kr/data/15126473/openapi.do
- 단독/다가구 매매/전월세: https://www.data.go.kr/data/15126465/openapi.do, https://www.data.go.kr/data/15126472/openapi.do
- 공동주택 단지 목록: https://www.data.go.kr/data/15057332/openapi.do
- 공동주택 기본정보: https://www.data.go.kr/data/15058453/openapi.do
- 건축HUB 건축물대장: https://www.data.go.kr/data/15134735/openapi.do
- 공동주택가격정보(링크): https://www.data.go.kr/data/15124003/openapi.do
- 토지이용규제정보서비스: https://www.data.go.kr/data/15058410/openapi.do
- 법정동코드: https://www.data.go.kr/data/15077871/openapi.do
- 공간정보오픈플랫폼 WMS/WFS: https://www.data.go.kr/data/15058805/openapi.do
- 법제처 현행법령 본문 조회(링크): https://www.data.go.kr/data/15057358/openapi.do
- TAGO 지하철정보: https://www.data.go.kr/data/15098554/openapi.do
- NEIS 학교기본정보(링크): https://www.data.go.kr/data/15122275/openapi.do
- 한국부동산원 부동산통계 조회(링크): https://www.data.go.kr/data/15134761/openapi.do
- HF u-보금자리론 금리: https://www.data.go.kr/data/15082039/openapi.do
- HF 디딤돌대출 금리: https://www.data.go.kr/data/15082028/openapi.do
- HF 전세자금보증상품 추천: https://www.data.go.kr/data/15119396/openapi.do
- 초등학교통학구역(한국교육시설안전원): https://www.data.go.kr/data/15159265/fileData.do
- 학교학구도연계정보: https://www.data.go.kr/data/15159266/fileData.do
- 서울교통공사 1~8호선 역사 좌표: https://www.data.go.kr/data/15099316/fileData.do
- 서울특별시 지하철역 좌표정보: https://www.data.go.kr/data/15171250/fileData.do

**주소·공간**
- 도로명주소 API 목록: https://business.juso.go.kr/jst/jstAddressApiList
- 도로명주소 검색 API: https://business.juso.go.kr/jst/jstRoadNmAddrApiSearch
- 좌표제공 검색 API: https://business.juso.go.kr/jst/jstCoordApiSearch
- juso Tech&Tips(좌표계 EPSG:5179 변환): https://business.juso.go.kr/jsi/jsiTechTipsList
- 법정동코드 전체자료: https://www.code.go.kr/stdcode/regCodeL.do
- VWorld 오픈API: https://www.vworld.kr/dev/v4api.do
- VWorld Geocoder 2.0: https://www.vworld.kr/dev/v4dv_geocoderguide2_s001.do
- VWorld WMS 2.0: https://www.vworld.kr/dev/v4dv_wmsguide2_s001.do
- VWorld 국가중점데이터 API 목록: https://www.vworld.kr/dtna/dtna_apiSvcList_s001.do
- VWorld 공동주택가격속성조회: https://www.vworld.kr/dtna/dtna_apiSvcFc_s001.do?apiNum=31
- VWorld 토지이용계획속성조회: https://www.vworld.kr/dtna/dtna_apiSvcFc_s001.do?apiNum=51
- VWorld 저작권정책: https://www.vworld.kr/v4po_prcint_a006.do
- 카카오 로컬 개발 가이드: https://developers.kakao.com/docs/ko/local/dev-guide
- 카카오 로컬 공통(이용 정책): https://developers.kakao.com/docs/ko/local/common
- 카카오 쿼터: https://developers.kakao.com/docs/ko/getting-started/quota

**학교**
- NEIS 학교기본정보: https://open.neis.go.kr/portal/data/service/selectServicePage.do?infId=OPEN17020190531110010104913&infSeq=1
- NEIS 개발자 가이드: https://open.neis.go.kr/portal/guide/apiGuidePage.do
- 학구도안내서비스: https://schoolzone.emac.kr/

**법령·통계·뉴스·정책·등기**
- 국가법령정보 공동활용 활용가이드: https://open.law.go.kr/LSO/openApi/guideList.do
- 국가법령정보 이용안내: https://open.law.go.kr/LSO/information/guide.do
- 국가법령정보 OPEN API 활용방법: https://open.law.go.kr/LSO/openApi/openApiManual.do
- R-ONE Open API 소개/목록/개발가이드: https://www.reb.or.kr/r-one/portal/openapi/openApiIntroPage.do, https://www.reb.or.kr/r-one/portal/openapi/openApiListPage.do, https://www.reb.or.kr/r-one/portal/openapi/openApiDevPage.do
- 네이버 뉴스 검색 API(개발자센터): https://developers.naver.com/docs/serviceapi/search/news/news.md
- 네이버 API 서비스 이용약관: https://developers.naver.com/products/terms/
- NAVER API HUB 뉴스 검색: https://api.ncloud-docs.com/docs/naver-api-hub-search-news
- NAVER API HUB 제품: https://www.ncloud.com/product/applicationService/naverApiHub
- 빅카인즈: https://www.bigkinds.or.kr/
- 문화체육관광부 빅카인즈 보도자료(2016): https://www.mcst.go.kr/site/s_notice/press/pressView.jsp?pSeq=15348
- 인터넷등기소: https://www.iros.go.kr/
- 등기정보광장: https://data.iros.go.kr/

**LLM·임베딩**
- Anthropic 요금: https://platform.claude.com/docs/en/about-claude/pricing
- Anthropic Search results(인용): https://platform.claude.com/docs/en/build-with-claude/search-results
- Anthropic Embeddings 안내: https://platform.claude.com/docs/en/build-with-claude/embeddings
- Voyage 요금: https://www.mongodb.com/docs/voyageai/management/billing/#model-pricing
- OpenAI Embeddings: https://developers.openai.com/api/docs/guides/embeddings
- BAAI bge-m3: https://huggingface.co/BAAI/bge-m3
- pgvector: https://github.com/pgvector/pgvector
