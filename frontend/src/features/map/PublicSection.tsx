/* 매물 상세의 공공데이터: 단지(K-apt)·지하철역·건축물대장 연결과 전월세.
   연결은 이름이 비슷한 후보 중 사람이 확정한다 (매물 담당·관리자만). 불러오지 못하면 다시 시도할 수 있다. */
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { SrcRef } from "@/components/Notes";
import { api } from "@/lib/api";
import { fadeIn } from "@/lib/motion";
import type { Evidence } from "@/lib/types";
import { useToast } from "@/state/ui";
import { RentChart } from "./RentChart";
import type { Listing, ListingPublic, PubKind } from "./types";
import { useBusyKey } from "./util";

const PUB_KINDS: [PubKind, string][] = [["complex", "단지"], ["station", "지하철역"], ["building", "건축물대장"]];

const Head = () => (
  <div className="sec-h"><h2>공공데이터</h2><span className="muted">Hood 답변·비교표의 근거</span></div>
);

function Meta({ ev }: { ev: Evidence }) {
  return (
    <span className="pub-meta">
      <SrcRef ev={ev} label="출처" />
      <span>{ev.date} 수집</span>
      {ev.state === "stale" ? <span className="pill pill--warn">오래된 수집본</span>
        : ev.state === "warning" ? <span className="pill pill--warn">표본 적음</span> : null}
    </span>
  );
}

export function PublicSection({ listing, reloadKey }: { listing: Listing; reloadKey: number }) {
  const id = listing.id;
  const toast = useToast();
  const [p, setP] = useState<ListingPublic | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [busyKey, run] = useBusyKey();
  const seq = useRef(0);

  const load = useCallback(async () => {
    const my = ++seq.current;
    try {
      const r = await api<ListingPublic>("GET", `/listings/${id}/public`);
      if (my !== seq.current) return;
      setP(r);
      setError(null);
    } catch (e) {
      if (my !== seq.current) return;
      setP(null);
      setError((e as Error).message);
    } finally {
      if (my === seq.current) setRetrying(false);
    }
  }, [id]);

  useEffect(() => {
    setP(null);
    setError(null);
    void load();
    return () => { seq.current++; };
  }, [load, reloadKey]);

  const retry = () => { setError(null); setRetrying(true); void load(); };

  const link = async (kind: PubKind, entityKey: string) => {
    const r = await run(`link-${kind}`, () => api<{ label: string }>("PUT", `/listings/${id}/links/${kind}`, { entity_key: entityKey }));
    if (r) { toast(`${r.label} 연결했습니다. Hood 답변과 비교표에 쓰입니다.`); void load(); }
  };
  const unlink = async (kind: PubKind) => {
    if (!confirm("이 연결을 해제할까요?")) return;
    const r = await run(`unlink-${kind}`, () => api("DELETE", `/listings/${id}/links/${kind}`));
    if (r) void load();
  };

  let body;
  if (error) {
    body = (
      <div className="pub-error" role="alert">
        <p>공공데이터를 불러오지 못했습니다.</p><span>{error}</span>
        <button type="button" className="btn btn--sm" data-act="pub-retry" data-id={id} onClick={retry}>다시 시도</button>
      </div>
    );
  } else if (!p) {
    body = <p className="loading" style={{ padding: "4px 0" }}>{retrying ? "다시 불러오는 중…" : "불러오는 중…"}</p>;
  } else {
    const rent = p.facts.rent;
    body = (
      <dl className="pub">
        {PUB_KINDS.map(([kind, word]) => (
          <PubRow key={`${kind}-${p.links[kind]?.entity_key ?? ""}`} id={id} kind={kind} word={word} p={p}
            busyKey={busyKey} onLink={link} onUnlink={unlink} />
        ))}
        <dt>전월세</dt>
        <dd>
          {rent ? (
            <>
              <span className="pub-v">{rent.evidence.snippet}</span>
              <Meta ev={rent.evidence} />
              <RentChart listing={listing} />
            </>
          ) : <span className="pub-none">최근 12개월 같은 단지·비슷한 면적 신고가 없거나 아직 수집 전입니다.</span>}
        </dd>
      </dl>
    );
  }

  return (
    <div className="sec" id="pub-sec" data-id={id}>
      <Head />
      <AnimatePresence initial={false} mode="wait">
        <motion.div key={error ? "err" : p ? "ok" : "loading"} {...fadeIn}>{body}</motion.div>
      </AnimatePresence>
    </div>
  );
}

function PubRow({ id, kind, word, p, busyKey, onLink, onUnlink }: {
  id: number; kind: PubKind; word: string; p: ListingPublic; busyKey: string | null;
  onLink: (kind: PubKind, entityKey: string) => void; onUnlink: (kind: PubKind) => void;
}) {
  const toast = useToast();
  const f = p.facts[kind];
  const lk = p.links[kind];
  const cands = p.candidates[kind] || [];
  const [pick, setPick] = useState(cands[0]?.entity_key ?? "");
  const [stations, setStations] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);

  if (f) {
    return (
      <>
        <dt>{word}</dt>
        <dd>
          <span className="pub-v">{f.evidence.snippet}</span>
          <Meta ev={f.evidence} />
          {p.can_edit && (
            <span className="pub-meta">
              {lk?.confirmed_by || ""} 연결 ·{" "}
              <button type="button" className="unlink" data-act="pub-unlink" data-id={id} data-kind={kind}
                disabled={busyKey === `unlink-${kind}`} onClick={() => onUnlink(kind)}>연결 해제</button>
            </span>
          )}
        </dd>
      </>
    );
  }
  if (!cands.length) return <><dt>{word}</dt><dd><span className="pub-none">수집된 {word} 정보가 없습니다.</span></dd></>;
  if (!p.can_edit) return <><dt>{word}</dt><dd><span className="pub-none">아직 연결하지 않았습니다 (매물 담당이 연결).</span></dd></>;

  if (kind === "station") {
    const linkStations = () => {
      if (!stations.size) {
        toast("연결할 지하철 노선을 1개 이상 선택해 주세요.");
        listRef.current?.querySelector<HTMLInputElement>("input")?.focus();
        return;
      }
      // 화면 순서대로 보낸다
      onLink("station", `station_ids:${cands.map((c) => c.entity_key).filter((k) => stations.has(k)).join(",")}`);
    };
    return (
      <>
        <dt>{word}</dt>
        <dd>
          <fieldset className="pub-stations" data-kind="station">
            <legend>연결할 지하철 노선</legend>
            <div className="pub-station-list" ref={listRef}>
              {cands.map((c, i) => (
                <label key={c.entity_key} htmlFor={`station-${id}-${i}`}>
                  <input type="checkbox" id={`station-${id}-${i}`} name="station_ids" value={c.entity_key}
                    checked={stations.has(c.entity_key)}
                    onChange={(e) => {
                      const next = new Set(stations);
                      if (e.target.checked) next.add(c.entity_key); else next.delete(c.entity_key);
                      setStations(next);
                    }} />
                  <span><b>{c.label}</b>{c.detail && <small>{c.detail}</small>}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <span className="pub-link">
            <motion.button type="button" className="btn btn--sm" data-act="pub-link" data-id={id} data-kind="station"
              whileTap={{ scale: 0.97 }} disabled={busyKey === "link-station"} onClick={linkStations}>선택한 노선 연결</motion.button>
          </span>
          <span className="pub-meta">같은 환승역으로 확인한 노선을 모두 선택하세요. 최소 1개가 필요합니다.</span>
        </dd>
      </>
    );
  }
  return (
    <>
      <dt>{word}</dt>
      <dd>
        <span className="pub-link">
          <select aria-label={`연결할 ${word}`} data-kind={kind} value={pick} onChange={(e) => setPick(e.target.value)}>
            {cands.map((c) => <option key={c.entity_key} value={c.entity_key}>{c.label}{c.detail ? ` · ${c.detail}` : ""}</option>)}
          </select>
          <motion.button type="button" className="btn btn--sm" data-act="pub-link" data-id={id} data-kind={kind}
            whileTap={{ scale: 0.97 }} disabled={busyKey === `link-${kind}`} onClick={() => onLink(kind, pick)}>연결</motion.button>
        </span>
        <span className="pub-meta">이름이 비슷한 후보입니다. 맞는 것을 골라 확정하세요.</span>
      </dd>
    </>
  );
}
