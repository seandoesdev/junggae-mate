/* Cloudflare Pages Function — GET /config.json
   화면이 시작할 때 부를 API 서버 주소를 알려 준다. 값은 Pages 프로젝트의 환경 변수 API_URL
   (대시보드 > Workers & Pages > junggae-mate > Settings > Variables and Secrets,
    또는 `npx wrangler pages secret put API_URL --project-name junggae-mate`).
   값을 바꾸면 다시 빌드하지 않아도 다음 배포부터 반영된다. API 서버는 CORS_ORIGINS에 이 화면 주소를 넣어야 한다. */

interface Env {
  /** 예: https://api.example.com (끝의 / 없이) */
  API_URL?: string;
  /** (선택) 네이버 지도 Client ID. 비우면 화면이 API 서버의 /api/public-config(서버 .env의 NAVER_CLIENT_ID)에서 받는다 */
  NAVER_CLIENT_ID?: string;
}

const isHttpUrl = (v: string) => {
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
};

export const onRequestGet = ({ env }: { env: Env }): Response => {
  const raw = (env.API_URL || "").trim().replace(/\/+$/, "");
  const naver = (env.NAVER_CLIENT_ID || "").trim();
  const body = { apiUrl: isHttpUrl(raw) ? raw : "", naverMapClientId: /^[A-Za-z0-9_-]{1,64}$/.test(naver) ? naver : "" };
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
};
