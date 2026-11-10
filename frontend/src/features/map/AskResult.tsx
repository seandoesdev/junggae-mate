/* 지도 질문 결과 (#/map/ask/질문): Hood 답변을 지도 왼쪽에 펼치고 맞는 매물을 지도에서 강조한다.
   찾은 조건을 눌러 빼고 다시 찾을 수 있다. 질문 입력은 Hood Chat·Ask Hood 패널이 맡는다. */
import { motion } from "motion/react";
import { NoteText, SrcRef } from "@/components/Notes";
import { StageTag } from "@/components/Stage";
import { api } from "@/lib/api";
import { NOTE_TOKEN, STAGE_COLOR, shortPrice } from "@/lib/format";
import { press } from "@/lib/motion";
import { useUser } from "@/state/session";
import { useToast, useUi } from "@/state/ui";
import { AskReportDialog } from "./dialogs";
import type { AskState, Customer, Listing } from "./types";

/** 질문(뺀 조건 포함)으로 고객 자료 만들기 대화상자를 연다. 담당 고객이 앞에 온다 */
export function useAskReport() {
  const user = useUser();
  const toast = useToast();
  const { openDialog } = useUi();
  return async (q: string, drop: string[]) => {
    const cs = await api<Customer[]>("GET", "/customers").catch((e: Error) => { toast(e.message); return null; });
    if (!cs) return;
    const mineFirst = cs.slice().sort((a, b) => Number(b.agent_id === user.id) - Number(a.agent_id === user.id));
    openDialog(() => <AskReportDialog q={q} drop={drop} customers={mineFirst} />);
  };
}

export function AskResult({ ask, listings, onDrop, onReset, onDropAll, onClear, onOpen }: {
  ask: AskState;
  /** 지금 지도에 있는 매물 (단계는 지금 상태로 보인다) */
  listings: Listing[];
  onDrop: (key: string) => void;
  onReset: () => void;
  onDropAll: () => void;
  onClear: () => void;
  onOpen: (id: number) => void;
}) {
  const { q, drop, result: r } = ask;
  const askReport = useAskReport();
  const byId = new Map(r.sources.map((s) => [s.id, s]));
  // 각주 번호: 답변 → 추가로 확인할 사항 순서로 처음 나온 근거부터
  const order: string[] = [];
  for (const t of [r.opinion, ...r.to_check]) {
    for (const m of t.matchAll(NOTE_TOKEN)) if (byId.has(m[1]) && !order.includes(m[1])) order.push(m[1]);
  }
  const foot = order.map((id) => byId.get(id)!).filter(Boolean);
  const live = new Map(listings.map((l) => [l.id, l]));
  const ls = r.listings;
  const place = r.understood.find((c) => c.key === "place" || c.key === "district");

  return (
    <>
      <div className="side-h">
        <h1>질문 결과</h1>
        <span>
          {r.session_id ? (
            <a className="btn btn--sm" href={`#/ai/s/${r.session_id}`}>Hood Chat에서 이어 묻기</a>
          ) : null}{" "}
          <button type="button" className="btn btn--sm" data-act="clear-ask" onClick={onClear}>닫기</button>
        </span>
      </div>
      <div className="ask-res">
        <p className="ask-q">{q}</p>
        {(r.understood.length > 0 || drop.length > 0) && (
          <div className="understood">
            <span className="lbl">찾은 조건</span>
            {r.understood.map((c) => (
              <motion.button key={c.key} type="button" className="cond" data-act="ask-drop" data-key={c.key}
                title="이 조건을 빼고 다시 찾기" whileTap={press} onClick={() => onDrop(c.key)}>
                {c.label}<b aria-hidden="true">×</b>
              </motion.button>
            ))}
            {drop.length > 0 && (
              <button type="button" className="btn btn--sm" data-act="ask-reset" onClick={onReset}>뺀 조건 되돌리기</button>
            )}
          </div>
        )}

        {(ls.length > 0 || r.listing_intent) && (
          <div className="sec" id="ask-listings">
            <div className="sec-h">
              <h2>{r.relaxed ? "조건에 가까운 매물" : "맞는 매물"} <span className="muted num">{ls.length}</span></h2>
              <span className="muted">지도에 강조</span>
            </div>
            <table className="tbl">
              <thead><tr><th></th><th>매물</th><th className="r">가격</th><th>단계</th></tr></thead>
              <tbody>
                {ls.length ? ls.map((l) => {
                  const st = (live.get(l.id) || l).stage;
                  return (
                    <tr key={l.id} className={`lrow clickable ${l.mine ? "" : "is-other"}`}
                      style={{ ["--c" as string]: st === "available" ? "var(--line)" : STAGE_COLOR[st] }}
                      data-act="open" data-id={l.id} tabIndex={0}
                      onClick={() => onOpen(l.id)}
                      onKeyDown={(e) => { if (e.key === "Enter") onOpen(l.id); }}>
                      <td></td>
                      <td>
                        <b>{l.label}</b> {l.title}{!l.mine && <> <span className="muted">· {l.agent_name}</span></>}
                        {l.matched.map((m, i) => <span key={`m${i}`} className="why">{m.want}: {m.text}</span>)}
                        {l.unmet.map((u, i) => <span key={`u${i}`} className="why gap">차이: {u}</span>)}
                      </td>
                      <td className="r num" title={l.price_text}>{shortPrice(l)}</td>
                      <td><StageTag s={st} /></td>
                    </tr>
                  );
                }) : (
                  <tr><td colSpan={4} className="empty">
                    {place ? `${place.label} 안에 등록된 매물이 없습니다.` : "맞는 매물이 없습니다. 위 조건을 눌러 빼고 다시 찾아 보세요."}
                    {r.understood.length > 0 && <><br />
                      <button type="button" className="btn btn--sm" style={{ marginTop: 8 }} data-act="ask-drop-all" onClick={onDropAll}>
                        조건 빼고 사무소 매물 보기
                      </button></>}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <div className="sec">
          <div className="sec-h"><h2>답변</h2></div>
          <p className="opinion" id="ask-answer"><NoteText text={r.opinion} sources={r.sources} order={order} /></p>
          {r.to_check.length > 0 && (
            <>
              <div className="sec-h" style={{ marginTop: 12, borderBottomWidth: 1 }}><h2>추가로 확인할 사항</h2></div>
              <ul className="tocheck">
                {r.to_check.map((t, i) => <li key={i}><NoteText text={t} sources={r.sources} order={order} /></li>)}
              </ul>
            </>
          )}
          {foot.length > 0 && (
            <ol className="foot-list">
              {foot.map((s) => <li key={s.id}><SrcRef ev={s} /> <span className="muted">{s.date}</span></li>)}
            </ol>
          )}
          <p style={{ margin: "10px 0 0" }}>
            <button type="button" className="btn btn--sm" data-act="ask-report" onClick={() => askReport(q, drop)}>고객 자료로 만들기</button>
          </p>
        </div>
      </div>
    </>
  );
}
