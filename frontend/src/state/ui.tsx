/* 알림(toast)과 대화상자(dialog). 예전과 같은 #toast, #dialog 요소를 쓴다.
   - toast(msg, ms): 화면 아래에 잠깐 보이는 알림
   - openDialog((close) => <내용/>): 모달 대화상자. 첫 입력칸에 포커스. Escape·[data-act=close-dialog]로 닫힌다
   - useBusy(): 버튼을 잠깐 막고 실행, 오류는 알림으로 보여 주고 다시 던지지 않는다
   상태는 UiProvider가 갖고, 실제 요소는 <UiLayer/>가 그린다. UiLayer는 다른 Provider(출처 등) 안쪽에 두어
   대화상자 내용에서도 useSources() 같은 훅을 쓸 수 있게 한다 (main.tsx 참고). */
import { AnimatePresence, motion } from "motion/react";
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from "react";
import { DUR, EASE_OUT } from "@/lib/motion";

type DialogRender = (close: () => void) => ReactNode;

type Ui = {
  toast: (msg: string, ms?: number) => void;
  openDialog: (render: DialogRender) => void;
  closeDialog: () => void;
};

type Layer = {
  msg: { text: string; key: number } | null;
  render: DialogRender | null;
  closeDialog: () => void;
};

const Ctx = createContext<Ui | null>(null);
const LayerCtx = createContext<Layer | null>(null);

export function UiProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<Layer["msg"]>(null);
  const timer = useRef<number>(0);
  const [render, setRender] = useState<DialogRender | null>(null);

  const toast = useCallback((text: string, ms = 2800) => {
    setMsg({ text, key: Date.now() });
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(null), ms);
  }, []);

  const closeDialog = useCallback(() => setRender(null), []);
  const openDialog = useCallback((r: DialogRender) => setRender(() => r), []);

  const value = useMemo(() => ({ toast, openDialog, closeDialog }), [toast, openDialog, closeDialog]);
  const layer = useMemo(() => ({ msg, render, closeDialog }), [msg, render, closeDialog]);

  return (
    <Ctx.Provider value={value}>
      <LayerCtx.Provider value={layer}>{children}</LayerCtx.Provider>
    </Ctx.Provider>
  );
}

/** #dialog 와 #toast 를 그린다. main.tsx에서 다른 Provider들 안쪽에 한 번만 둔다 */
export function UiLayer() {
  const layer = useContext(LayerCtx);
  if (!layer) throw new Error("UiProvider 밖입니다.");
  const { msg, render, closeDialog } = layer;
  const dlg = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dlg.current;
    if (!d) return;
    if (render && !d.open) {
      d.showModal();
      requestAnimationFrame(() => d.querySelector<HTMLElement>("input, select, textarea, button")?.focus());
    } else if (!render && d.open) d.close();
  }, [render]);

  return (
    <>
      <dialog
        id="dialog"
        className="dialog"
        ref={dlg}
        onClose={closeDialog}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("[data-act=close-dialog]")) { e.preventDefault(); closeDialog(); }
        }}
      >
        {render && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: DUR.base, ease: EASE_OUT }}
          >
            {render(closeDialog)}
          </motion.div>
        )}
      </dialog>
      {/* 알림이 이어서 오면 앞의 것이 사라진 뒤 나온다 (#toast가 한 번에 하나만 있도록) */}
      <AnimatePresence mode="wait">
        {msg && (
          <motion.div
            key={msg.key}
            id="toast"
            className="toast"
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: DUR.fast, ease: EASE_OUT }}
          >
            {msg.text}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export function useUi() {
  const u = useContext(Ctx);
  if (!u) throw new Error("UiProvider 밖입니다.");
  return u;
}
export const useToast = () => useUi().toast;

/** [busy, run] — run(fn)은 실행 중 busy=true, 오류는 알림(4.2초)으로 보여 주고 undefined를 돌려준다 */
export function useBusy() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    try { return await fn(); }
    catch (e) { toast((e as Error).message, 4200); return undefined; }
    finally { setBusy(false); }
  }, [toast]);
  return [busy, run] as const;
}
