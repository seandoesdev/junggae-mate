/* 지도 화면이 화면을 떠났다 돌아와도 기억하는 것 (예전 전역 M과 같다):
   - 질문 결과(ask): Hood에서 '지도에서 보기'를 누르면 답변을 그대로 넘겨 받는다 (다시 묻지 않는다)
   - 보기 범위(내 매물·사무소 전체)와 숨긴 거래 단계
   지도 밖 화면으로 가면 질문 결과는 잊는다 (다른 화면에서 매물을 열었을 때 이전 질문으로 돌아가지 않도록). */
import { LOGOUT_EVENT, navigate } from "@/lib/router";
import type { AskResult, AskState } from "./types";

export const askHash = (q: string) => `#/map/ask/${encodeURIComponent(q)}`;
export const askKey = (q: string, drop: string[]) => `${q}|${drop.join(",")}`;

let ask: AskState | null = null;

export const mapMemory = {
  scope: "mine" as "mine" | "all",
  scopeUser: null as number | null,
  hidden: new Set<string>(),
  /** 거래 종류 필터 (null = 전체) */
  deal: null as "sale" | "jeonse" | "monthly" | null,
};

export const getMapAsk = () => ask;
export function setMapAsk(next: AskState | null) {
  ask = next;
}

/** Hood 답변을 지도 질문 결과로 넘긴다. 이어서 askHash(q)로 이동하면 다시 묻지 않고 이 결과를 쓴다 */
export function seedMapAsk(q: string, drop: string[], result: AskResult) {
  ask = { q, drop, key: askKey(q, drop), result };
}

/** seedMapAsk + 지도 질문 결과로 이동 */
export function showAskOnMap(q: string, drop: string[], result: AskResult) {
  seedMapAsk(q, drop, result);
  navigate(askHash(q));
}

/* 같은 질문을 동시에 두 번 보내지 않는다 (개발 모드 StrictMode의 effect 재실행 등).
   질문 하나가 대화 하나·월 질문 수 하나로 기록되므로, 진행 중인 요청이 있으면 그 결과를 같이 기다린다 */
const inflight = new Map<string, Promise<unknown>>();
export function searchOnce<T>(key: string, send: () => Promise<T>): Promise<T> {
  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const p = send().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

addEventListener("hashchange", () => {
  if (!location.hash.startsWith("#/map")) ask = null;
});

// 로그아웃하면 지도 기억을 처음으로
addEventListener(LOGOUT_EVENT, () => {
  ask = null;
  mapMemory.scope = "mine";
  mapMemory.scopeUser = null;
  mapMemory.hidden.clear();
  mapMemory.deal = null;
});
