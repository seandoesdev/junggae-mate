/* 거래 단계 표시: 이름표(StageTag)와 5칸 진행 막대(Prog). 색은 CSS 변수 --st-* (청록 한 가지의 진하기) */
import { STAGES, STAGE_COLOR, STAGE_LABEL, stageIdx } from "@/lib/format";

export function StageTag({ s }: { s: string }) {
  return <span className="stage" data-s={s}>{STAGE_LABEL[s] || s}</span>;
}

export function Prog({ s, wide = false }: { s: string; wide?: boolean }) {
  const n = stageIdx(s) + 1;
  return (
    <span
      className={`prog ${wide ? "prog--wide" : ""}`}
      style={{ ["--c" as string]: STAGE_COLOR[s] || "var(--line)" }}
      aria-label={`${STAGE_LABEL[s] || ""} ${Math.max(n, 0)}/5`}
    >
      {STAGES.map((_, i) => <i key={i} className={i < n ? "on" : ""} />)}
    </span>
  );
}
