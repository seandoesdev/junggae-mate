/* 백엔드 /api 호출. 토큰은 탭(sessionStorage)에만 둔다. 401이면 로그인 화면으로 돌린다.
   API 서버가 다른 주소면(Cloudflare에서 화면만 내려줄 때) lib/config의 주소를 앞에 붙인다. 쿠키는 쓰지 않는다. */
import { apiUrl } from "./config";

type FieldError = { loc?: (string | number)[]; msg: string };

export class ApiError extends Error {
  status: number;
  fields: Record<string, string>;
  constructor(status: number, detail: unknown) {
    const list = Array.isArray(detail) ? (detail as FieldError[]) : null;
    const msg = list
      ? list.map((d) => `${(d.loc || []).slice(-1)[0] ?? ""}: ${d.msg}`).join(", ")
      : typeof detail === "string" ? detail : "";
    super(msg || `요청이 실패했습니다 (${status})`);
    this.status = status;
    this.fields = list ? Object.fromEntries(list.map((d) => [String((d.loc || []).slice(-1)[0]), d.msg])) : {};
  }
}

const TOKEN_KEY = "mate_token";
let token: string | null = sessionStorage.getItem(TOKEN_KEY);
let onUnauthorized: () => void = () => {};

export const getToken = () => token;
export function setToken(next: string | null) {
  token = next;
  if (next) sessionStorage.setItem(TOKEN_KEY, next);
  else sessionStorage.removeItem(TOKEN_KEY);
}
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export type Method = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function api<T = any>(
  method: Method,
  path: string,
  body?: unknown,
  opts: { form?: FormData; signal?: AbortSignal } = {},
): Promise<T> {
  const init: RequestInit = { method, headers: {}, signal: opts.signal };
  const headers = init.headers as Record<string, string>;
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.form) init.body = opts.form;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(apiUrl(path), init);
  if (res.status === 401 && path !== "/auth/login") {
    onUnauthorized();
    throw new ApiError(401, "다시 로그인해 주세요.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { detail?: unknown }).detail);
  return data as T;
}
