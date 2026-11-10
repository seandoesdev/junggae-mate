/* Hood AI 대화 상태 (예전 app-hood.js의 H, CONV).
   전용 화면(#/ai)과 Ask Hood 패널은 각자의 대화를 가진다: main = 전용 화면, side = 패널.
   새 대화는 key를 바꿔 끼워, 늦게 온 이전 답이 새 대화에 섞이지 않게 한다.
   화면이 바뀌어도(전용 화면이 사라져도) 대화가 남도록 모듈 안에 둔다. */
import { useSyncExternalStore } from "react";
import { api } from "@/lib/api";
import { LOGOUT_EVENT, replaceHash } from "@/lib/router";
import type { Evidence } from "@/lib/types";

export type Cond = { key: string; label: string };
export type TurnListing = {
  id: number;
  label: string;
  title: string;
  price: number | null;
  jeonse_deposit?: number | null;
  monthly_deposit?: number | null;
  monthly_rent?: number | null;
  area_m2: number;
  district: string;
  stage: string;
  lat: number | null;
  lng: number | null;
  matched: { want: string; text: string }[];
  unmet: string[];
};
export type Place = { name: string; lat: number; lng: number; radius_m: number | null };
export type Turn = {
  message_id: number;
  session_id: number;
  question: string;
  effective_query?: string;
  understood: Cond[];
  dropped?: string[];
  listings: TurnListing[];
  listing_intent?: boolean;
  relaxed?: boolean;
  place?: Place | null;
  opinion: string;
  to_check: string[];
  sources: Evidence[];
  asked_at?: string;
};
export type SessionItem = { id: number; title: string; updated_at: string; messages: number; last_question?: string };

export type Conv = { key: number; sid: number | null; title: string; turns: Turn[]; pending: string | null };
export type Slot = "main" | "side";

type State = { main: Conv; side: Conv; sessions: SessionItem[]; news: boolean };

let seq = 0;
export const blankConv = (): Conv => ({ key: ++seq, sid: null, title: "", turns: [], pending: null });

let state: State = { main: blankConv(), side: blankConv(), sessions: [], news: true };
const subs = new Set<() => void>();
const set = (patch: Partial<State>) => { state = { ...state, ...patch }; subs.forEach((f) => f()); };
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

// 로그아웃하면 대화를 비운다 (같은 탭에서 다른 사람이 로그인해도 앞 사람의 대화가 보이지 않게)
addEventListener(LOGOUT_EVENT, () => set({ main: blankConv(), side: blankConv(), sessions: [] }));

export const hood = {
  get: () => state,
  setConv(slot: Slot, conv: Conv) { set({ [slot]: conv } as Partial<State>); },
  setNews(news: boolean) { set({ news }); },
  async loadSessions() {
    try { set({ sessions: await api<SessionItem[]>("GET", "/ai/sessions") }); } catch { set({ sessions: [] }); }
  },
  async loadConv(id: number): Promise<Conv> {
    const s = await api<{ id: number; title: string; messages: Turn[] }>("GET", `/ai/sessions/${id}`);
    return { key: ++seq, sid: s.id, title: s.title, turns: s.messages, pending: null };
  },
  /** 질문 하나 (예전 hoodAsk). replace: 조건을 빼고 같은 질문을 다시 찾아 그 답을 바꿔 끼운다 */
  async ask(slot: Slot, q: string, toast: (m: string, ms?: number) => void,
    { drop = [], replace = false }: { drop?: string[]; replace?: boolean } = {}) {
    const conv = state[slot];
    if (conv.pending) return;
    const key = conv.key;
    if (!replace) set({ [slot]: { ...conv, pending: q } } as Partial<State>);
    try {
      const r = await api<Turn>("POST", "/search", {
        q, drop, session_id: conv.sid || undefined, exclude_types: state.news ? [] : ["news"],
      });
      const cur = state[slot];
      if (cur.key === key) {
        const turns = cur.turns.slice();
        const i = turns.findIndex((t) => t.message_id === r.message_id);
        if (i >= 0) turns[i] = r; else turns.push(r);
        set({ [slot]: { ...cur, turns, title: cur.sid ? cur.title : q, sid: r.session_id, pending: null } } as Partial<State>);
      }
    } catch (e) {
      toast((e as Error).message, 4800);
    } finally {
      const cur = state[slot];
      if (cur.key === key && cur.pending) set({ [slot]: { ...cur, pending: null } } as Partial<State>);
    }
    void hood.loadSessions();
    // 전용 화면의 대화는 주소에 대화 번호를 남긴다 (다시 열거나 공유하기 쉽게). 화면을 다시 불러오지 않도록 replaceState
    const c = state.main;
    if (slot === "main" && c.key === key && c.sid && /^#\/ai(\/s\/\d+)?$/.test(location.hash || "") && location.hash !== `#/ai/s/${c.sid}`) {
      replaceHash(`#/ai/s/${c.sid}`);
    }
  },
};

export function useHood() {
  return useSyncExternalStore(subscribe, hood.get);
}

// ── 이름표·도우미 ─────────────────────────────────────────
export const TYPE_NAME: Record<string, string> = { data: "매물·실거래가", law: "법령", policy: "정책", office: "사무소 자료", news: "기사" };
export const ROUTE_NAME: Record<string, string> = {
  listing: "매물", trade: "매매 실거래가", rent: "전월세 실거래가", complex: "단지(K-apt)", building: "건축물대장", station: "지하철 노선", document: "법령·정책·자료",
};
export const STATE_NAME: Record<string, string> = { draft: "작성 중", review: "검토 중", approved: "승인", shared: "전달됨" };
export const ASK_EXAMPLES = ["마포구 8억 이하 59㎡ 학교 가까운 집", "마포한강뷰 전세 시세와 세대수", "동탄 매물 보여줘", "거래 신고는 계약 후 며칠 안에?"];

export const askHash = (q: string) => `#/map/ask/${encodeURIComponent(q)}`;

const RECENT_KEY = "mate_recent_questions";
/** 최근 질문 (지도 화면과 같이 쓰는 sessionStorage) */
export function rememberQuestion(q: string) {
  let prev: string[] = [];
  try { prev = JSON.parse(sessionStorage.getItem(RECENT_KEY) || "[]") || []; } catch { /* 비었으면 새로 */ }
  sessionStorage.setItem(RECENT_KEY, JSON.stringify([q, ...prev.filter((x) => x !== q)].slice(0, 5)));
}

/** "오늘 14:03" / "어제 09:10" / "10/27" */
export function when(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso), now = new Date();
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (d.toDateString() === now.toDateString()) return `오늘 ${hm}`;
  if (new Date(now.getTime() - 864e5).toDateString() === d.toDateString()) return `어제 ${hm}`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
