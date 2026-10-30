"use strict";
/* 중개메이트 시안 v0.3 — 예시 데이터로 동작한다. 새로고침하면 초기화된다. */

// ── 기본 데이터 ─────────────────────────────────────────
const ME = 1;
const AGENTS = { 1: "김선용", 2: "박지은", 3: "이도현" };
const STAGES = ["intro", "visit", "nego", "contract", "done"];
const STAGE_LABEL = { available: "거래 가능", intro: "소개", visit: "방문", nego: "협의", contract: "계약", done: "완료", dropped: "무산" };
const STAGE_COLOR = {
  available: "var(--st-available)", intro: "var(--st-intro)", visit: "var(--st-visit)", nego: "var(--st-nego)",
  contract: "var(--st-contract)", done: "var(--st-done)", dropped: "var(--st-dropped)",
};
const NEXT_TODO = { visit: "방문 일정 잡기", nego: "가격·조건 협의", contract: "계약서 작성·계약금 일정", done: "잔금·인도 확인" };

const listings = [
  { id: 1, label: "A", title: "마포한강뷰 59", price: 78000, area: 59.9, floor: "7/15층", station: "공덕역", walk: 7, park: 9, agent: 1, lat: 37.5428, lng: 126.9497, trade: { median: 76700, count: 4 }, school: "마포초" },
  { id: 2, label: "B", title: "마포공원앞 62", price: 75000, area: 62.3, floor: "5/12층", station: "공덕역", walk: 9, park: 3, agent: 1, lat: 37.5462, lng: 126.9568, trade: { median: 75500, count: 3 }, school: "공덕초", history: "7.7억→7.5억 (10/22)" },
  { id: 3, label: "C", title: "공덕역세권 59", price: 80000, area: 59.8, floor: "12/20층", station: "공덕역", walk: 4, park: 15, agent: 1, lat: 37.5446, lng: 126.9520, trade: { median: 79750, count: 2 } },
  { id: 4, label: "D", title: "마포래미안 84", price: 115000, area: 84.9, floor: "15/25층", station: "애오개역", walk: 6, park: 8, agent: 2, lat: 37.5530, lng: 126.9560 },
  { id: 5, label: "E", title: "아현숲 49", price: 72000, area: 49.5, floor: "3/10층", station: "아현역", walk: 5, park: 4, agent: 1, lat: 37.5575, lng: 126.9560 },
  { id: 6, label: "F", title: "도화현대 59", price: 76000, area: 59.5, floor: "9/18층", station: "마포역", walk: 14, park: 6, agent: 2, lat: 37.5395, lng: 126.9465, history: "7.8억→7.6억 (10/10)" },
  { id: 7, label: "G", title: "신공덕숲길 60", price: 79000, area: 60.1, floor: "17/22층", station: "공덕역", walk: 10, park: 6, agent: 1, lat: 37.5480, lng: 126.9530, trade: { median: 77500, count: 1 } },
  { id: 8, label: "H", title: "염리언덕 59", price: 68000, area: 59.2, floor: "4/8층", station: "대흥역", walk: 8, park: 5, agent: 3, lat: 37.5490, lng: 126.9440 },
  { id: 9, label: "I", title: "대흥래미안 84", price: 92000, area: 84.0, floor: "11/19층", station: "대흥역", walk: 5, park: 7, agent: 3, lat: 37.5478, lng: 126.9408 },
  { id: 10, label: "J", title: "용강리버뷰 59", price: 83000, area: 59.9, floor: "20/25층", station: "마포역", walk: 6, park: 4, agent: 1, lat: 37.5385, lng: 126.9420 },
  { id: 11, label: "K", title: "공덕자이 74", price: 99000, area: 74.5, floor: "8/21층", station: "공덕역", walk: 3, park: 10, agent: 2, lat: 37.5432, lng: 126.9555, trade: { median: 98000, count: 2 } },
  { id: 12, label: "L", title: "마포한신 52", price: 64000, area: 52.0, floor: "6/12층", station: "애오개역", walk: 9, park: 6, agent: 3, lat: 37.5515, lng: 126.9500 },
];

const customers = [
  { id: 1, name: "김하늘", type: "매수", agent: 1, phone: "010-****-2481", budget: 80000, areaMin: 59, district: "마포구", walk: 10, prefs: ["통학", "공원", "조용한 주거지"], firstHome: true },
  { id: 2, name: "박서준", type: "매수", agent: 1, phone: "010-****-7720", budget: 100000, areaMin: 59, district: "마포구", walk: 15, prefs: ["역세권"] },
  { id: 3, name: "최유나", type: "매수", agent: 2, phone: "010-****-1104", budget: 100000, areaMin: 74, district: "마포구", walk: 10, prefs: [] },
  { id: 4, name: "정민호", type: "매수", agent: 1, phone: "010-****-5093", budget: 82000, areaMin: 49, district: "마포구", walk: 10, prefs: ["역세권"] },
  { id: 5, name: "한소희", type: "매수", agent: 3, phone: "010-****-3361", budget: 70000, areaMin: 52, district: "마포구", walk: 15, prefs: [] },
  { id: 6, name: "오지훈", type: "매수", agent: 2, phone: "010-****-8842", budget: 85000, areaMin: 59, district: "마포구", walk: 12, prefs: ["공원"] },
  { id: 7, name: "윤채원", type: "매수", agent: 1, phone: "010-****-0157", budget: 82000, areaMin: 59, district: "마포구", walk: 10, prefs: ["공원", "통학"] },
];

let nextDealId = 100;
const deals = [
  { id: 1, listing: 1, customer: 1, agent: 1, stage: "nego", days: 2, next: "11/1 매도인에게 7.6억 제안 전달" },
  { id: 2, listing: 2, customer: 1, agent: 1, stage: "visit", days: 4, next: "11/2 14:00 2차 방문" },
  { id: 3, listing: 5, customer: 1, agent: 1, stage: "dropped", days: 6, reason: "전용 59㎡ 미만" },
  { id: 4, listing: 3, customer: 4, agent: 1, stage: "intro", days: 1, next: "관심 여부 전화 확인" },
  { id: 5, listing: 7, customer: 6, agent: 2, stage: "contract", days: 5, next: "11/15 중도금" },
  { id: 6, listing: 4, customer: 2, agent: 1, stage: "visit", days: 3, next: "11/3 오전 방문" },
  { id: 7, listing: 11, customer: 3, agent: 2, stage: "nego", days: 6, next: "관리비·하자 보수 조건 조율" },
  { id: 8, listing: 12, customer: 5, agent: 3, stage: "done", days: 9, next: "10/20 잔금 완료" },
  { id: 9, listing: 9, customer: 3, agent: 2, stage: "intro", days: 2, next: "평면도 전달" },
  { id: 10, listing: 10, customer: 2, agent: 1, stage: "intro", days: 1, next: "조망 사진 전달" },
  { id: 11, listing: 8, customer: 5, agent: 3, stage: "dropped", days: 12, reason: "다른 매물 계약" },
  { id: 12, listing: 6, customer: 6, agent: 2, stage: "intro", days: 7, next: "방문 일정 조율" },
  { id: 13, listing: 1, customer: 2, agent: 1, stage: "intro", days: 1, next: "조망 사진 전달" },
];

/* 문서 근거 (자료실에 등록된 문서의 조각). 실제 앱에서는 RAG 검색 결과가 이 자리에 온다. */
const TYPE_WORD = { law: "법령", policy: "정책", office: "사무소", news: "기사", data: "데이터" };
const SOURCES = [
  { id: "S1", type: "law", title: "공인중개사법 제25조 (중개대상물의 확인·설명)", org: "법제처 국가법령정보", date: "2026-01-01", loc: "제25조 제1항",
    text: "개업공인중개사는 중개를 의뢰받은 경우에는 중개가 완성되기 전에 해당 중개대상물의 상태·입지 및 권리관계, 법령의 규정에 의한 거래 또는 이용제한사항 등을 확인하여 이를 권리를 취득하고자 하는 중개의뢰인에게 성실·정확하게 설명하고, 등기사항증명서 등 설명의 근거자료를 제시하여야 한다." },
  { id: "S2", type: "law", title: "부동산 거래신고 등에 관한 법률 제3조 (부동산 거래의 신고)", org: "법제처 국가법령정보", date: "2026-01-01", loc: "제3조 제1항",
    text: "거래당사자는 부동산의 매매계약을 체결한 경우 그 실제 거래가격 등을 거래계약의 체결일부터 30일 이내에 그 권리의 대상인 부동산등의 소재지를 관할하는 시장·군수 또는 구청장에게 공동으로 신고하여야 한다." },
  { id: "S3", type: "policy", title: "생애최초 주택 구입 지원 안내 (샘플)", org: "국토교통부", date: "2026-09-30", loc: "4쪽 · 지원 대상",
    text: "생애최초로 주택을 구입하는 무주택 세대주로서 부부합산 연소득 7천만 원 이하인 경우 지원 대상입니다. 주택가격 9억 원 이하 주택을 구입하는 경우 최대 3억 원까지 저리 구입자금 대출을 지원합니다." },
  { id: "S4", type: "policy", title: "생애최초 주택 구입 지원 안내 (샘플)", org: "국토교통부", date: "2026-09-30", loc: "5쪽 · 시행일",
    text: "이 지원은 2026년 11월 1일부터 시행되며, 시행일 이후 신청분부터 적용됩니다.", conflictWith: "S5" },
  { id: "S5", type: "news", title: "서울 주택시장 동향 (샘플)", org: "샘플경제신문 · 이용 허용 기사 요약", date: "2026-10-21", loc: "제공 요약 2문단",
    text: "생애최초 주택 구입 지원이 10월 15일부터 시행된다고 전했다. 마포구 등 서북권 아파트 매수 문의가 늘었다.", conflictWith: "S4" },
  { id: "S6", type: "office", title: "매수 상담 확인 절차 v3", org: "하늘공인중개사사무소 내부 문서", date: "2026-08-01", loc: "1. 계약 전 확인",
    text: "계약 전에는 등기사항증명서로 권리관계(근저당·가압류 등)를, 건축물대장으로 위반건축물 여부와 사용승인일을 확인하고 고객에게 근거 서류를 보여 준다. 최근 실거래가와 현재 매도 희망가는 구분해서 설명한다." },
  { id: "S7", type: "office", title: "단지별 학구도 확인 메모", org: "하늘공인중개사사무소 내부 문서", date: "2026-03-15", loc: "마포구 공덕동 일대",
    text: "마포한강뷰: 마포초 배정 구역\n마포공원앞: 공덕초 배정 구역\n(교육지원청 학구도 안내 서비스로 확인, 2026-03)" },
  { id: "S8", type: "data", title: "아파트 매매 실거래가", org: "국토교통부 · 공공데이터포털", date: "2026-10-28", loc: "동일 단지·유사 면적 최근 12개월",
    text: "신고된 과거 거래 가격입니다. 현재 매물의 매도 희망가나 거래 가능 여부를 뜻하지 않습니다." },
  { id: "S9", type: "office", title: "중개보수 안내 기준", org: "하늘공인중개사사무소 내부 문서", date: "2026-07-01", loc: "매매",
    text: "주택 매매 2억 원 이상 9억 원 미만: 상한요율 0.4%. 9억 원 이상 12억 원 미만: 0.5%. 상한 내에서 협의하며 계약 전 고객에게 서면으로 안내한다." },
];
const src = (id) => SOURCES.find((s) => s.id === id);

let nextReportId = 10;
const reports = [
  { id: 1, customer: 1, kind: "compare", title: "매물 비교표", listingIds: [1, 2], state: "shared", version: "1.0", date: "10/29", approvedBy: 1, share: { url: "https://mate.example/r/8f3k2q", expires: "11/5", views: 2, lastView: "10/30 09:12" } },
  { id: 2, customer: 1, kind: "answer", title: "생애최초 지원 문의 답변", question: "마포구 아파트를 사면 생애최초 주택 구입 지원을 받을 수 있나요?", state: "review", version: "0.2", date: "10/30" },
];
const activities = {
  1: [
    { at: "10/30", text: "A 마포한강뷰 방문→협의" },
    { at: "10/29", text: "매물 비교표 1.0 승인, 링크 전달" },
    { at: "10/24", text: "2차 상담. E 아현숲 제외(면적)" },
    { at: "10/17", text: "1차 상담. 예산 8억, 59㎡ 이상" },
  ],
};
const checked = {}; // listingId → Set(체크한 항목 키)

const ui = { mapScope: "mine", boardScope: "mine", hidden: new Set(), match: null, map: null, markers: {}, libQuery: "", libType: "all", libSel: null };

// ── 유틸 ─────────────────────────────────────────
const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const eok = (p) => `${(p / 10000).toFixed(2).replace(/\.?0+$/, "")}억`;
const byId = (a, id) => a.find((x) => x.id === Number(id));
const idx = (s) => STAGES.indexOf(s);
const stage = (s) => `<span class="stage" data-s="${s}">${STAGE_LABEL[s]}</span>`;
const prog = (s, wide) => { const n = idx(s) + 1; return `<span class="prog ${wide ? "prog--wide" : ""}" style="--c:${STAGE_COLOR[s]}">${STAGES.map((_, i) => `<i class="${i < n ? "on" : ""}"></i>`).join("")}</span>`; };
const active = (f) => deals.filter((d) => d.stage !== "dropped" && f(d));
function listingStage(l) {
  const ds = active((d) => d.listing === l.id);
  return ds.length ? ds.reduce((b, d) => (idx(d.stage) > idx(b) ? d.stage : b), ds[0].stage) : "available";
}
const fits = (l, c) => l.price <= c.budget && l.area >= c.areaMin && l.walk <= c.walk + 2 && listingStage(l) !== "done";
const log = (cid, text) => (activities[cid] ||= []).unshift({ at: "오늘", text });
function toast(m) { const t = $("#toast"); t.textContent = m; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2400); }
const srcLink = (id, label) => `<button type="button" class="srcref" data-act="source" data-src="${id}">${esc(label || `${TYPE_WORD[src(id).type]} · ${src(id).title.replace(/ \(샘플\)$/, "")}`)}</button>`;

// ── 라우팅 ─────────────────────────────────────────
function route() {
  const [page, a, b] = (location.hash || "#/map").slice(2).split("/");
  document.querySelectorAll(".view").forEach((v) => (v.hidden = true));
  document.querySelectorAll(".nav a").forEach((n) => n.classList.toggle("is-active", n.dataset.nav === (page === "report" ? "customers" : page || "map")));
  closeDrawer();
  if (page === "deals") { $("#view-deals").hidden = false; renderBoard(); return; }
  if (page === "customers") { $("#view-customers").hidden = false; renderCustomers(Number(a) || 1); return; }
  if (page === "library") { $("#view-library").hidden = false; renderLibrary(); return; }
  if (page === "report") { $("#view-report").hidden = false; renderReport(Number(a)); return; }
  $("#view-map").hidden = false;
  ui.match = a === "match" ? byId(customers, b) : null;
  if (ui.match) setScope("map", "all", false);
  ensureMap();
  renderMap();
  a === "l" ? renderListing(Number(b)) : renderListingList();
}
addEventListener("hashchange", route);

// ── 지도 ─────────────────────────────────────────
function ensureMap() {
  if (typeof window.L === "undefined") { $("#map-fail").hidden = false; return; }
  if (ui.map) { setTimeout(() => ui.map.invalidateSize(), 0); return; }
  ui.map = L.map("map", { zoomControl: false }).setView([37.547, 126.951], 15);
  L.control.zoom({ position: "bottomleft" }).addTo(ui.map);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(ui.map);
  const lg = document.createElement("div");
  lg.className = "legend";
  lg.innerHTML = "색: 거래 단계 · 칸: 진행 정도<br>숫자: 연결된 고객 · 흐림: 동료 매물";
  $(".map-wrap").appendChild(lg);
}
const scoped = () => listings.filter((l) => ui.mapScope === "all" || l.agent === ME);
const visible = () => scoped().filter((l) => !ui.hidden.has(listingStage(l)));
const selId = () => Number((location.hash.match(/^#\/map\/l\/(\d+)/) || [])[1]) || null;

function renderMap() {
  const counts = {};
  scoped().forEach((l) => { const s = listingStage(l); counts[s] = (counts[s] || 0) + 1; });
  $("#stage-filter").innerHTML = ["available", ...STAGES].map((s) =>
    `<button type="button" data-act="filter" data-s="${s}" aria-pressed="${!ui.hidden.has(s)}">${stage(s)} <b class="num">${counts[s] || 0}</b></button>`).join("");
  const mb = $("#match-bar");
  if (ui.match) {
    const c = ui.match;
    mb.innerHTML = `<span><b>${esc(c.name)}</b> 조건 (${eok(c.budget)} 이하, ${c.areaMin}㎡ 이상, 역 ${c.walk}분): 맞는 매물 ${listings.filter((l) => fits(l, c)).length}건 표시</span>
      <button type="button" class="btn btn--sm" data-act="clear-match">해제</button>`;
    mb.hidden = false;
  } else mb.hidden = true;
  if (!ui.map) return;
  Object.values(ui.markers).forEach((m) => m.remove());
  ui.markers = {};
  const sel = selId();
  visible().forEach((l) => {
    const s = listingStage(l), n = idx(s) + 1, cnt = active((d) => d.listing === l.id).length;
    const cls = ["pin", l.agent !== ME && "is-other", ui.match && (fits(l, ui.match) ? "is-match" : "is-dim"), sel === l.id && "is-sel"].filter(Boolean).join(" ");
    const html = `<div class="${cls}" data-s="${s}" data-id="${l.id}" style="--c:${STAGE_COLOR[s]}" aria-label="${esc(l.label)} ${esc(l.title)} ${eok(l.price)} ${STAGE_LABEL[s]}">
      ${l.agent !== ME ? `<span class="pa">${esc(AGENTS[l.agent][0])}</span>` : ""}
      <span>${esc(l.label)} ${eok(l.price)}</span><span class="pp">${STAGES.map((_, i) => `<i class="${i < n ? "on" : ""}"></i>`).join("")}</span>
      ${cnt ? `<span class="pc">${cnt}</span>` : ""}</div>`;
    const m = L.marker([l.lat, l.lng], { icon: L.divIcon({ className: "pin-wrap", html, iconSize: [0, 0] }), zIndexOffset: sel === l.id ? 1000 : idx(s) * 10, title: `${l.label} ${l.title}` }).addTo(ui.map);
    m.on("click", () => (location.hash = `#/map/l/${l.id}`));
    ui.markers[l.id] = m;
  });
}

function renderListingList() {
  const ls = visible().sort((a, b) => idx(listingStage(b)) - idx(listingStage(a)) || a.price - b.price);
  $("#map-side").innerHTML = `
    <div class="side-h"><h2>${ui.mapScope === "mine" ? "내 매물" : "사무소 매물"} <span class="muted num">${ls.length}</span></h2>
      <button type="button" class="btn btn--sm" data-act="todo" data-msg="지도에서 위치를 찍고 등록합니다 (현재 앱에 있는 기능).">매물 등록</button></div>
    <table class="tbl"><thead><tr><th></th><th>매물</th><th class="r">가격</th><th>단계</th><th>고객</th></tr></thead><tbody>
    ${ls.map((l) => { const s = listingStage(l); return `<tr class="lrow clickable ${l.agent !== ME ? "is-other" : ""}" style="--c:${STAGE_COLOR[s] === STAGE_COLOR.available ? "var(--line)" : STAGE_COLOR[s]}" data-act="open" data-id="${l.id}">
      <td></td><td><b>${esc(l.label)}</b> ${esc(l.title)}${l.agent !== ME ? `<br><span class="muted">담당 ${esc(AGENTS[l.agent])}</span>` : ""}</td>
      <td class="r num">${eok(l.price)}</td><td>${stage(s)}</td><td class="num">${active((d) => d.listing === l.id).length || "-"}</td></tr>`; }).join("")
      || `<tr><td colspan="5" class="empty">표시할 매물이 없습니다.</td></tr>`}
    </tbody></table>`;
}

/* 매물별 확인할 사항: 가격·지역·단계에 맞는 조항을 자료실에서 찾아 붙인다 (실제 앱에서는 RAG 검색 결과) */
function checksFor(l) {
  const s = listingStage(l);
  const items = [
    { key: "reg", text: "등기사항증명서로 권리관계(근저당·가압류) 확인", srcs: ["S6", "S1"] },
    { key: "bld", text: "건축물대장으로 위반건축물·사용승인일 확인", srcs: ["S6"] },
  ];
  if (l.price <= 90000) items.push({ key: "fh", text: "주택가격 9억 원 이하: 생애최초 구입 지원 가격 기준에 해당 (11/1 시행, 소득·무주택 요건 별도)", srcs: ["S3", "S4"] });
  else items.push({ key: "fh", text: "주택가격 9억 원 초과: 생애최초 구입 지원 가격 기준 밖", srcs: ["S3"] });
  if (l.price <= 90000) items.push({ key: "fhd", cls: "warn", text: "지원 시행일이 기사(10/15)와 공식 안내(11/1)가 다름. 공식 안내 기준으로 설명", srcs: ["S4", "S5"] });
  items.push(l.school ? { key: "sch", text: `학구도상 ${l.school} 배정 구역`, srcs: ["S7"] }
    : { key: "sch", cls: "warn", text: "배정 학교 자료 없음. 교육지원청 학구도 확인 필요", srcs: [] });
  if (idx(s) >= idx("contract")) items.unshift({ key: "rpt", cls: "bad", text: "계약일부터 30일 이내 거래 신고 (매도·매수인 공동)", srcs: ["S2"] });
  return items;
}

function renderListing(id) {
  const l = byId(listings, id);
  if (!l) return renderListingList();
  const s = listingStage(l), n = idx(s) + 1;
  const ds = deals.filter((d) => d.listing === l.id).sort((a, b) => (a.stage === "dropped") - (b.stage === "dropped") || idx(b.stage) - idx(a.stage));
  const done = (checked[l.id] ||= new Set());
  if (ui.map) ui.map.panTo([l.lat, l.lng]);
  $("#map-side").innerHTML = `
    <div class="detail">
      <div class="detail-top"><button type="button" class="btn btn--sm" data-act="back">목록</button>${stage(s)}</div>
      <h2>${esc(l.label)} ${esc(l.title)}</h2>
      <div class="price num">${eok(l.price)}${l.history ? ` <span class="muted" style="font-size:12px;font-weight:400">${esc(l.history)}</span>` : ""}</div>
      ${prog(s, true)}<div class="prog-labels">${STAGES.map((x, i) => `<span class="${i === n - 1 ? "cur" : ""}">${STAGE_LABEL[x]}</span>`).join("")}</div>

      <div class="sec"><div class="sec-h"><h2>거래</h2><span class="muted">진행 ${active((d) => d.listing === l.id).length}건</span></div>
        ${ds.map(dealBox).join("") || `<p class="empty">연결된 고객이 없습니다.</p>`}
        <p style="margin:8px 0 0"><button type="button" class="btn btn--sm" data-act="link" data-id="${l.id}">고객 연결</button></p>
      </div>

      <div class="sec"><div class="sec-h"><h2>확인할 사항</h2><span class="muted">${done.size}/${checksFor(l).length} 확인</span></div>
        <ul class="checks">${checksFor(l).map((c) => `<li class="${c.cls || ""}">
          <input type="checkbox" id="ck-${c.key}" data-act="check" data-id="${l.id}" data-key="${c.key}" ${done.has(c.key) ? "checked" : ""} />
          <label class="txt" for="ck-${c.key}">${esc(c.text)}</label>
          <span class="src">${c.srcs.length ? `출처: ${c.srcs.map((x) => srcLink(x)).join(", ")}` : "출처 없음"}</span></li>`).join("")}</ul>
      </div>

      <div class="sec"><div class="sec-h"><h2>매물 정보</h2><span class="muted">담당 ${esc(AGENTS[l.agent])}</span></div>
        <dl class="kv">
          <dt>전용면적</dt><dd class="num">${l.area}㎡</dd><dt>층</dt><dd>${esc(l.floor)}</dd>
          <dt>교통</dt><dd>${esc(l.station)} 도보 ${l.walk}분</dd><dt>공원</dt><dd>도보 ${l.park}분</dd>
          <dt>실거래</dt><dd>${l.trade ? `중위 ${eok(l.trade.median)} (${l.trade.count}건, 최근 12개월) ${srcLink("S8", "출처")}` : "자료 없음"}</dd>
        </dl>
      </div>
    </div>`;
}

function dealBox(d) {
  const c = byId(customers, d.customer), i = idx(d.stage);
  if (d.stage === "dropped") return `<div class="deal is-dropped" style="--c:${STAGE_COLOR.dropped}"><div class="deal-top"><a href="#/customers/${c.id}">${esc(c.name)}</a> <span class="muted">담당 ${esc(AGENTS[d.agent])}</span>${stage("dropped")}</div><div class="next">사유: ${esc(d.reason)}</div></div>`;
  return `<div class="deal" style="--c:${STAGE_COLOR[d.stage]}">
    <div class="deal-top"><a href="#/customers/${c.id}">${esc(c.name)}</a> <span class="muted">담당 ${esc(AGENTS[d.agent])} · ${d.days}일째</span>${stage(d.stage)}</div>
    <div class="next">다음: <b>${esc(d.next || "-")}</b></div>
    <div class="acts">
      <button type="button" class="btn btn--sm" data-act="prev" data-id="${d.id}" ${i <= 0 ? "disabled" : ""}>이전 단계</button>
      <button type="button" class="btn btn--sm btn--main" data-act="next" data-id="${d.id}" ${i >= 4 ? "disabled" : ""}>${i < 4 ? `${STAGE_LABEL[STAGES[i + 1]]}(으)로` : "완료"}</button>
      <button type="button" class="btn btn--sm" data-act="drop" data-id="${d.id}">무산</button>
    </div></div>`;
}

function move(id, delta) {
  const d = byId(deals, id), from = d.stage, to = STAGES[idx(from) + delta];
  if (!to) return;
  Object.assign(d, { stage: to, days: 0, next: NEXT_TODO[to] || d.next });
  const l = byId(listings, d.listing), c = byId(customers, d.customer);
  log(c.id, `${l.label} ${l.title} ${STAGE_LABEL[from]}→${STAGE_LABEL[to]}`);
  const others = active((x) => x.listing === l.id && x.id !== d.id).length;
  toast(`${c.name} · ${l.label}: ${STAGE_LABEL[from]} → ${STAGE_LABEL[to]}${to === "contract" && others ? ` (같은 매물 다른 거래 ${others}건 그대로 둠)` : ""}`);
  route();
}

// ── 거래 ─────────────────────────────────────────
function renderBoard() {
  const ds = deals.filter((d) => ui.boardScope === "all" || d.agent === ME);
  $("#board").innerHTML = STAGES.map((s) => {
    const items = ds.filter((d) => d.stage === s);
    return `<section class="col"><div class="col-h">${stage(s)}<span class="num">${items.length}</span></div>
      ${items.map((d) => {
        const c = byId(customers, d.customer), l = byId(listings, d.listing), i = idx(d.stage);
        return `<article class="dcard ${d.agent !== ME ? "is-other" : ""}">
          <div class="dcard-top"><a href="#/customers/${c.id}">${esc(c.name)}</a><span class="muted num">${d.days}일</span></div>
          <button type="button" class="btn--link" style="text-align:left" data-act="open" data-id="${l.id}">${esc(l.label)} ${esc(l.title)} · ${eok(l.price)}</button>
          <div class="next">${esc(d.next || "")}</div>
          <div class="acts"><span class="who">담당 ${esc(AGENTS[d.agent])}</span>
            <span><button type="button" class="btn btn--sm" data-act="prev" data-id="${d.id}" ${i <= 0 ? "disabled" : ""} aria-label="이전 단계">이전</button>
            <button type="button" class="btn btn--sm" data-act="next" data-id="${d.id}" ${i >= 4 ? "disabled" : ""} aria-label="다음 단계">다음</button></span></div>
        </article>`;
      }).join("") || `<p class="col-empty">없음</p>`}</section>`;
  }).join("");
  const dr = ds.filter((d) => d.stage === "dropped");
  $("#dropped").textContent = `무산 ${dr.length}건${dr.length ? ": " + dr.map((d) => `${byId(customers, d.customer).name}–${byId(listings, d.listing).label} (${d.reason})`).join(", ") : ""}`;
}

// ── 고객 ─────────────────────────────────────────
const STATE_WORD = { draft: "작성 중", review: "검토 요청", approved: "승인", shared: "전달함" };
function renderCustomers(cid) {
  $("#customer-list").innerHTML = `<div class="side-h"><h2>고객 <span class="muted num">${customers.length}</span></h2>
      <button type="button" class="btn btn--sm" data-act="todo" data-msg="고객 등록 화면 (시안에서는 생략)">고객 등록</button></div>
    <table class="tbl"><thead><tr><th>이름</th><th>담당</th><th>진행</th></tr></thead><tbody>
    ${customers.map((c) => { const ds = active((d) => d.customer === c.id); const top = ds.reduce((b, d) => (idx(d.stage) > idx(b) ? d.stage : b), ds[0]?.stage);
      return `<tr class="clickable ${c.id === cid ? "is-sel" : ""}" data-act="customer" data-id="${c.id}"><td><b>${esc(c.name)}</b> <span class="muted">${esc(c.type)}</span></td>
        <td>${esc(AGENTS[c.agent])}</td><td>${top ? `${stage(top)} <span class="muted num">${ds.length}건</span>` : `<span class="muted">-</span>`}</td></tr>`; }).join("")}
    </tbody></table>`;

  const c = byId(customers, cid);
  const ds = deals.filter((d) => d.customer === c.id);
  const reps = reports.filter((r) => r.customer === c.id);
  $("#customer-detail").innerHTML = `
    <div class="c-head"><div><h1>${esc(c.name)} <span class="muted" style="font-size:13px">${esc(c.type)}</span></h1>
      <div class="meta">담당 ${esc(AGENTS[c.agent])} · ${esc(c.phone)}${c.firstHome ? " · 생애최초 구입" : ""}</div></div>
      <div class="c-acts">
        <a class="btn" href="#/map/match/${c.id}">조건에 맞는 매물 지도에서 보기</a>
        <button type="button" class="btn btn--main" data-act="new-compare" data-id="${c.id}">비교표 작성</button>
        <button type="button" class="btn" data-act="new-answer" data-id="${c.id}">문의 답변 작성</button>
      </div></div>

    <div class="sec"><div class="sec-h"><h2>찾는 조건</h2><button type="button" class="btn--link" data-act="todo" data-msg="조건 수정 (시안에서는 생략)">수정</button></div>
      <dl class="kv"><dt>예산</dt><dd>${eok(c.budget)} 이하</dd><dt>면적</dt><dd>전용 ${c.areaMin}㎡ 이상</dd>
        <dt>지역</dt><dd>${esc(c.district)}, 역 도보 ${c.walk}분 이내</dd><dt>원하는 점</dt><dd>${esc(c.prefs.join(", ") || "-")}</dd></dl></div>

    <div class="cols-2">
      <div class="sec"><div class="sec-h"><h2>거래</h2><span class="muted">진행 ${active((d) => d.customer === c.id).length}건</span></div>
        <table class="tbl"><thead><tr><th>매물</th><th class="r">가격</th><th>단계</th><th>다음 할 일</th></tr></thead><tbody>
        ${ds.map((d) => { const l = byId(listings, d.listing); return `<tr class="clickable" data-act="open" data-id="${l.id}">
          <td><b>${esc(l.label)}</b> ${esc(l.title)}</td><td class="r num">${eok(l.price)}</td><td>${stage(d.stage)}<br>${d.stage === "dropped" ? "" : prog(d.stage)}</td>
          <td>${esc(d.stage === "dropped" ? d.reason : d.next)}</td></tr>`; }).join("") || `<tr><td colspan="4" class="empty">연결된 매물이 없습니다.</td></tr>`}
        </tbody></table></div>

      <div>
        <div class="sec"><div class="sec-h"><h2>고객 자료</h2></div>
          <table class="tbl"><thead><tr><th>자료</th><th>판</th><th>상태</th></tr></thead><tbody>
          ${reps.map((r) => `<tr class="clickable" data-act="report" data-id="${r.id}"><td><a href="#/report/${r.id}">${esc(r.title)}</a> <span class="muted">${esc(r.date)}</span></td>
            <td class="num">${esc(r.version)}</td><td><span class="state" data-s="${r.state}">${STATE_WORD[r.state]}</span></td></tr>`).join("") || `<tr><td colspan="3" class="empty">없음</td></tr>`}
          </tbody></table></div>
        <div class="sec"><div class="sec-h"><h2>상담 기록</h2></div>
          <ol class="timeline">${(activities[c.id] || [{ at: "", text: "기록 없음" }]).map((a) => `<li><time>${esc(a.at)}</time><span>${esc(a.text)}</span></li>`).join("")}</ol></div>
      </div>
    </div>`;
}

// ── 자료실 (문서 검색) ─────────────────────────────────────────
function libHits() {
  const words = ui.libQuery.trim().split(/\s+/).filter(Boolean);
  return SOURCES.filter((s) => (ui.libType === "all" || s.type === ui.libType)
    && (!words.length || words.some((w) => (s.title + s.text + s.org).includes(w))));
}
function hl(text) {
  let out = esc(text);
  ui.libQuery.trim().split(/\s+/).filter((w) => w.length > 1).forEach((w) => { out = out.split(esc(w)).join(`<mark>${esc(w)}</mark>`); });
  return out;
}
function renderLibrary() {
  const hits = libHits();
  $("#library-side").innerHTML = `
    <div class="side-h"><h2>자료실</h2><button type="button" class="btn btn--sm" data-act="todo" data-msg="관리자가 PDF·문서를 올리면 조항·쪽 단위로 나눠 검색할 수 있게 됩니다.">문서 등록</button></div>
    <form class="search" data-act="lib-search">
      <input id="lib-q" type="search" placeholder="예: 거래 신고 기한, 생애최초, 학구도" value="${esc(ui.libQuery)}" aria-label="자료 검색어" />
      <div class="types" role="group" aria-label="자료 종류">${["all", "law", "policy", "office", "news", "data"].map((t) =>
        `<button type="button" data-act="lib-type" data-t="${t}" aria-pressed="${ui.libType === t}">${t === "all" ? "전체" : TYPE_WORD[t]}</button>`).join("")}</div>
    </form>
    ${hits.map((s) => `<button type="button" class="hit ${ui.libSel === s.id ? "is-sel" : ""}" data-act="lib-open" data-src="${s.id}">
      <div class="t"><span class="typeword">${TYPE_WORD[s.type]}</span>${esc(s.title)}</div>
      <div class="m">${esc(s.org)} · ${esc(s.date)} · ${esc(s.loc)}</div><div class="x">${hl(s.text)}</div></button>`).join("")
      || `<p class="empty">찾는 내용이 있는 문서가 없습니다.</p>`}`;
  const s = src(ui.libSel || hits[0]?.id);
  $("#library-detail").innerHTML = s ? sourceBody(s, true) : `<p class="empty">왼쪽에서 문서를 고르세요.</p>`;
}
function sourceBody(s, inLibrary) {
  const other = s.conflictWith && src(s.conflictWith);
  return `
    <div class="drawer-h"><div><span class="typeword">${TYPE_WORD[s.type]}</span><h2 style="display:inline">${esc(s.title)}</h2></div>
      ${inLibrary ? "" : `<button type="button" class="btn btn--sm" data-act="close-drawer">닫기</button>`}</div>
    <dl class="kv" style="margin-top:10px"><dt>발행</dt><dd>${esc(s.org)}</dd><dt>기준일</dt><dd>${esc(s.date)}</dd><dt>위치</dt><dd>${esc(s.loc)}</dd></dl>
    <div class="excerpt">${inLibrary ? hl(s.text) : esc(s.text)}</div>
    ${s.type === "news" ? `<p class="note" style="color:var(--warn)">기사는 시장 상황을 설명하는 보조 자료입니다. 정책 적용 여부의 근거로 쓰지 않습니다.</p>` : ""}
    ${other ? `<p class="note">내용이 다른 자료: ${srcLink(other.id)} (${esc(other.date)})</p>` : ""}
    ${inLibrary ? `<p><button type="button" class="btn" data-act="quote" data-src="${s.id}">고객 문의 답변에 인용</button></p>` : `<p><a href="#/library" data-act="lib-goto" data-src="${s.id}">자료실에서 보기</a></p>`}`;
}
function openDrawer(id) { const d = $("#drawer"); d.innerHTML = sourceBody(src(id), false); d.hidden = false; }
function closeDrawer() { $("#drawer").hidden = true; }

// ── 고객 자료 ─────────────────────────────────────────
function newReport(cid, kind, question, quoteSrc) {
  const c = byId(customers, cid);
  const ids = active((d) => d.customer === c.id).map((d) => d.listing).slice(0, 5);
  if (kind === "compare" && !ids.length) return toast("비교할 매물이 없습니다. 지도에서 매물을 먼저 연결하세요.");
  const r = { id: nextReportId++, customer: c.id, kind, version: "0.1", date: "오늘", state: "draft",
    title: kind === "compare" ? "매물 비교표" : "문의 답변", listingIds: ids, question, quoteSrc };
  reports.unshift(r);
  log(c.id, `${r.title} 작성 시작`);
  location.hash = `#/report/${r.id}`;
}

/* [S3] 형태의 표시를 각주 번호로 바꾼다. 사용한 출처 순서대로 번호를 매긴다. */
function withNotes(text, used) {
  return esc(text).replace(/\[(S\d+)\]/g, (_, id) => {
    if (!used.includes(id)) used.push(id);
    return `<sup>${srcLink(id, `${used.indexOf(id) + 1})`)}</sup>`;
  });
}

function compareDoc(r, c, used) {
  const ls = r.listingIds.map((i) => byId(listings, i));
  const row = (h, f) => `<tr><th>${h}</th>${ls.map(f).join("")}</tr>`;
  const op = ls.map((l) => {
    const parts = [`${l.label} ${l.title}는 ${eok(l.price)}, 전용 ${l.area}㎡로 ${l.price <= c.budget ? "예산 안에 있고" : "예산을 넘고"} ${l.station}까지 걸어서 ${l.walk}분입니다.`];
    if (l.trade) parts.push(`같은 단지 비슷한 면적의 최근 실거래 중위가는 ${eok(l.trade.median)}입니다[S8].`);
    if (c.prefs.includes("공원")) parts.push(`공원까지 도보 ${l.park}분${l.park <= 5 ? "으로 가깝습니다" : "입니다"}.`);
    if (l.history) parts.push(`가격이 ${l.history.replace("→", "에서 ")}로 조정되었습니다.`);
    if (c.prefs.includes("통학") && l.school) parts.push(`학구도상 ${l.school} 배정 구역입니다[S7].`);
    return parts.join(" ");
  });
  if (c.firstHome) op.push("두 매물 모두 주택가격 9억 원 이하라 생애최초 구입 지원의 가격 기준에는 해당합니다[S3]. 다만 지원은 11월 1일 이후 신청분부터 적용됩니다[S4].");
  const todo = [];
  if (c.prefs.includes("통학")) ls.filter((l) => !l.school).forEach((l) => todo.push(`${l.label}의 배정 학교 (교육지원청 학구도)`));
  if (c.prefs.includes("조용한 주거지")) todo.push("소음 등 주거 환경은 방문해서 확인");
  todo.push(`계약 전 등기사항증명서·건축물대장 확인[S6]`);
  return `
    <h2>매물 비교</h2>
    <table class="ptbl"><thead><tr><th style="width:110px"></th>${ls.map((l) => `<th>${esc(l.label)} ${esc(l.title)}</th>`).join("")}</tr></thead><tbody>
      ${row("매도 희망가", (l) => `<td>${eok(l.price)}${l.history ? `<br><small>${esc(l.history)}</small>` : ""}</td>`)}
      ${row("전용면적 / 층", (l) => `<td>${l.area}㎡ / ${esc(l.floor)}</td>`)}
      ${row("교통", (l) => `<td>${esc(l.station)} 도보 ${l.walk}분</td>`)}
      ${row("공원", (l) => `<td>도보 ${l.park}분</td>`)}
      ${row("최근 실거래", (l) => `<td>${l.trade ? `${eok(l.trade.median)} (${l.trade.count}건)` : "자료 없음"}</td>`)}
      ${row("예산·면적 조건", (l) => (l.price <= c.budget && l.area >= c.areaMin ? `<td>맞음</td>` : `<td class="x">${l.price > c.budget ? "예산 초과" : "면적 부족"}</td>`))}
    </tbody></table>
    <h2>중개사 의견</h2>
    <p class="opinion" data-editable>${op.map((t) => withNotes(t, used)).join(" ")}</p>
    <h2>추가로 확인할 사항</h2>
    <ul class="tocheck">${todo.map((t) => `<li>${withNotes(t, used)}</li>`).join("")}</ul>`;
}

function answerDoc(r, used) {
  const quoted = r.quoteSrc ? [`참고한 자료: ${src(r.quoteSrc).title}[${r.quoteSrc}]`] : [];
  const ans = r.quoteSrc && !["S3", "S4", "S5"].includes(r.quoteSrc)
    ? `${src(r.quoteSrc).text}[${r.quoteSrc}]`
    : "무주택 세대주이고 부부합산 연소득이 7천만 원 이하라면, 9억 원 이하 주택을 살 때 최대 3억 원까지 저리 대출을 받을 수 있습니다[S3]. 이 지원은 2026년 11월 1일부터 시행되며 그 이후 신청분부터 적용됩니다[S4]. 일부 기사에는 시행일이 10월 15일로 나와 있으나, 국토교통부 공식 안내를 기준으로 안내드립니다[S5].";
  return `
    <h2>문의 내용</h2><p class="opinion">${esc(r.question)}</p>
    <h2>답변</h2><p class="opinion" data-editable>${withNotes(ans, used)}</p>
    ${quoted.length ? `<p class="opinion" style="font-size:12px">${withNotes(quoted[0], used)}</p>` : ""}
    <h2>추가로 확인할 사항</h2>
    <ul class="tocheck"><li>소득·무주택 요건 충족 여부 (취급 은행 확인)</li><li>11월 1일 이후 신청 가능 여부 재확인</li></ul>`;
}

function renderReport(id) {
  const r = byId(reports, id);
  if (!r) { location.hash = "#/customers"; return; }
  const c = byId(customers, r.customer);
  const order = ["draft", "review", "approved", "shared"];
  const cur = order.indexOf(r.state), approved = cur >= 2;
  const used = [];
  const body = r.kind === "compare" ? compareDoc(r, c, used) : answerDoc(r, used);
  $("#view-report").innerHTML = `
    <div class="paper-wrap"><article class="paper">
      ${approved ? "" : `<span class="stamp">${r.state === "draft" ? "작성 중" : "검토 중"} · 고객 전달 전</span>`}
      <header class="paper-h"><div><h1>${esc(r.title)}</h1><div class="to">${esc(c.name)} 고객님께 · ${esc(r.date)} · 제${esc(r.version)}판</div></div>
        <div class="from">하늘공인중개사사무소<br>공인중개사 ${esc(AGENTS[c.agent])}<br>02-***-1234</div></header>
      ${body}
      <h2>출처</h2>
      <ol class="foot">${used.map((sid) => { const s = src(sid); return `<li>${esc(s.org)}, 「${esc(s.title.replace(/ \(샘플\)$/, ""))}」 ${esc(s.loc)} (${esc(s.date)})${s.type === "news" ? " — 보조 자료" : ""}</li>`; }).join("")}</ol>
      <div class="paper-end"><span>${approved ? `공인중개사 ${esc(AGENTS[r.approvedBy || ME])} 확인` : "승인 전 문서입니다."}</span><span>실거래가는 과거 신고 가격이며 현재 매도 희망가와 다를 수 있습니다.</span></div>
    </article></div>
    <aside class="rside">
      <a href="#/customers/${c.id}">${esc(c.name)} 고객으로</a>
      <div><h2 style="font-size:13.5px">진행</h2><ol class="flow">${["작성", "검토", "승인", "전달 (인쇄·링크)"].map((t, i) => `<li class="${i < cur ? "done" : ""} ${i === cur ? "cur" : ""}">${t}</li>`).join("")}</ol></div>
      <div class="acts">
        ${!approved ? `<button type="button" class="btn" data-act="save-edit" data-id="${r.id}">수정 내용 저장</button><p class="hint">의견·답변 문단은 문서에서 바로 고칠 수 있습니다. 출처 번호를 누르면 원문이 열립니다.</p>` : ""}
        ${r.state === "draft" ? `<button type="button" class="btn btn--main" data-act="to-review" data-id="${r.id}">검토 요청</button>` : ""}
        ${r.state === "review" ? `<button type="button" class="btn btn--main" data-act="approve" data-id="${r.id}">출처 확인 후 승인</button>` : ""}
        <button type="button" class="btn ${approved ? "btn--main" : ""}" data-act="print" ${approved ? "" : "disabled"}>인쇄 / PDF 저장</button>
        <button type="button" class="btn" data-act="share" data-id="${r.id}" ${approved ? "" : "disabled"}>링크로 보내기</button>
        ${approved ? "" : `<p class="hint">인쇄와 링크 전달은 승인한 판만 할 수 있습니다.</p>`}
        ${r.share ? `<div class="share"><b>보낸 링크</b><code>${esc(r.share.url)}</code><span>${esc(r.share.expires)}까지 · 열람 ${r.share.views}회${r.share.lastView ? ` (마지막 ${esc(r.share.lastView)})` : ""}</span></div>` : ""}
      </div>
    </aside>`;
  if (!approved) $("#view-report").querySelectorAll("[data-editable]").forEach((el) => el.setAttribute("contenteditable", "true"));
}

// ── 대화상자 ─────────────────────────────────────────
function dialog(html) { const d = $("#dialog"); d.innerHTML = html; d.showModal(); }
const bumpMinor = (v) => { const [a, b] = v.split(".").map(Number); return `${a}.${b + 1}`; };

// ── 이벤트 ─────────────────────────────────────────
function setScope(which, scope, rerender) {
  ui[which === "board" ? "boardScope" : "mapScope"] = scope;
  (which === "board" ? $("#view-deals") : $("#view-map")).querySelectorAll("[data-scope]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.scope === scope)));
  if (rerender) route();
}

document.addEventListener("submit", (e) => {
  if (e.target.matches("[data-act=lib-search]")) { e.preventDefault(); ui.libQuery = $("#lib-q").value; ui.libSel = null; renderLibrary(); }
});
document.addEventListener("input", (e) => {
  if (e.target.id === "lib-q") { ui.libQuery = e.target.value; ui.libSel = null; const pos = e.target.selectionStart; renderLibrary(); const q = $("#lib-q"); q.focus(); q.setSelectionRange(pos, pos); }
});
document.addEventListener("change", (e) => {
  const el = e.target.closest("[data-act=check]");
  if (!el) return;
  const set = (checked[el.dataset.id] ||= new Set());
  el.checked ? set.add(el.dataset.key) : set.delete(el.dataset.key);
  renderListing(Number(el.dataset.id));
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });

document.addEventListener("click", (e) => {
  const sc = e.target.closest("[data-scope]");
  if (sc) return setScope(sc.closest("#view-deals") ? "board" : "map", sc.dataset.scope, true);
  const el = e.target.closest("[data-act]");
  if (!el || el.dataset.act === "check" || el.tagName === "FORM") return;
  const id = Number(el.dataset.id);
  switch (el.dataset.act) {
    case "open": location.hash = `#/map/l/${id}`; break;
    case "back": location.hash = ui.match ? `#/map/match/${ui.match.id}` : "#/map"; break;
    case "filter": { const s = el.dataset.s; ui.hidden.has(s) ? ui.hidden.delete(s) : ui.hidden.add(s); route(); break; }
    case "clear-match": location.hash = "#/map"; break;
    case "next": move(id, 1); break;
    case "prev": move(id, -1); break;
    case "drop":
      dialog(`<h2>무산 처리</h2><label>사유<input id="drop-reason" value="고객 의사 변경" /></label>
        <div class="btns"><button type="button" class="btn" data-act="close-dialog">취소</button><button type="button" class="btn btn--main" data-act="drop-ok" data-id="${id}">무산 처리</button></div>`);
      break;
    case "drop-ok": { const d = byId(deals, id); Object.assign(d, { stage: "dropped", reason: $("#drop-reason").value || "-" }); log(d.customer, `${byId(listings, d.listing).label} 무산 (${d.reason})`); $("#dialog").close(); toast("무산 처리했습니다."); route(); break; }
    case "link": {
      const have = new Set(deals.filter((d) => d.listing === id).map((d) => d.customer));
      const opts = customers.filter((c) => !have.has(c.id)), l = byId(listings, id);
      dialog(`<h2>${esc(l.label)} ${esc(l.title)} · 고객 연결</h2>
        <label>고객<select id="link-c">${opts.map((c) => `<option value="${c.id}">${esc(c.name)} (담당 ${esc(AGENTS[c.agent])})${fits(l, c) ? " · 조건 맞음" : ""}</option>`).join("")}</select></label>
        <div class="btns"><button type="button" class="btn" data-act="close-dialog">취소</button><button type="button" class="btn btn--main" data-act="link-ok" data-id="${id}" ${opts.length ? "" : "disabled"}>연결 (소개 단계)</button></div>`);
      break;
    }
    case "link-ok": { const c = byId(customers, $("#link-c").value), l = byId(listings, id); deals.push({ id: nextDealId++, listing: id, customer: c.id, agent: c.agent, stage: "intro", days: 0, next: "매물 소개" }); log(c.id, `${l.label} ${l.title} 소개`); $("#dialog").close(); toast(`${c.name} — ${l.label} 연결했습니다.`); route(); break; }
    case "close-dialog": $("#dialog").close(); break;
    case "customer": location.hash = `#/customers/${id}`; break;
    case "report": location.hash = `#/report/${id}`; break;
    case "new-compare": newReport(id, "compare"); break;
    case "new-answer":
      dialog(`<h2>문의 답변 작성</h2><label>고객 문의<textarea id="q" rows="3">마포구 아파트를 사면 생애최초 주택 구입 지원을 받을 수 있나요?</textarea></label>
        <p class="note muted" style="font-size:12px">자료실의 법령·공식 정책·사무소 문서에서 관련 조항을 찾아 답변 초안을 만듭니다.</p>
        <div class="btns"><button type="button" class="btn" data-act="close-dialog">취소</button><button type="button" class="btn btn--main" data-act="answer-ok" data-id="${id}">작성</button></div>`);
      break;
    case "answer-ok": $("#dialog").close(); newReport(id, "answer", $("#q").value.trim() || "문의"); break;
    case "save-edit": { const r = byId(reports, id); r.version = bumpMinor(r.version); log(r.customer, `${r.title} ${r.version}판 저장`); toast(`${r.version}판으로 저장했습니다.`); route(); break; }
    case "to-review": { const r = byId(reports, id); r.state = "review"; log(r.customer, `${r.title} 검토 요청`); toast("검토를 요청했습니다."); route(); break; }
    case "approve": {
      const r = byId(reports, id);
      if (!confirm("출처와 기준일, 추가 확인 사항을 확인했습니까? 승인 후에는 이 판을 고칠 수 없습니다.")) return;
      Object.assign(r, { state: "approved", version: "1.0", approvedBy: ME });
      log(r.customer, `${r.title} 1.0 승인`);
      toast("승인했습니다.");
      route();
      break;
    }
    case "print": window.print(); break;
    case "share": {
      const r = byId(reports, id);
      r.share ||= { url: `https://mate.example/r/${Math.random().toString(36).slice(2, 8)}`, expires: "7일 후", views: 0 };
      if (r.state === "approved") { r.state = "shared"; log(r.customer, `${r.title} 링크 전달`); }
      dialog(`<h2>링크로 보내기</h2><label>링크<input readonly value="${esc(r.share.url)}" /></label>
        <p class="muted" style="font-size:12px">승인한 ${esc(r.version)}판만 열립니다. ${esc(r.share.expires)}까지 유효하며, 고객이 열면 상담 기록에 남습니다.</p>
        <div class="btns"><button type="button" class="btn btn--main" data-act="close-dialog">확인</button></div>`);
      route();
      break;
    }
    case "source": openDrawer(el.dataset.src); break;
    case "close-drawer": closeDrawer(); break;
    case "lib-goto": ui.libSel = el.dataset.src; ui.libQuery = ""; ui.libType = "all"; break;
    case "lib-type": ui.libType = el.dataset.t; ui.libSel = null; renderLibrary(); break;
    case "lib-open": ui.libSel = el.dataset.src; renderLibrary(); break;
    case "quote":
      dialog(`<h2>문의 답변에 인용</h2><label>고객<select id="quote-c">${customers.map((c) => `<option value="${c.id}">${esc(c.name)} (담당 ${esc(AGENTS[c.agent])})</option>`).join("")}</select></label>
        <label>고객 문의<textarea id="quote-q" rows="2">${esc(src(el.dataset.src).title)} 관련 문의</textarea></label>
        <div class="btns"><button type="button" class="btn" data-act="close-dialog">취소</button><button type="button" class="btn btn--main" data-act="quote-ok" data-src="${el.dataset.src}">답변 작성</button></div>`);
      break;
    case "quote-ok": $("#dialog").close(); newReport(Number($("#quote-c").value), "answer", $("#quote-q").value, el.dataset.src); break;
    case "todo": toast(el.dataset.msg || "시안에서는 생략했습니다."); break;
  }
});

route();
