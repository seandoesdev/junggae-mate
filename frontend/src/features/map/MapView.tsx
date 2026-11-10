/* 지도 (#/map, #/map/l/매물, #/map/match/고객, #/map/ask/질문):
   단계별 색 핀, 매물 목록·상세, 거래 단계 변경, 확인할 사항, 현장 메모, 공공데이터, 매물 등록·수정·종료, 질문 결과 강조.
   예전 app-map.js + app-ask.js를 옮겼다. 지도는 네이버 지도(안 되면 OpenStreetMap, engine.ts)이고
   핀은 HTML이라 예전 .pin 모양을 그대로 쓴다. */
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ViewProps } from "@/App";
import { StageTag } from "@/components/Stage";
import { api } from "@/lib/api";
import { staggerIn } from "@/lib/anime";
import { STAGES, STAGE_COLOR, eok, stageIdx } from "@/lib/format";
import { DUR, EASE_OUT, press } from "@/lib/motion";
import { navigate } from "@/lib/router";
import { useUser } from "@/state/session";
import { useToast } from "@/state/ui";
import { AskResult } from "./AskResult";
import { askHash, askKey, getMapAsk, mapMemory, searchOnce, setMapAsk } from "./askStore";
import { boundsOf, drawPlace, extendBounds, pinHtml, placeLabel, useMapEngine, type Pin } from "./engine";
import { ListingDetail } from "./ListingDetail";
import { ListingForm, type LatLngText } from "./ListingForm";
import type { AskResult as AskResultData, AskState, Listing } from "./types";
import { safeDecode } from "./util";
import "./map.css";

type MatchCustomer = { id: number; name: string; budget_max: number | null; area_min: number | null; station_walk_max: number | null };
type Match = { customer: MatchCustomer; ids: Set<number> };
type Scope = "mine" | "all";

const barMotion = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 4 },
  transition: { duration: DUR.base, ease: EASE_OUT },
} as const;

export default function MapView({ a, b }: ViewProps) {
  const user = useUser();
  const toast = useToast();

  // 보기 범위: 처음(또는 다른 사람으로 로그인했을 때) 관리자는 사무소 전체, 중개사는 내 매물
  if (mapMemory.scopeUser !== user.id) {
    mapMemory.scope = user.role === "admin" ? "all" : "mine";
    mapMemory.scopeUser = user.id;
  }
  const [scope, setScopeState] = useState<Scope>(mapMemory.scope);
  const [hidden, setHiddenState] = useState<Set<string>>(() => new Set(mapMemory.hidden));
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [match, setMatch] = useState<Match | null>(null);
  const [ask, setAskState] = useState<AskState | null>(getMapAsk);
  const [searching, setSearching] = useState(false);
  const [form, setForm] = useState<{ listing: Listing | null } | null>(null);
  const [pos, setPos] = useState<LatLngText>({ lat: "", lng: "" });
  const [tick, setTick] = useState(0);   // 예전 route(): 목록·핀·상세를 다시 불러온다

  const detailId = a === "l" && b ? Number(b) : null;
  const askWant = a === "ask" && b ? safeDecode(b) : null;

  const setScope = (s: Scope) => { mapMemory.scope = s; setScopeState(s); };
  const setAsk = (x: AskState | null) => { setMapAsk(x); setAskState(x); };

  // ── 지도 ──
  const mapEl = useRef<HTMLDivElement>(null);
  const pickRef = useRef(false);
  pickRef.current = form !== null;
  const placeTempRef = useRef<(lat: number, lng: number) => void>(() => {});
  const { map, failed } = useMapEngine(mapEl, { onClick: (p) => { if (pickRef.current) placeTempRef.current(p.lat, p.lng); } });
  const mapRef = useRef(map);
  mapRef.current = map;

  // ── 불러오기 ──
  const commitSeq = useRef(0);
  const fetchListings = useCallback(async (mine: boolean) => {
    try { return (await api<{ items: Listing[] }>("GET", `/listings${mine ? "?mine=true" : ""}`)).items; }
    catch (e) { toast((e as Error).message); return []; }
  }, [toast]);

  /* 같은 질문으로 돌아올 때(매물 상세 → 질문 결과)는 뺀 조건과 결과를 그대로 쓴다.
     실패하면 같은 질문의 이전 결과를 그대로 두고 null을 돌려준다. 늦게 도착한 이전 요청의 응답은 버린다. */
  const askSeq = useRef(0);
  const loadAsk = useCallback(async (q: string, drop?: string[]) => {
    const cur = getMapAsk();
    const d = drop ?? (cur && cur.q === q ? cur.drop : []);
    const key = askKey(q, d);
    if (cur && cur.key === key) return cur;
    const prev = cur && cur.q === q ? cur : null;
    const my = ++askSeq.current;
    setSearching(true);
    try {
      const result = await searchOnce(key, () =>
        api<AskResultData>("POST", "/search", { q, drop: d, session_id: prev?.result.session_id ?? undefined }));
      if (my !== askSeq.current) return null;
      const next = { q, drop: d, key, result };
      setMapAsk(next);
      return next;
    } catch (e) {
      if (my === askSeq.current) { toast((e as Error).message, 4200); setMapAsk(prev); }
      return null;
    } finally {
      if (my === askSeq.current) setSearching(false);
    }
  }, [toast]);

  // 주소가 바뀔 때 (예전 VIEWS.map): 질문·고객 조건을 정하고 매물을 받은 뒤 한 번에 그린다
  useEffect(() => {
    let alive = true;
    setForm(null);   // 매물 등록 중이었다면 그만둔다
    const my = ++commitSeq.current;
    void (async () => {
      let cur = getMapAsk();
      if (a === "ask" && b) {
        const want = safeDecode(b);
        await loadAsk(want);
        if (!alive) return;
        cur = getMapAsk();
        if (!cur || cur.q !== want) { navigate("#/map"); return; }   // 찾기 실패 (알림은 이미 보임)
      } else if (a !== "l") {
        cur = null;           // 질문 결과에서 매물을 열었을 때만 결과를 유지한다
        setMapAsk(null);
      }
      let s: Scope = cur ? "all" : mapMemory.scope;
      let m: Match | null = null;
      if (a === "match" && b) {
        try {
          const [c, mm] = await Promise.all([
            api<{ customer: MatchCustomer }>("GET", `/customers/${b}`),
            api<{ items: { id: number }[] }>("GET", `/customers/${b}/matches`),
          ]);
          m = { customer: c.customer, ids: new Set(mm.items.map((l) => l.id)) };
          s = "all";
        } catch (e) { toast((e as Error).message); }
        if (!alive) return;
      }
      const items = await fetchListings(s === "mine" && !m && !cur);
      if (!alive || my !== commitSeq.current) return;
      setAskState(cur);
      setMatch(m);
      setScope(s);
      setListings(items);
    })();
    return () => { alive = false; };
  }, [a, b, tick, loadAsk, fetchListings, toast]);

  const changeScope = async (s: Scope) => {
    const my = ++commitSeq.current;
    const items = await fetchListings(s === "mine" && !match && !ask);
    if (my !== commitSeq.current) return;
    setScope(s);
    setListings(items);
  };

  const toggleStage = (s: string) => {
    const next = new Set(hidden);
    if (next.has(s)) next.delete(s); else next.add(s);
    mapMemory.hidden = next;
    setHiddenState(next);
  };

  const rerunAsk = async (drop: string[]) => {
    if (!ask) return;
    await loadAsk(ask.q, drop);
    setAskState(getMapAsk());
  };

  // ── 핀 ──
  const visible = useMemo(() => (listings || []).filter((l) => !hidden.has(l.stage)), [listings, hidden]);
  const matchIds = useMemo(() => {
    if (match) return match.ids;
    // 맞는 매물이 하나도 없으면 강조하지 않는다 (모든 핀이 흐려져 지도가 빈 것처럼 보이지 않도록)
    const ids = ask ? ask.result.listings.map((l) => l.id) : [];
    return ids.length ? new Set(ids) : null;
  }, [match, ask]);

  const pinsShown = useRef(false);
  const fittedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!map || !listings) return;
    const first = !pinsShown.current;
    const ls = visible.filter((l) => l.lat && l.lng);
    const markers = ls.map((l) => map.addPin({ lat: l.lat!, lng: l.lng! }, pinHtml(l, matchIds, detailId === l.id, first), {
      zIndex: detailId === l.id ? 1000 : stageIdx(l.stage) * 10,
      title: `${l.label} ${l.title}`,
      onClick: () => { if (!pickRef.current) navigate(`#/map/l/${l.id}`); },
    }));
    const place = ask?.result.place;
    const placed = place ? drawPlace(map, place, placeLabel(place, ask!.result.listings.length)) : null;

    const key = `${scope}|${match ? match.customer.id : ""}|${ask ? ask.key : ""}`;
    const many = Boolean(matchIds && matchIds.size);
    const focus = many ? ls.filter((l) => matchIds!.has(l.id)) : ls;   // 강조된 매물이 있으면 그 매물에 맞춘다
    if (fittedFor.current !== key && (focus.length || placed)) {
      fittedFor.current = key;
      // 질문한 지역이 있으면 그 지역(과 맞는 매물)에, 없으면 매물에 맞춘다
      const pins = boundsOf(focus.map((l) => ({ lat: l.lat!, lng: l.lng! })));
      let bounds = placed && !many ? placed.bounds : pins;
      if (placed && many && bounds) bounds = extendBounds(bounds, placed.bounds);
      // 애니메이션 없이 맞춘다 — 지도가 움직이는 동안 핀 클릭이 빗나가지 않도록
      if (bounds) map.fit(bounds, { pad: 0.2, maxZoom: placed && !focus.length ? 13 : 16 });
    }

    // 처음 불러온 핀만 차례로 떨어지듯 나타난다 (이후 필터·선택으로 다시 그릴 때는 바로)
    let raf = 0;
    let undo = () => {};
    if (first && markers.length) {
      raf = requestAnimationFrame(() => {
        pinsShown.current = true;
        const els = markers.map((mk) => mk.el()?.querySelector(".pin-drop")).filter((x): x is Element => Boolean(x));
        undo = staggerIn(els, { gap: 28, y: -8, duration: 240 });
      });
    }
    return () => {
      cancelAnimationFrame(raf);
      undo();
      markers.forEach((mk) => mk.remove());
      placed?.remove();
    };
  }, [map, listings, visible, matchIds, detailId, ask, scope, match]);

  // ── 매물 등록·수정: 지도를 눌러 위치를 정한다 ──
  const tempMarker = useRef<Pin | null>(null);
  const placeTemp = useCallback((lat: number, lng: number) => {
    setPos({ lat: lat.toFixed(6), lng: lng.toFixed(6) });
    const m = mapRef.current;
    if (!m) return;
    if (tempMarker.current) tempMarker.current.setPosition({ lat, lng });
    else {
      // .temp-pin은 18px + 테두리 3px → 가운데(12, 12)가 좌표
      tempMarker.current = m.addPin({ lat, lng }, '<div class="temp-pin"></div>', {
        draggable: true, anchor: [12, 12], zIndex: 2000,
        onDragEnd: (p) => placeTempRef.current(p.lat, p.lng),
      });
    }
  }, []);
  placeTempRef.current = placeTemp;
  useEffect(() => {
    if (form) return;
    tempMarker.current?.remove();
    tempMarker.current = null;
  }, [form]);

  const openForm = (l: Listing | null) => {
    setForm({ listing: l });
    setPos({ lat: "", lng: "" });
    if (l && l.lat && l.lng) placeTemp(l.lat, l.lng);
  };

  // ── 왼쪽 ──
  const back = () => navigate(ask ? askHash(ask.q) : match ? `#/map/match/${match.customer.id}` : "#/map");
  const clearAsk = () => { setAsk(null); navigate("#/map"); };
  const openListing = (id: number) => navigate(`#/map/l/${id}`);

  let sideKey: string;
  let sideEl: ReactNode;
  if (form) {
    sideKey = "form";
    sideEl = (
      <ListingForm listing={form.listing} pos={pos} onPos={setPos}
        onCancel={() => setForm(null)}
        onSaved={(l) => {
          setForm(null);
          if (location.hash === `#/map/l/${l.id}`) setTick((t) => t + 1);
          else navigate(`#/map/l/${l.id}`);
        }} />
    );
  } else if (detailId) {
    sideKey = `detail-${detailId}`;
    sideEl = (
      <ListingDetail key={detailId} id={detailId} reloadKey={tick}
        backLabel={ask ? "질문 결과" : "목록"} onBack={back} onEdit={openForm}
        onLoaded={(l) => { if (mapRef.current && l.lat && l.lng) mapRef.current.panTo({ lat: l.lat, lng: l.lng }); }}
        onRouteReload={() => setTick((t) => t + 1)}
        onNotesChanged={() => {
          // 메모가 바뀌면 같은 질문으로 돌아갈 때 새로 찾는다
          // (기억만 바꾼다: 지금 지도를 다시 맞추지 않도록)
          const cur = getMapAsk();
          if (cur) setMapAsk({ ...cur, key: `${cur.key}*` });
        }} />
    );
  } else if (askWant !== null) {
    if (ask && ask.q === askWant && !searching) {
      sideKey = "ask";
      sideEl = (
        <AskResult ask={ask} listings={listings || []}
          onDrop={(key) => rerunAsk([...ask.drop, key])}
          onReset={() => rerunAsk([])}
          onDropAll={() => rerunAsk([...new Set([...ask.drop, ...ask.result.understood.map((c) => c.key)])])}
          onClear={clearAsk} onOpen={openListing} />
      );
    } else {
      sideKey = "searching";
      sideEl = <p className="loading">찾는 중…</p>;
    }
  } else if (!listings) {
    sideKey = "loading";
    sideEl = <><div className="side-h"><h1>매물</h1></div><p className="loading">불러오는 중…</p></>;
  } else {
    sideKey = "list";
    sideEl = (
      <ListingList listings={visible} title={match ? `${match.customer.name} 고객 조건` : scope === "mine" ? "내 매물" : "사무소 매물"}
        onRegister={() => openForm(null)} onOpen={openListing} />
    );
  }
  // 목록 → 상세는 오른쪽에서, 상세 → 목록은 왼쪽에서 짧게 들어온다
  const enterX = sideKey.startsWith("detail") || sideKey === "form" ? 10 : -10;

  // ── 지도 위 막대 ──
  const counts: Record<string, number> = {};
  (listings || []).forEach((l) => { counts[l.stage] = (counts[l.stage] || 0) + 1; });
  let barKey: string | null = null;
  let barEl: ReactNode = null;
  if (match) {
    const c = match.customer;
    barKey = `match-${c.id}`;
    barEl = (
      <>
        <span><b>{c.name}</b> 조건 ({eok(c.budget_max)} 이하, {c.area_min ?? "-"}㎡ 이상, 역 {c.station_walk_max ?? "-"}분): 맞는 매물 {match.ids.size}건 표시</span>
        <button type="button" className="btn btn--sm" data-act="clear-match" onClick={() => navigate("#/map")}>해제</button>
      </>
    );
  } else if (ask) {
    const n = ask.result.listings.length;
    barKey = "ask";
    barEl = (
      <>
        <span>질문 결과: {n ? <>{ask.result.relaxed ? "조건에 가까운" : "맞는"} 매물 <b className="num">{n}</b>건 강조</> : "맞는 매물 없음"}</span>
        <button type="button" className="btn btn--sm" data-act="clear-ask" onClick={clearAsk}>해제</button>
      </>
    );
  }

  return (
    <main id="view-map" className="view view-map">
      <aside className="side" id="map-side" aria-label="매물 목록과 상세">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={sideKey}
            initial={{ opacity: 0, x: enterX }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
            transition={{ duration: DUR.fast, ease: EASE_OUT }}>
            {sideEl}
          </motion.div>
        </AnimatePresence>
      </aside>
      <section className="map-wrap" aria-label="매물 지도">
        <div className="map-bar">
          <div className="toggle" role="group" aria-label="보기 범위">
            <button type="button" data-scope="mine" aria-pressed={scope === "mine"} onClick={() => changeScope("mine")}>내 매물</button>
            <button type="button" data-scope="all" aria-pressed={scope === "all"} onClick={() => changeScope("all")}>사무소 전체</button>
          </div>
          <div className="stage-filter" id="stage-filter" role="group" aria-label="거래 단계 필터">
            {listings && ["available", ...STAGES].map((s) => (
              <motion.button key={s} type="button" data-act="filter" data-s={s} aria-pressed={!hidden.has(s)}
                whileTap={press} onClick={() => toggleStage(s)}>
                <StageTag s={s} /> <b className="num">{counts[s] || 0}</b>
              </motion.button>
            ))}
          </div>
        </div>
        <AnimatePresence>
          {barKey && <motion.div key={barKey} className="match-bar" id="match-bar" {...barMotion}>{barEl}</motion.div>}
        </AnimatePresence>
        <AnimatePresence>
          {form && (
            <motion.div key="pick" className="pick-bar" id="pick-bar" style={{ x: "-50%" }}
              initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
              transition={{ duration: DUR.base, ease: EASE_OUT }}>
              지도를 눌러 매물 위치를 정하세요. 표시를 끌어서 옮길 수 있습니다.
            </motion.div>
          )}
        </AnimatePresence>
        <div id="map" className="map" ref={mapEl} />
        <p className="map-fail" id="map-fail" hidden={!failed}>지도를 불러오지 못했습니다. 왼쪽 목록을 이용하세요.</p>
        {map && <div className="legend">색: 거래 단계 · 칸: 진행 정도<br />숫자: 연결된 고객 · 흐림: 동료 매물</div>}
      </section>
    </main>
  );
}

function ListingList({ listings, title, onRegister, onOpen }: {
  listings: Listing[]; title: string; onRegister: () => void; onOpen: (id: number) => void;
}) {
  const ls = listings.slice().sort((x, y) => stageIdx(y.stage) - stageIdx(x.stage) || x.price - y.price);
  return (
    <>
      <div className="side-h">
        <h1>{title} <span className="muted num">{ls.length}</span></h1>
        <button type="button" className="btn btn--sm" data-act="register" onClick={onRegister}>매물 등록</button>
      </div>
      <table className="tbl">
        <thead><tr><th></th><th>매물</th><th className="r">가격</th><th>단계</th><th>고객</th></tr></thead>
        <tbody>
          {ls.length ? ls.map((l) => (
            <tr key={l.id} className={`lrow clickable ${l.mine ? "" : "is-other"}`}
              style={{ ["--c" as string]: l.stage === "available" ? "var(--line)" : STAGE_COLOR[l.stage] }}
              data-act="open" data-id={l.id} tabIndex={0}
              onClick={() => onOpen(l.id)} onKeyDown={(e) => { if (e.key === "Enter") onOpen(l.id); }}>
              <td></td>
              <td><b>{l.label}</b> {l.title}{!l.mine && <><br /><span className="muted">담당 {l.agent_name}</span></>}</td>
              <td className="r num">{eok(l.price)}</td>
              <td><StageTag s={l.stage} /></td>
              <td className="num">{l.active_deals || "-"}</td>
            </tr>
          )) : <tr><td colSpan={5} className="empty">표시할 매물이 없습니다.</td></tr>}
        </tbody>
      </table>
    </>
  );
}
