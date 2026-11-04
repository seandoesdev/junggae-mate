/* 고객 자료(#/report/<id>) — A4 문서(비교표·문의 답변)와 오른쪽 진행 패널. 예전 app-docs.js의 고객 자료 부분.
   작성 → 검토 → 승인 → 전달(인쇄·링크). 승인 전에는 의견 문단을 문서에서 바로 고쳐 새 판으로 저장한다.
   의견 문단은 contentEditable이라 브라우저가 DOM을 갖는다: 판(version)마다 한 번 그리고, 저장할 때 textWithTokens로 읽는다. */
import { AnimatePresence, motion } from "motion/react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import type { ViewProps } from "@/App";
import { NoteText, textWithTokens } from "@/components/Notes";
import { ApiError, api, getToken } from "@/lib/api";
import { apiUrl } from "@/lib/config";
import { staggerIn } from "@/lib/anime";
import { NOTE_TOKEN, dateTime, day, eok } from "@/lib/format";
import { DUR, EASE_OUT, fadeUp } from "@/lib/motion";
import { navigate } from "@/lib/router";
import type { Evidence } from "@/lib/types";
import { useUser } from "@/state/session";
import { useBusy, useToast, useUi } from "@/state/ui";
import "./report.css";

type Check = { condition: string; ok: boolean; detail: string };
type Listing = {
  label: string;
  title: string;
  price: number;
  price_history: { price: number }[];
  area_m2: number;
  floor: string | null;
  station: string | null;
  station_walk_min: number | null;
  park_walk_min: number | null;
  trade_reference: { median_price: number; count: number } | null;
  checks: Check[];
};
type Report = {
  id: number;
  kind: "compare" | "answer";
  state: "draft" | "review" | "approved" | "shared";
  title: string;
  version: string;
  created_at: string;
  customer_id: number;
  customer_name: string;
  agent_id: number;
  agent_name: string;
  question: string | null;
  listings: Listing[];
  opinion: string;
  to_check: string[];
  sources: Evidence[];
  approved_by: string | null;
  approved_at: string | null;
  share: { url: string; expires_at: string; views: number; last_view: string | null } | null;
  history: { version: string; note: string; by: string | null; at: string }[];
};

const FLOW = ["draft", "review", "approved", "shared"];
const FLOW_LABEL = ["작성", "검토", "승인", "전달 (인쇄·링크)"];

/** 문서 전체의 각주 순서: 의견 문단 → 추가 확인 사항 순서로 처음 나온 근거부터 1), 2) …
    NoteText들이 같은 배열을 받으므로 출처 목록과 번호가 언제나 맞는다 */
function noteOrder(r: Report): string[] {
  const known = new Set(r.sources.map((s) => s.id));
  const order: string[] = [];
  for (const text of [r.opinion, ...r.to_check]) {
    for (const m of text.matchAll(NOTE_TOKEN)) if (known.has(m[1]) && !order.includes(m[1])) order.push(m[1]);
  }
  return order;
}

/** 고칠 수 있는 의견 문단. 판이 바뀔 때만 다시 그린다(입력 중에는 React가 손대지 않는다) */
const Opinion = memo(function Opinion({
  text, sources, order, editable, elRef,
}: { text: string; sources: Evidence[]; order: string[]; editable: boolean; elRef: RefObject<HTMLParagraphElement | null> }) {
  return (
    <p className="opinion" id="opinion" ref={elRef} contentEditable={editable || undefined} suppressContentEditableWarning>
      <NoteText text={text} sources={sources} order={order} />
    </p>
  );
});

function CompareTable({ ls }: { ls: Listing[] }) {
  const row = (h: string, f: (l: Listing) => ReactNode) => (
    <tr><th>{h}</th>{ls.map((l, i) => <td key={i}>{f(l)}</td>)}</tr>
  );
  const conds = [...new Set(ls.flatMap((l) => l.checks.map((c) => c.condition)))];
  return (
    <>
      <h2>매물 비교</h2>
      <table className="ptbl">
        <thead><tr><th style={{ width: 110 }} />{ls.map((l, i) => <th key={i}>{l.label} {l.title}</th>)}</tr></thead>
        <tbody>
          {row("매도 희망가", (l) => (
            <>{eok(l.price)}{l.price_history.length > 1 && <><br /><small>{l.price_history.map((h) => eok(h.price)).join("→")}</small></>}</>
          ))}
          {row("전용면적 / 층", (l) => `${l.area_m2}㎡ / ${l.floor || "-"}`)}
          {row("교통", (l) => (l.station ? `${l.station} 도보 ${l.station_walk_min}분` : "-"))}
          {row("공원", (l) => (l.park_walk_min != null ? `도보 ${l.park_walk_min}분` : "-"))}
          {row("최근 실거래", (l) => (l.trade_reference ? `${eok(l.trade_reference.median_price)} (${l.trade_reference.count}건)` : "자료 없음"))}
        </tbody>
        <tbody>
          {conds.map((cn) => (
            <tr key={cn}>
              <th>{cn}</th>
              {ls.map((l, i) => {
                const c = l.checks.find((x) => x.condition === cn);
                return c
                  ? <td key={i} className={c.ok ? "" : "x"}>{c.ok ? "맞음" : "차이"} <small>{c.detail}</small></td>
                  : <td key={i}>-</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export default function ReportView({ a }: ViewProps) {
  const user = useUser();
  const toast = useToast();
  const { openDialog } = useUi();
  const [busy, run] = useBusy();
  const [r, setR] = useState<Report | null>(null);
  const opinionRef = useRef<HTMLParagraphElement>(null);
  const paperRef = useRef<HTMLElement>(null);

  // 늦게 도착한 이전 문서의 응답이 지금 문서를 덮지 않도록, 가장 최근 요청만 받는다
  const loadSeq = useRef(0);
  const load = useCallback(async (id: string) => {
    const my = ++loadSeq.current;
    try {
      const next = await api<Report>("GET", `/reports/${id}`);
      if (my === loadSeq.current) setR(next);
    } catch (e) {
      if (my !== loadSeq.current) return;
      toast((e as Error).message);
      navigate("#/customers");
    }
  }, [toast]);

  useEffect(() => {
    setR(null);
    if (a) void load(a);
    return () => { loadSeq.current++; };
  }, [a, load]);

  // 문서를 처음 열 때 한 번: 문서 부분이 차례로, 이어서 출처 목록이 차례로 나타난다 (저장·승인 때는 다시 하지 않는다)
  const rid = r?.id;
  useLayoutEffect(() => {
    const paper = paperRef.current;
    if (!rid || !paper) return;
    const parts = [...paper.children].filter((el) => !el.classList.contains("stamp"));
    const stopParts = staggerIn(parts, { gap: 30 });
    const stopFoot = staggerIn(paper.querySelectorAll(".foot li"), { delay: 30 * parts.length + 60, gap: 50, y: 4 });
    return () => { stopParts(); stopFoot(); };
  }, [rid]);

  const order = useMemo(() => (r ? noteOrder(r) : []), [r]);

  if (!r) return <main id="view-report" className="view view-report"><p className="loading">불러오는 중…</p></main>;

  const approved = r.state === "approved" || r.state === "shared";
  const cur = FLOW.indexOf(r.state);
  const byId = new Map(r.sources.map((s) => [s.id, s]));

  // 각 동작은 갱신된 자료를 돌려준다 → 그대로 다시 그린다
  const act = async (method: "PUT" | "POST", path: string, body: unknown, msg: string) => {
    const next = await run(() => api<Report>(method, path, body));
    if (next) { setR(next); toast(msg); }
    return next;
  };

  const saveEdit = () => {
    const opinion = opinionRef.current ? textWithTokens(opinionRef.current) : "";
    if (!opinion) { toast("의견 문단이 비어 있습니다."); return; }
    void act("PUT", `/reports/${r.id}`, { opinion }, "수정 내용을 새 판으로 저장했습니다.");
  };
  const toReview = () => void act("POST", `/reports/${r.id}/review`, undefined, "검토를 요청했습니다.");
  const approve = () => {
    if (!confirm("출처와 기준일, 추가로 확인할 사항을 확인했습니까? 승인하면 이 판은 고칠 수 없습니다.")) return;
    void act("POST", `/reports/${r.id}/approve`, { confirm: true }, "승인했습니다. 인쇄와 링크 전달을 할 수 있습니다.");
  };

  // 서버가 만든 인쇄용 문서(열리면 바로 인쇄 창)를 새 탭에서 연다. 팝업 차단을 피하려고 탭을 먼저 연다
  const print = async () => {
    const w = window.open("", "_blank");
    const ok = await run(async () => {
      const res = await fetch(apiUrl(`/reports/${r.id}/export`), { headers: { Authorization: `Bearer ${getToken() ?? ""}` } });
      if (!res.ok) throw new ApiError(res.status, ((await res.json().catch(() => ({}))) as { detail?: unknown }).detail);
      const url = URL.createObjectURL(new Blob([await res.text()], { type: "text/html;charset=utf-8" }));
      if (w) w.location.href = url; else window.open(url, "_blank");
      return true;
    });
    if (!ok) w?.close();
  };

  const share = async () => {
    const next = await run(() => api<Report>("POST", `/reports/${r.id}/share`));
    if (!next?.share) return;
    setR(next);
    const s = next.share;
    openDialog(() => <ShareDialog url={s.url} version={next.version} expires={s.expires_at} />);
  };

  return (
    <main id="view-report" className="view view-report">
      <div className="paper-wrap">
        <article className="paper" ref={paperRef}>
          <AnimatePresence>
            {!approved && (
              <motion.span
                key={r.state} className="stamp"
                initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: DUR.base, ease: EASE_OUT }}
              >
                {r.state === "draft" ? "작성 중" : "검토 중"} · 고객 전달 전
              </motion.span>
            )}
          </AnimatePresence>
          <header className="paper-h">
            <div>
              <h1>{r.title}</h1>
              <div className="to">
                {r.customer_name} 고객님께 · {day(r.created_at)} ·{" "}
                <motion.span key={r.version} className="rp-ver" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  transition={{ duration: DUR.base, ease: EASE_OUT }}>
                  제{r.version}판
                </motion.span>
              </div>
            </div>
            <div className="from">{user.tenant_name}<br />공인중개사 {r.agent_name}</div>
          </header>
          {r.question && <><h2>문의 내용</h2><p className="opinion">{r.question}</p></>}
          {r.kind === "compare" && r.listings.length > 0 && <CompareTable ls={r.listings} />}
          <h2>{r.kind === "answer" ? "답변" : "중개사 의견"}</h2>
          <Opinion key={`${r.version}-${approved}`} text={r.opinion} sources={r.sources} order={order}
            editable={!approved} elRef={opinionRef} />
          {r.to_check.length > 0 && (
            <>
              <h2>추가로 확인할 사항</h2>
              <ul className="tocheck">
                {r.to_check.map((t, i) => <li key={i}><NoteText text={t} sources={r.sources} order={order} /></li>)}
              </ul>
            </>
          )}
          <h2>출처</h2>
          <ol className="foot">
            {order.length ? order.map((sid) => {
              const s = byId.get(sid)!;
              return <li key={sid}>{s.org}, 「{s.title}」 {s.location || ""} ({s.date}){s.type === "news" ? " — 보조 자료" : ""}</li>;
            }) : <li>없음</li>}
          </ol>
          <div className="paper-end">
            <AnimatePresence mode="wait" initial={false}>
              <motion.span key={String(approved)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: DUR.fast, ease: EASE_OUT }}>
                {approved ? `공인중개사 ${r.approved_by} 확인 · ${day(r.approved_at)}` : "승인 전 문서입니다."}
              </motion.span>
            </AnimatePresence>
            <span>실거래가는 과거 신고 가격이며 현재 매도 희망가와 다를 수 있습니다.</span>
          </div>
        </article>
      </div>
      <aside className="rside">
        <a href={`#/customers/${r.customer_id}`}>{r.customer_name} 고객으로</a>
        <div>
          <h2 className="rp-h">진행</h2>
          <ol className="flow">
            {FLOW_LABEL.map((t, i) => <li key={t} className={`${i < cur ? "done" : ""} ${i === cur ? "cur" : ""}`}>{t}</li>)}
          </ol>
        </div>
        <div className="acts">
          {!approved && (
            <>
              <button type="button" className="btn" data-act="save-edit" disabled={busy} onClick={saveEdit}>수정 내용 저장</button>
              <p className="hint">의견 문단은 문서에서 바로 고칠 수 있습니다. 각주 번호를 누르면 원문이 열립니다.</p>
            </>
          )}
          {r.state === "draft" && (
            <button type="button" className="btn btn--main" data-act="to-review" disabled={busy} onClick={toReview}>검토 요청</button>
          )}
          {r.state === "review" && (
            <>
              <button type="button" className="btn btn--main" data-act="approve" disabled={busy} onClick={approve}>출처 확인 후 승인</button>
              {user.role !== "admin" && user.id !== r.agent_id && (
                <p className="hint">고객 담당({r.agent_name})이나 관리자가 승인합니다.</p>
              )}
            </>
          )}
          <button type="button" className={`btn ${approved ? "btn--main" : ""}`} data-act="print" disabled={!approved || busy} onClick={print}>
            인쇄 / PDF 저장
          </button>
          <button type="button" className="btn" data-act="share" disabled={!approved || busy} onClick={share}>링크로 보내기</button>
          {!approved && <p className="hint">인쇄와 링크 전달은 승인한 판만 할 수 있습니다.</p>}
          <AnimatePresence initial={false}>
            {r.share && (
              <motion.div key={r.share.url} className="share" {...fadeUp}>
                <b>보낸 링크</b>
                <code>{r.share.url}</code>
                <span>
                  {day(r.share.expires_at)}까지 · 열람 {r.share.views}회
                  {r.share.last_view ? ` (마지막 ${dateTime(r.share.last_view)})` : ""}
                </span>
              </motion.div>
            )}
          </AnimatePresence>
          {r.history.length > 0 && (
            <div>
              <h2 className="rp-h rp-h--hist">이력</h2>
              <ol className="flow">
                {r.history.map((h, i) => <li key={i} className="done">{h.version}판 · {h.note} · {h.by || ""} {day(h.at)}</li>)}
              </ol>
            </div>
          )}
        </div>
      </aside>
    </main>
  );
}

function ShareDialog({ url, version, expires }: { url: string; version: string; expires: string }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); toast("링크를 복사했습니다."); }
    catch { input.current?.select(); toast("링크를 선택했습니다. Ctrl+C로 복사하세요."); }
  };
  return (
    <>
      <h2>링크로 보내기</h2>
      <label>링크<input readOnly value={url} id="share-url" ref={input} /></label>
      <p className="muted rp-share-note">승인한 {version}판만 열립니다. {day(expires)}까지 유효하며, 고객이 열면 상담 기록에 남습니다.</p>
      <div className="btns">
        <button type="button" className="btn" data-act="copy-share" onClick={copy}>복사</button>
        <button type="button" className="btn btn--main" data-act="close-dialog">확인</button>
      </div>
    </>
  );
}
