/* 출처(근거) — 화면에 나온 근거를 id로 모아 두고, 누르면 출처 패널(#drawer)을 연다.
   데스크톱: 오른쪽 떠 있는 패널. 휴대폰(≤900px): 아래에서 올라오는 시트를 대화상자처럼 다룬다
   (뒤 화면 스크롤 막기, 포커스 가두기, 바깥 누르면 닫기, 머리글을 끌어내려 닫기, 닫으면 포커스 복귀). */
import { AnimatePresence, motion, useDragControls } from "motion/react";
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore,
  type ReactNode,
} from "react";
import { api } from "@/lib/api";
import { TYPE_WORD } from "@/lib/format";
import { LOGOUT_EVENT } from "@/lib/router";
import { DUR, EASE_OUT, SPRING_PANEL } from "@/lib/motion";
import type { Evidence } from "@/lib/types";
import { useToast } from "./ui";

type Sources = {
  remember: (ev: Evidence | null | undefined) => Evidence | null | undefined;
  get: (id: string) => Evidence | undefined;
  /** id 또는 근거 자체. 문서 조각(c12)은 모르면 서버에서 불러온다 */
  open: (idOrEv: string | Evidence) => Promise<void>;
  close: () => void;
  current: Evidence | null;
};

const Ctx = createContext<Sources | null>(null);

const SHEET_QUERY = "(max-width: 900px)";
export function useSheetMode() {
  return useSyncExternalStore(
    (cb) => { const m = matchMedia(SHEET_QUERY); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); },
    () => matchMedia(SHEET_QUERY).matches,
  );
}

export function SourcesProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const store = useRef(new Map<string, Evidence>());
  const [current, setCurrent] = useState<Evidence | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const isOpen = useRef(false);

  const remember = useCallback((ev: Evidence | null | undefined) => {
    if (ev && ev.id) store.current.set(ev.id, ev);
    return ev;
  }, []);
  const get = useCallback((id: string) => store.current.get(id), []);

  // 로그아웃하면 모아 둔 근거를 비운다
  useEffect(() => {
    const clear = () => { store.current.clear(); isOpen.current = false; setCurrent(null); };
    addEventListener(LOGOUT_EVENT, clear);
    return () => removeEventListener(LOGOUT_EVENT, clear);
  }, []);

  const open = useCallback(async (idOrEv: string | Evidence) => {
    const id = typeof idOrEv === "string" ? idOrEv : idOrEv.id;
    let ev = typeof idOrEv === "string" ? store.current.get(idOrEv) : (remember(idOrEv) ?? undefined);
    if (!ev && /^c\d+$/.test(id)) {
      const at = location.hash;
      ev = remember(await api<Evidence>("GET", `/evidence/${id}`).catch(() => null)) ?? undefined;
      if (location.hash !== at) return;   // 기다리는 사이 다른 화면으로 갔으면 열지 않는다
    }
    if (!ev) { toast("출처를 찾을 수 없습니다."); return; }
    if (!isOpen.current) opener.current = document.activeElement as HTMLElement | null;  // 닫을 때 포커스를 돌려줄 곳
    isOpen.current = true;
    setCurrent(ev);
  }, [remember, toast]);

  const close = useCallback(() => {
    if (!isOpen.current) return;
    isOpen.current = false;
    setCurrent(null);
    const o = opener.current;
    opener.current = null;
    if (o && o.isConnected) requestAnimationFrame(() => o.focus({ preventScroll: true }));
  }, []);

  const value = useMemo(() => ({ remember, get, open, close, current }), [remember, get, open, close, current]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <SourceDrawer ev={current} onClose={close} />
    </Ctx.Provider>
  );
}

export function useSources() {
  const s = useContext(Ctx);
  if (!s) throw new Error("SourcesProvider 밖입니다.");
  return s;
}

/** 검색어 강조 */
function highlight(text: string, query: string): ReactNode {
  const words = query.trim().split(/\s+/).filter((w) => w.length > 1);
  if (!words.length) return text;
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");
  return text.split(re).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part));
}

/** 출처 본문. 출처 패널과 자료실 상세가 같이 쓴다 */
export function SourceBody({
  ev, inLibrary = false, query = "", onClose, onQuote,
}: { ev: Evidence; inLibrary?: boolean; query?: string; onClose?: () => void; onQuote?: (ev: Evidence) => void }) {
  return (
    <>
      <div className="drawer-h" data-drag-handle>
        <div>
          <span className="typeword">{ev.type_label || TYPE_WORD[ev.type || ""] || ""}</span>
          <h2 style={{ display: "inline" }}>{ev.title}</h2>
        </div>
        {!inLibrary && <button type="button" className="btn btn--sm" data-act="close-drawer" onClick={onClose}>닫기</button>}
      </div>
      <dl className="kv" style={{ marginTop: 10 }}>
        <dt>발행</dt><dd>{ev.org}</dd>
        <dt>기준일</dt><dd>{ev.date}{ev.effective_date ? ` · 시행 ${ev.effective_date}` : ""}</dd>
        <dt>위치</dt><dd>{ev.location || "-"}</dd>
      </dl>
      <div className="excerpt">{highlight(ev.snippet || "", query)}</div>
      {ev.note && <p className="note" style={{ color: ev.state === "ok" ? "var(--sub)" : "var(--warn)" }}>{ev.note}</p>}
      {ev.url && <p className="note"><a href={ev.url} target="_blank" rel="noopener noreferrer">원문 페이지 열기</a></p>}
      {inLibrary && ev.kind === "chunk" && onQuote && (
        <p><button type="button" className="btn" data-act="quote" onClick={() => onQuote(ev)}>고객 문의 답변에 인용</button></p>
      )}
    </>
  );
}

const FOCUSABLE = "a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex='-1'])";

function SourceDrawer({ ev, onClose }: { ev: Evidence | null; onClose: () => void }) {
  const sheet = useSheetMode();
  const ref = useRef<HTMLElement>(null);
  const drag = useDragControls();

  // 휴대폰 시트: 뒤 화면 스크롤 막기 + 어둡게 (CSS body.sheet-open)
  useEffect(() => {
    if (!ev || !sheet) return;
    document.body.classList.add("sheet-open");
    return () => document.body.classList.remove("sheet-open");
  }, [ev, sheet]);

  // 열리면 첫 버튼에 포커스
  useEffect(() => {
    if (ev) requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>("button")?.focus());
  }, [ev]);

  // Escape로 닫기 (어느 폭이든)
  useEffect(() => {
    if (!ev) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [ev, onClose]);

  // 휴대폰 시트: 바깥을 누르면 닫고, 그 누름이 아래 화면의 버튼까지 누르지 않게 클릭을 삼킨다
  useEffect(() => {
    if (!ev || !sheet) return;
    let swallowAt = 0;
    const down = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest("#drawer")) return;
      onClose();
      swallowAt = Date.now();
    };
    const click = (e: MouseEvent) => {
      if (swallowAt && Date.now() - swallowAt < 600) { e.preventDefault(); e.stopPropagation(); }
      swallowAt = 0;
    };
    document.addEventListener("pointerdown", down);
    document.addEventListener("click", click, true);
    return () => { document.removeEventListener("pointerdown", down); document.removeEventListener("click", click, true); };
  }, [ev, sheet, onClose]);

  // 휴대폰 시트: Tab이 뒤 화면으로 빠져나가지 않게
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !sheet || !ref.current) return;
    const f = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  };

  const motionProps = sheet
    ? {
        initial: { y: "100%" }, animate: { y: 0 }, exit: { y: "100%" }, transition: SPRING_PANEL,
        drag: "y" as const, dragControls: drag, dragListener: false,
        dragConstraints: { top: 0, bottom: 0 }, dragElastic: { top: 0, bottom: 0.7 },
        onDragEnd: (_: unknown, info: { offset: { y: number }; velocity: { y: number } }) => {
          if (info.offset.y > 110 || info.velocity.y > 600) onClose();
        },
      }
    : {
        initial: { opacity: 0, x: 16 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: 12 },
        transition: { duration: DUR.base, ease: EASE_OUT },
      };

  return (
    <AnimatePresence>
      {ev && (
        <motion.aside
          key="drawer"
          id="drawer"
          ref={ref}
          className="drawer"
          aria-label="출처"
          role={sheet ? "dialog" : "complementary"}
          aria-modal={sheet || undefined}
          onKeyDown={onKeyDown}
          onPointerDown={(e) => {
            const t = e.target as HTMLElement;
            if (sheet && t.closest("[data-drag-handle]") && !t.closest("button, a")) drag.start(e);
          }}
          {...motionProps}
        >
          <SourceBody ev={ev} onClose={onClose} />
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
