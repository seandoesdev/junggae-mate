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

/** 만원 금액: 1억 이상 "3.2억", 미만 "5,000만" */
export const won = (v: number | null | undefined) =>
  v == null ? "-" : v >= 10000 ? eok(v) : `${v.toLocaleString("ko-KR")}만`;

export type Deal = "sale" | "jeonse" | "monthly";
export const DEAL_LABEL: Record<Deal, string> = { sale: "매매", jeonse: "전세", monthly: "월세" };
export const PROPERTY_LABEL: Record<string, string> = {
  apartment: "아파트", officetel: "오피스텔", villa: "빌라", house: "단독·다가구", oneroom: "원룸", commercial: "상가·사무실",
};

/** 매매가·전세 보증금·월세(보증금/월세)를 가진 것 (매물, 거래의 매물, 예전 스냅숏) */
export type Priced = {
  price?: number | null; jeonse_deposit?: number | null; monthly_deposit?: number | null; monthly_rent?: number | null;
};

/** 내놓은 거래 종류 (서버 drafting.offers와 같은 규칙) */
export const dealTypes = (l: Priced): Deal[] => {
  const out: Deal[] = [];
  if (l.price != null) out.push("sale");
  if (l.jeonse_deposit != null) out.push("jeonse");
  if (l.monthly_deposit != null && l.monthly_rent != null) out.push("monthly");
  return out;
};

const one = (l: Priced, d: Deal, short: boolean) =>
  d === "monthly" ? `${short ? "월" : "월세"} ${won(l.monthly_deposit)}/${l.monthly_rent}`
    : d === "jeonse" ? `${short ? "전" : "전세"} ${won(l.jeonse_deposit)}`
      : short ? eok(l.price) : `매매 ${eok(l.price)}`;

/** "매매 9.2억 · 전세 5억" (deal을 주면 그 종류만) */
export const priceText = (l: Priced, deal?: Deal | null) => {
  const ds = deal && dealTypes(l).includes(deal) ? [deal] : dealTypes(l);
  return ds.map((d) => one(l, d, false)).join(" · ") || "-";
};

/** 핀·목록용 짧은 금액: 한 종류만. 매매는 예전처럼 "7.8억", 전세 "전 5.2억", 월세 "월 1,000만/75" */
export const shortPrice = (l: Priced, deal?: Deal | null) => {
  const ds = dealTypes(l);
  const d = deal && ds.includes(deal) ? deal : ds[0];
  return d ? one(l, d, true) : "-";
};

/** 정렬용 대표 금액 */
export const mainAmount = (l: Priced) => l.price ?? l.jeonse_deposit ?? l.monthly_deposit ?? 0;

/** ISO → "05/21" */
export const day = (iso?: string | null) => (iso ? iso.slice(5, 10).replace("-", "/") : "");
/** ISO → "05/21 14:03" */
export const dateTime = (iso?: string | null) => (iso ? `${iso.slice(5, 10).replace("-", "/")} ${iso.slice(11, 16)}` : "");

/** 근거 제목 앞의 [샘플] 표시를 뗀다 */
export const cleanTitle = (t?: string | null) => String(t || "").replace(/^\[샘플\]\s*/, "");

/** "c12", "l3" 같은 근거 번호 (구조화 근거 c/l/t/r/k/b/s) */
export const NOTE_TOKEN = /\[([cltrkbs]\d+)\]/g;
