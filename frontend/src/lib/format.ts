/* 화면 전체가 같이 쓰는 이름표와 숫자 표기 (예전 app-core.js와 같은 규칙) */

export const STAGES = ["intro", "visit", "nego", "contract", "done"] as const;
export type Stage = (typeof STAGES)[number] | "available" | "dropped";

export const STAGE_LABEL: Record<string, string> = {
  available: "거래 가능", intro: "소개", visit: "방문", nego: "협의", contract: "계약", done: "완료", dropped: "무산",
};
export const STAGE_COLOR: Record<string, string> = {
  available: "var(--st-available)", intro: "var(--st-intro)", visit: "var(--st-visit)", nego: "var(--st-nego)",
  contract: "var(--st-contract)", done: "var(--st-done)", dropped: "var(--st-dropped)",
};
export const TYPE_WORD: Record<string, string> = { law: "법령", policy: "정책", office: "사무소", news: "기사", data: "데이터" };

export const stageIdx = (s: string) => (STAGES as readonly string[]).indexOf(s);

/** 만원 단위 금액 → "8.5억" */
export const eok = (p: number | null | undefined) =>
  p == null ? "-" : `${(p / 10000).toFixed(2).replace(/\.?0+$/, "")}억`;

/** ISO → "05/21" */
export const day = (iso?: string | null) => (iso ? iso.slice(5, 10).replace("-", "/") : "");
/** ISO → "05/21 14:03" */
export const dateTime = (iso?: string | null) => (iso ? `${iso.slice(5, 10).replace("-", "/")} ${iso.slice(11, 16)}` : "");

/** 근거 제목 앞의 [샘플] 표시를 뗀다 */
export const cleanTitle = (t?: string | null) => String(t || "").replace(/^\[샘플\]\s*/, "");

/** "c12", "l3" 같은 근거 번호 (구조화 근거 c/l/t/r/k/b/s) */
export const NOTE_TOKEN = /\[([cltrkbs]\d+)\]/g;
