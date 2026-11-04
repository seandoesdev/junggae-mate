/* 자료실 — 문서 근거 검색(왼쪽)과 고른 문서 조각(오른쪽). 예전 app-docs.js의 자료실 부분.
   - 검색어가 없으면 문서 목록, 있으면 /evidence/search 결과. 입력은 250ms 뒤에 검색한다.
   - 중개사는 사무소 자료를 직접 적어 추가(add-doc), 관리자는 파일 등록(upload).
   - 문서 조각은 '고객 문의 답변에 인용'으로 바로 답변 자료를 만든다. */
import { motion } from "motion/react";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { ViewProps } from "@/App";
import { api } from "@/lib/api";
import { DUR, EASE_OUT, fadeUp } from "@/lib/motion";
import { LOGOUT_EVENT, navigate } from "@/lib/router";
import type { Evidence } from "@/lib/types";
import { useUser } from "@/state/session";
import { SourceBody, useSources } from "@/state/sources";
import { useBusy, useToast, useUi } from "@/state/ui";
import "./library.css";

type Doc = {
  id: number;
  type: string;
  type_label: string;
  title: string;
  org: string;
  date: string;
  effective_date: string | null;
  chunks: number;
  first_chunk: string;
  mine: boolean;
};
type Item = { kind: "doc"; doc: Doc } | { kind: "hit"; ev: Evidence };
type Customer = { id: number; name: string; agent_name: string };

const LIB_TYPES: [string, string][] = [["", "전체"], ["law", "법령"], ["policy", "정책"], ["office", "사무소"], ["news", "기사"]];
const askHash = (q: string) => `#/map/ask/${encodeURIComponent(q)}`;
const itemId = (it: Item) => (it.kind === "doc" ? it.doc.first_chunk : it.ev.id);

// 다른 화면에 다녀와도 검색어·종류·고른 문서를 그대로 둔다 (예전 전역 D와 같다)
const mem: { q: string; type: string; sel: string | null } = { q: "", type: "", sel: null };
addEventListener(LOGOUT_EVENT, () => { mem.q = ""; mem.type = ""; mem.sel = null; });

/** 결과 요약에서 검색어 강조 */
function hl(text: string, query: string): ReactNode {
  const words = query.trim().split(/\s+/).filter((w) => w.length > 1);
  if (!words.length) return text;
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");
  return text.split(re).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part));
}

export default function LibraryView(_: ViewProps) {
  const user = useUser();
  const toast = useToast();
  const { openDialog } = useUi();
  const { remember, get } = useSources();
  const [busy, run] = useBusy();

  const [q, setQ] = useState(mem.q);
  const [type, setType] = useState(mem.type);
  const [sel, setSel] = useState<string | null>(mem.sel);
  const [items, setItems] = useState<Item[]>([]);
  const [batch, setBatch] = useState(0);              // 결과 묶음이 바뀔 때만 목록 등장 움직임
  const [loading, setLoading] = useState<string | null>("불러오는 중…");
  const [docs, setDocs] = useState<Record<number, Doc>>({});
  const [detail, setDetail] = useState<Evidence | null>(null);

  const qRef = useRef(mem.q);
  const typeRef = useRef(mem.type);
  const timer = useRef(0);
  const seq = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const choose = (id: string | null) => { mem.sel = id; setSel(id); };

  const search = useCallback(async () => {
    window.clearTimeout(timer.current);
    const my = ++seq.current;
    const query = qRef.current.trim();
    const t = typeRef.current;
    let next: Item[] = [];
    try {
      if (query) {
        const r = await api<{ items: Evidence[] }>("GET", `/evidence/search?q=${encodeURIComponent(query)}${t ? `&type=${t}` : ""}`);
        next = r.items.map((e) => ({ kind: "hit", ev: remember(e) as Evidence }));
      } else {
        const ds = await api<Doc[]>("GET", `/documents${t ? `?type=${t}` : ""}`);
        setDocs((prev) => ({ ...prev, ...Object.fromEntries(ds.map((d) => [d.id, d])) }));
        next = ds.map((d) => ({ kind: "doc", doc: d }));
      }
    } catch (e) {
      toast((e as Error).message);
    }
    if (my !== seq.current) return;  // 더 새로운 검색이 진행 중
    setItems(next);
    setBatch((b) => b + 1);
    setLoading(null);
  }, [remember, toast]);

  // 검색 결과에서도 '내가 추가한 자료'인지 알 수 있도록 문서 목록을 한 번 받아 둔다
  const reload = useCallback(async () => {
    try {
      const ds = await api<Doc[]>("GET", "/documents");
      setDocs(Object.fromEntries(ds.map((d) => [d.id, d])));
    } catch { /* 목록은 검색이 다시 받는다 */ }
    await search();
  }, [search]);

  useEffect(() => {
    void reload();
    return () => { seq.current++; window.clearTimeout(timer.current); };
  }, [reload]);

  // 오른쪽에 보일 문서 조각: 고른 것, 없으면 첫 결과
  const shown = sel ?? (items[0] ? itemId(items[0]) : null);
  useEffect(() => {
    if (!shown) { setDetail(null); return; }
    let live = true;
    const known = get(shown);
    if (known) { setDetail(known); return; }
    api<Evidence>("GET", `/evidence/${shown}`)
      .then((ev) => { if (live) setDetail(remember(ev) as Evidence); })
      .catch((e: Error) => toast(e.message));
    return () => { live = false; };
  }, [shown, get, remember, toast]);

  const onInput = (v: string) => {
    setQ(v);
    qRef.current = v;
    mem.q = v;
    choose(null);
    setLoading("검색 중…");  // 이전 목록을 잘못 누르지 않도록
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void search(), 250);
  };
  const onSubmit = (e: FormEvent) => { e.preventDefault(); void search(); };
  const pickType = (t: string) => {
    setType(t);
    typeRef.current = t;
    mem.type = t;
    choose(null);
    void search();
  };

  const ask = () => {
    const v = q.trim();
    if (!v) { toast("물어볼 내용을 검색창에 적어 주세요."); inputRef.current?.focus(); return; }
    navigate(askHash(v));
  };

  // 새로 추가한 자료를 바로 보여 준다
  const afterAdd = useCallback((firstChunk: string | null) => {
    qRef.current = ""; typeRef.current = "";
    mem.q = ""; mem.type = ""; mem.sel = firstChunk;
    setQ(""); setType(""); setSel(firstChunk);
    setLoading("불러오는 중…");
    void reload();
  }, [reload]);

  const addDoc = () => openDialog((close) => <AddDocDialog close={close} onDone={(r) => afterAdd(r.first_chunk)} />);
  const upload = () => openDialog((close) => <UploadDialog close={close} tenantName={user.tenant_name} onDone={() => afterAdd(null)} />);

  const quote = async (ev: Evidence) => {
    const cs = await api<Customer[]>("GET", "/customers").catch((e: Error) => { toast(e.message); return null; });
    if (!cs) return;
    openDialog((close) => <QuoteDialog close={close} ev={ev} customers={cs} />);
  };

  const delDoc = async (doc: Doc) => {
    if (!confirm("이 자료를 지울까요? 질문 검색과 이후 고객 자료에서 더 이상 쓰이지 않습니다.")) return;
    const r = await run(() => api("DELETE", `/documents/${doc.id}`));
    if (!r) return;
    toast("자료를 지웠습니다.");
    choose(null);
    void reload();
  };

  const doc = detail && typeof detail.document_id === "number" ? docs[detail.document_id] : undefined;

  return (
    <main id="view-library" className="view view-split">
      <aside id="library-side" className="side">
        <div className="side-h">
          <h1>자료실</h1>
          <span className="lib-h-acts">
            <button type="button" className="btn btn--sm" data-act="add-doc" onClick={addDoc}>자료 추가</button>
            {user.role === "admin" && (
              <button type="button" className="btn btn--sm" data-act="upload" onClick={upload}>파일 등록</button>
            )}
          </span>
        </div>
        <form className="search" id="lib-form" onSubmit={onSubmit}>
          <input
            id="lib-q" ref={inputRef} type="search" placeholder="예: 거래 신고 기한, 생애최초, 학구도"
            value={q} onChange={(e) => onInput(e.target.value)} aria-label="자료 검색어" autoComplete="off"
          />
          <div className="types" role="group" aria-label="자료 종류">
            {LIB_TYPES.map(([t, w]) => (
              <button key={t || "all"} type="button" data-act="lib-type" data-t={t || "all"} aria-pressed={type === t}
                onClick={() => pickType(t)}>
                {w}
              </button>
            ))}
          </div>
          <button type="button" className="btn btn--sm" data-act="lib-ask" style={{ justifySelf: "start" }} onClick={ask}>
            이 내용으로 질문하기 (매물·실거래가 함께)
          </button>
        </form>
        <div id="lib-hits" aria-busy={loading ? true : undefined}>
          {loading ? (
            <p className="loading">{loading}</p>
          ) : items.length ? (
            <div key={batch}>
              {items.map((it, i) => {
                const id = itemId(it);
                return (
                  <motion.button
                    key={id} type="button" className={`hit ${shown === id ? "is-sel" : ""}`}
                    data-act="lib-open" data-src={id} onClick={() => choose(id)}
                    initial={fadeUp.initial} animate={fadeUp.animate}
                    transition={{ ...fadeUp.transition, delay: Math.min(i, 10) * 0.02 }}
                  >
                    {it.kind === "doc" ? (
                      <>
                        <div className="t"><span className="typeword">{it.doc.type_label}</span>{it.doc.title}</div>
                        <div className="m">
                          {it.doc.org} · {it.doc.date}{it.doc.effective_date ? ` · 시행 ${it.doc.effective_date}` : ""} · 조각 {it.doc.chunks}개
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="t"><span className="typeword">{it.ev.type_label}</span>{it.ev.title}</div>
                        <div className="m">
                          {it.ev.org} · {it.ev.date} · {it.ev.location}{it.ev.state === "conflict" ? " · 공식 자료와 다름" : ""}
                        </div>
                        <div className="x">{hl(it.ev.snippet || "", q)}</div>
                      </>
                    )}
                  </motion.button>
                );
              })}
            </div>
          ) : (
            <p className="empty">찾는 내용이 있는 문서가 없습니다.</p>
          )}
        </div>
      </aside>
      <section id="library-detail" className="pane" aria-live="polite">
        {detail ? (
          <motion.div
            key={detail.id}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            transition={{ duration: DUR.fast, ease: EASE_OUT }}
          >
            <SourceBody ev={detail} inLibrary query={q} onQuote={quote} />
            {doc?.mine && (
              <p>
                <button type="button" className="btn btn--sm" data-act="del-doc" data-doc={doc.id} disabled={busy}
                  onClick={() => delDoc(doc)}>
                  이 자료 지우기
                </button>
              </p>
            )}
          </motion.div>
        ) : !shown && !loading ? (
          <p className="empty">왼쪽에서 문서를 고르세요.</p>
        ) : null}
      </section>
    </main>
  );
}

// ── 대화상자 ─────────────────────────────────────────

/** 중개사가 직접 적는 사무소 자료 (단지 정보, 현장 확인 내용, 학구도 확인 결과 등) */
function AddDocDialog({ close, onDone }: { close: () => void; onDone: (r: { first_chunk: string }) => void }) {
  const toast = useToast();
  const [busy, run] = useBusy();
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [region, setRegion] = useState("");

  const ok = async () => {
    const body = { title: title.trim(), text: text.trim(), region: region.trim() || null };
    if (!body.title || body.text.length < 5) { toast("제목과 내용을 적어 주세요."); return; }
    const r = await run(() => api<{ first_chunk: string }>("POST", "/documents", body));
    if (!r) return;
    close();
    toast("자료를 추가했습니다. 질문 검색에 바로 쓰입니다.");
    onDone(r);
  };

  return (
    <>
      <h2>자료 추가</h2>
      <p className="muted lib-dlg-note">
        우리 사무소에서만 보이며, 질문 검색과 고객 자료의 근거로 바로 쓰입니다. 단지 이름을 적으면 그 단지 매물을 찾을 때 함께 봅니다.
      </p>
      <label>제목<input id="doc-title" maxLength={200} placeholder="예: 용강리버뷰 단지 확인 내용" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      <label>내용<textarea id="doc-text" rows={8} maxLength={20000}
        placeholder="예: 용강리버뷰 아파트는 2026년 학구도 기준 용강초 배정 구역입니다(교육지원청 확인, 2026-10)."
        value={text} onChange={(e) => setText(e.target.value)} /></label>
      <label>지역 (선택)<input id="doc-region" maxLength={30} placeholder="예: 마포구" value={region} onChange={(e) => setRegion(e.target.value)} /></label>
      <div className="btns">
        <button type="button" className="btn" data-act="close-dialog">취소</button>
        <button type="button" className="btn btn--main" data-act="add-doc-ok" disabled={busy} onClick={ok}>추가</button>
      </div>
    </>
  );
}

/** 관리자: 파일(txt, md, pdf)을 문서로 등록 */
function UploadDialog({ close, tenantName, onDone }: { close: () => void; tenantName: string; onDone: () => void }) {
  const toast = useToast();
  const [busy, run] = useBusy();
  const file = useRef<HTMLInputElement>(null);
  const [f, setF] = useState({
    title: "", source_type: "office", scope: "tenant", publisher: tenantName, published_at: "", effective_date: "", region: "",
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));

  const ok = async () => {
    const picked = file.current?.files?.[0];
    if (!picked || !f.title.trim() || !f.published_at) { toast("파일, 제목, 기준일을 입력하세요."); return; }
    const form = new FormData();
    form.append("file", picked);
    Object.entries(f).forEach(([k, v]) => { if (v.trim()) form.append(k, v.trim()); });
    const r = await run(() => api<{ job: { detail?: string } }>("POST", "/admin/documents", undefined, { form }));
    if (!r) return;
    close();
    toast(r.job?.detail || "등록했습니다.");
    onDone();
  };

  return (
    <>
      <h2>파일 등록</h2>
      <label>파일 (txt, md, pdf)<input id="up-file" ref={file} type="file" accept=".txt,.md,.pdf" /></label>
      <label>제목<input id="up-title" maxLength={200} value={f.title} onChange={set("title")} /></label>
      <div className="row2">
        <label>종류
          <select id="up-type" value={f.source_type} onChange={set("source_type")}>
            <option value="office">사무소 문서</option><option value="law">법령</option>
            <option value="policy">공식 정책</option><option value="news">기사(이용 허용분)</option>
          </select>
        </label>
        <label>공개 범위
          <select id="up-scope" value={f.scope} onChange={set("scope")}>
            <option value="tenant">우리 사무소만</option><option value="public">모든 사무소</option>
          </select>
        </label>
      </div>
      <div className="row2">
        <label>발행 기관<input id="up-org" value={f.publisher} onChange={set("publisher")} /></label>
        <label>기준일<input id="up-date" type="date" value={f.published_at} onChange={set("published_at")} /></label>
      </div>
      <div className="row2">
        <label>시행일 (선택)<input id="up-eff" type="date" value={f.effective_date} onChange={set("effective_date")} /></label>
        <label>지역 (선택)<input id="up-region" placeholder="예: 서울" value={f.region} onChange={set("region")} /></label>
      </div>
      <div className="btns">
        <button type="button" className="btn" data-act="close-dialog">취소</button>
        <button type="button" className="btn btn--main" data-act="upload-ok" disabled={busy} onClick={ok}>등록</button>
      </div>
    </>
  );
}

/** 문서 조각을 인용해 고객 문의 답변 자료를 만든다 */
function QuoteDialog({ close, ev, customers }: { close: () => void; ev: Evidence; customers: Customer[] }) {
  const toast = useToast();
  const [busy, run] = useBusy();
  const [cid, setCid] = useState(customers[0] ? String(customers[0].id) : "");
  const [question, setQuestion] = useState("");

  const ok = async () => {
    const qv = question.trim();
    if (!qv) { toast("고객 문의 내용을 적어 주세요."); return; }
    const r = await run(() => api<{ id: number }>("POST", `/customers/${cid}/reports`, { kind: "answer", question: qv, quote_id: ev.id }));
    if (!r) return;
    close();
    navigate(`#/report/${r.id}`);
  };

  return (
    <>
      <h2>고객 문의 답변에 인용</h2>
      <p className="muted lib-dlg-note">인용할 자료: {ev.title}</p>
      <label>고객
        <select id="quote-customer" value={cid} onChange={(e) => setCid(e.target.value)}>
          {customers.map((c) => <option key={c.id} value={c.id}>{c.name} (담당 {c.agent_name})</option>)}
        </select>
      </label>
      <label>고객 문의<textarea id="quote-q" rows={3} maxLength={1000} value={question} onChange={(e) => setQuestion(e.target.value)} /></label>
      <div className="btns">
        <button type="button" className="btn" data-act="close-dialog">취소</button>
        <button type="button" className="btn btn--main" data-act="quote-ok" data-src={ev.id} disabled={busy} onClick={ok}>답변 작성</button>
      </div>
    </>
  );
}
