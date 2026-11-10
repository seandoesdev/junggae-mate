/* 매물 등록·수정 (지도 왼쪽). 위치는 지도를 눌러 정한다: 누른 곳의 좌표가 위도·경도 칸에 채워지고, 표시를 끌어서 옮길 수 있다.
   거래 종류(매매·전세·월세)를 하나 이상 고르고 그 금액을 적는다. 한 매물을 여러 종류로 내놓을 수 있다 (금액은 만원). */
import { useState, type FormEvent, type ReactNode } from "react";
import { ApiError, api } from "@/lib/api";
import { DEAL_LABEL, PROPERTY_LABEL, type Deal } from "@/lib/format";
import { useToast } from "@/state/ui";
import type { Listing } from "./types";

export type LatLngText = { lat: string; lng: string };

/** 숫자 칸 (보낼 때 Number로 바꾼다) */
const NUMBER_FIELDS = new Set([
  "price", "jeonse_deposit", "monthly_deposit", "monthly_rent", "area_m2", "supply_m2", "rooms", "baths",
  "maintenance_fee", "loan_amount", "station_walk_min", "park_walk_min", "lat", "lng",
]);
const TEXT_FIELDS = ["title", "property_type", "complex_name", "address", "district", "floor", "facing", "maintenance_note",
  "parking", "move_in", "station", "description"];
const NEEDS_COMPLEX = new Set(["apartment", "officetel"]);

export function ListingForm({ listing, pos, onPos, onCancel, onSaved }: {
  listing: Listing | null;
  /** 위도·경도 칸 (지도를 누르거나 표시를 끌면 바뀐다) */
  pos: LatLngText;
  onPos: (p: LatLngText) => void;
  onCancel: () => void;
  onSaved: (l: Listing) => void;
}) {
  const toast = useToast();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [ptype, setPtype] = useState(listing?.property_type ?? "apartment");
  // 새 매물은 매매로 시작한다 (예전 화면과 같은 흐름)
  const [deals, setDeals] = useState<Set<Deal>>(() => new Set(listing ? listing.deal_types : ["sale"]));

  const val = (k: keyof Listing, fallback = "") => (listing?.[k] == null ? fallback : String(listing[k]));
  const err = (k: string) => <span className="field-error" data-err={k}>{errors[k] || ""}</span>;
  const field = (k: keyof Listing, label: string, opts: { type?: "number" | "text"; req?: boolean; ph?: string; init?: string } = {}) => (
    <label key={k}>
      {label}{opts.req ? " *" : ""}
      <input name={k} type={opts.type ?? "text"} step={opts.type === "number" ? "any" : undefined} required={opts.req}
        placeholder={opts.ph} defaultValue={val(k, opts.init ?? "")} />
      {err(k)}
    </label>
  );
  const row = (...children: ReactNode[]) => <div className="row2">{children}</div>;
  const toggleDeal = (d: Deal) => setDeals((s) => {
    const next = new Set(s);
    if (next.has(d)) next.delete(d); else next.add(d);
    return next;
  });

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrors({});
    if (!deals.size) { setErrors({ deal: "거래 종류를 하나 이상 고르세요." }); return; }
    const fd = new FormData(e.currentTarget);
    const body: Record<string, string | number | null> = {};
    for (const k of [...TEXT_FIELDS, ...NUMBER_FIELDS]) {
      const raw = String(fd.get(k) ?? "").trim();
      body[k] = raw === "" ? null : NUMBER_FIELDS.has(k) ? Number(raw) : raw;
    }
    // 고르지 않은 거래 종류의 금액은 보내지 않는다
    if (!deals.has("sale")) body.price = null;
    if (!deals.has("jeonse")) body.jeonse_deposit = null;
    if (!deals.has("monthly")) { body.monthly_deposit = null; body.monthly_rent = null; }
    setSaving(true);
    try {
      const l = await api<Listing>(listing ? "PUT" : "POST", listing ? `/listings/${listing.id}` : "/listings", body);
      toast(listing ? "매물을 고쳤습니다." : `${l.label} ${l.title} 등록했습니다.`);
      onSaved(l);
    } catch (ex) {
      if (ex instanceof ApiError) setErrors(ex.fields);
      toast((ex as Error).message.replace(/^body: Value error, /, ""), 4200);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form id="listing-form" className="form" data-id={listing ? listing.id : ""} noValidate onSubmit={submit}>
      <div className="detail-top">
        <h2>{listing ? "매물 수정" : "매물 등록"}</h2>
        <button type="button" className="btn btn--sm" data-act="cancel-form" onClick={onCancel}>취소</button>
      </div>
      {field("title", "매물 이름", { req: true })}
      {row(
        <label key="property_type">유형
          <select name="property_type" value={ptype} onChange={(e) => setPtype(e.target.value)}>
            {Object.entries(PROPERTY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>,
        field("complex_name", NEEDS_COMPLEX.has(ptype) ? "단지명" : "건물 이름", {
          req: NEEDS_COMPLEX.has(ptype), ph: NEEDS_COMPLEX.has(ptype) ? undefined : "비우면 매물 이름",
        }),
      )}
      {field("address", "주소", { req: true })}
      {field("district", "구", { req: true, init: listing ? "" : "마포구" })}

      <fieldset className="deal-pick" id="deal-pick">
        <legend>거래 종류 *</legend>
        <div className="toggle" role="group" aria-label="거래 종류">
          {(Object.keys(DEAL_LABEL) as Deal[]).map((d) => (
            <button key={d} type="button" data-deal={d} aria-pressed={deals.has(d)} onClick={() => toggleDeal(d)}>{DEAL_LABEL[d]}</button>
          ))}
        </div>
        {err("deal")}
        {deals.has("sale") && field("price", "매매가 (만원)", { type: "number", req: true })}
        {deals.has("jeonse") && field("jeonse_deposit", "전세 보증금 (만원)", { type: "number", req: true })}
        {deals.has("monthly") && row(
          field("monthly_deposit", "월세 보증금 (만원)", { type: "number", req: true }),
          field("monthly_rent", "월세 (만원)", { type: "number", req: true }),
        )}
      </fieldset>

      {row(field("area_m2", "전용면적 (㎡)", { type: "number", req: true }), field("supply_m2", "공급면적 (㎡)", { type: "number" }))}
      {row(field("rooms", "방", { type: "number" }), field("baths", "욕실", { type: "number" }))}
      {row(field("floor", "층", { ph: "7/15층" }), field("facing", "향", { ph: "남향" }))}
      {row(field("maintenance_fee", "관리비 (월, 만원)", { type: "number" }), field("maintenance_note", "관리비 포함 항목", { ph: "인터넷·수도" }))}
      {row(field("move_in", "입주 가능일", { ph: "즉시 / 2026-12-20 / 협의" }), field("parking", "주차", { ph: "세대당 1대" }))}
      {deals.has("sale") || deals.has("jeonse") ? field("loan_amount", "융자 (만원)", { type: "number", ph: "없으면 비움" }) : null}
      {row(field("station", "가까운 역"), field("station_walk_min", "역 도보 (분)", { type: "number" }))}
      {field("park_walk_min", "공원 도보 (분)", { type: "number" })}
      <p className="muted" style={{ margin: 0 }}>위치: 지도를 누르면 아래 좌표가 채워집니다.</p>
      <div className="row2">
        {(["lat", "lng"] as const).map((k) => (
          <label key={k}>
            {k === "lat" ? "위도" : "경도"} *
            <input name={k} type="number" step="any" required value={pos[k]} onChange={(e) => onPos({ ...pos, [k]: e.target.value })} />
            {err(k)}
          </label>
        ))}
      </div>
      <label>메모<textarea name="description" rows={3} defaultValue={listing?.description ?? ""} /></label>
      <div className="btns"><button type="submit" className="btn btn--main" disabled={saving}>{listing ? "저장" : "등록"}</button></div>
    </form>
  );
}
