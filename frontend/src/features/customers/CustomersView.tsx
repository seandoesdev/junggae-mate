/* 고객 화면 (예전 app-people.js의 VIEWS.customers / renderCustomer / 고객 등록·수정 / 고객 자료 만들기).
   왼쪽 고객 목록(#customer-list), 오른쪽 상세(#customer-detail). 고객을 바꾸면 상세가 짧게 나타나고,
   새 상담 기록은 위에서 살짝 올라오며 들어온다. */
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { ViewProps } from "@/App";
import { Prog, StageTag } from "@/components/Stage";
import { api } from "@/lib/api";
import { day, eok, priceText, won } from "@/lib/format";
import { fadeIn, fadeUp } from "@/lib/motion";
import { navigate } from "@/lib/router";
import { useUser } from "@/state/session";
import { useBusy, useToast, useUi } from "@/state/ui";

type Customer = {
  id: number;
  name: string;
  deal_type: string;
  /** 끝 4자리 가림 표시 ("***-****-1234"). 원문은 '보기'로만 */
  phone: string | null;
  has_phone: boolean;
  /** 사무소 설정상 이 사람에게는 연락처를 보여 주지 않음 */
  phone_hidden: boolean;
  privacy_consent_at: string | null;
  monthly_rent_max: number | null;
  agent_id: number;
  agent_name: string;
  budget_max: number | null;
  area_min: number | null;
  district: string | null;
  station_walk_max: number | null;
  preferences: string[];
  first_home: boolean;
  top_stage: string | null;
  active_deals: number;
};
type CustomerDeal = {
  id: number;
  listing_id: number;
  stage: string;
  next_action: string | null;
  dropped_reason: string | null;
  listing: { label: string; title: string; price: number | null; price_text?: string };
};
type ReportRow = { id: number; title: string; created_at: string; version: string; state: string };
type Activity = { at: string; text: string; user_name?: string | null };
type CustomerDetail = { customer: Customer; deals: CustomerDeal[]; reports: ReportRow[]; activities: Activity[] };
type CustomerSaved = Customer & { warnings: string[] };

const REPORT_STATE: Record<string, string> = { draft: "작성 중", review: "검토 요청", approved: "승인", shared: "전달함" };

/** 행 전체를 누르거나 Enter로 열기 (예전 tr.clickable[tabindex=0]) */
const rowKeys = (go: () => void) => (e: KeyboardEvent) => {
  if (e.key === "Enter" && e.target === e.currentTarget) { e.preventDefault(); go(); }
};

export default function CustomersView({ a }: ViewProps) {
  const user = useUser();
  const toast = useToast();
  const { openDialog } = useUi();

  const list = useQuery({ queryKey: ["customers"], queryFn: () => api<Customer[]>("GET", "/customers") });
  useEffect(() => { if (list.error) toast((list.error as Error).message); }, [list.error, toast]);

  const rows = list.data;
  const cid = Number(a) || rows?.find((c) => c.agent_id === user.id)?.id || rows?.[0]?.id;

  return (
    <main id="view-customers" className="view view-split">
      <aside className="side" id="customer-list" aria-label="고객 목록">
        {rows && (
          <>
            <div className="side-h">
              <h2>고객 <span className="muted num">{rows.length}</span></h2>
              <button type="button" className="btn btn--sm" data-act="new-customer"
                onClick={() => openDialog((close) => <CustomerDialog close={close} />)}>고객 등록</button>
            </div>
            <table className="tbl">
              <thead><tr><th>이름</th><th>담당</th><th>진행</th></tr></thead>
              <tbody>
                {rows.map((c) => {
                  const go = () => navigate(`#/customers/${c.id}`);
                  return (
                    <tr key={c.id} className={`clickable ${c.id === cid ? "is-sel" : ""}`} data-act="customer" data-id={c.id}
                      tabIndex={0} onClick={go} onKeyDown={rowKeys(go)} aria-current={c.id === cid || undefined}>
                      <td><b>{c.name}</b> <span className="muted">{c.deal_type}</span></td>
                      <td>{c.agent_name}</td>
                      <td>{c.top_stage
                        ? <><StageTag s={c.top_stage} /> <span className="muted num">{c.active_deals}건</span></>
                        : <span className="muted">-</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </aside>
      <section className="pane" id="customer-detail">
        {rows && !cid && <p className="empty">등록된 고객이 없습니다.</p>}
        {cid ? <Detail cid={cid} /> : null}
      </section>
    </main>
  );
}

function Detail({ cid }: { cid: number }) {
  const toast = useToast();
  const { openDialog } = useUi();
  const qc = useQueryClient();
  const [warnings, setWarnings] = useState<string[]>([]);

  const q = useQuery({
    queryKey: ["customer", cid],
    queryFn: () => api<CustomerDetail>("GET", `/customers/${cid}`),
    placeholderData: keepPreviousData,
  });
  useEffect(() => { if (q.error) toast((q.error as Error).message); }, [q.error, toast]);
  useEffect(() => { setWarnings([]); }, [cid]);

  const d = q.data;
  if (!d) return null;
  const c = d.customer;

  const editCustomer = () => openDialog((close) => (
    <CustomerDialog c={c} close={close} onSaved={(r) => {
      setWarnings(r.warnings);
      void qc.invalidateQueries({ queryKey: ["customer", c.id] });
    }} />
  ));

  return (
    <motion.div key={c.id} {...fadeIn}>
      <div className="c-head">
        <div>
          <h1>{c.name} <span className="muted" style={{ fontSize: 13 }}>{c.deal_type}</span></h1>
          <div className="meta">
            담당 {c.agent_name}
            {c.phone && <> · <PhoneReveal cid={c.id} masked={c.phone} /></>}
            {c.phone_hidden && <> · <span className="muted">연락처는 담당 중개사만 볼 수 있습니다</span></>}
            {c.first_home ? " · 생애최초 구입" : ""}
            {!c.privacy_consent_at && (c.has_phone || c.phone_hidden) && <> · <span style={{ color: "var(--warn)" }}>개인정보 동의 기록 없음</span></>}
          </div>
        </div>
        <div className="c-acts">
          <a className="btn" href={`#/map/match/${c.id}`}>조건에 맞는 매물 지도에서 보기</a>
          <CompareButton cid={c.id} />
          <button type="button" className="btn" data-act="new-answer" data-id={c.id}
            onClick={() => openDialog((close) => <AnswerDialog cid={c.id} close={close} />)}>문의 답변 작성</button>
        </div>
      </div>

      <div className="sec">
        <div className="sec-h"><h2>찾는 조건</h2><button type="button" className="btn--link" data-act="edit-customer" onClick={editCustomer}>수정</button></div>
        <dl className="kv">
          <dt>{isRent(c.deal_type) ? "보증금" : "예산"}</dt>
          <dd>{c.budget_max ? `${isRent(c.deal_type) ? won(c.budget_max) : eok(c.budget_max)} 이하` : "-"}
            {c.monthly_rent_max ? `, 월세 ${c.monthly_rent_max}만 원 이하` : ""}</dd>
          <dt>면적</dt><dd>{c.area_min ? `전용 ${c.area_min}㎡ 이상` : "-"}</dd>
          <dt>지역</dt><dd>{c.district || "-"}{c.station_walk_max ? `, 역 도보 ${c.station_walk_max}분 이내` : ""}</dd>
          <dt>원하는 점</dt><dd>{c.preferences.join(", ") || "-"}</dd>
        </dl>
        <div id="customer-warnings">
          {warnings.length > 0 && <ul className="warn-list">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
        </div>
      </div>

      <div className="cols-2">
        <div className="sec">
          <div className="sec-h"><h2>거래</h2><span className="muted">진행 {c.active_deals}건</span></div>
          <table className="tbl">
            <thead><tr><th>매물</th><th className="r">가격</th><th>단계</th><th>다음 할 일</th></tr></thead>
            <tbody>
              {d.deals.map((x) => {
                const go = () => navigate(`#/map/l/${x.listing_id}`);
                return (
                  <tr key={x.id} className="clickable" data-act="open" data-id={x.listing_id} tabIndex={0} onClick={go} onKeyDown={rowKeys(go)}>
                    <td><b>{x.listing.label}</b> {x.listing.title}</td>
                    <td className="r num">{x.listing.price_text ?? priceText(x.listing)}</td>
                    <td><StageTag s={x.stage} />{x.stage === "dropped" ? null : <><br /><Prog s={x.stage} /></>}</td>
                    <td>{x.stage === "dropped" ? x.dropped_reason : x.next_action}</td>
                  </tr>
                );
              })}
              {!d.deals.length && (
                <tr><td colSpan={4} className="empty">연결된 매물이 없습니다. 지도에서 매물을 고른 뒤 "고객 연결"을 누르세요.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div>
          <div className="sec">
            <div className="sec-h"><h2>고객 자료</h2></div>
            <table className="tbl">
              <thead><tr><th>자료</th><th>판</th><th>상태</th></tr></thead>
              <tbody>
                {d.reports.map((r) => {
                  const go = () => navigate(`#/report/${r.id}`);
                  return (
                    <tr key={r.id} className="clickable" data-act="report" data-id={r.id} tabIndex={0} onClick={go} onKeyDown={rowKeys(go)}>
                      <td><a href={`#/report/${r.id}`} onClick={(e) => e.stopPropagation()}>{r.title}</a> <span className="muted">{day(r.created_at)}</span></td>
                      <td className="num">{r.version}</td>
                      <td><span className="state" data-s={r.state}>{REPORT_STATE[r.state]}</span></td>
                    </tr>
                  );
                })}
                {!d.reports.length && <tr><td colSpan={3} className="empty">없음</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="sec">
            <div className="sec-h"><h2>상담 기록</h2></div>
            <MemoForm cid={c.id} />
            <ol className="timeline" style={{ marginTop: 8 }}>
              <AnimatePresence initial={false}>
                {d.activities.map((x) => (
                  <motion.li key={`${x.at}|${x.text}`} {...fadeUp} exit={undefined}>
                    <time>{day(x.at)}</time>
                    <span>{x.text}{x.user_name ? <> <span className="muted">· {x.user_name}</span></> : null}</span>
                  </motion.li>
                ))}
              </AnimatePresence>
              {!d.activities.length && <li><time /><span className="muted">기록 없음</span></li>}
            </ol>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function MemoForm({ cid }: { cid: number }) {
  const qc = useQueryClient();
  const [busy, run] = useBusy();
  const [text, setText] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    const ok = await run(() => api("POST", `/customers/${cid}/activities`, { text: t }));
    if (!ok) return;
    setText("");
    await qc.invalidateQueries({ queryKey: ["customer", cid] });
  };
  return (
    <form className="memo" id="memo-form" onSubmit={submit}>
      <input id="memo-text" placeholder="상담 메모 (예: 전화로 주말 방문 약속)" maxLength={1000} aria-label="상담 메모"
        value={text} onChange={(e) => setText(e.target.value)} />
      <button type="submit" className="btn btn--sm" disabled={busy}>기록</button>
    </form>
  );
}

/** 고객 자료 만들기 → 만든 자료 화면으로 (예전 createReport) */
function useCreateReport(cid: number) {
  const [busy, run] = useBusy();
  const create = async (body: { kind: "compare" } | { kind: "answer"; question: string }) => {
    const r = await run(() => api<{ id: number }>("POST", `/customers/${cid}/reports`, body));
    if (r) navigate(`#/report/${r.id}`);
  };
  return [busy, create] as const;
}

function CompareButton({ cid }: { cid: number }) {
  const [busy, create] = useCreateReport(cid);
  return (
    <button type="button" className="btn btn--main" data-act="new-compare" data-id={cid} disabled={busy}
      onClick={() => create({ kind: "compare" })}>{busy ? "작성 중…" : "비교표 작성"}</button>
  );
}

function AnswerDialog({ cid, close }: { cid: number; close: () => void }) {
  const toast = useToast();
  const [busy, create] = useCreateReport(cid);
  const ref = useRef<HTMLTextAreaElement>(null);
  const ok = () => {
    const question = ref.current?.value.trim() ?? "";
    if (!question) { toast("고객 문의 내용을 적어 주세요."); return; }
    void create({ kind: "answer", question });
  };
  return (
    <>
      <h2>문의 답변 작성</h2>
      <label>고객 문의<textarea id="q" ref={ref} rows={3} maxLength={1000} /></label>
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>자료실의 법령·공식 정책·사무소 문서에서 관련 조항을 찾아 답변 초안을 만듭니다.</p>
      <div className="btns">
        <button type="button" className="btn" data-act="close-dialog" onClick={close}>취소</button>
        <button type="button" className="btn btn--main" data-act="answer-ok" data-id={cid} disabled={busy} onClick={ok}>
          {busy ? "작성 중…" : "작성"}
        </button>
      </div>
    </>
  );
}

/** 고객 등록(c 없음)·찾는 조건 수정(c 있음) */
function CustomerDialog({ c, close, onSaved }: { c?: Customer; close: () => void; onSaved?: (r: CustomerSaved) => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, run] = useBusy();
  const v = (x: string | number | null | undefined) => (x == null ? "" : String(x));
  const [dealType, setDealType] = useState(c ? dealOf(c.deal_type) : "매수");

  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? "").trim();
    const num = (k: string) => (s(k) === "" ? null : Number(s(k)));
    const body = {
      name: s("name"), deal_type: s("deal_type") || "매수", phone: s("phone") || null,
      clear_phone: f.get("clear_phone") === "on",
      budget_max: num("budget_max"), monthly_rent_max: dealType === "월세" ? num("monthly_rent_max") : null,
      area_min: num("area_min"), district: s("district") || null,
      station_walk_max: num("station_walk_max"), first_home: f.get("first_home") === "on",
      privacy_consent: f.get("privacy_consent") === "on",
      preferences: s("preferences").split(",").map((x) => x.trim()).filter(Boolean),
    };
    const r = await run(() => api<CustomerSaved>(c ? "PUT" : "POST", c ? `/customers/${c.id}` : "/customers", body));
    if (!r) return;
    close();
    void qc.invalidateQueries({ queryKey: ["customers"] });
    if (c) {
      onSaved?.(r);
      toast("조건을 저장했습니다.");
    } else {
      toast(`${r.name} 고객을 등록했습니다.`);
      navigate(`#/customers/${r.id}`);
    }
  };

  return (
    <form onSubmit={save}>
      <h2>{c ? "찾는 조건 수정" : "고객 등록"}</h2>
      <label>이름 *<input id="cf-name" name="name" defaultValue={v(c?.name)} maxLength={50} required /></label>
      <div className="row2">
        <label>거래 종류
          <select id="cf-deal_type" name="deal_type" value={dealType} onChange={(e) => setDealType(e.target.value)}>
            <option value="매수">매수</option><option value="전세">전세</option><option value="월세">월세</option>
          </select>
        </label>
        <label>연락처{c?.has_phone ? " (바꿀 때만 입력)" : ""}
          <input id="cf-phone" name="phone" maxLength={30} placeholder={c?.phone ?? "010-0000-0000"} autoComplete="off" />
        </label>
      </div>
      {c?.has_phone && <label className="check-row"><input name="clear_phone" type="checkbox" /> 저장된 연락처 지우기</label>}
      <div className="row2">
        <label>{dealType === "매수" ? "예산 상한" : "보증금 한도"} (만원)
          <input id="cf-budget_max" name="budget_max" type="number" defaultValue={v(c?.budget_max)} /></label>
        {dealType === "월세"
          ? <label>월세 한도 (만원)<input id="cf-monthly_rent_max" name="monthly_rent_max" type="number" defaultValue={v(c?.monthly_rent_max)} /></label>
          : <label>최소 면적 (㎡)<input id="cf-area_min" name="area_min" type="number" step="any" defaultValue={v(c?.area_min)} /></label>}
      </div>
      {dealType === "월세" && (
        <label>최소 면적 (㎡)<input id="cf-area_min" name="area_min" type="number" step="any" defaultValue={v(c?.area_min)} /></label>
      )}
      <div className="row2">
        <label>지역 (구)<input id="cf-district" name="district" defaultValue={c ? v(c.district) : "마포구"} maxLength={30} /></label>
        <label>역 도보 (분 이내)<input id="cf-station_walk_max" name="station_walk_max" type="number" defaultValue={v(c?.station_walk_max)} /></label>
      </div>
      <label>원하는 점 (쉼표로 구분)<input id="cf-preferences" name="preferences" defaultValue={c ? c.preferences.join(", ") : ""} /></label>
      {dealType === "매수" && (
        <label className="check-row"><input id="cf-first_home" name="first_home" type="checkbox" defaultChecked={Boolean(c?.first_home)} /> 생애최초 구입</label>
      )}
      <label className="check-row">
        <input id="cf-privacy_consent" name="privacy_consent" type="checkbox" defaultChecked={Boolean(c?.privacy_consent_at)} />
        개인정보 수집·이용 동의를 받았습니다{c?.privacy_consent_at ? ` (${day(c.privacy_consent_at)})` : ""}
      </label>
      <div className="btns">
        <button type="button" className="btn" data-act="close-dialog" onClick={close}>취소</button>
        <button type="submit" className="btn btn--main" data-act="customer-save" data-id={c?.id} disabled={busy}>{c ? "저장" : "등록"}</button>
      </div>
    </form>
  );
}

const isRent = (t: string) => /전세|월세/.test(t);
/** 예전 자유 입력('아파트 매수')도 매수·전세·월세 중 하나로 읽는다 (서버 drafting.customer_mode와 같은 규칙) */
const dealOf = (t: string) => (t.includes("월세") ? "월세" : /전세|임차/.test(t) ? "전세" : "매수");

/** 가림 표시된 연락처. 누르면 원문을 한 번 받아 보여 준다 (서버가 볼 때마다 감사 기록을 남긴다) */
function PhoneReveal({ cid, masked }: { cid: number; masked: string }) {
  const toast = useToast();
  const [phone, setPhone] = useState<string | null>(null);
  useEffect(() => setPhone(null), [cid]);
  if (phone) return <a href={`tel:${phone.replace(/[^0-9+]/g, "")}`} className="num">{phone}</a>;
  return (
    <span className="num">{masked}{" "}
      <button type="button" className="btn--link" data-act="reveal-phone" onClick={async () => {
        try { setPhone((await api<{ phone: string }>("POST", `/customers/${cid}/phone`)).phone); }
        catch (e) { toast((e as Error).message); }
      }}>보기</button>
    </span>
  );
}
