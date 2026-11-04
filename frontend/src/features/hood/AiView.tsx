/* Hood AI 전용 화면 (#/ai): 왼쪽 메뉴(채팅·보고서·사용량·설정)와 이전 대화, 오른쪽 본문.
   #/ai → 늘 새 대화로 시작 (패널에서 하던 대화를 잇지 않는다). #/ai/s/<번호> → 그 대화를 불러와 이어 묻기.
   #/ai/reports[/상태], #/ai/usage, #/ai/settings */
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ViewProps } from "@/App";
import { SearchIcon, SparkIcon } from "@/components/Icons";
import { api } from "@/lib/api";
import { staggerIn } from "@/lib/anime";
import { DUR, EASE_OUT } from "@/lib/motion";
import { navigate, replaceHash } from "@/lib/router";
import { useUser } from "@/state/session";
import { useToast } from "@/state/ui";
import { Composer } from "./Composer";
import { ReportsPage, SettingsPage } from "./Pages";
import { ASK_EXAMPLES, blankConv, hood, rememberQuestion, useHood, when } from "./store";
import { Thread } from "./Thread";
import { UsagePage } from "./Usage";
import "./hood.css";

const PAGES = ["search", "reports", "usage", "settings"] as const;
type AiPage = (typeof PAGES)[number];

export default function AiView({ a, b }: ViewProps) {
  const toast = useToast();
  const numeric = !!a && /^\d+$/.test(a);
  const page = (!a || a === "s" || numeric ? "search" : a) as AiPage;
  const sid = a === "s" ? b : numeric ? a : undefined;
  const { main } = useHood();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void hood.loadSessions();
    if (!PAGES.includes(page)) { navigate("#/ai"); return; }
    if (page !== "search") return;
    if (!sid) {
      hood.setConv("main", blankConv());   // 상단 Hood AI(#/ai)로 들어오면 늘 새 대화. 하던 대화는 이전 대화 목록에서 다시 연다
      return;
    }
    const id = Number(sid);
    if (id === hood.get().main.sid) return;
    let live = true;
    setLoading(true);
    hood.loadConv(id)
      .then((c) => { if (live) hood.setConv("main", c); })
      .catch((e: Error) => { if (live) { toast(e.message); navigate("#/ai"); } })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; setLoading(false); };
  }, [page, sid, toast]);

  const isThread = page === "search" && !loading && (main.turns.length > 0 || !!main.pending);

  return (
    <main id="view-ai" className="view view-ai">
      <Rail page={page} />
      <section className={`ai-main ${isThread ? "is-thread" : ""}`} id="ai-main">
        {page === "search" && (loading ? <p className="loading">대화를 불러오는 중…</p> : <SearchPage />)}
        {page === "reports" && <ReportsPage state={b} />}
        {page === "usage" && <UsagePage />}
        {page === "settings" && <SettingsPage />}
      </section>
    </main>
  );
}

function Rail({ page }: { page: AiPage }) {
  const { sessions, main } = useHood();
  const toast = useToast();
  const [deleting, setDeleting] = useState<number | null>(null);

  const del = async (id: number) => {
    if (!confirm("이 대화를 지울까요?")) return;
    setDeleting(id);
    try { await api("DELETE", `/ai/sessions/${id}`); } catch (e) { toast((e as Error).message, 4200); setDeleting(null); return; }
    setDeleting(null);
    const s = hood.get();
    if (s.main.sid === id) { hood.setConv("main", blankConv()); if (page === "search") replaceHash("#/ai"); }
    if (s.side.sid === id) hood.setConv("side", blankConv());
    void hood.loadSessions();
  };

  return (
    <aside className="ai-rail" aria-label="Hood AI 메뉴와 이전 대화">
      <nav className="ai-nav" aria-label="Hood AI">
        {([["search", "#/ai", "채팅"], ["reports", "#/ai/reports", "보고서"], ["usage", "#/ai/usage", "사용량"], ["settings", "#/ai/settings", "설정"]] as const)
          .map(([k, href, w]) => (
            <a key={k} href={href} data-ai={k} className={page === k ? "is-active" : undefined}>
              {page === k && <motion.span layoutId="ai-nav-ind" className="ai-nav-ind" transition={{ duration: DUR.base, ease: EASE_OUT }} aria-hidden="true" />}
              <span>{w}</span>
            </a>
          ))}
      </nav>
      <div className="ai-history-h">
        <h2>이전 대화</h2>
        <a className="btn btn--sm" href="#/ai" data-act="hood-new-page" onClick={(e) => {
          e.preventDefault();
          hood.setConv("main", blankConv());
          navigate("#/ai");
        }}>새 대화</a>
      </div>
      <ul className="ai-history" id="ai-history">
        <AnimatePresence initial={false}>
          {sessions.map((s) => (
            <motion.li key={s.id} className={s.id === main.sid ? "is-cur" : ""} layout="position"
              initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }}
              transition={{ duration: DUR.base, ease: EASE_OUT }}>
              <a href={`#/ai/s/${s.id}`}>
                <span className="h-title">{s.title}</span>
                <span className="h-meta">{when(s.updated_at)} · 질문 {s.messages}개</span>
              </a>
              <button type="button" className="h-del" data-act="hood-del" aria-label={`${s.title} 대화 지우기`} title="지우기"
                disabled={deleting === s.id} onClick={() => void del(s.id)}>×</button>
            </motion.li>
          ))}
        </AnimatePresence>
        {!sessions.length && <li className="h-empty">아직 대화가 없습니다.</li>}
      </ul>
    </aside>
  );
}

function SearchPage() {
  const { main: c } = useHood();
  const toast = useToast();
  const [draft, setDraft] = useState("");
  const ta = useRef<HTMLTextAreaElement>(null);
  const thread = useRef<HTMLDivElement>(null);
  const isThread = c.turns.length > 0 || !!c.pending;

  const send = (q: string) => {
    if (hood.get().main.pending) { toast("앞 질문의 답을 찾는 중입니다. 답이 나온 뒤 보내 주세요."); return; }   // 적은 질문은 지우지 않는다
    setDraft("");
    rememberQuestion(q);
    void hood.ask("main", q, toast);
  };

  // 답이 오면(또는 새 대화면) 입력창으로
  useEffect(() => {
    if (!c.pending) ta.current?.focus({ preventScroll: true });
  }, [c.pending, c.key, isThread]);

  // 새 칸이 생기면 맨 아래로
  useLayoutEffect(() => {
    const th = thread.current;
    if (th) th.scrollTop = th.scrollHeight;
  }, [c.turns, c.pending, c.key]);

  if (!isThread) {
    return (
      <StartScreen
        composer={
          <Composer ref={ta} id="ai-form" className="composer--lg" rows={3} placeholder="매물·실거래가·전월세·법령을 물어보세요"
            value={draft} onChange={setDraft} onSend={send} pending={false} />
        }
        onExample={(q) => { rememberQuestion(q); void hood.ask("main", q, toast); }}
      />
    );
  }

  const last = c.turns[c.turns.length - 1];
  return (
    <>
      <header className="ai-thread-h">
        <h1>{c.title || "새 대화"}</h1>
        <span className="muted">질문 {c.turns.length}개{last ? ` · ${when(last.asked_at)}` : ""}</span>
      </header>
      <div className="ai-thread" id="ai-thread" ref={thread}>
        <Thread conv={c} slot="main" compact={false} />
      </div>
      <div className="ai-dock">
        <Composer ref={ta} id="ai-form" rows={1} placeholder="이어서 물어보세요 (예: 그중 7억 이하만)"
          value={draft} onChange={setDraft} onSend={send} pending={!!c.pending} />
      </div>
    </>
  );
}

/** 시작 화면: 작은 이름표 → 인사 → 입력창이 차례로 (한 번만) */
function StartScreen({ composer, onExample }: { composer: React.ReactNode; onExample: (q: string) => void }) {
  const user = useUser();
  const { sessions } = useHood();
  const root = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => staggerIn(root.current?.querySelectorAll(":scope > [data-seq]"), { gap: 40, y: 6 }), []);

  return (
    <div className="ai-start" ref={root}>
      <p className="hood-kicker" data-seq><SparkIcon /><span>Hood Chat</span><b className="hood-new">NEW</b></p>
      <h1 className="hood-hello" data-seq>안녕하세요, <span>{user.name}</span></h1>
      <div data-seq>{composer}</div>
      <p className="ai-sub" data-seq>매물·현장 메모, 매매·전월세 실거래가, 단지·건축물·지하철 공공데이터, 법령·정책, 사무소 자료, 기사에서 찾아 문장마다 출처를 붙입니다.</p>
      <ul className="ai-examples" data-seq>
        {ASK_EXAMPLES.map((q) => (
          <li key={q}>
            <button type="button" className="ask-pick" data-act="hood-example" onClick={() => onExample(q)}>
              <SearchIcon /><span>{q}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="ai-tip" data-seq>답을 받은 뒤 <b>그중 7억 이하만</b>처럼 이어서 물으면 앞 조건에 더해 찾습니다.</p>
      {sessions.length > 0 && (
        <motion.section className="ai-recent" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: DUR.base, ease: EASE_OUT }}>
          <h2>최근 대화</h2>
          <ul>
            {sessions.slice(0, 4).map((s) => (
              <li key={s.id}>
                <a href={`#/ai/s/${s.id}`}>
                  <span className="h-title">{s.title}</span><span className="h-meta">{when(s.updated_at)} · 질문 {s.messages}개</span>
                </a>
              </li>
            ))}
          </ul>
        </motion.section>
      )}
    </div>
  );
}
