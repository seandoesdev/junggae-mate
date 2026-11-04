/* Ask Hood: 어느 화면에서든 오른쪽에서 바로 묻는 패널 (휴대폰 폭에서는 아래에서 올라오는 시트).
   전용 화면(#/ai)과 따로 자기 대화(side)를 가진다. 시계로 이전 대화를 불러와 이어 묻는다.
   닫혀 있어도 요소는 남는다(aria-hidden="true", inert). 열고 닫는 움직임은 Motion 스프링이 맡는다. */
import { motion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ClockIcon, CloseIcon, ExpandIcon, PlusIcon, SearchIcon, SparkIcon } from "@/components/Icons";
import { DUR, EASE_OUT, SPRING_PANEL } from "@/lib/motion";
import { hoodPanel, useHoodPanel } from "@/state/hood";
import { useUser } from "@/state/session";
import { useSheetMode } from "@/state/sources";
import { useToast } from "@/state/ui";
import { Composer } from "./Composer";
import { ASK_EXAMPLES, blankConv, hood, rememberQuestion, useHood, when } from "./store";
import { Thread } from "./Thread";
import "./hood.css";

export default function HoodPanel() {
  const { open, prefill } = useHoodPanel();
  const { side: c, sessions } = useHood();
  const user = useUser();
  const toast = useToast();
  const sheet = useSheetMode();
  const [view, setView] = useState<"thread" | "history">("thread");
  // 닫는 움직임이 끝날 때까지는 보이게 둔다. 닫힌 뒤에는 본문을 비운다
  const [shown, setShown] = useState(open);
  const [draft, setDraft] = useState("");
  const ta = useRef<HTMLTextAreaElement>(null);
  const body = useRef<HTMLDivElement>(null);

  const panel = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  // aria-hidden은 포커스를 패널 밖으로 옮긴 뒤에 붙인다 (숨긴 요소 안에 포커스가 남지 않게)
  const [ariaHidden, setAriaHidden] = useState(!open);

  // 열 때는 늘 지금 대화부터 (상단 버튼, '/' 키, 지도 화면의 이어 묻기). 닫으면 연 곳으로 포커스를 돌려준다
  useLayoutEffect(() => {
    if (open) {
      opener.current = document.activeElement as HTMLElement | null;
      setShown(true);
      setView("thread");
      setAriaHidden(false);
      return;
    }
    if (panel.current?.contains(document.activeElement)) {
      const o = opener.current?.isConnected && opener.current !== document.body && !panel.current.contains(opener.current) ? opener.current : document.getElementById("ask-hood-btn");
      o?.focus({ preventScroll: true });
    }
    opener.current = null;
    setAriaHidden(true);
  }, [open]);

  // 다른 화면이 넣어 둔 질문을 입력창에 채운다
  useEffect(() => {
    if (!open || !prefill) return;
    const p = hoodPanel.takePrefill();
    if (p) { setView("thread"); setDraft(p); }
  }, [open, prefill]);

  // 열리면 입력창으로 (움직임이 어느 정도 진행된 뒤)
  useEffect(() => {
    if (!open || view !== "thread") return;
    const t = window.setTimeout(() => ta.current?.focus({ preventScroll: true }), 150);
    return () => clearTimeout(t);
  }, [open, view]);

  useEffect(() => {
    if (open && view === "history") void hood.loadSessions();
  }, [open, view]);

  // Escape로 닫기 (출처 패널·대화상자가 열려 있으면 그쪽이 먼저)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.getElementById("drawer") || document.querySelector("#dialog[open]")) return;
      hoodPanel.close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // 새 칸이 생기면 맨 아래로
  useLayoutEffect(() => {
    if (body.current && view === "thread") body.current.scrollTop = body.current.scrollHeight;
  }, [c.turns, c.pending, c.key, view, shown]);

  const send = (q: string) => {
    if (hood.get().side.pending) { toast("앞 질문의 답을 찾는 중입니다. 답이 나온 뒤 보내 주세요."); return; }
    setDraft("");
    setView("thread");
    rememberQuestion(q);
    void hood.ask("side", q, toast);
  };
  const load = async (id: number) => {
    try { hood.setConv("side", await hood.loadConv(id)); } catch (e) { toast((e as Error).message); return; }
    setView("thread");
  };

  const hidden = sheet ? { x: 0, y: "100%" } : { x: "112%", y: 0 };

  return (
    <motion.aside
      className="hood-panel"
      id="hood-panel"
      aria-label="Ask Hood"
      ref={panel}
      aria-hidden={ariaHidden}
      inert={ariaHidden}
      initial={false}
      animate={open ? { x: 0, y: 0 } : hidden}
      transition={SPRING_PANEL}
      style={{ visibility: shown ? "visible" : "hidden" }}
      onAnimationComplete={() => { if (!hoodPanel.get().open) setShown(false); }}
    >
      <header className="hood-h">
        <h2 className="hood-title"><SparkIcon /><span>Ask Hood</span></h2>
        <span className="hood-tools">
          <button type="button" className="icon-btn" data-act="hood-history" aria-label="이전 대화" title="이전 대화"
            aria-pressed={view === "history"} onClick={() => setView((v) => (v === "history" ? "thread" : "history"))}>
            <ClockIcon />
          </button>
          <button type="button" className="icon-btn" data-act="hood-new" aria-label="새 대화" title="새 대화"
            onClick={() => { hood.setConv("side", blankConv()); setView("thread"); }}>
            <PlusIcon />
          </button>
          <a className="icon-btn" id="hood-expand" href={c.sid ? `#/ai/s/${c.sid}` : "#/ai"} aria-label="Hood AI에서 크게 보기" title="크게 보기"
            onClick={() => hoodPanel.close()}>
            <ExpandIcon />
          </a>
          <button type="button" className="icon-btn" data-act="hood-close" aria-label="닫기" title="닫기" onClick={() => hoodPanel.close()}>
            <CloseIcon />
          </button>
        </span>
      </header>

      <div className="hood-body" id="hood-body" ref={body}>
        {shown && view === "history" && (
          <div className="hood-hist">
            <h3>이전 대화</h3>
            <ul>
              {sessions.map((s, i) => (
                <motion.li key={s.id} className={s.id === c.sid ? "is-cur" : ""}
                  initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: DUR.base, ease: EASE_OUT, delay: Math.min(i, 8) * 0.03 }}>
                  <button type="button" data-act="hood-load" onClick={() => void load(s.id)}>
                    <span className="h-title">{s.title}</span>
                    <span className="h-meta">
                      {when(s.updated_at)} · 질문 {s.messages}개{s.last_question && s.messages > 1 ? ` · 마지막: ${s.last_question}` : ""}
                    </span>
                  </button>
                </motion.li>
              ))}
              {!sessions.length && <li className="h-empty">아직 대화가 없습니다. 아래에 질문을 적어 보세요.</li>}
            </ul>
          </div>
        )}
        {shown && view === "thread" && (c.turns.length || c.pending ? (
          <Thread conv={c} slot="side" compact />
        ) : (
          <div className="hood-empty">
            <p className="hood-hello hood-hello--sm">안녕하세요, <span>{user.name}</span></p>
            <p>보고 있는 화면을 떠나지 않고 물어볼 수 있습니다. 답은 이전 대화에 남습니다.</p>
            <ul>
              {ASK_EXAMPLES.slice(0, 3).map((q) => (
                <li key={q}>
                  <button type="button" className="ask-pick" data-act="hood-example" onClick={() => send(q)}>
                    <SearchIcon /><span>{q}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <Composer ref={ta} id="hood-form" textareaId="hood-q" className="composer--panel" rows={2} placeholder="질문하거나 이어서 물어보세요"
        value={draft} onChange={setDraft} onSend={send} pending={!!c.pending} />
    </motion.aside>
  );
}
