/* 여러 화면이 함께 쓰는 응답 모양. 화면 전용 모양은 각 features/* 안에 둔다. */

export type User = {
  id: number;
  name: string;
  email: string;
  role: "agent" | "admin";
  tenant_id: number;
  tenant_name: string;
};

/** 출처(근거) 한 건. 문서 조각(c), 매물(l), 실거래(t), 전월세(r), 단지(k), 건축물(b), 역(s) */
export type Evidence = {
  id: string;
  kind?: string;
  type?: string;
  type_label?: string;
  title: string;
  org?: string;
  date?: string;
  effective_date?: string | null;
  location?: string | null;
  snippet?: string;
  note?: string | null;
  state?: "ok" | "warn" | "stale" | string;
  url?: string | null;
  [k: string]: unknown;
};
