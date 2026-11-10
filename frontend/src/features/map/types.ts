/* 지도 화면 응답 모양 (예전 app-map.js / app-ask.js가 쓰던 그대로) */
import type { Evidence } from "@/lib/types";

export type Listing = {
  id: number;
  label: string;
  title: string;
  complex_name: string;
  address: string;
  district: string;
  /** 매매가 (만원). 전세·월세만 내놓은 매물은 null */
  price: number | null;
  jeonse_deposit: number | null;
  monthly_deposit: number | null;
  monthly_rent: number | null;
  /** 서버가 계산한 거래 종류·금액 표기 ("매매 9.2억 · 전세 5억") */
  deal_types: ("sale" | "jeonse" | "monthly")[];
  price_text: string;
  property_type: string;
  supply_m2: number | null;
  rooms: number | null;
  baths: number | null;
  facing: string | null;
  maintenance_fee: number | null;
  maintenance_note: string | null;
  parking: string | null;
  move_in: string | null;
  loan_amount: number | null;
  area_m2: number;
  floor: string | null;
  station: string | null;
  station_walk_min: number | null;
  park_walk_min: number | null;
  lat: number | null;
  lng: number | null;
  description: string | null;
  source: string;
  source_date: string;
  agent_id: number;
  agent_name: string;
  stage: string;
  active_deals: number;
  mine: boolean;
  price_history: { price: number; changed_at: string }[];
};

export type Deal = {
  id: number;
  customer_id: number;
  customer_name: string;
  agent_id: number;
  agent_name: string;
  stage: string;
  next_action: string | null;
  dropped_reason: string | null;
  days_in_stage: number;
  listing: { id: number; label: string; title: string; agent_id: number };
};

export type Check = {
  key: string;
  text: string;
  level: "urgent" | "warn" | "normal" | string;
  sources: Evidence[];
  checked: boolean;
  checked_by: string | null;
  checked_at: string | null;
};

export type Note = { id: number; text: string; by: string; user_id: number; created_at: string };

export type TradeReference = { median_price: number; count: number; period: string; source: string } | null;

export type ListingDetail = {
  listing: Listing;
  trade_reference: TradeReference;
  deals: Deal[];
  checks: Check[];
  notes: Note[];
};

export type PubKind = "complex" | "station" | "building";
export type PubFact = { value: Record<string, unknown>; evidence: Evidence } | null;
export type PubCandidate = { entity_key: string; label: string; detail?: string | null };
export type PubLink = { kind: string; entity_key: string; label: string; confirmed_by?: string | null };

export type ListingPublic = {
  links: Partial<Record<PubKind, PubLink>>;
  candidates: Partial<Record<PubKind, PubCandidate[]>>;
  facts: { rent: PubFact; complex: PubFact; building: PubFact; station: PubFact };
  can_edit: boolean;
};

export type RentRow = {
  id: number;
  contract_date: string;
  deposit: number;
  monthly_rent: number;
  rent_type: "jeonse" | "monthly" | string;
  floor: number | null;
  area_m2: number;
};

export type AskListing = Listing & {
  matched: { want: string; text: string }[];
  unmet: string[];
};

export type AskPlace = { name: string; lat: number; lng: number; radius_m: number | null };

export type AskResult = {
  opinion: string;
  to_check: string[];
  sources: Evidence[];
  understood: { key: string; label: string }[];
  listings: AskListing[];
  listing_intent?: boolean;
  relaxed?: boolean;
  place?: AskPlace | null;
  session_id?: number | null;
  [k: string]: unknown;
};

export type AskState = { q: string; drop: string[]; key: string; result: AskResult };

export type Customer = { id: number; name: string; agent_id: number; agent_name: string };
