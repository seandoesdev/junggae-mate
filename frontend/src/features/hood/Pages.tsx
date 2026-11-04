/* Hood AI 보고서(#/ai/reports[/상태])와 설정(#/ai/settings) */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, type FormEvent, type ReactNode } from "react";
import { api } from "@/lib/api";
import { DUR, EASE_OUT, press, SPRING_SNAPPY } from "@/lib/motion";
import { navigate } from "@/lib/router";
import { useUser } from "@/state/session";
import { useBusy, useToast } from "@/state/ui";
import { STATE_NAME, when } from "./store";

/** 머리글 + 본문. 불러오는 중이면 '불러오는 중…' */
export function AiPageShell({ title, sub, action, children }: { title: string; sub?: ReactNode; action?: ReactNode; children?: ReactNode }) {
  return (
    <div className="ai-page">
      <header className="title-row">
        <div><h1>{title}</h1>{sub && <p className="sub">{sub}</p>}</div>
        {action}
      </header>
      {children ?? <p className="loading">불러오는 중…</p>}
    </div>
  );
}

/** 불러오기 실패는 알림으로 (예전과 같이) */
export function useErrorToast(error: unknown) {
  const toast = useToast();
  useEffect(() => { if (error) toast((error as Error).message); }, [error, toast]);
}

// ── 보고서 ─────────────────────────────────────────
type ReportItem = {
  id: number; title: string; kind: string; question?: string | null; customer_name: string; state: string;
  version: string; created_by?: string | null; created_at: string; share_views: number;
};
type Reports = { counts: { all: number; draft: number; review: number; done: number }; items: ReportItem[] };

const pill = (s: string) => (
  <span className={`pill pill--${s === "review" ? "warn" : s === "draft" ? "neutral" : "ok"}`}>{STATE_NAME[s]}</span>
);

export function ReportsPage({ state }: { state?: string }) {
  const q = useQuery({
    queryKey: ["hood", "reports", state || ""],
    queryFn: () => api<Reports>("GET", `/reports${state ? `?state=${state}` : ""}`),
    staleTime: 0,
  });
  useErrorToast(q.error);
  const r = q.data;
  if (!r) return <AiPageShell title="보고서" />;
  const c = r.counts;
  const tabs: [string, string, number][] = [["", "전체", c.all], ["draft", "작성 중", c.draft], ["review", "검토 중", c.review], ["done", "승인·전달", c.done]];
  const open = (id: number) => navigate(`#/report/${id}`);
  return (
    <AiPageShell
      title="보고서"
      sub={<>Hood AI 답변과 비교표로 만든 고객 자료 {c.all}건{c.review ? ` · 승인을 기다리는 자료 ${c.review}건` : ""}</>}
      action={<a className="btn" href="#/customers">고객 화면에서 새로 만들기</a>}
    >
      <nav className="tabs" aria-label="상태">
        {tabs.map(([k, w, n]) => (
          <a key={k} href={`#/ai/reports${k ? `/${k}` : ""}`} className={(state || "") === k ? "is-active" : undefined}>
            {w} <span className="num">{n}</span>
          </a>
        ))}
      </nav>
      <table className="tbl rtable">
        <thead><tr><th>자료</th><th>고객</th><th>상태</th><th className="r">판</th><th>만든 사람</th><th className="r">만든 날</th><th className="r">링크 열람</th></tr></thead>
        <tbody>
          {r.items.map((x, i) => (
            <motion.tr key={x.id} className="clickable" data-act="hood-report" tabIndex={0}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: DUR.base, ease: EASE_OUT, delay: Math.min(i, 10) * 0.02 }}
              onClick={() => open(x.id)} onKeyDown={(e) => { if (e.key === "Enter") open(x.id); }}>
              <td><b>{x.title}</b><span className="why">{x.kind === "answer" ? x.question || "문의 답변" : "매물 비교표"}</span></td>
              <td>{x.customer_name}</td><td>{pill(x.state)}</td><td className="r num">{x.version}</td>
              <td>{x.created_by || "-"}</td><td className="r num">{x.created_at.slice(0, 10)}</td>
              <td className="r num">{x.state === "shared" ? x.share_views : <span className="muted">-</span>}</td>
            </motion.tr>
          ))}
          {!r.items.length && (
            <tr><td colSpan={7} className="empty">이 상태의 고객 자료가 없습니다. Hood AI 답변 아래의 '고객 자료로 만들기'로 만들 수 있습니다.</td></tr>
          )}
        </tbody>
      </table>
    </AiPageShell>
  );
}

// ── 설정 ─────────────────────────────────────────
type Settings = {
  source_types: string[]; detail_count: number; near_miss: boolean; monthly_limit: number | null;
  updated_at: string | null; updated_by: string | null; month_used: number; can_edit: boolean;
  llm: { enabled: boolean; model: string | null };
};

const TYPES: [string, string, string][] = [
  ["law", "법령", "법제처 법령 조문"], ["policy", "정책", "정부·지자체 공식 안내"],
  ["office", "사무소 자료", "중개사가 추가한 자료·내부 문서"], ["news", "기사", "시장 분위기 보조 자료 (사실 근거로는 쓰지 않음)"],
];

export function SettingsPage() {
  const user = useUser();
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, run] = useBusy();
  const form = useRef<HTMLFormElement>(null);
  const q = useQuery({ queryKey: ["hood", "settings"], queryFn: () => api<Settings>("GET", "/ai/settings"), staleTime: 0 });
  useErrorToast(q.error);
  const s = q.data;
  if (!s) return <AiPageShell title="설정" />;
  const dis = !s.can_edit;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const f = form.current!;
    const body = {
      source_types: [...f.querySelectorAll<HTMLInputElement>("[name=types]:checked")].map((x) => x.value),
      detail_count: Number(f.querySelector<HTMLInputElement>("[name=detail]:checked")!.value),
      near_miss: f.querySelector<HTMLInputElement>("[name=near]")!.checked,
      monthly_limit: (f.elements.namedItem("limit") as HTMLInputElement).value ? Number((f.elements.namedItem("limit") as HTMLInputElement).value) : null,
    };
    if (!body.source_types.length) { toast("답변에 쓸 자료를 하나 이상 골라 주세요."); return; }
    const r = await run(() => api<Settings>("PUT", "/ai/settings", body));
    if (r) {
      toast("설정을 저장했습니다. 다음 질문부터 적용됩니다.");
      qc.setQueryData(["hood", "settings"], { ...s, ...r });
    }
  };

  const stamp = s.updated_at ? `${s.updated_by || ""} · ${when(s.updated_at)} 저장` : "기본값";
  return (
    <AiPageShell title="설정" sub={<>Hood AI가 답할 때 쓰는 자료와 방식입니다. {user.tenant_name} 전체에 적용됩니다.</>}>
      {dis && <p className="notice">관리자만 바꿀 수 있습니다. 지금 값을 보여 드립니다.</p>}
      <form id="ai-settings" className="settings" ref={form} onSubmit={save}>
        <div className="set-row">
          <div className="set-l"><h2>답변에 쓸 자료</h2><p>매물 정보·현장 메모와 실거래가는 늘 씁니다. 끈 자료는 답변과 출처에서 빠집니다.</p></div>
          <div className="set-p">
            {TYPES.map(([k, w, d]) => (
              <label key={k} className="check">
                <input type="checkbox" name="types" value={k} defaultChecked={s.source_types.includes(k)} disabled={dis} />
                <span><b>{w}</b><small>{d}</small></span>
              </label>
            ))}
          </div>
        </div>
        <div className="set-row">
          <div className="set-l"><h2>자세히 설명할 매물 수</h2><p>맞는 매물 중 답변 문장으로 하나씩 설명하는 수입니다. 나머지는 목록과 지도에만 나옵니다.</p></div>
          <div className="set-p">
            <div className="seg" role="radiogroup" aria-label="자세히 설명할 매물 수">
              {[1, 2, 3, 4, 5].map((n) => (
                <label key={n}><input type="radio" name="detail" value={n} defaultChecked={s.detail_count === n} disabled={dis} /><span>{n}건</span></label>
              ))}
            </div>
          </div>
        </div>
        <div className="set-row">
          <div className="set-l"><h2>맞는 매물이 없을 때</h2><p>예: 8억 이하로 찾았는데 없으면 8.8억까지, 59㎡로 찾았는데 없으면 53㎡까지 넓혀 차이와 함께 보여 줍니다.</p></div>
          <div className="set-p">
            <label className="switch">
              <input type="checkbox" name="near" defaultChecked={s.near_miss} disabled={dis} />
              <span className="track" aria-hidden="true" /><span>조건을 조금 넓혀 가까운 매물 보여 주기</span>
            </label>
          </div>
        </div>
        <div className="set-row">
          <div className="set-l"><h2>월 질문 한도</h2><p>사무소 전체가 한 달에 할 수 있는 질문 수입니다. 비워 두면 제한하지 않습니다.</p></div>
          <div className="set-p">
            <label className="inline">한도 <input type="number" name="limit" min={1} max={100000} inputMode="numeric"
              defaultValue={s.monthly_limit ?? ""} placeholder="제한 없음" disabled={dis} /> 건</label>
            <p className="muted" style={{ margin: "8px 0 0" }}>이번 달 {s.month_used}건 사용</p>
          </div>
        </div>
        <div className="set-row">
          <div className="set-l"><h2>답변 작성 방식</h2><p>서버 설정(.env)으로 정합니다.</p></div>
          <div className="set-p">
            <p style={{ margin: 0 }}>
              {s.llm.enabled
                ? `Claude (${s.llm.model})가 찾은 출처 안에서 문장을 다듬고, 출처 없는 문장은 확인할 사항으로 돌립니다.`
                : "규칙 기반 문장틀로 씁니다. ANTHROPIC_API_KEY를 넣으면 Claude가 같은 출처 안에서 문장을 다듬습니다."}
            </p>
          </div>
        </div>
        <div className="set-foot">
          {/* 저장하면 저장 표시가 바뀌며 살짝 떠오른다 */}
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={stamp} className="muted" id="set-stamp"
              initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
              transition={{ duration: DUR.base, ease: EASE_OUT }}>
              {stamp}
            </motion.span>
          </AnimatePresence>
          {s.can_edit && (
            <motion.button type="submit" className="btn btn--main" disabled={busy} whileTap={press} transition={SPRING_SNAPPY}>저장</motion.button>
          )}
        </div>
      </form>
    </AiPageShell>
  );
}
