/* 매물 등록·수정 (지도 왼쪽). 위치는 지도를 눌러 정한다: 누른 곳의 좌표가 위도·경도 칸에 채워지고, 표시를 끌어서 옮길 수 있다 */
import { useState, type FormEvent } from "react";
import { ApiError, api } from "@/lib/api";
import { useToast } from "@/state/ui";
import type { Listing } from "./types";

type Field = [key: keyof Listing, label: string, type: "text" | "number", required?: boolean];

const FIELDS: Field[] = [
  ["title", "매물 이름", "text", true], ["complex_name", "단지명", "text", true], ["address", "주소", "text", true],
  ["district", "구", "text", true], ["price", "매도 희망가 (만원)", "number", true], ["area_m2", "전용면적 (㎡)", "number", true],
  ["floor", "층", "text"], ["station", "가까운 역", "text"], ["station_walk_min", "역 도보 (분)", "number"],
  ["park_walk_min", "공원 도보 (분)", "number"], ["lat", "위도", "number", true], ["lng", "경도", "number", true],
];

export type LatLngText = { lat: string; lng: string };

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

  const input = ([k, label, type, req]: Field) => {
    const coord = k === "lat" || k === "lng";
    const initial = k === "district" && !listing ? "마포구" : String(listing?.[k] ?? "");
    return (
      <label key={k}>
        {label}{req ? " *" : ""}
        {coord ? (
          <input name={k} type={type} step="any" required={req} value={pos[k]}
            onChange={(e) => onPos({ ...pos, [k]: e.target.value })} />
        ) : (
          <input name={k} type={type} step={type === "number" ? "any" : undefined} required={req} defaultValue={initial} />
        )}
        <span className="field-error" data-err={k}>{errors[k] || ""}</span>
      </label>
    );
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrors({});
    const fd = new FormData(e.currentTarget);
    const body: Record<string, string | number | null> = {};
    [...FIELDS.map((f) => f[0] as string), "description"].forEach((k) => {
      const raw = String(fd.get(k) ?? "").trim();
      const num = FIELDS.find((f) => f[0] === k)?.[2] === "number";
      body[k] = raw === "" ? null : num ? Number(raw) : raw;
    });
    setSaving(true);
    try {
      const l = await api<Listing>(listing ? "PUT" : "POST", listing ? `/listings/${listing.id}` : "/listings", body);
      toast(listing ? "매물을 고쳤습니다." : `${l.label} ${l.title} 등록했습니다.`);
      onSaved(l);
    } catch (ex) {
      if (ex instanceof ApiError) setErrors(ex.fields);
      toast((ex as Error).message, 4200);
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
      {FIELDS.slice(0, 4).map(input)}
      <div className="row2">{FIELDS.slice(4, 6).map(input)}</div>
      <div className="row2">{FIELDS.slice(6, 8).map(input)}</div>
      <div className="row2">{FIELDS.slice(8, 10).map(input)}</div>
      <p className="muted" style={{ margin: 0 }}>위치: 지도를 누르면 아래 좌표가 채워집니다.</p>
      <div className="row2">{FIELDS.slice(10).map(input)}</div>
      <label>메모<textarea name="description" rows={3} defaultValue={listing?.description ?? ""} /></label>
      <div className="btns"><button type="submit" className="btn btn--main" disabled={saving}>{listing ? "저장" : "등록"}</button></div>
    </form>
  );
}
