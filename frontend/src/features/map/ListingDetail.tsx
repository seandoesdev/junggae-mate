/* 매물 상세 (지도 왼쪽): 거래 단계 변경, 고객 연결, 확인할 사항, 현장 메모, 공공데이터, 매물 정보·수정·거래 종료 */
import { motion } from "motion/react";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { SrcRef } from "@/components/Notes";
import { Prog, StageTag } from "@/components/Stage";
import { api } from "@/lib/api";
import { staggerIn } from "@/lib/anime";
import { STAGES, STAGE_COLOR, STAGE_LABEL, dateTime, day, eok, stageIdx } from "@/lib/format";
import { DUR, EASE_OUT } from "@/lib/motion";
import { navigate } from "@/lib/router";
import { useUser } from "@/state/session";
import { useToast, useUi } from "@/state/ui";
import { DropDialog, LinkDialog } from "./dialogs";
import { PublicSection } from "./PublicSection";
import type { Customer, Deal, Listing, ListingDetail as Detail } from "./types";
import { useBusyKey } from "./util";

type Props = {
  id: number;
  /** 바뀌면 다시 불러온다 (예전 route()) */
  reloadKey: number;
  backLabel: string;
  onBack: () => void;
  onEdit: (l: Listing) => void;
  onLoaded: (l: Listing) => void;
  /** 거래 단계·고객 연결처럼 목록과 핀까지 바뀌는 변경 뒤 */
  onRouteReload: () => void;
  /** 현장 메모가 바뀌면 다음 질문 결과는 새로 찾는다 */
  onNotesChanged: () => void;
};

/** 상세의 각 칸이 처음 보일 때 차례로 살짝 올라온다 */
function Sec({ i, children, ...rest }: { i: number; children: ReactNode; id?: string; "data-id"?: number }) {
  return (
    <motion.div className="sec" {...rest}
      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DUR.base, ease: EASE_OUT, delay: 0.04 * i }}>
      {children}
    </motion.div>
  );
}

export function ListingDetail({ id, reloadKey, backLabel, onBack, onEdit, onLoaded, onRouteReload, onNotesChanged }: Props) {
  const user = useUser();
  const toast = useToast();
  const { openDialog, closeDialog } = useUi();
  const [data, setData] = useState<Detail | null>(null);
  const [busyKey, run] = useBusyKey();
  const [checkOverride, setCheckOverride] = useState<Record<string, boolean>>({});
  const [noteText, setNoteText] = useState("");
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const progRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  const loadedRef = useRef(onLoaded);
  loadedRef.current = onLoaded;

  const refresh = useCallback(async () => {
    const my = ++seq.current;
    try {
      const r = await api<Detail>("GET", `/listings/${id}`);
      if (my !== seq.current) return;
      setData(r);
      loadedRef.current(r.listing);
    } catch (e) {
      if (my !== seq.current) return;
      toast((e as Error).message);
      navigate("#/map");
    }
  }, [id, toast]);

  useEffect(() => {
    void refresh();
    return () => { seq.current++; };
  }, [refresh, reloadKey]);

  // 매물을 열면 거래 단계 칸이 왼쪽부터 차례로 채워진다 (처음 한 번)
  const loaded = Boolean(data);
  useEffect(() => {
    if (!loaded) return;
    return staggerIn(progRef.current?.querySelectorAll(".prog i.on"), { gap: 70, y: 0, duration: 200, delay: 80 });
  }, [loaded]);

  if (!data) return <p className="loading">불러오는 중…</p>;

  const r = data;
  const l = r.listing;
  const n = stageIdx(l.stage) + 1;
  const done = r.checks.filter((c) => c.checked).length;
  const own = l.mine || user.role === "admin";
  const deals = r.deals.slice().sort((a, b) =>
    Number(a.stage === "dropped") - Number(b.stage === "dropped") || stageIdx(b.stage) - stageIdx(a.stage));
  const tr = r.trade_reference;
  const ph = l.price_history;
  const hist = ph.length > 1 ? `${ph.map((h) => eok(h.price)).join("→")} (${day(ph[ph.length - 1].changed_at)})` : "";

  const changeStage = async (dealId: number, stage: string, reason?: string) => {
    const res = await api<{ warnings: string[]; deal: { customer_name: string; listing: { label: string } } }>(
      "POST", `/deals/${dealId}/stage`, { stage, reason });
    toast(res.warnings.length
      ? `${STAGE_LABEL[stage]}(으)로 바꿨습니다. ${res.warnings.join(" ")}`
      : `${res.deal.customer_name} · ${res.deal.listing.label}: ${STAGE_LABEL[stage]}`, 4200);
    closeDialog();
    onRouteReload();
    return res;
  };

  const openDrop = (dealId: number) =>
    openDialog(() => <DropDialog onOk={(reason) => changeStage(dealId, "dropped", reason)} />);

  const openLink = async () => {
    const cs = await run("link", () => api<Customer[]>("GET", "/customers"));
    if (!cs) return;
    const linked = new Set(r.deals.map((d) => d.customer_id));
    const opts = cs.filter((c) => !linked.has(c.id));
    openDialog(() => (
      <LinkDialog title={`${l.label} ${l.title}`} listingId={l.id} options={opts}
        onDone={(name) => { closeDialog(); toast(`${name} 고객을 연결했습니다.`); onRouteReload(); }} />
    ));
  };

  const toggleCheck = async (key: string, checked: boolean) => {
    setCheckOverride((o) => ({ ...o, [key]: checked }));
    try {
      await api("PUT", `/listings/${l.id}/checks/${key}`, { checked });
      await refresh();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setCheckOverride((o) => { const next = { ...o }; delete next[key]; return next; });
    }
  };

  const addNote = async (e: FormEvent) => {
    e.preventDefault();
    const text = noteText.trim();
    if (!text) { noteRef.current?.focus(); return; }
    const res = await run("note", () => api("POST", `/listings/${l.id}/notes`, { text }));
    if (res) {
      onNotesChanged();
      toast("메모를 남겼습니다.");
      setNoteText("");
      void refresh();
    }
  };
  const delNote = async (noteId: number) => {
    if (!confirm("이 메모를 지울까요?")) return;
    const res = await run(`del-${noteId}`, () => api("DELETE", `/listings/${l.id}/notes/${noteId}`));
    if (res) { onNotesChanged(); void refresh(); }
  };

  const closeListing = async () => {
    if (!confirm("이 매물을 거래 종료로 바꿀까요? 지도와 목록에서 빠집니다.")) return;
    const res = await run("close", () => api<{ label: string; title: string }>("POST", `/listings/${l.id}/close`));
    if (res) { toast(`${res.label} ${res.title}: 거래 종료`); navigate("#/map"); }
  };

  return (
    <div className="detail" data-id={l.id}>
      <div className="detail-top">
        <button type="button" className="btn btn--sm" data-act="back" onClick={onBack}>{backLabel}</button>
        <StageTag s={l.stage} />
      </div>
      <h2 id="listing-detail-title">{l.label} {l.title}</h2>
      <div className="price num">
        {eok(l.price)}
        {hist && <> <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>{hist}</span></>}
      </div>
      <div ref={progRef}>
        <Prog s={l.stage} wide />
        <div className="prog-labels">
          {STAGES.map((s, i) => <span key={s} className={i === n - 1 ? "cur" : ""}>{STAGE_LABEL[s]}</span>)}
        </div>
      </div>

      <Sec i={0}>
        <div className="sec-h"><h2>거래</h2><span className="muted">진행 {l.active_deals}건</span></div>
        {deals.length
          ? deals.map((d) => (
            <DealBox key={d.id} d={d} canChange={user.role === "admin" || [d.agent_id, d.listing.agent_id].includes(user.id)}
              busy={busyKey === `deal-${d.id}`}
              onStage={(stage) => run(`deal-${d.id}`, () => changeStage(d.id, stage))}
              onDrop={() => openDrop(d.id)} />
          ))
          : <p className="empty">연결된 고객이 없습니다.</p>}
        <p style={{ margin: "8px 0 0" }}>
          <button type="button" className="btn btn--sm" data-act="link" data-id={l.id} disabled={busyKey === "link"} onClick={openLink}>고객 연결</button>
        </p>
      </Sec>

      <Sec i={1}>
        <div className="sec-h"><h2>확인할 사항</h2><span className="muted">{done}/{r.checks.length} 확인</span></div>
        <ul className="checks">
          {r.checks.map((c) => {
            const pending = c.key in checkOverride;
            return (
              <li key={c.key} className={c.level === "urgent" ? "bad" : c.level === "warn" ? "warn" : ""}>
                <input type="checkbox" id={`ck-${c.key}`} data-check={c.key} data-key={c.key} data-id={l.id}
                  checked={pending ? checkOverride[c.key] : c.checked} disabled={pending}
                  onChange={(e) => toggleCheck(c.key, e.target.checked)} />
                <label className="txt" htmlFor={`ck-${c.key}`}>{c.text}</label>
                <span className="src">
                  {c.sources.length
                    ? <>출처: {c.sources.map((s, i) => <span key={s.id}>{i > 0 && ", "}<SrcRef ev={s} /></span>)}</>
                    : "출처 없음"}
                </span>
                {c.checked && <span className="by">{c.checked_by} 확인 · {dateTime(c.checked_at)}</span>}
              </li>
            );
          })}
        </ul>
      </Sec>

      <Sec i={2}>
        <div className="sec-h"><h2>현장 메모</h2><span className="muted">질문 검색에 함께 쓰입니다</span></div>
        <ul className="notes">
          {r.notes.length ? r.notes.map((nt) => (
            <li key={nt.id}>
              {nt.text}
              <span className="by">
                {nt.by} · {dateTime(nt.created_at)}
                {(nt.user_id === user.id || user.role === "admin") && (
                  <button type="button" data-act="del-note" data-id={l.id} data-note={nt.id}
                    disabled={busyKey === `del-${nt.id}`} onClick={() => delNote(nt.id)}>지우기</button>
                )}
              </span>
            </li>
          )) : <li className="muted">아직 메모가 없습니다.</li>}
        </ul>
        <form className="note-form" id="note-form" data-id={l.id} onSubmit={addNote}>
          <textarea ref={noteRef} name="text" rows={2} maxLength={1000} placeholder="예: 남향, 밤에 조용함, 주차 여유"
            aria-label="현장 메모" value={noteText} onChange={(e) => setNoteText(e.target.value)} />
          <button type="submit" className="btn btn--sm" disabled={busyKey === "note"}>남기기</button>
        </form>
      </Sec>

      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: DUR.base, ease: EASE_OUT, delay: 0.12 }}>
        <PublicSection listing={l} reloadKey={reloadKey} />
      </motion.div>

      <Sec i={4}>
        <div className="sec-h"><h2>매물 정보</h2><span className="muted">담당 {l.agent_name}</span></div>
        <dl className="kv">
          <dt>전용면적</dt><dd className="num">{l.area_m2}㎡</dd>
          <dt>층</dt><dd>{l.floor || "-"}</dd>
          <dt>주소</dt><dd>{l.address}</dd>
          <dt>교통</dt><dd>{l.station ? `${l.station} 도보 ${l.station_walk_min ?? "-"}분` : "-"}</dd>
          <dt>공원</dt><dd>{l.park_walk_min != null ? `도보 ${l.park_walk_min}분` : "-"}</dd>
          <dt>실거래</dt>
          <dd>
            {tr ? <>중위 {eok(tr.median_price)} ({tr.count}건, {tr.period})<br />
              <span className="muted">과거 신고 거래 · 현재 호가 아님 · {tr.source}</span></> : "자료 없음"}
          </dd>
          <dt>출처</dt><dd>{l.source} · {l.source_date}</dd>
          {l.description && <><dt>메모</dt><dd>{l.description}</dd></>}
        </dl>
        {own && (
          <div className="detail-acts">
            <button type="button" className="btn btn--sm" data-act="edit-listing" data-id={l.id} onClick={() => onEdit(l)}>수정</button>
            <button type="button" className="btn btn--sm" id="listing-close-btn" data-act="close-listing" data-id={l.id}
              disabled={busyKey === "close"} onClick={closeListing}>거래 종료</button>
          </div>
        )}
      </Sec>
    </div>
  );
}

function DealBox({ d, canChange, busy, onStage, onDrop }: {
  d: Deal; canChange: boolean; busy: boolean; onStage: (stage: string) => void; onDrop: () => void;
}) {
  if (d.stage === "dropped") {
    return (
      <div className="deal is-dropped" style={{ ["--c" as string]: STAGE_COLOR.dropped }}>
        <div className="deal-top">
          <a href={`#/customers/${d.customer_id}`}>{d.customer_name}</a>
          <span className="muted">담당 {d.agent_name}</span><StageTag s="dropped" />
        </div>
        <div className="next">사유: {d.dropped_reason || "-"}</div>
      </div>
    );
  }
  const i = stageIdx(d.stage);
  const why = canChange ? undefined : "거래 담당·매물 담당 중개사나 관리자만 바꿀 수 있습니다";
  return (
    <div className="deal" style={{ ["--c" as string]: STAGE_COLOR[d.stage] }}>
      <div className="deal-top">
        <a href={`#/customers/${d.customer_id}`}>{d.customer_name}</a>
        <span className="muted">담당 {d.agent_name} · {d.days_in_stage}일째</span><StageTag s={d.stage} />
      </div>
      <div className="next">다음: <b>{d.next_action || "-"}</b></div>
      <div className="acts">
        <button type="button" className="btn btn--sm" data-act="prev" data-id={d.id} data-stage={d.stage}
          disabled={i <= 0 || !canChange || busy} title={why} onClick={() => onStage(STAGES[i - 1])}>이전 단계</button>
        <button type="button" className="btn btn--sm btn--main" data-act="next" data-id={d.id} data-stage={d.stage}
          disabled={i >= 4 || !canChange || busy} title={why} onClick={() => onStage(STAGES[i + 1])}>
          {i < 4 ? `${STAGE_LABEL[STAGES[i + 1]]}(으)로` : "완료"}
        </button>
        <button type="button" className="btn btn--sm" data-act="drop" data-id={d.id} disabled={!canChange} title={why}
          onClick={onDrop}>무산</button>
      </div>
    </div>
  );
}
