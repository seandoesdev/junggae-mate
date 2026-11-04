/* 입력창: 여러 줄 질문 + 아래 줄에 '자료 추가'(Hood가 근거로 쓸 사무소 자료), '기사 포함' 토글, 보내기.
   Enter로 보내고 Shift+Enter는 줄바꿈. 한글 조합 중 Enter는 무시. 높이는 내용에 맞춰 140px까지 늘어난다. */
import { motion } from "motion/react";
import { forwardRef, useLayoutEffect, useRef, type FormEvent } from "react";
import { ClipIcon, SendIcon } from "@/components/Icons";
import { press, SPRING_SNAPPY } from "@/lib/motion";
import { useUi } from "@/state/ui";
import { AddDocDialog } from "./dialogs";
import { hood, useHood } from "./store";

type Props = {
  id: string;
  textareaId?: string;
  className?: string;
  placeholder: string;
  rows: number;
  value: string;
  onChange: (v: string) => void;
  /** 비어 있지 않은 질문을 보낼 때. 앞 질문을 기다리는 중이면 부모가 알린다 */
  onSend: (q: string) => void;
  pending: boolean;
};

export const Composer = forwardRef<HTMLTextAreaElement, Props>(function Composer(
  { id, textareaId, className = "", placeholder, rows, value, onChange, onSend, pending }, outer,
) {
  const { news } = useHood();
  const { openDialog } = useUi();
  const ta = useRef<HTMLTextAreaElement | null>(null);

  // 내용에 맞춰 높이 조절 (비우면 처음 높이로)
  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    if (value) el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [value]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = value.trim();
    if (!q) { ta.current?.focus(); return; }
    onSend(q);
  };

  return (
    <form className={`composer ${className}`} id={id} autoComplete="off" onSubmit={submit}>
      <textarea
        id={textareaId}
        ref={(el) => { ta.current = el; if (typeof outer === "function") outer(el); else if (outer) outer.current = el; }}
        rows={rows}
        maxLength={500}
        aria-label="Hood에게 질문"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing || e.keyCode === 229) return;
          e.preventDefault();
          e.currentTarget.form?.requestSubmit();
        }}
      />
      <div className="composer-bar">
        <button type="button" className="icon-btn" data-act="add-doc" aria-label="자료 추가 (Hood가 근거로 쓸 사무소 자료)" title="자료 추가"
          onClick={() => openDialog((close) => <AddDocDialog close={close} />)}>
          <ClipIcon />
        </button>
        <label className="composer-toggle">
          <input type="checkbox" name="news" checked={news} onChange={(e) => hood.setNews(e.target.checked)} />
          <span className="track" aria-hidden="true" />기사 포함
        </label>
        <motion.button type="submit" className="composer-send" aria-label="보내기" disabled={pending}
          whileTap={pending ? undefined : press} transition={SPRING_SNAPPY}>
          <SendIcon />
        </motion.button>
      </div>
    </form>
  );
});
