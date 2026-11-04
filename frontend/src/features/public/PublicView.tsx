/* 관리자 공공데이터 운영 (예전 app-public.js). 키를 노출하지 않고 승인된 API를 수집하고 작업 결과를 확인한다.
   수집 폼 5개(form[data-collect]) + 최근 수집 작업(#public-jobs). 작업 기록 위에는 자료별 완료·실패 건수 막대(Bklit). */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useState, type FormEvent } from "react";
import type { ViewProps } from "@/App";
import { Bar } from "@/components/charts/bar";
import { BarChart } from "@/components/charts/bar-chart";
import { BarXAxis } from "@/components/charts/bar-x-axis";
import { Grid } from "@/components/charts/grid";
import { ChartTooltip } from "@/components/charts/tooltip";
import { api } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { fadeUp } from "@/lib/motion";
import "./public.css";

type Job = { id: number; kind: string; status: string; detail: string | null; created_at: string; finished_at: string | null };
type CollectResult = { received?: number; inserted?: number; job?: Job };

const PUBLIC_LABEL: Record<string, string> = {
  trades: "아파트 매매 실거래가",
  "public_data:15126474": "아파트 전월세 실거래가",
  "public_data:15058453": "공동주택 단지정보",
  "public_data:15134735": "건축물대장",
  "public_data:15098554": "지하철역 정보",
};
/** 막대 가로축용 짧은 이름 (PUBLIC_LABEL과 같은 순서) */
const SHORT_LABEL: Record<string, string> = {
  trades: "매매", "public_data:15126474": "전월세", "public_data:15058453": "단지",
  "public_data:15134735": "건축물", "public_data:15098554": "지하철역",
};

const publicMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
};

type Field = {
  name: string; label: string; value?: string; placeholder?: string; pattern?: string; inputMode?: "numeric";
  note?: string; wide?: boolean; required?: boolean; select?: [string, string][];
};
type CardDef = { id: string; title: string; help: string; action: string; fields: Field[] };

const PUBLIC_CARDS: CardDef[] = [
  { id: "trades", title: "아파트 매매 실거래가", help: "시군구와 계약월 단위로 신고 매매 자료를 갱신합니다.", action: "/admin/collect/trades", fields: [
    { name: "lawd_cd", label: "법정동 시군구 코드", value: "11440", pattern: "[0-9]{5}", inputMode: "numeric", note: "5자리 코드 (예: 서울 마포구 11440)" },
    { name: "deal_ymd", label: "계약월", value: publicMonth(), pattern: "[0-9]{6}", inputMode: "numeric", note: "YYYYMM" },
  ] },
  { id: "rents", title: "아파트 전월세 실거래가", help: "시군구와 계약월 단위로 신고 자료를 갱신합니다.", action: "/admin/collect/rents", fields: [
    { name: "lawd_cd", label: "법정동 시군구 코드", value: "11440", pattern: "[0-9]{5}", inputMode: "numeric", note: "5자리 코드 (예: 서울 마포구 11440)" },
    { name: "deal_ymd", label: "계약월", value: publicMonth(), pattern: "[0-9]{6}", inputMode: "numeric", note: "YYYYMM" },
  ] },
  { id: "complexes", title: "공동주택 단지정보", help: "K-apt 단지코드로 기본정보를 갱신합니다.", action: "/admin/collect/complexes", fields: [
    { name: "kapt_code", label: "K-apt 단지코드", placeholder: "예: A10024875", pattern: "[A-Za-z0-9]+", note: "영문과 숫자로 된 단지코드", wide: true },
  ] },
  { id: "buildings", title: "건축물대장 표제부", help: "법정동과 지번을 기준으로 건축물 정보를 수집합니다.", action: "/admin/collect/buildings", fields: [
    { name: "sigungu_cd", label: "시군구 코드", value: "11440", pattern: "[0-9]{5}", inputMode: "numeric" },
    { name: "bjdong_cd", label: "법정동 코드", placeholder: "예: 10100", pattern: "[0-9]{5}", inputMode: "numeric" },
    { name: "plat_gb_cd", label: "대지 구분", required: false, select: [["", "전체"], ["0", "대지"], ["1", "산"], ["2", "블록"], ["3", "기타"]] },
    { name: "bun", label: "본번", placeholder: "예: 123", pattern: "[0-9]{1,4}", inputMode: "numeric", required: false },
    { name: "ji", label: "부번", placeholder: "예: 4", pattern: "[0-9]{1,4}", inputMode: "numeric", required: false },
  ] },
  { id: "stations", title: "지하철역 정보", help: "역명으로 노선별 역 정보를 갱신합니다.", action: "/admin/collect/subway-stations", fields: [
    { name: "station_name", label: "역명", placeholder: "예: 공덕", note: "‘역’을 제외한 이름도 사용할 수 있습니다.", wide: true },
  ] },
];

const isPublicJob = (j: Job) => j.kind === "trades" || j.kind.startsWith("public_data:");

export default function PublicView(_: ViewProps) {
  const jobs = useQuery({ queryKey: ["admin-jobs"], queryFn: () => api<Job[]>("GET", "/admin/jobs"), staleTime: 0 });
  const refresh = () => { void jobs.refetch(); };
  const rows = jobs.data?.filter(isPublicJob);

  return (
    <main id="view-public" className="view view-page public-admin">
      <header className="page-head">
        <div><h1>공공데이터</h1></div>
        <button type="button" className="btn btn--sm" data-act="public-jobs-retry" onClick={refresh}>기록 새로고침</button>
      </header>
      <p className="public-intro">승인된 공공데이터포털 API를 서버 키로 수집합니다. API 키 값은 이 화면에 표시하거나 브라우저로 전송하지 않습니다.</p>
      <div className="collect-grid">
        {PUBLIC_CARDS.map((card) => <CollectCard key={card.id} card={card} />)}
      </div>
      <section className="job-sec">
        <div className="sec-h"><h2>최근 수집 작업</h2><span className="muted">최근 50개 작업 중 공공데이터</span></div>
        {rows && rows.length > 0 && <JobChart rows={rows} />}
        <div id="public-jobs">
          {jobs.isPending && !jobs.isError && <p className="loading">불러오는 중…</p>}
          {jobs.isError && (
            <div className="pub-error" role="alert">
              <p>수집 기록을 불러오지 못했습니다.</p>
              <span>{(jobs.error as Error).message}</span>
              <button type="button" className="btn btn--sm" data-act="public-jobs-retry" onClick={refresh}>다시 시도</button>
            </div>
          )}
          {rows && !jobs.isError && (rows.length ? <JobList rows={rows} /> : <p className="empty-box">아직 공공데이터 수집 기록이 없습니다.</p>)}
        </div>
      </section>
    </main>
  );
}

function JobList({ rows }: { rows: Job[] }) {
  return (
    <ul className="job-list">
      <AnimatePresence initial={false}>
        {rows.map((j) => {
          const [cls, word] = j.status === "done" ? ["pill--ok", "완료"] : j.status === "failed" ? ["pill--warn", "실패"] : ["pill--neutral", "진행 중"];
          return (
            <motion.li key={j.id} {...fadeUp} exit={undefined}>
              <span className="job-kind">{PUBLIC_LABEL[j.kind] || j.kind}</span>
              <span className={`pill ${cls} job-state`}>{word}</span>
              <span className="job-detail">{j.detail || "-"}</span>
              <time className="job-time">{dateTime(j.finished_at || j.created_at) || "-"}</time>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}

/** 자료별 완료·실패 작업 수 (최근 50개 작업 중). 작업 기록은 건수를 글로만 남기므로 행 수 대신 작업 결과를 센다 */
function JobChart({ rows }: { rows: Job[] }) {
  const data = Object.keys(PUBLIC_LABEL).map((kind) => {
    const mine = rows.filter((j) => j.kind === kind);
    return {
      name: SHORT_LABEL[kind],
      done: mine.filter((j) => j.status === "done").length,
      failed: mine.filter((j) => j.status === "failed").length,
    };
  });
  const summary = data.map((d) => `${d.name} 완료 ${d.done}건, 실패 ${d.failed}건`).join(" / ");
  return (
    <figure className="job-chart">
      <figcaption>
        <span>자료별 작업 결과</span>
        <span className="job-chart-key"><i style={{ background: "var(--chart-1)" }} />완료</span>
        <span className="job-chart-key"><i style={{ background: "var(--chart-3)" }} />실패</span>
      </figcaption>
      <div aria-hidden="true">
        <BarChart data={data} xDataKey="name" stacked aspectRatio="4 / 1" barGap={0.45} animationDuration={500}
          margin={{ top: 10, right: 8, bottom: 26, left: 8 }}>
          <Grid horizontal numTicksRows={3} />
          <Bar dataKey="done" fill="var(--chart-1)" lineCap={3} showValue valueLabelFormatter={(n) => `${n}`} />
          <Bar dataKey="failed" fill="var(--chart-3)" lineCap={3} showValue valueLabelFormatter={(n) => `${n}`} valueLabelColor="var(--text)" />
          <BarXAxis showAllLabels />
          <ChartTooltip rows={(p) => [
            { color: "var(--chart-1)", label: "완료", value: `${p.done as number}건` },
            { color: "var(--chart-3)", label: "실패", value: `${p.failed as number}건` },
          ]} />
        </BarChart>
      </div>
      <p className="sr-only">{summary}</p>
    </figure>
  );
}

function CollectCard({ card }: { card: CardDef }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<{ cls: string; text: string }>({ cls: "", text: "" });

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const body: Record<string, string> = {};
    new FormData(e.currentTarget).forEach((v, k) => { if (v !== "") body[k] = String(v); });
    setBusy(true);
    setOut({ cls: "", text: "수집 중입니다. 데이터 양에 따라 시간이 걸릴 수 있습니다…" });
    try {
      const r = await api<CollectResult>("POST", card.action, body);
      const summary = r.job?.detail || `${r.received || 0}건 수신, ${r.inserted || 0}건 신규 저장`;
      setOut({ cls: "is-ok", text: `완료: ${summary}` });
    } catch (err) {
      setOut({ cls: "is-error", text: `실패: ${(err as Error).message}` });
    } finally {
      setBusy(false);
      // 실패한 수집도 작업 기록에 남는다
      void qc.invalidateQueries({ queryKey: ["admin-jobs"] });
    }
  };

  return (
    <section className="card collect-card">
      <h2>{card.title}</h2>
      <p>{card.help}</p>
      <form className="collect-form" data-collect={card.id} data-action={card.action} onSubmit={submit}>
        {card.fields.map((f) => (
          <label key={f.name} className={f.wide ? "wide" : ""}>
            {f.label}
            {f.select ? (
              <select name={f.name}>{f.select.map(([v, w]) => <option key={v} value={v}>{w}</option>)}</select>
            ) : (
              <input name={f.name} defaultValue={f.value || ""} placeholder={f.placeholder || ""} required={f.required !== false}
                pattern={f.pattern} inputMode={f.inputMode} />
            )}
            {f.note && <small>{f.note}</small>}
          </label>
        ))}
        <button type="submit" className="btn btn--main" disabled={busy}>수집</button>
      </form>
      <p className={`collect-result ${out.cls}`} id={`collect-result-${card.id}`} role="status" aria-live="polite">{out.text}</p>
    </section>
  );
}
