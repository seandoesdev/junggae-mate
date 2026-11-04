/* 해시 주소(#/map, #/ai/usage, #/customers/3 …)를 예전과 똑같이 쓴다. */
import { useSyncExternalStore } from "react";

export const PAGES = ["map", "ai", "deals", "customers", "library", "public", "report"] as const;
export type Page = (typeof PAGES)[number];

export type Route = { page: Page; a?: string; b?: string; hash: string };

const subscribe = (cb: () => void) => {
  addEventListener("hashchange", cb);
  return () => removeEventListener("hashchange", cb);
};
const snapshot = () => location.hash || "#/map";

export function parse(hash: string): Route {
  const [page = "map", a, b] = hash.replace(/^#\/?/, "").split("/");
  const known = (PAGES as readonly string[]).includes(page) ? (page as Page) : "map";
  return { page: known, a: a || undefined, b: b || undefined, hash };
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, snapshot);
  return parse(hash);
}

/** 방문 기록을 늘리지 않고 주소만 바꾼다. replaceState는 hashchange를 내지 않으므로 직접 알려
    useRoute를 쓰는 화면이 곧바로 따라오게 한다 (그러지 않으면 다음 렌더 때 '주소가 바뀐 것'으로 보여
    출처 패널·대화상자를 엉뚱하게 닫는다) */
export function replaceHash(hash: string) {
  if (location.hash === hash) return;
  history.replaceState(null, "", hash);
  dispatchEvent(new HashChangeEvent("hashchange"));
}

/** 로그아웃할 때 화면별로 기억해 둔 것(대화, 지도 범위, 검색어, 근거 모음)을 비우라는 신호 */
export const LOGOUT_EVENT = "mate:logout";

/** navigate("#/ai") — 같은 주소면 hashchange가 안 나므로 그대로 둔다 */
export function navigate(hash: string) {
  if (location.hash !== hash) location.hash = hash;
}
