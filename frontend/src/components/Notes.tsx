/* 근거 표시 — "…입니다[t3]." 의 [t3]을 각주 번호 버튼으로 바꾸고, 근거 이름 버튼(SrcRef)을 만든다.
   order: 한 문서(답변·보고서) 안에서 공유하는 배열. 처음 나온 순서대로 1), 2) … 번호를 매긴다.
   NoteText는 자기가 렌더될 때 order에 번호를 더한다 — 자식 렌더는 부모 렌더보다 늦으므로, 같은 렌더에서
   각주 목록(출처 목록)도 그려야 하면 noteOrder(문단들, 근거)로 순서를 먼저 계산해 같은 배열을 넘긴다. */
import type { ReactNode } from "react";
import { NOTE_TOKEN, TYPE_WORD, cleanTitle } from "@/lib/format";
import type { Evidence } from "@/lib/types";
import { useSources } from "@/state/sources";

export function NoteText({ text, sources, order }: { text: string; sources: Evidence[] | undefined; order: string[] }) {
  const { open, remember } = useSources();
  const byId = new Map((sources || []).map((s) => [s.id, s]));
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(NOTE_TOKEN)) {
    const id = m[1];
    const at = m.index ?? 0;
    out.push(text.slice(last, at));
    last = at + m[0].length;
    const ev = byId.get(id);
    if (!ev) continue;
    if (!order.includes(id)) order.push(id);
    remember(ev);
    out.push(
      <sup key={`${id}-${at}`} data-token={id}>
        <button type="button" className="srcref" data-act="source" data-src={id} contentEditable={false}
          onClick={(e) => { e.preventDefault(); void open(ev); }}>
          {order.indexOf(id) + 1})
        </button>
      </sup>,
    );
  }
  out.push(text.slice(last));
  return <>{out}</>;
}

/** 문단들에 나온 근거 번호를 처음 나온 순서대로 모은다 (sources에 없는 번호는 뺀다) */
export function noteOrder(texts: string[], sources: Evidence[] | undefined): string[] {
  const known = new Set((sources || []).map((s) => s.id));
  const order: string[] = [];
  for (const t of texts) for (const m of t.matchAll(NOTE_TOKEN)) if (known.has(m[1]) && !order.includes(m[1])) order.push(m[1]);
  return order;
}

/** 근거 이름 버튼: "기사 · 제목". 종류가 제목에 이미 있으면 한 번만 쓴다 */
export function SrcRef({ ev, label, className = "srcref" }: { ev: Evidence; label?: string; className?: string }) {
  const { open } = useSources();
  const title = cleanTitle(ev.title);
  const kind = ev.type_label || TYPE_WORD[ev.type || ""] || "";
  const text = label || (title.includes(kind) ? title : `${kind} · ${title}`);
  return (
    <button type="button" className={className} data-act="source" data-src={ev.id}
      onClick={(e) => { e.preventDefault(); void open(ev); }}>
      {text}
    </button>
  );
}

/** 고친 문단(contentEditable)을 저장할 때: 각주 버튼을 다시 [id] 표시로 되돌린 뒤 글자만 꺼낸다 */
export function textWithTokens(el: HTMLElement): string {
  const copy = el.cloneNode(true) as HTMLElement;
  copy.querySelectorAll<HTMLElement>("sup[data-token]").forEach((sup) => sup.replaceWith(`[${sup.dataset.token}]`));
  return (copy.textContent || "").replace(/\s+/g, " ").trim();
}
