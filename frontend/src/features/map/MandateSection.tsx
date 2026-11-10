/* 매물 상세 › 의뢰인·방문 안내 (PRD F2). 사무소 누구나 보고(방문 약속에 필요), 고치는 것은 매물 담당·관리자.
   연락처·출입 정보는 가림 표시만 내려오고, '보기'를 누르면 원문을 한 번 받는다 (서버가 볼 때마다 감사 기록). */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { dateTime, day } from "@/lib/format";
import { useBusy, useToast, useUi } from "@/state/ui";

type Owner = {
  id: number; name: string; relation: string; memo: string | null;
  phone: string | null; has_phone: boolean; privacy_consent_at: string | null;
};
type OwnerRow = Owner & { listings: number };
type Mandate = {
  owner: Owner; kind: "general" | "exclusive"; starts_on: string | null; ends_on: string | null; days_left: number | null;
  price_flex: string | null; move_out: string | null; occupancy: "vacant" | "owner" | "tenant";
  tenant_phone: string | null; has_tenant_phone: boolean; visit_rule: string | null; has_access: boolean;
  updated_by: string | null; updated_at: string;
};
type Data = { mandate: Mandate | null; can_edit: boolean };
type Field = "owner_phone" | "tenant_phone" | "access";

const KIND = { general: "일반 중개", exclusive: "전속 중개" } as const;
const OCC = { vacant: "공실", owner: "집주인 거주", tenant: "세입자 거주" } as const;

export function MandateSection({ listingId, reloadKey }: { listingId: number; reloadKey: number }) {
  const toast = useToast();
  const { openDialog } = useUi();
  const [data, setData] = useState<Data | null>(null);

  const load = useCallback(async () => {
    try { setData(await api<Data>("GET", `/listings/${listingId}/mandate`)); }
    catch (e) { toast((e as Error).message); }
  }, [listingId, toast]);
  useEffect(() => { void load(); }, [load, reloadKey]);

  if (!data) return <div id="mandate-sec"><div className="sec-h"><h2>의뢰인·방문 안내</h2></div><p className="loading">불러오는 중…</p></div>;
  const m = data.mandate;
  const edit = () => openDialog((close) => (
    <MandateDialog listingId={listingId} mandate={m} close={close} onSaved={(d) => { setData(d); close(); }} />
  ));

  return (
    <div id="mandate-sec">
      <div className="sec-h">
        <h2>의뢰인·방문 안내</h2>
        {data.can_edit
          ? <button type="button" className="btn--link" data-act="edit-mandate" onClick={edit}>{m ? "수정" : "등록"}</button>
          : <span className="muted">수정은 매물 담당</span>}
      </div>
      {!m ? <p className="empty">의뢰인 정보가 없습니다.{data.can_edit ? " 집주인 연락처와 방문 방법을 적어 두세요." : ""}</p> : (
        <>
          <dl className="kv">
            <dt>의뢰인</dt>
            <dd>
              {m.owner.name} <span className="muted">({m.owner.relation})</span>
              {m.owner.phone && <> · <Secret listingId={listingId} field="owner_phone" masked={m.owner.phone} /></>}
              {!m.owner.privacy_consent_at && <><br /><span style={{ color: "var(--warn)" }}>개인정보 동의 기록 없음</span></>}
              {m.owner.memo && <><br /><span className="muted">{m.owner.memo}</span></>}
            </dd>
            <dt>의뢰</dt>
            <dd>
              {KIND[m.kind]}
              {(m.starts_on || m.ends_on) && <> · {m.starts_on ? day(m.starts_on) : ""} ~ {m.ends_on ? day(m.ends_on) : ""}</>}
              {m.days_left != null && m.days_left <= 7 && (
                <b style={{ color: m.days_left < 0 ? "var(--bad)" : "var(--warn)" }}>
                  {" "}{m.days_left < 0 ? "만료됨" : `만료 D-${m.days_left}`}
                </b>
              )}
            </dd>
            {m.price_flex && <><dt>가격 조정</dt><dd>{m.price_flex}</dd></>}
            {m.move_out && <><dt>희망 시기</dt><dd>{m.move_out}</dd></>}
            <dt>거주</dt>
            <dd>
              {OCC[m.occupancy]}
              {m.occupancy === "tenant" && m.tenant_phone && <> · 세입자 <Secret listingId={listingId} field="tenant_phone" masked={m.tenant_phone} /></>}
            </dd>
            <dt>방문</dt><dd>{m.visit_rule || "-"}</dd>
            <dt>출입</dt><dd>{m.has_access ? <Secret listingId={listingId} field="access" masked="저장됨" /> : "-"}</dd>
          </dl>
          <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
            마지막 수정 {m.updated_by || "-"} · {dateTime(m.updated_at)} · 연락처·출입 정보를 보면 기록이 남습니다
          </p>
        </>
      )}
    </div>
  );
}

/** 가림 표시 + [보기]. 연락처는 전화 걸기 링크로 보여 준다 */
function Secret({ listingId, field, masked }: { listingId: number; field: Field; masked: string }) {
  const toast = useToast();
  const [value, setValue] = useState<string | null>(null);
  useEffect(() => setValue(null), [listingId, masked]);
  if (value) {
    return field === "access" ? <b data-secret={field}>{value}</b>
      : <a href={`tel:${value.replace(/[^0-9+]/g, "")}`} className="num" data-secret={field}>{value}</a>;
  }
  return (
    <span className="num">{masked}{" "}
      <button type="button" className="btn--link" data-act="reveal" data-field={field} onClick={async () => {
        try { setValue((await api<{ value: string }>("POST", `/listings/${listingId}/mandate/reveal`, { field })).value); }
        catch (e) { toast((e as Error).message); }
      }}>보기</button>
    </span>
  );
}

function MandateDialog({ listingId, mandate: m, close, onSaved }: {
  listingId: number; mandate: Mandate | null; close: () => void; onSaved: (d: Data) => void;
}) {
  const toast = useToast();
  const [busy, run] = useBusy();
  const [owners, setOwners] = useState<OwnerRow[]>([]);
  const [ownerId, setOwnerId] = useState<string>(m ? String(m.owner.id) : "new");
  const [occ, setOcc] = useState<Mandate["occupancy"]>(m?.occupancy ?? "vacant");

  useEffect(() => {
    api<OwnerRow[]>("GET", "/owners").then(setOwners).catch((e) => toast((e as Error).message));
  }, [toast]);

  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? "").trim() || null;
    const body = {
      ...(ownerId === "new"
        ? { owner: { name: s("owner_name") ?? "", phone: s("owner_phone"), relation: s("relation") ?? "본인", memo: s("owner_memo"),
            privacy_consent: f.get("privacy_consent") === "on" } }
        : { owner_id: Number(ownerId) }),
      kind: s("kind"), starts_on: s("starts_on"), ends_on: s("ends_on"), price_flex: s("price_flex"), move_out: s("move_out"),
      occupancy: occ, tenant_phone: occ === "tenant" ? s("tenant_phone") : null, visit_rule: s("visit_rule"),
      access: s("access"), clear_access: f.get("clear_access") === "on",
    };
    const r = await run(() => api<Data>("PUT", `/listings/${listingId}/mandate`, body));
    if (r) { toast("의뢰인·방문 안내를 저장했습니다."); onSaved(r); }
  };

  const remove = async () => {
    if (!confirm("이 매물의 의뢰인·방문 안내를 지울까요? (의뢰인 기록은 남습니다)")) return;
    const r = await run(() => api("DELETE", `/listings/${listingId}/mandate`));
    if (r) { toast("지웠습니다."); onSaved({ mandate: null, can_edit: true }); }
  };

  return (
    <form onSubmit={save} id="mandate-form">
      <h2>의뢰인·방문 안내</h2>
      <label>의뢰인
        <select name="owner_pick" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
          <option value="new">새 의뢰인 적기</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>{o.name} ({o.relation}){o.phone ? ` · ${o.phone}` : ""}{o.listings ? ` · 매물 ${o.listings}` : ""}</option>
          ))}
        </select>
      </label>
      {ownerId === "new" && (
        <>
          <div className="row2">
            <label>이름 *<input name="owner_name" required maxLength={50} /></label>
            <label>관계<input name="relation" defaultValue="본인" maxLength={20} placeholder="본인 / 배우자 / 대리인" /></label>
          </div>
          <label>연락처<input name="owner_phone" maxLength={30} placeholder="010-0000-0000" autoComplete="off" /></label>
          <label>메모<input name="owner_memo" maxLength={500} /></label>
          <label className="check-row"><input name="privacy_consent" type="checkbox" /> 개인정보 수집·이용 동의를 받았습니다</label>
        </>
      )}
      <div className="row2">
        <label>의뢰 방식
          <select name="kind" defaultValue={m?.kind ?? "general"}>
            <option value="general">일반 중개</option><option value="exclusive">전속 중개</option>
          </select>
        </label>
        <label>거주 상태
          <select name="occupancy" value={occ} onChange={(e) => setOcc(e.target.value as Mandate["occupancy"])}>
            <option value="vacant">공실</option><option value="owner">집주인 거주</option><option value="tenant">세입자 거주</option>
          </select>
        </label>
      </div>
      <div className="row2">
        <label>의뢰일<input name="starts_on" type="date" defaultValue={m?.starts_on ?? ""} /></label>
        <label>의뢰 만료일<input name="ends_on" type="date" defaultValue={m?.ends_on ?? ""} /></label>
      </div>
      <div className="row2">
        <label>가격 조정 여지<input name="price_flex" maxLength={200} defaultValue={m?.price_flex ?? ""} placeholder="500만 원까지" /></label>
        <label>희망 입주·명도 시기<input name="move_out" maxLength={100} defaultValue={m?.move_out ?? ""} /></label>
      </div>
      {occ === "tenant" && (
        <label>세입자 연락처{m?.has_tenant_phone ? " (바꿀 때만 입력)" : ""}
          <input name="tenant_phone" maxLength={30} placeholder={m?.tenant_phone ?? "010-0000-0000"} autoComplete="off" />
        </label>
      )}
      <label>방문 안내<input name="visit_rule" maxLength={300} defaultValue={m?.visit_rule ?? ""} placeholder="평일 18시 이후, 하루 전 연락" /></label>
      <label>출입 비밀번호·열쇠 위치{m?.has_access ? " (저장됨 · 바꿀 때만 입력)" : ""}
        <input name="access" maxLength={200} autoComplete="off" placeholder="암호화해 저장, 거래 종료 시 자동 삭제" />
      </label>
      {m?.has_access && <label className="check-row"><input name="clear_access" type="checkbox" /> 저장된 출입 정보 지우기</label>}
      <div className="btns">
        {m && <button type="button" className="btn" data-act="delete-mandate" disabled={busy} onClick={remove}>지우기</button>}
        <button type="button" className="btn" data-act="close-dialog" onClick={close}>취소</button>
        <button type="submit" className="btn btn--main" data-act="mandate-save" disabled={busy}>저장</button>
      </div>
    </form>
  );
}
