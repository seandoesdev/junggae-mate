/* Cloudflare Pages Function — GET /config.json
   화면이 시작할 때 부를 API 서버 주소를 알려 준다. 값은 Pages 프로젝트의 환경 변수 API_URL
   (대시보드 > Workers & Pages > junggae-mate > Settings > Variables and Secrets,
    또는 `npx wrangler pages secret put API_URL --project-name junggae-mate`).
   값을 바꾸면 다시 빌드하지 않아도 다음 배포부터 반영된다. API 서버는 CORS_ORIGINS에 이 화면 주소를 넣어야 한다. */

interface Env {
  /** 예: https://api.example.com (끝의 / 없이) */
  API_URL?: string;
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
  return new Response(JSON.stringify({ apiUrl: isHttpUrl(raw) ? raw : "" }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
};
