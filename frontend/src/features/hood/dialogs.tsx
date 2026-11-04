/* Hood에서 여는 대화상자: 자료 추가(입력창의 클립), 고객 자료로 만들기(답변 아래). 예전 app-docs.js·app-ask.js와 같은 문구 */
import { useRef } from "react";
import { api } from "@/lib/api";
import { navigate } from "@/lib/router";
import type { User } from "@/lib/types";
import { useBusy, useToast } from "@/state/ui";

type Customer = { id: number; name: string; agent_id: number; agent_name: string };

/** 중개사가 직접 적는 사무소 자료 (단지 정보, 현장 확인 내용, 학구도 확인 결과 등) */
export function AddDocDialog({ close }: { close: () => void }) {
  const toast = useToast();
  const [busy, run] = useBusy();
  const title = useRef<HTMLInputElement>(null);
  const text = useRef<HTMLTextAreaElement>(null);
  const region = useRef<HTMLInputElement>(null);
  const ok = async () => {
    const body = { title: title.current!.value.trim(), text: text.current!.value.trim(), region: region.current!.value.trim() || null };
    if (!body.title || body.text.length < 5) { toast("제목과 내용을 적어 주세요."); return; }
    const r = await run(() => api("POST", "/documents", body));
    if (!r) return;
    close();
    toast("자료를 추가했습니다. 질문 검색에 바로 쓰입니다.");
  };
  return (
    <>
      <h2>자료 추가</h2>
      <p className="muted" style={{ fontSize: 12, margin: "0 0 8px" }}>
        우리 사무소에서만 보이며, 질문 검색과 고객 자료의 근거로 바로 쓰입니다. 단지 이름을 적으면 그 단지 매물을 찾을 때 함께 봅니다.
      </p>
      <label>제목<input id="doc-title" ref={title} maxLength={200} placeholder="예: 용강리버뷰 단지 확인 내용" /></label>
      <label>내용<textarea id="doc-text" ref={text} rows={8} maxLength={20000}
        placeholder="예: 용강리버뷰 아파트는 2026년 학구도 기준 용강초 배정 구역입니다(교육지원청 확인, 2026-10)." /></label>
      <label>지역 (선택)<input id="doc-region" ref={region} maxLength={30} placeholder="예: 마포구" /></label>
      <div className="btns">
        <button type="button" className="btn" data-act="close-dialog">취소</button>
        <button type="button" className="btn btn--main" data-act="add-doc-ok" disabled={busy} onClick={ok}>추가</button>
      </div>
    </>
  );
}

function AskReportDialog({ q, drop, customers, user }: { q: string; drop: string[]; customers: Customer[]; user: User }) {
  const [busy, run] = useBusy();
  const sel = useRef<HTMLSelectElement>(null);
  const mineFirst = customers.slice().sort((a, b) => Number(b.agent_id === user.id) - Number(a.agent_id === user.id));
  const ok = async () => {
    const r = await run(() => api<{ id: number }>("POST", `/customers/${sel.current!.value}/reports`, { kind: "answer", question: q, drop }));
    if (r) navigate(`#/report/${r.id}`);
  };
  return (
    <>
      <h2>고객 자료로 만들기</h2>
      <p className="muted" style={{ fontSize: 12, margin: "0 0 8px" }}>
        질문: {q}<br />뺀 조건은 그대로 빼고, 질문에 없는 예산·면적·지역은 고객 조건으로 채워 다시 찾습니다. 만든 뒤 문서에서 고치고 승인하면 인쇄·링크로 보낼 수 있습니다.
      </p>
      <label>고객<select id="ask-customer" ref={sel}>
        {mineFirst.map((c) => <option key={c.id} value={c.id}>{c.name} (담당 {c.agent_name})</option>)}
      </select></label>
      <div className="btns">
        <button type="button" className="btn" data-act="close-dialog">취소</button>
        <button type="button" className="btn btn--main" data-act="ask-report-ok" disabled={busy || !customers.length} onClick={ok}>만들기</button>
      </div>
    </>
  );
}

/** 답변 아래 '고객 자료로 만들기': 고객을 고르면 같은 질문(뺀 조건 유지)으로 고객 답변 자료를 만든다 */
export async function openAskReport(
  q: string, drop: string[], user: User,
  ui: { toast: (m: string, ms?: number) => void; openDialog: (r: (close: () => void) => React.ReactNode) => void },
) {
  let customers: Customer[];
  try { customers = await api<Customer[]>("GET", "/customers"); } catch (e) { ui.toast((e as Error).message); return; }
  ui.openDialog(() => <AskReportDialog q={q} drop={drop} customers={customers} user={user} />);
}
