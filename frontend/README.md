# 중개메이트 화면 (frontend)

React 19 + TypeScript + Vite + Tailwind v4. 차트는 Bklit UI(shadcn 레지스트리), 움직임은 Motion과 anime.js.
백엔드(FastAPI)는 저장소 루트의 `backend/`에 따로 있다. 빌드 결과(`dist/`)를 FastAPI가 `/app.html`, `/assets/*`로 내려준다.

```bash
npm ci
npm run dev            # http://localhost:5173/app.html — /api, /r 을 API_URL(기본 http://localhost:8000)로 넘긴다
API_URL=http://localhost:18000 npm run dev -- --port 5174   # E2E용 격리 백엔드에 붙이기
npm run typecheck      # tsc -b
npm run build          # dist/
```

## Cloudflare 배포 (화면만, API 서버는 따로)

화면은 Cloudflare Pages 프로젝트 `junggae-mate`(정적 자산 `dist/` + Pages Function `functions/config.json.ts`)가 내려주고,
API는 별도 서버(FastAPI)가 맡는다. 화면은 시작할 때 `/config.json`에서 API 주소(Pages 환경 변수 `API_URL`)를 받는다.
주소: https://junggae-mate.kro.kr (외부 DNS CNAME → `junggae-mate.pages.dev`), https://junggae-mate.pages.dev

```bash
npx wrangler login            # 처음 한 번 (Cloudflare 계정 이메일 인증 필요)
npm run deploy                # 빌드 + 배포 (main 브랜치 = 운영)
npx wrangler pages secret put API_URL --project-name junggae-mate   # API 서버 주소 (예: https://api.example.com). 대시보드에서도 된다
npm run cf:dev                # 로컬에서 Pages로 확인 (http://localhost:8788, API 주소는 .dev.vars의 API_URL)
```

`API_URL`을 바꾸면 그다음 배포부터 반영된다(대시보드에서 바꾼 뒤 `npm run deploy` 또는 "재배포").
주소 체계: `/` → `/app` (Pages는 `/app.html`을 `/app`으로 돌린다), 화면 안 이동은 `#/…` 해시.

API 서버 쪽(.env)에는 화면 주소를 허용한다:

```bash
CORS_ORIGINS=https://junggae-mate.kro.kr,https://junggae-mate.pages.dev
CORS_ORIGIN_REGEX=^https://[0-9a-f]{8}\.junggae-mate\.pages\.dev$   # 선택: 배포마다 생기는 미리보기 주소
PUBLIC_BASE_URL=https://api-junggae-mate.kro.kr                      # 고객 공유 링크(/r/…)에 쓸 API 공개 주소
```

로그인은 `Authorization: Bearer` 헤더라 쿠키·자격 증명 CORS는 필요 없다. FastAPI가 화면도 함께 내려주는 기존 방식(같은 주소)도 그대로 동작한다.

## 구조

| 경로 | 내용 |
|---|---|
| `src/main.tsx` | Provider 묶음: MotionConfig(동작 줄이기 존중) → React Query → 로그인 → 알림·대화상자 → 출처 |
| `src/App.tsx` | 로그인 화면 / 상단바 + 주소(#/…)별 화면 + Ask Hood 패널 |
| `src/lib/api.ts` | `api(method, path, body?, {form})` — `/api` 호출, 401이면 로그아웃, 오류는 `ApiError` |
| `src/lib/router.ts` | 해시 주소 `#/page/a/b` — `useRoute()`, `navigate()` |
| `src/lib/format.ts` | 거래 단계 이름·색, `eok()`, `day()`, `dateTime()`, 근거 번호 정규식 |
| `src/lib/motion.ts` | 움직임 길이·곡선·스프링 (아래 규칙) |
| `src/lib/anime.ts` | anime.js 도우미: `staggerIn`, `drawIn`, `countUp` |
| `src/state/session.tsx` | `useSession()`, `useUser()` |
| `src/state/ui.tsx` | `useToast()`, `useUi().openDialog((close) => …)`, `useBusy()` |
| `src/state/sources.tsx` | 근거 모음과 출처 패널 `useSources().open(evOrId)`, `SourceBody` |
| `src/state/hood.ts` | Ask Hood 패널 열기·닫기 `hoodPanel.open(prefill?)` |
| `src/components/` | `Topbar`, `LoginScreen`, `Notes`(`NoteText`·`SrcRef`·`textWithTokens`), `Stage`(`StageTag`·`Prog`), `Icons` |
| `src/components/charts/` | Bklit 차트 원본 (shadcn으로 설치, 우리 코드처럼 다룬다) |
| `src/features/<화면>/` | 화면별 코드와 `<화면>.css` |
| `src/styles/legacy.css` | 예전 화면 CSS를 그대로 옮긴 것. 클래스 이름을 그대로 쓰면 같은 모양이 나온다 |

## 규칙

- **모양**: 흰 시트 + 청회색 틀, 색은 데이터(거래 단계)에만. 어두운 배경을 쓰지 않는다.
  예전 클래스(`card`, `btn`, `kv`, `lrow`, `stage` …)를 우선 쓰고, 새 배치는 Tailwind 유틸리티로.
  `legacy.css`·`index.css`는 화면 작업에서 고치지 않는다. 덧붙임은 `features/<화면>/<화면>.css`.
- **E2E가 기대는 id·클래스·`data-act`·`data-nav`·`aria-*`는 그대로 둔다** (`e2e_app.py`).
- **데이터**: `api()`를 직접 부르거나 React Query(`useQuery`, `useMutation`)로. 응답 모양은 예전 `app-*.js`가 쓰던 그대로.
- **움직임 (절제된 업무용)**
  - Motion: 화면 요소의 등장·퇴장·전환, 패널·시트 스프링, 누름(`whileTap`), `layout` 재배치.
  - anime.js: 여러 단계를 차례로 보여 주는 연출, SVG 선 그리기, 숫자 올라가기 — `lib/anime.ts` 도우미를 effect에서 부르고 정리 함수를 반환.
  - 길이 150–300ms. 키보드 동작·지도 이동·자주 바뀌는 목록 갱신에는 넣지 않는다. `prefers-reduced-motion`을 따른다(도우미와 MotionConfig가 처리).
- **차트 (Bklit)**: `src/components/charts/`의 설치된 원본을 먼저 읽고 props를 확인한다. 색은 `var(--chart-1…5)`(청록 진하기).
  막대 `BarChart`+`Bar`+`BarXAxis`, 선 `LineChart`+`Line`+`XAxis`+`YAxis`, 면 `AreaChart`, 작은 추이 `LineSparkline`/`BarSparkline`,
  `Gauge`, `RingChart`, `FunnelChart`, `ScatterChart`. 새 차트가 필요하면 `npx shadcn@latest add @bklit/<item>`.
- **접근성**: 버튼은 `<button type="button">`, 아이콘 버튼은 `aria-label`, 대화상자·시트는 포커스를 가두고 닫으면 돌려준다.
