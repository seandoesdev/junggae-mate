/* 거래 보드 (예전 app-people.js의 VIEWS.deals + app-map.js의 단계 바꾸기).
   단계별 칸(.col)에 거래 카드(.dcard). 이전/다음으로 단계를 바꾸면 카드가 새 칸으로 옮겨 간다(Motion layoutId).
   위에는 단계 깔때기(Bklit FunnelChart): '이 단계까지 온 진행 중 거래' 수. 칸 머리의 진행선과 숫자는 처음 한 번만 그린다(anime.js). */
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { LayoutGroup, motion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import type { ViewProps } from "@/App";
import { FunnelChart } from "@/components/charts/funnel-chart";
import { StageTag } from "@/components/Stage";
import { api } from "@/lib/api";
import { countUp, drawIn } from "@/lib/anime";
import { STAGES, STAGE_COLOR, STAGE_LABEL, priceText, stageIdx } from "@/lib/format";
import { SPRING_SNAPPY, press } from "@/lib/motion";
import { navigate } from "@/lib/router";
import { useUser } from "@/state/session";
import { useToast } from "@/state/ui";
import "./deals.css";

type Deal = {
  id: number;
  listing_id: number;
  customer_id: number;
  customer_name: string;
  agent_id: number;
  agent_name: string;
  stage: string;
  next_action: string | null;
  dropped_reason: string | null;
  days_in_stage: number;
  listing: { id: number; label: string; title: string; price: number | null; price_text?: string; agent_id: number; agent_name: string };
};
type StageResult = { deal: Deal; warnings: string[] };
type Scope = "mine" | "all";

// 다른 화면에 다녀와도 고른 범위를 기억한다 (예전 P.boardScope)
let lastScope: Scope = "mine";

/** 칸 머리 진행선·깔때기에 쓰는 단계 색 (청록 진하기 = --chart-1…5) */
const FUNNEL_COLOR: Record<string, string> = {
  intro: "var(--chart-5)", visit: "var(--chart-3)", nego: "var(--chart-2)", contract: "var(--chart-1)", done: "var(--chart-4)",
};

export default function DealsView(_: ViewProps) {
  const user = useUser();
  const toast = useToast();
  const qc = useQueryClient();
  const [scope, setScopeState] = useState<Scope>(lastScope);
  const setScope = (s: Scope) => { lastScope = s; setScopeState(s); };
  const [busyId, setBusyId] = useState<number | null>(null);
  // 키보드로 바꾼 단계는 움직이지 않고, 옮겨 간 카드의 같은 버튼으로 포커스를 돌려준다
  const [instant, setInstant] = useState(false);
  const refocus = useRef<{ id: number; act: "prev" | "next" } | null>(null);

  const q = useQuery({
    queryKey: ["deals", scope],
    queryFn: () => api<Deal[]>("GET", `/deals${scope === "mine" ? "?mine=true" : ""}`),
    placeholderData: keepPreviousData,
  });
  useEffect(() => { if (q.error) toast((q.error as Error).message); }, [q.error, toast]);

  const deals = q.data;

  useLayoutEffect(() => {
    const r = refocus.current;
    if (!r || !deals) return;
    const card = document.querySelector(`#board [data-deal="${r.id}"]`);
    if (!card) return;
    refocus.current = null;
    const btn = card.querySelector<HTMLButtonElement>(`[data-act="${r.act}"]:not([disabled])`)
      ?? card.querySelector<HTMLButtonElement>("[data-act]:not([disabled])");
    btn?.focus();
  }, [deals]);

  const canChange = (d: Deal) => user.role === "admin" || [d.agent_id, d.listing.agent_id].includes(user.id);

  async function changeStage(e: MouseEvent<HTMLButtonElement>, d: Deal, act: "prev" | "next") {
    const keyboard = e.detail === 0;   // Enter·Space로 누른 버튼은 click detail이 0
    const stage = STAGES[stageIdx(d.stage) + (act === "next" ? 1 : -1)];
    if (!stage) return;
    setBusyId(d.id);
    try {
      const r = await api<StageResult>("POST", `/deals/${d.id}/stage`, { stage });
      setInstant(keyboard);
      if (keyboard) refocus.current = { id: d.id, act };
      // 응답의 거래로 바로 바꿔 카드가 새 칸으로 옮겨 가게 한 뒤, 다른 화면의 자료도 새로 받게 표시한다
      qc.setQueryData<Deal[]>(["deals", scope], (old) => old?.map((x) => (x.id === d.id ? { ...x, ...r.deal } : x)));
      void qc.invalidateQueries();
      toast(
        r.warnings.length
          ? `${STAGE_LABEL[stage]}(으)로 바꿨습니다. ${r.warnings.join(" ")}`
          : `${r.deal.customer_name} · ${r.deal.listing.label}: ${STAGE_LABEL[stage]}`,
        4200,
      );
    } catch (err) {
      toast((err as Error).message, 4200);
    } finally {
      setBusyId(null);
    }
  }

  const dropped = deals?.filter((d) => d.stage === "dropped") ?? [];
  const active = deals?.filter((d) => d.stage !== "dropped") ?? [];
  // 깔때기: 단계 n 이상에 있는 진행 중 거래 수 (지금 단계별 수는 칸 머리에 있다)
  const reached = STAGES.map((_, i) => active.filter((d) => stageIdx(d.stage) >= i).length);

  return (
    <main id="view-deals" className="view view-page">
      <div className="page-head">
        <h1>거래</h1>
        <div className="toggle" role="group" aria-label="보기 범위">
          <button type="button" data-scope="mine" aria-pressed={scope === "mine"} onClick={() => setScope("mine")}>내 거래</button>
          <button type="button" data-scope="all" aria-pressed={scope === "all"} onClick={() => setScope("all")}>사무소 전체</button>
        </div>
      </div>

      {deals && reached[0] > 0 && (
        <section className="deal-funnel" aria-label="거래 단계 깔때기">
          <div className="deal-funnel-h">
            <h2>단계별 도달</h2>
            <span className="muted">진행 중 {reached[0]}건 중 각 단계까지 온 거래 (무산 제외)</span>
          </div>
          <FunnelChart
            className="deal-funnel-chart"
            style={{ aspectRatio: "auto" }}
            data={STAGES.map((s, i) => ({
              label: STAGE_LABEL[s],
              value: reached[i],
              displayValue: `${reached[i]}건`,
              color: FUNNEL_COLOR[s],
            }))}
            layers={2}
            gap={3}
            showPercentage={false}
            labelLayout="grouped"
            staggerDelay={0.05}
            enterTransition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
          />
          <p className="sr-only">
            {STAGES.map((s, i) => `${STAGE_LABEL[s]} ${reached[i]}건`).join(", ")}
          </p>
        </section>
      )}

      <LayoutGroup>
        <div className="board" id="board">
          {deals && STAGES.map((s, i) => {
            const items = deals.filter((d) => d.stage === s);
            return (
              <section key={s} className="col" aria-label={STAGE_LABEL[s]}>
                <div className="col-h">
                  <span className="col-title"><StageTag s={s} /><StageLine idx={i} /></span>
                  <ColCount n={items.length} />
                </div>
                {items.map((d) => {
                  const idx = stageIdx(d.stage), can = canChange(d), busy = busyId === d.id;
                  return (
                    <motion.article
                      key={d.id}
                      layoutId={`deal-${d.id}`}
                      layout="position"
                      transition={instant ? { duration: 0 } : SPRING_SNAPPY}
                      data-deal={d.id}
                      className={`dcard ${d.agent_id === user.id ? "" : "is-other"}`}
                    >
                      <div className="dcard-top">
                        <a href={`#/customers/${d.customer_id}`}>{d.customer_name}</a>
                        <span className="muted num">{d.days_in_stage}일</span>
                      </div>
                      <button type="button" className="btn--link" style={{ textAlign: "left" }} data-act="open"
                        onClick={() => navigate(`#/map/l/${d.listing_id}`)}>
                        {d.listing.label} {d.listing.title} · {d.listing.price_text ?? priceText(d.listing)}
                      </button>
                      <div className="next">{d.next_action || ""}</div>
                      <div className="acts">
                        <span className="who">담당 {d.agent_name}</span>
                        <span>
                          <motion.button type="button" className="btn btn--sm" data-act="prev" aria-label="이전 단계"
                            whileTap={press} disabled={idx <= 0 || !can || busy}
                            onClick={(e) => changeStage(e, d, "prev")}>이전</motion.button>{" "}
                          <motion.button type="button" className="btn btn--sm" data-act="next" aria-label="다음 단계"
                            whileTap={press} disabled={idx >= 4 || !can || busy}
                            onClick={(e) => changeStage(e, d, "next")}>다음</motion.button>
                        </span>
                      </div>
                    </motion.article>
                  );
                })}
                {!items.length && <p className="col-empty">없음</p>}
              </section>
            );
          })}
        </div>
      </LayoutGroup>
      <p className="dropped" id="dropped">
        {deals && `무산 ${dropped.length}건${dropped.length
          ? ": " + dropped.map((d) => `${d.customer_name}–${d.listing.label} (${d.dropped_reason || "-"})`).join(", ")
          : ""}`}
      </p>
    </main>
  );
}

/** 칸 머리의 작은 진행선: 5칸 중 이 단계까지. 처음 나타날 때 한 번 그려진다 */
function StageLine({ idx }: { idx: number }) {
  const ref = useRef<SVGLineElement>(null);
  useEffect(() => drawIn(ref.current, { delay: 120 + idx * 70, duration: 380 }), [idx]);
  const W = 40, x2 = 2 + ((W - 4) * (idx + 1)) / STAGES.length;
  return (
    <svg className="col-line" width={W} height="6" viewBox={`0 0 ${W} 6`} aria-hidden="true">
      <line x1="2" y1="3" x2={W - 2} y2="3" stroke="var(--rule)" strokeWidth="2" strokeLinecap="round" />
      <line ref={ref} x1="2" y1="3" x2={x2} y2="3" stroke={STAGE_COLOR[STAGES[idx]]} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** 칸의 거래 수. 처음 나타날 때만 0에서 올라가고, 그 뒤 바뀌면 바로 바뀐다.
   (글자는 React가 아니라 이 effect가 쓴다 — anime.js가 글자를 바꿔도 React와 엇갈리지 않게) */
function ColCount({ n }: { n: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const mountedAt = useRef(0);
  useEffect(() => {
    if (!mountedAt.current) mountedAt.current = performance.now();
    // StrictMode가 effect를 두 번 부르므로 '처음'은 시간으로 판단한다
    if (performance.now() - mountedAt.current < 300) return countUp(ref.current, n, { duration: 500 });
    if (ref.current) ref.current.textContent = String(n);
  }, [n]);
  return <span className="num" ref={ref} />;
}
