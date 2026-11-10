/* 지도 엔진: 네이버 지도(기본)와 OpenStreetMap(Leaflet, 예비)을 같은 모양으로 감싼다.
   - 네이버 지도 Client ID는 서버 .env의 NAVER_CLIENT_ID (lib/config의 naverClientId)
   - Client ID가 없거나, 스크립트를 못 받거나, 인증이 실패하면(네이버 클라우드에 이 화면 주소를 등록하지 않은 경우 등)
     OpenStreetMap으로 바꿔 그린다 → 지도가 빈 채로 남지 않는다
   - 핀은 HTML이라 예전 .pin 모양(legacy.css)을 그대로 쓴다. 기준점은 핀의 왼쪽 위(0,0)이고 .pin이 스스로 위로 올라간다 */
import { useEffect, useRef, useState, type RefObject } from "react";
import { naverClientId } from "@/lib/config";
import { STAGES, STAGE_COLOR, STAGE_LABEL, eok, stageIdx } from "@/lib/format";
import type { AskPlace, Listing } from "./types";

export type LatLng = { lat: number; lng: number };
export type Bounds = { south: number; west: number; north: number; east: number };
export type Pin = { el(): HTMLElement | null; setPosition(p: LatLng): void; remove(): void };
export type PinOptions = {
  zIndex?: number;
  title?: string;
  interactive?: boolean;
  onClick?: () => void;
  draggable?: boolean;
  onDragEnd?: (p: LatLng) => void;
  /** 핀 HTML 안에서 좌표가 가리키는 점 (px). 기본 [0, 0] */
  anchor?: [number, number];
};
export interface MapEngine {
  kind: "naver" | "osm";
  addPin(p: LatLng, html: string, o?: PinOptions): Pin;
  addCircle(c: LatLng, radiusM: number): { remove(): void };
  /** 범위에 맞춘다. pad: 범위 크기에 대한 여백 비율, maxZoom: 이보다 더 확대하지 않는다 */
  fit(b: Bounds, o: { pad: number; maxZoom: number }): void;
  panTo(p: LatLng): void;
  destroy(): void;
}
type MapOptions = { center: LatLng; zoom: number; controls: boolean; onClick?: (p: LatLng) => void };

export const SEOUL: LatLng = { lat: 37.547, lng: 126.951 };
const PLACE_COLOR = "#1b6c80";

// ── 범위 계산 (지도 상태와 무관하게 좌표로) ──

export function boundsOf(pts: LatLng[]): Bounds | null {
  if (!pts.length) return null;
  return pts.reduce<Bounds>((b, p) => ({
    south: Math.min(b.south, p.lat), west: Math.min(b.west, p.lng), north: Math.max(b.north, p.lat), east: Math.max(b.east, p.lng),
  }), { south: pts[0].lat, west: pts[0].lng, north: pts[0].lat, east: pts[0].lng });
}

export const extendBounds = (a: Bounds, b: Bounds): Bounds => ({
  south: Math.min(a.south, b.south), west: Math.min(a.west, b.west), north: Math.max(a.north, b.north), east: Math.max(a.east, b.east),
});

/** 원(중심, 반경 m)을 감싸는 범위 */
export function circleBounds(c: LatLng, radiusM: number): Bounds {
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.cos((c.lat * Math.PI) / 180));
  return { south: c.lat - dLat, west: c.lng - dLng, north: c.lat + dLat, east: c.lng + dLng };
}

function padBounds(b: Bounds, ratio: number): Bounds {
  const h = (b.north - b.south) * ratio, w = (b.east - b.west) * ratio;
  return { south: b.south - h, west: b.west - w, north: b.north + h, east: b.east + w };
}

// ── 네이버 지도 ──

type NLatLng = { lat(): number; lng(): number };
type NListener = unknown;
interface NMap {
  fitBounds(b: unknown, margin?: number): void;
  getZoom(): number;
  setZoom(z: number, effect?: boolean): void;
  panTo(p: NLatLng): void;
  setSize(s: unknown): void;
  destroy(): void;
}
interface NMarker { setMap(m: NMap | null): void; setPosition(p: NLatLng): void; getElement?(): HTMLElement }
interface NaverMaps {
  Map: new (el: HTMLElement, o: object) => NMap;
  LatLng: new (lat: number, lng: number) => NLatLng;
  LatLngBounds: new (sw: NLatLng, ne: NLatLng) => unknown;
  Point: new (x: number, y: number) => unknown;
  Size: new (w: number, h: number) => unknown;
  Marker: new (o: object) => NMarker;
  Circle: new (o: object) => { setMap(m: NMap | null): void };
  Position: Record<string, unknown>;
  ZoomControlStyle: Record<string, unknown>;
  Event: {
    addListener(target: object, ev: string, fn: (e: { coord?: NLatLng }) => void): NListener;
    removeListener(l: NListener): void;
  };
}
declare global {
  interface Window { naver?: { maps?: NaverMaps }; navermap_authFailure?: () => void }
}

let naverLoad: Promise<NaverMaps | null> | null = null;
let naverAuthFailed = false;
const authFailListeners = new Set<() => void>();

/** 네이버 지도 스크립트를 한 번만 받는다. 못 받으면 null */
function loadNaver(clientId: string): Promise<NaverMaps | null> {
  naverLoad ??= new Promise((resolve) => {
    if (window.naver?.maps) return resolve(window.naver.maps);
    // 인증 실패(등록하지 않은 화면 주소, 잘못된 Client ID)는 지도를 만든 뒤 이 함수로 알려 온다
    window.navermap_authFailure = () => {
      naverAuthFailed = true;
      console.warn("네이버 지도 인증 실패: 네이버 클라우드 Maps 애플리케이션의 Web 서비스 URL에 이 화면 주소를 등록했는지 확인하세요. OpenStreetMap으로 표시합니다.");
      authFailListeners.forEach((f) => f());
    };
    let poll = 0;
    const done = (v: NaverMaps | null) => { clearTimeout(timer); clearInterval(poll); resolve(v); };
    const timer = window.setTimeout(() => done(null), 10_000);
    // callback 파라미터는 naver.maps가 만들어지기 전에 불리므로 쓰지 않는다. 스크립트를 다 읽은 뒤 Map이 생겼는지 본다
    const ready = () => Boolean(window.naver?.maps?.Map);
    const s = document.createElement("script");
    s.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(clientId)}`;
    s.async = true;
    s.onload = () => {
      if (ready()) return done(window.naver!.maps!);
      poll = window.setInterval(() => { if (ready()) done(window.naver!.maps!); }, 50);
    };
    s.onerror = () => done(null);
    document.head.appendChild(s);
  });
  return naverLoad;
}

function createNaver(n: NaverMaps, box: HTMLElement, o: MapOptions): MapEngine {
  const ll = (p: LatLng) => new n.LatLng(p.lat, p.lng);
  const map = new n.Map(box, {
    center: ll(o.center), zoom: o.zoom,
    zoomControl: o.controls,
    zoomControlOptions: { position: n.Position.LEFT_BOTTOM, style: n.ZoomControlStyle.SMALL },
    scrollWheel: o.controls,
    scaleControl: false, mapDataControl: false, mapTypeControl: false,
    logoControlOptions: { position: n.Position.BOTTOM_RIGHT },
  });
  const listeners: NListener[] = [];
  if (o.onClick) {
    const onClick = o.onClick;
    listeners.push(n.Event.addListener(map, "click", (e) => { if (e.coord) onClick({ lat: e.coord.lat(), lng: e.coord.lng() }); }));
  }
  // 칸 크기가 바뀌면(휴대폰 폭, 옆 패널) 지도 크기를 다시 맞춘다
  const ro = new ResizeObserver(() => map.setSize(new n.Size(box.clientWidth, box.clientHeight)));
  ro.observe(box);

  return {
    kind: "naver",
    addPin(p, html, po = {}) {
      const [ax, ay] = po.anchor ?? [0, 0];
      const mk = new n.Marker({
        map, position: ll(p), zIndex: po.zIndex ?? 0, title: po.title ?? "",
        clickable: po.interactive !== false || Boolean(po.draggable), draggable: Boolean(po.draggable),
        icon: { content: `<div class="pin-wrap">${html}</div>`, anchor: new n.Point(ax, ay) },
      });
      const own: NListener[] = [];
      if (po.onClick) own.push(n.Event.addListener(mk, "click", po.onClick));
      if (po.onDragEnd) {
        const end = po.onDragEnd;
        own.push(n.Event.addListener(mk, "dragend", (e) => { if (e.coord) end({ lat: e.coord.lat(), lng: e.coord.lng() }); }));
      }
      return {
        el: () => mk.getElement?.() ?? null,
        setPosition: (q) => mk.setPosition(ll(q)),
        // 인증 실패로 지도를 먼저 없앤 뒤에 불려도 괜찮게
        remove: () => { try { own.forEach((l) => n.Event.removeListener(l)); mk.setMap(null); } catch { /* 이미 없어진 지도 */ } },
      };
    },
    addCircle(c, radiusM) {
      const circle = new n.Circle({
        map, center: ll(c), radius: radiusM, clickable: false,
        strokeColor: PLACE_COLOR, strokeWeight: 1.5, strokeStyle: "shortdash", fillColor: PLACE_COLOR, fillOpacity: 0.06,
      });
      return { remove: () => { try { circle.setMap(null); } catch { /* 이미 없어진 지도 */ } } };
    },
    fit(b, { pad, maxZoom }) {
      const p = padBounds(b, pad);
      map.fitBounds(new n.LatLngBounds(ll({ lat: p.south, lng: p.west }), ll({ lat: p.north, lng: p.east })), 0);
      if (map.getZoom() > maxZoom) map.setZoom(maxZoom, false);
    },
    panTo: (p) => map.panTo(ll(p)),
    destroy() {
      ro.disconnect();
      // 인증이 실패하면 네이버가 naver.maps를 비우므로, 정리 중 오류가 OpenStreetMap 전환을 막지 않게 한다
      try { listeners.forEach((l) => n.Event.removeListener(l)); map.destroy(); } catch { /* 이미 정리된 지도 */ }
    },
  };
}

// ── OpenStreetMap (Leaflet): 네이버 지도를 쓸 수 없을 때만 받는다 ──

async function createOsm(box: HTMLElement, o: MapOptions): Promise<MapEngine> {
  const [mod] = await Promise.all([import("leaflet"), import("leaflet/dist/leaflet.css")]);
  const L = (mod as unknown as { default?: typeof mod }).default ?? mod;
  const map = L.map(box, { zoomControl: false, scrollWheelZoom: o.controls, attributionControl: o.controls })
    .setView([o.center.lat, o.center.lng], o.zoom);
  if (o.controls) L.control.zoom({ position: "bottomleft" }).addTo(map);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  if (o.onClick) { const onClick = o.onClick; map.on("click", (e) => onClick({ lat: e.latlng.lat, lng: e.latlng.lng })); }
  // 칸 크기가 정해진 뒤 다시 잰다 (휴대폰 폭에서 지도 칸 높이가 늦게 정해진다)
  const t = window.setTimeout(() => map.invalidateSize(), 0);

  return {
    kind: "osm",
    addPin(p, html, po = {}) {
      const [ax, ay] = po.anchor ?? [0, 0];
      const mk = L.marker([p.lat, p.lng], {
        icon: L.divIcon({ className: "pin-wrap", html, iconSize: [0, 0], iconAnchor: [ax, ay] }),
        zIndexOffset: po.zIndex ?? 0, title: po.title ?? "",
        interactive: po.interactive !== false || Boolean(po.draggable), keyboard: po.interactive !== false,
        draggable: Boolean(po.draggable),
      }).addTo(map);
      if (po.onClick) mk.on("click", po.onClick);
      if (po.onDragEnd) { const end = po.onDragEnd; mk.on("dragend", () => { const q = mk.getLatLng(); end({ lat: q.lat, lng: q.lng }); }); }
      return {
        el: () => mk.getElement() ?? null,
        setPosition: (q) => { mk.setLatLng([q.lat, q.lng]); },
        remove: () => { mk.remove(); },
      };
    },
    addCircle(c, radiusM) {
      const circle = L.circle([c.lat, c.lng], {
        radius: radiusM, color: PLACE_COLOR, weight: 1.5, dashArray: "4 4", fillColor: PLACE_COLOR, fillOpacity: 0.06, interactive: false,
      }).addTo(map);
      return { remove: () => { circle.remove(); } };
    },
    fit(b, { pad, maxZoom }) {
      const p = padBounds(b, pad);
      map.fitBounds([[p.south, p.west], [p.north, p.east]], { animate: false, maxZoom });
    },
    panTo: (p) => { map.panTo([p.lat, p.lng]); },
    destroy() { clearTimeout(t); map.remove(); },
  };
}

// ── 화면에서 쓰는 훅 ──

/**
 * el 칸 안에 지도를 만든다. 네이버 지도를 먼저 시도하고, 안 되면 OpenStreetMap.
 * options는 처음 만들 때만 읽는다. onClick은 항상 최신 함수를 부른다.
 */
export function useMapEngine(
  el: RefObject<HTMLDivElement | null>,
  options: { center?: LatLng; zoom?: number; controls?: boolean; onClick?: (p: LatLng) => void } = {},
) {
  const [map, setMap] = useState<MapEngine | null>(null);
  const [failed, setFailed] = useState(false);
  const opts = useRef(options);
  opts.current = options;

  useEffect(() => {
    const host = el.current;
    if (!host) return;
    let alive = true;
    let engine: MapEngine | null = null;
    let box: HTMLDivElement | null = null;
    const o = opts.current;
    const mapOptions: MapOptions = {
      center: o.center ?? SEOUL, zoom: o.zoom ?? 15, controls: o.controls ?? true,
      onClick: o.onClick ? (p) => opts.current.onClick?.(p) : undefined,
    };

    // 엔진마다 새 칸을 쓴다 (네이버 지도가 칸에 남긴 스타일이 Leaflet에 섞이지 않도록)
    const freshBox = () => {
      engine?.destroy();
      engine = null;
      box?.remove();
      box = document.createElement("div");
      box.style.cssText = "width:100%;height:100%";
      host.appendChild(box);
      return box;
    };

    const build = async (osmOnly: boolean) => {
      try {
        const id = osmOnly || naverAuthFailed ? "" : await naverClientId();
        const naver = id ? await loadNaver(id) : null;
        if (!alive) return;
        let next: MapEngine;
        if (naver && !naverAuthFailed) next = createNaver(naver, freshBox(), mapOptions);
        else {
          const target = freshBox();
          next = await createOsm(target, mapOptions);
          if (!alive) { next.destroy(); return; }
        }
        engine = next;
        setMap(next);
        setFailed(false);
      } catch {
        if (alive) setFailed(true);
      }
    };

    const onAuthFail = () => { if (alive && engine?.kind === "naver") { setMap(null); void build(true); } };
    authFailListeners.add(onAuthFail);
    void build(false);
    return () => {
      alive = false;
      authFailListeners.delete(onAuthFail);
      engine?.destroy();
      box?.remove();
      setMap(null);
    };
  }, [el]);

  return { map, failed };
}

// ── 핀 HTML ──

export const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** 매물 핀 HTML. .pin-drop은 처음 나타날 때 움직임을 받는 감싸개 (.pin 자체의 위치 transform을 건드리지 않도록) */
export function pinHtml(l: Listing, matchIds: Set<number> | null, selected: boolean, hiddenAtFirst: boolean) {
  const n = stageIdx(l.stage) + 1;
  const cls = ["pin", !l.mine && "is-other", matchIds && (matchIds.has(l.id) ? "is-match" : "is-dim"), selected && "is-sel"]
    .filter(Boolean).join(" ");
  return `<div class="pin-drop"${hiddenAtFirst ? ' style="opacity:0"' : ""}><div class="${cls}" data-s="${esc(l.stage)}" data-id="${l.id}" style="--c:${STAGE_COLOR[l.stage]}" role="button" tabindex="0"
      aria-label="${esc(l.label)} ${esc(l.title)} ${eok(l.price)} ${esc(STAGE_LABEL[l.stage])}">
    ${l.mine ? "" : `<span class="pa" title="담당 ${esc(l.agent_name)}">${esc((l.agent_name || "?")[0])}</span>`}
    <span>${esc(l.label)} ${eok(l.price)}</span><span class="pp">${STAGES.map((_, i) => `<i class="${i < n ? "on" : ""}"></i>`).join("")}</span>
    ${l.active_deals ? `<span class="pc">${l.active_deals}</span>` : ""}</div></div>`;
}

/** 질문한 지역: 반경 원과 이름표. 지역에 맞는 매물이 없어도 지도가 그 지역으로 간다. 맞출 범위를 돌려준다 */
export function drawPlace(map: MapEngine, p: AskPlace, label: string) {
  const c = { lat: p.lat, lng: p.lng };
  const circle = p.radius_m ? map.addCircle(c, p.radius_m) : null;
  const tag = map.addPin(c, `<div class="place-tag">${esc(label)}</div>`, { interactive: false });
  return {
    bounds: p.radius_m ? circleBounds(c, p.radius_m) : boundsOf([c])!,
    remove: () => { circle?.remove(); tag.remove(); },
  };
}

/** 지도 화면의 질문 지역 이름표 */
export const placeLabel = (p: AskPlace, found: number) =>
  `${p.name}${p.radius_m ? ` 반경 ${p.radius_m / 1000}km` : ""} · ${found ? `맞는 매물 ${found}건` : "등록된 매물 없음"}`;
