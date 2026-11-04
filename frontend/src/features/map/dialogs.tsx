/* 지도 화면 대화상자: 무산 처리, 고객 연결, 고객 자료로 만들기 (예전 openDialog HTML과 같은 모양) */
import { useState } from "react";
import { api } from "@/lib/api";
import { navigate } from "@/lib/router";
import { useBusy } from "@/state/ui";
import type { Customer } from "./types";

export function DropDialog({ onOk }: { onOk: (reason: string) => Promise<unknown> }) {
  const [reason, setReason] = useState("고객 의사 변경");
  const [busy, run] = useBusy();
  return (
    <>
      <h2>무산 처리</h2>
      <label>사유<input id="drop-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} /></label>
      <div className="btns">
        <button type="button" className="btn" data-act="close-dialog">취소</button>
        <button type="button" className="btn btn--main" data-act="drop-ok" disabled={busy}
          onClick={() => run(() => onOk(reason.trim()))}>무산 처리</button>
      </div>
    </>
  );
}

export function LinkDialog({ title, listingId, options, onDone }: {
  title: string; listingId: number; options: Customer[]; onDone: (customerName: string) => void;
}) {
  const [cid, setCid] = useState(options[0] ? String(options[0].id) : "");
  const [next, setNext] = useState("매물 소개");
  const [busy, run] = useBusy();
  const ok = async () => {
    const r = await run(() => api<{ customer_name: string }>("POST", "/deals", {
      listing_id: listingId, customer_id: Number(cid), next_action: next.trim() || null,
    }));
    if (r) onDone(r.customer_name);
  };
  return (
    <>
      <h2>{title} · 고객 연결</h2>
      <label>고객
        <select id="link-customer" value={cid} onChange={(e) => setCid(e.target.value)}>
          {options.map((c) => <option key={c.id} value={c.id}>{c.name} (담당 {c.agent_name})</option>)}
        </select>
      </label>
      <label>다음 할 일<input id="link-next" value={next} maxLength={200} onChange={(e) => setNext(e.target.value)} /></label>
      <div className="btns">
        <button type="button" className="btn" data-act="close-dialog">취소</button>
        <button type="button" className="btn btn--main" data-act="link-ok" disabled={!options.length || busy} onClick={ok}>
          연결 (소개 단계)
        </button>
      </div>
    </>
  );
}

/** 질문(뺀 조건 포함)으로 고객 자료를 만든다. Hood 답변에서도 같은 대화상자를 쓸 수 있다 */
export function AskReportDialog({ q, drop, customers }: { q: string; drop: string[]; customers: Customer[] }) {
  const [cid, setCid] = useState(customers[0] ? String(customers[0].id) : "");
  const [busy, run] = useBusy();
  const ok = async () => {
    const r = await run(() => api<{ id: number }>("POST", `/customers/${cid}/reports`, { kind: "answer", question: q, drop }));
    if (r) navigate(`#/report/${r.id}`);
  };
  return (
    <>
      <h2>고객 자료로 만들기</h2>
      <p className="muted" style={{ fontSize: 12, margin: "0 0 8px" }}>
        질문: {q}<br />
        뺀 조건은 그대로 빼고, 질문에 없는 예산·면적·지역은 고객 조건으로 채워 다시 찾습니다. 만든 뒤 문서에서 고치고 승인하면 인쇄·링크로 보낼 수 있습니다.
      </p>
      <label>고객
        <select id="ask-customer" value={cid} onChange={(e) => setCid(e.target.value)}>
          {customers.map((c) => <option key={c.id} value={c.id}>{c.name} (담당 {c.agent_name})</option>)}
        </select>
      </label>
      <div className="btns">
        <button type="button" className="btn" data-act="close-dialog">취소</button>
        <button type="button" className="btn btn--main" data-act="ask-report-ok" disabled={!customers.length || busy} onClick={ok}>만들기</button>
      </div>
    </>
  );
}
