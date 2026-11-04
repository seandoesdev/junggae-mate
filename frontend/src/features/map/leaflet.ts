/* Leaflet 지도: OSM 타일, 왼쪽 아래 확대 버튼. 핀은 divIcon(HTML)이라 예전 .pin 모양을 그대로 쓴다 */
import * as L from "leaflet";
import { useEffect, useRef, useState, type RefObject } from "react";
import { STAGES, STAGE_COLOR, STAGE_LABEL, eok, stageIdx } from "@/lib/format";
import type { AskPlace, Listing } from "./types";

export { L };

export function useLeafletMap(el: RefObject<HTMLDivElement | null>, onClick: (lat: number, lng: number) => void) {
  const [map, setMap] = useState<L.Map | null>(null);
  const [failed, setFailed] = useState(false);
  const click = useRef(onClick);
  click.current = onClick;

  useEffect(() => {
    if (!el.current) return;
    let m: L.Map;
    try {
      m = L.map(el.current, { zoomControl: false }).setView([37.547, 126.951], 15);
      L.control.zoom({ position: "bottomleft" }).addTo(m);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(m);
      m.on("click", (e: L.LeafletMouseEvent) => click.current(e.latlng.lat, e.latlng.lng));
    } catch {
      setFailed(true);
      return;
    }
    setMap(m);
    // 칸 크기가 정해진 뒤 다시 잰다 (휴대폰 폭에서 지도 칸 높이가 늦게 정해진다)
    const t = window.setTimeout(() => m.invalidateSize(), 0);
    return () => { clearTimeout(t); m.remove(); setMap(null); };
  }, [el]);

  return { map, failed };
}

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** 핀 HTML. .pin-drop은 처음 나타날 때 움직임을 받는 감싸개 (.pin 자체의 위치 transform을 건드리지 않도록) */
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
export function drawPlace(map: L.Map, p: AskPlace, found: number) {
  const layer = L.layerGroup().addTo(map);
  const label = `${p.name}${p.radius_m ? ` 반경 ${p.radius_m / 1000}km` : ""} · ${found ? `맞는 매물 ${found}건` : "등록된 매물 없음"}`;
  let bounds = L.latLngBounds([[p.lat, p.lng], [p.lat, p.lng]]);
  if (p.radius_m) {
    L.circle([p.lat, p.lng], {
      radius: p.radius_m, color: "#1b6c80", weight: 1.5, dashArray: "4 4", fillColor: "#1b6c80", fillOpacity: 0.06, interactive: false,
    }).addTo(layer);
    bounds = L.latLng(p.lat, p.lng).toBounds(p.radius_m * 2);   // 지도 상태와 무관하게 좌표로 계산
  }
  L.marker([p.lat, p.lng], {
    interactive: false, keyboard: false,
    icon: L.divIcon({ className: "pin-wrap", html: `<div class="place-tag">${esc(label)}</div>`, iconSize: [0, 0] }),
  }).addTo(layer);
  return { layer, bounds };
}
