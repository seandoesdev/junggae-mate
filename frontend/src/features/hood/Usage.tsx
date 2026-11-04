/* Hood AI 사용량 (#/ai/usage): 숫자 카드, 일별 질문, 사람별·출처별, 월 한도, 검색 경로와 응답 시간.
   차트는 Bklit(components/charts). 색은 --chart-1…5(청록 진하기). 숫자 카드는 anime.js로 올라간다. */
import { useQuery } from "@tanstack/react-query";
import { useLayoutEffect, useRef } from "react";
import { Bar } from "@/components/charts/bar";
import { BarChart } from "@/components/charts/bar-chart";
import { BarXAxis } from "@/components/charts/bar-x-axis";
import { BarYAxis } from "@/components/charts/bar-y-axis";
import { Gauge } from "@/components/charts/gauge";
import { Grid } from "@/components/charts/grid";
import { Ring } from "@/components/charts/ring";
import { RingCenter } from "@/components/charts/ring-center";
import { RingChart } from "@/components/charts/ring-chart";
import { ChartTooltip } from "@/components/charts/tooltip";
import { YAxis } from "@/components/charts/y-axis";
import { api } from "@/lib/api";
import { countUp } from "@/lib/anime";
import { AiPageShell, useErrorToast } from "./Pages";
import { ROUTE_NAME, TYPE_NAME } from "./store";

type Usage = {
  today: string; month_start: string; month_total: number; today_total: number; mine_month: number;
  with_listings: number; avg_sources: number | null; reports_from_answers: number; llm_answers: number;
  daily: { date: string; count: number }[];
  by_user: { name: string; count: number }[];
  by_source_type: { type: string; count: number }[];
  monthly_limit: number | null;
  traces: number; latency_avg_ms: number | null; latency_p95_ms: number | null; stale_answers: number;
  by_route: { route: string; count: number }[];
};

/** 응답 시간 목표 (p95). 이보다 느리면 계기판이 가득 찬다 */
const LATENCY_TARGET_MS = 3000;

const md = (iso: string) => `${+iso.slice(5, 7)}/${+iso.slice(8, 10)}`;

/** 숫자가 0에서 올라간다 (동작 줄이기면 바로 최종값) */
function Count({ n }: { n: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => countUp(ref.current, n, { duration: 600 }), [n]);
  return <span ref={ref}>{n.toLocaleString("ko-KR")}</span>;
}

function Kpi({ label, n, foot, lead, children }: { label: string; n: number; foot?: React.ReactNode; lead?: boolean; children?: React.ReactNode }) {
  return (
    <div className={`kpi ${lead ? "kpi--lead" : ""}`}>
      <span className="k-l">{label}</span>
      <span className="k-v num"><Count n={n} /><small>건</small></span>
      {children}
      {foot && <span className="k-c">{foot}</span>}
    </div>
  );
}

function BarList({ items, topFirst = false }: { items: { label: string; count: number }[]; topFirst?: boolean }) {
  const max = Math.max(1, ...items.map((x) => x.count));
  return (
    <ul className="barlist">
      {items.map((x, i) => (
        <li key={x.label}>
          <span>{x.label}</span><span className="num">{x.count}</span>
          <i style={{ width: `${(x.count / max) * 100}%` }} className={topFirst && i === 0 ? "top" : ""} />
        </li>
      ))}
    </ul>
  );
}

export function UsagePage() {
  const q = useQuery({ queryKey: ["hood", "usage"], queryFn: () => api<Usage>("GET", "/ai/usage"), staleTime: 0 });
  useErrorToast(q.error);
  const u = q.data;
  if (!u) return <AiPageShell title="사용량" />;

  const month = `${+u.month_start.slice(0, 4)}년 ${+u.month_start.slice(5, 7)}월`;
  const lim = u.monthly_limit;
  const share = (n: number) => (u.month_total ? `${Math.round((n / u.month_total) * 100)}%` : "-");
  const dailyTotal = u.daily.reduce((a, d) => a + d.count, 0);
  const top = u.daily.reduce((a, d) => (d.count > a.count ? d : a), u.daily[0] ?? { date: "", count: 0 });
  const daily = u.daily.map((d, i) => ({ name: i === u.daily.length - 1 ? "오늘" : md(d.date), count: d.count }));
  const routes = u.by_route.map((x) => ({ name: ROUTE_NAME[x.route] || x.route, count: x.count }));
  const p95 = u.latency_p95_ms;

  return (
    <AiPageShell
      title="사용량"
      sub={<>{month} 질문 {u.month_total}건 · {lim ? `월 한도 ${lim}건 중 ${Math.max(lim - u.month_total, 0)}건 남음` : "월 한도 없음"} · 답변 방식 {u.llm_answers ? `Claude ${u.llm_answers}건` : "규칙 기반 문장틀"}</>}
      action={<a className="btn" href="#/ai/settings">한도·자료 설정</a>}
    >
      <div className="kpis">
        <Kpi lead label="이번 달 질문" n={u.month_total} foot={lim ? `한도 ${lim}건` : `${month} 1일부터`}>
          {lim ? (
            <span className="meter" aria-label={`한도 ${lim}건 중 ${u.month_total}건`}>
              <i style={{ width: `${Math.min(100, (u.month_total / lim) * 100)}%` }} />
            </span>
          ) : null}
        </Kpi>
        <Kpi label="오늘" n={u.today_total} foot={u.today.slice(5).replace("-", "/")} />
        <Kpi label="내 질문" n={u.mine_month} foot={`이번 달 중 ${share(u.mine_month)}`} />
        <Kpi label="매물을 찾은 답변" n={u.with_listings} foot={`이번 달 중 ${share(u.with_listings)}`} />
        <Kpi label="고객 자료로 만든 답변" n={u.reports_from_answers} foot="이번 달" />
      </div>

      <div className="ugrid">
        <section className="card card--chart">
          <div className="card-h"><h2>일별 질문</h2><span className="muted">최근 {u.daily.length}일</span></div>
          {dailyTotal ? (
            <div className="hood-chart" role="img" aria-label={`최근 ${u.daily.length}일 일별 질문 수`}>
              <BarChart data={daily} xDataKey="name" aspectRatio="640 / 250" barGap={0.36} animationDuration={700}
                margin={{ top: 12, right: 8, bottom: 30, left: 34 }}>
                <Grid horizontal numTicksRows={4} fadeHorizontal={false} strokeDasharray="0" />
                <Bar dataKey="count" fill="var(--chart-1)" lineCap={2} fadedOpacity={0.45} />
                <YAxis numTicks={4} formatValue={(v) => (Number.isInteger(v) ? String(v) : "")} />
                <BarXAxis maxLabels={{ base: 5, sm: 14 }} />
                <ChartTooltip showDatePill={false} rows={(p) => [{ color: "var(--chart-1)", label: "질문", value: `${p.count as number}건` }]} />
              </BarChart>
            </div>
          ) : (
            <p className="empty-box hood-chart-empty">최근 {u.daily.length}일 동안 질문이 없습니다.</p>
          )}
          <div className="card-foot">
            <span>{u.daily.length}일 합계 <b className="num">{dailyTotal}건</b></span>
            <span>가장 많은 날 <b className="num">{top.count ? `${md(top.date)} ${top.count}건` : "-"}</b></span>
            <span>질문한 날 <b className="num">{u.daily.filter((d) => d.count).length}일</b></span>
          </div>
        </section>
        <div className="ucol">
          {lim ? (
            <section className="card">
              <div className="card-h"><h2>월 한도</h2><span className="muted">{Math.max(lim - u.month_total, 0)}건 남음</span></div>
              <div className="hood-ring">
                <RingChart size={150} strokeWidth={12} baseInnerRadius={52} padding={6} animationDuration={700}
                  data={[{ label: "이번 달 질문", value: Math.min(u.month_total, lim), maxValue: lim, color: "var(--chart-1)" }]}>
                  <Ring index={0} />
                  <RingCenter defaultLabel={`한도 ${lim}건`} suffix="건" />
                </RingChart>
              </div>
            </section>
          ) : null}
          <section className="card">
            <div className="card-h"><h2>사람별</h2><span className="muted">이번 달</span></div>
            {u.by_user.length
              ? <BarList topFirst items={u.by_user.map((x) => ({ label: x.name, count: x.count }))} />
              : <p className="empty-box">이번 달 질문이 아직 없습니다.</p>}
          </section>
          <section className="card">
            <div className="card-h"><h2>답변에 쓴 출처</h2><span className="muted">{u.avg_sources != null ? `답변당 평균 ${u.avg_sources}개` : "이번 달"}</span></div>
            <BarList items={u.by_source_type.map((x) => ({ label: TYPE_NAME[x.type] || x.type, count: x.count }))} />
          </section>
        </div>
      </div>

      <section className="card route-card">
        <div className="card-h">
          <h2>검색 경로</h2>
          <span className="muted">
            {u.traces
              ? `이번 달 ${u.traces}건 · 평균 응답 ${u.latency_avg_ms}ms · p95 ${u.latency_p95_ms}ms · 오래된 공공데이터를 쓴 답변 ${u.stale_answers}건`
              : "이번 달 기록 없음"}
          </span>
        </div>
        {routes.length ? (
          <div className="hood-route">
            <div className="hood-route-bars" style={{ height: routes.length * 34 + 16 }} role="img"
              aria-label={routes.map((r) => `${r.name} ${r.count}건`).join(", ")}>
              <BarChart data={routes} xDataKey="name" orientation="horizontal" aspectRatio="auto" className="h-full"
                barGap={0.4} animationDuration={700} margin={{ top: 8, right: 36, bottom: 8, left: 112 }}>
                <Bar dataKey="count" fill="var(--chart-2)" lineCap={2} fadedOpacity={0.45} showValue={false} />
                <BarYAxis />
                <ChartTooltip rows={(p) => [{ color: "var(--chart-2)", label: "질문", value: `${p.count as number}건` }]} />
              </BarChart>
            </div>
            {p95 != null && (
              <div className="hood-latency">
                <h3>응답 시간 <span className="muted">p95</span></h3>
                <p className="hood-latency-v num"><Count n={p95} /><small>ms</small></p>
                <Gauge orientation="linear" value={Math.max(2, Math.min(100, (p95 / LATENCY_TARGET_MS) * 100))} totalNotches={24}
                  activeFill="var(--chart-1)" inactiveFill="var(--control)" linearHeight={14} minWidth={160} />
                <p className="muted">목표 {LATENCY_TARGET_MS / 1000}초 이내 · 평균 {u.latency_avg_ms}ms · 오래된 공공데이터를 쓴 답변 {u.stale_answers}건</p>
              </div>
            )}
          </div>
        ) : (
          <p className="empty-box">질문을 하면 매물·실거래가·전월세·단지·건축물·노선·문서 중 어떤 경로를 썼는지 여기에 쌓입니다.</p>
        )}
      </section>
    </AiPageShell>
  );
}
