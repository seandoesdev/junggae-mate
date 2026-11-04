/* API 서버 주소.
   - FastAPI가 화면도 함께 내려줄 때: 비워 둔다 → 같은 주소의 /api
   - Cloudflare Worker가 화면만 내려줄 때: Worker가 /config.json 으로 API_URL을 알려 준다
     (Cloudflare 설정에서 값만 바꾸면 되고 다시 빌드하지 않는다)
   - 빌드할 때 고정하려면 VITE_API_URL=https://api.example.com */

const clean = (v: string) => v.trim().replace(/\/+$/, "");
const isHttp = (v: string) => /^https?:\/\/[^/\s]+/.test(v);

let base = clean(import.meta.env.VITE_API_URL ?? "");

/** "https://api.example.com" 또는 "" (같은 주소) */
export const apiBase = () => base;
/** apiUrl("/listings") → "https://api.example.com/api/listings" */
export const apiUrl = (path: string) => `${base}/api${path}`;

/** 화면을 그리기 전에 한 번 부른다. /config.json이 없거나 JSON이 아니면(FastAPI·개발 서버) 그대로 둔다 */
export async function loadConfig(): Promise<void> {
  try {
    const res = await fetch("/config.json", { cache: "no-store", headers: { Accept: "application/json" } });
    if (!res.ok || !(res.headers.get("content-type") || "").includes("application/json")) return;
    const c = (await res.json()) as { apiUrl?: unknown };
    if (typeof c.apiUrl === "string" && isHttp(c.apiUrl)) base = clean(c.apiUrl);
  } catch {
    /* 설정을 못 받으면 같은 주소의 /api를 쓴다 */
  }
}
