/* 답변 한 칸(.turn): 질문, 이해한 조건(눌러서 빼기), 맞는 매물(작은 지도 + 목록), 답변 문단과 각주, 지도에서 보기·고객 자료로 만들기.
   compact: Ask Hood 패널 (지도 없음, 매물 5건까지). 답을 기다리는 칸은 .turn.is-pending */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { animate } from "animejs";
import { NoteText, SrcRef } from "@/components/Notes";
import { NOTE_TOKEN, STAGE_COLOR, STAGE_LABEL, shortPrice } from "@/lib/format";
import { reducedMotion } from "@/lib/motion";
import { navigate } from "@/lib/router";
import { useUser } from "@/state/session";
import { useUi } from "@/state/ui";
import { openAskReport } from "./dialogs";
import { showAskOnMap } from "@/features/map/askStore";
import { boundsOf, circleBounds, esc, extendBounds, useMapEngine, type Bounds } from "@/features/map/engine";
import type { AskResult } from "@/features/map/types";
import { hood, when, type Slot, type Turn } from "./store";

/** 답변을 지도 질문 결과로 넘긴다. 지도 화면은 다시 묻지 않고 이 답변을 그대로 쓴다 */
function goMap(t: Turn) {
  const q = t.effective_query || t.question, drop = t.dropped || [];
  showAskOnMap(q, drop, t as unknown as AskResult);
}

/* 답변 안의 작은 지도: 맞는 매물과 질문한 지역 (네이버 지도, 안 되면 OpenStreetMap) */
function TurnMap({ t }: { t: Turn }) {
  const el = useRef<HTMLDivElement>(null);
  const { map } = useMapEngine(el, {
    center: t.place ? { lat: t.place.lat, lng: t.place.lng } : undefined, zoom: 13, controls: false,
  });
  useEffect(() => {
    if (!map) return;
    const undo: (() => void)[] = [];
    let area: Bounds | null = null;
    if (t.place) {
      const c = { lat: t.place.lat, lng: t.place.lng };
      if (t.place.radius_m) {
        undo.push(map.addCircle(c, t.place.radius_m).remove);
        area = circleBounds(c, t.place.radius_m);
      } else area = boundsOf([c]);
      if (!t.listings.length) {
        undo.push(map.addPin(c, `<div class="place-tag">${esc(t.place.name)} · 등록된 매물 없음</div>`, { interactive: false }).remove);
      }
    }
    const ls = t.listings.filter((l) => l.lat && l.lng);
    ls.forEach((l) => {
      undo.push(map.addPin({ lat: l.lat!, lng: l.lng! },
        `<div class="pin" data-s="${esc(l.stage)}" style="--c:${STAGE_COLOR[l.stage]}"><span>${esc(l.label)} ${esc(shortPrice(l))}</span></div>`,
        { title: `${l.label} ${l.title}`, onClick: () => navigate(`#/map/l/${l.id}`) }).remove);
    });
    // 매물이 있으면 매물에 맞추고(질문한 지역 반경 포함), 없으면 질문한 지역에 맞춘다
    const pins = boundsOf(ls.map((l) => ({ lat: l.lat!, lng: l.lng! })));
    const all = pins && area && t.place?.radius_m ? extendBounds(pins, area) : pins ?? area;
    if (all) map.fit(all, { pad: 0.25, maxZoom: ls.length ? 15 : 12 });
    return () => undo.forEach((f) => f());
  }, [map, t]);
  return <div className="turn-map" ref={el} role="img" aria-label="맞는 매물 지도" />;
}

export function TurnView({ t, slot, compact }: { t: Turn; slot: Slot; compact: boolean }) {
  const user = useUser();
  const ui = useUi();
  // 이 답변 안에서 각주 번호를 공유한다. 아래 각주 목록을 같은 렌더에서 그리려고 처음 나온 순서를 미리 모은다
  const byId = new Map(t.sources.map((s) => [s.id, s]));
  const order: string[] = [];
  for (const text of [t.opinion, ...t.to_check]) {
    for (const m of text.matchAll(NOTE_TOKEN)) if (byId.has(m[1]) && !order.includes(m[1])) order.push(m[1]);
  }
  const ask = (drop: string[]) => void hood.ask(slot, t.question, ui.toast, { drop, replace: true });
  const ls = compact ? t.listings.slice(0, 5) : t.listings;
  const dropped = t.dropped || [];
  const place = t.understood.find((c) => c.key === "place" || c.key === "district");

  const opinion = <NoteText text={t.opinion} sources={t.sources} order={order} />;
  const checks = t.to_check.map((x, i) => <li key={i}><NoteText text={x} sources={t.sources} order={order} /></li>);
  const foot = order.map((id) => byId.get(id)).filter((s): s is NonNullable<typeof s> => Boolean(s));

  return (
    <>
      <p className="turn-q">{t.question}</p>
      {t.effective_query && t.effective_query !== t.question && <p className="turn-ctx">이어서 찾은 조건: {t.effective_query}</p>}
      {(t.understood.length > 0 || dropped.length > 0) && (
        <div className="understood">
          {t.understood.map((c) => (
            <button key={c.key} type="button" className="cond" data-act="hood-drop" data-key={c.key} title="이 조건을 빼고 다시 찾기"
              onClick={() => ask([...dropped, c.key])}>
              {c.label}<b aria-hidden="true">×</b>
            </button>
          ))}
          {dropped.length > 0 && <button type="button" className="btn btn--sm" data-act="hood-undrop" onClick={() => ask([])}>뺀 조건 되돌리기</button>}
        </div>
      )}
      {(t.listing_intent || t.listings.length > 0) && (
        <section className="turn-sec">
          <h3>{t.relaxed ? "조건에 가까운 매물" : "맞는 매물"} <span className="muted num">{t.listings.length}</span></h3>
          {!compact && (t.listings.length > 0 || t.place) && <TurnMap t={t} />}
          {ls.length ? (
            <>
              <ul className="turn-list">
                {ls.map((l) => {
                  const why = [...l.matched.map((m) => `${m.want}: ${m.text}`), ...l.unmet.map((u) => `차이: ${u}`)].join(" · ");
                  return (
                    <li key={l.id}>
                      <a href={`#/map/l/${l.id}`} style={{ ["--c" as string]: l.stage === "available" ? "var(--line)" : STAGE_COLOR[l.stage] }}>
                        <span className="tl-name"><b>{l.label}</b> {l.title}</span><span className="tl-price num">{shortPrice(l)}</span>
                        <span className="tl-why">{why || `${l.district} · 전용 ${l.area_m2}㎡ · ${STAGE_LABEL[l.stage]}`}</span>
                      </a>
                    </li>
                  );
                })}
              </ul>
              {compact && t.listings.length > ls.length && <p className="muted turn-more">외 {t.listings.length - ls.length}건은 지도에서 볼 수 있습니다.</p>}
            </>
          ) : (
            <p className="turn-empty">
              {place ? `${place.label} 안에 등록된 매물이 없습니다.` : "맞는 매물이 없습니다."}{" "}
              {t.understood.length > 0 && (
                <button type="button" className="btn btn--sm" data-act="hood-drop-all"
                  onClick={() => ask([...new Set([...dropped, ...t.understood.map((c) => c.key)])])}>
                  조건 빼고 사무소 매물 보기
                </button>
              )}
            </p>
          )}
        </section>
      )}
      <section className="turn-sec">
        <h3>답변</h3>
        <p className="opinion">{opinion}</p>
        {checks.length > 0 && <><h4>추가로 확인할 사항</h4><ul className="tocheck">{checks}</ul></>}
        {foot.length > 0 && (
          <ol className="foot-list">
            {foot.map((s) => <li key={s.id}><SrcRef ev={s} /> <span className="muted">{s.date}</span></li>)}
          </ol>
        )}
      </section>
      <div className="turn-acts">
        <button type="button" className="btn btn--sm" data-act="hood-map" onClick={() => goMap(t)}>지도에서 보기</button>
        <button type="button" className="btn btn--sm" data-act="ask-report"
          onClick={() => void openAskReport(t.effective_query || t.question, dropped, user, ui)}>
          고객 자료로 만들기
        </button>
        <span className="muted turn-time">{when(t.asked_at)}</span>
      </div>
    </>
  );
}

const STEPS = ["질문 이해", "근거 찾기", "답변 정리"];

/** 답을 기다리는 칸: 질문 이해 → 근거 찾기 → 답변 정리 (보여 주기용. 답이 오면 칸째로 사라진다) */
export function PendingBody({ q }: { q: string }) {
  const [step, setStep] = useState(0);
  const bar = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (reducedMotion()) { setStep(1); return; }
    const s = { v: 0 };
    // 앞 두 단계는 빨리, 마지막 단계는 답이 올 때까지 머문다
    const a = animate(s, {
      v: [0, STEPS.length - 0.01],
      duration: 2400,
      ease: "out(2)",
      onUpdate: () => {
        setStep(Math.floor(s.v));
        if (bar.current) bar.current.style.transform = `scaleX(${Math.min(1, (s.v + 0.4) / STEPS.length)})`;
      },
    });
    return () => { a.pause(); };
  }, []);
  return (
    <>
      <p className="turn-q">{q}</p>
      <div className="hood-steps" role="status" aria-label="매물·실거래가·법령·정책·자료를 찾는 중">
        <ol>
          {STEPS.map((w, i) => (
            <li key={w} className={i < step ? "is-done" : i === step ? "is-on" : ""}>
              <i aria-hidden="true" />{w}
            </li>
          ))}
        </ol>
        <span className="hood-steps-track" aria-hidden="true"><span ref={bar} /></span>
      </div>
      <p className="loading hood-steps-note">매물·실거래가·법령·정책·자료를 찾는 중…</p>
    </>
  );
}
