"use strict";
/* 지도: 단계별 색 핀, 매물 목록·상세, 거래 단계 변경, 확인할 사항, 현장 메모, 매물 등록·수정·종료. 질문 결과는 app-ask */

const M = {
  scope: "mine", hidden: new Set(), match: null, matchIds: null, ask: null,
  map: null, markers: {}, listings: [], fittedFor: null,
  pick: false, temp: null, detailId: null,
};

VIEWS.map = async (a, b) => {
  // 매물을 받기 전에도 화면 제목이 먼저 보이도록 (불러오는 동안의 모양)
  if (!$("#map-side").querySelector("h1, .detail")) $("#map-side").innerHTML = `<div class="side-h"><h1>매물</h1></div><p class="loading">불러오는 중…</p>`;
  M.match = null;
  M.matchIds = null;
  if (a === "ask" && b) {
    const want = decodeURIComponent(b);
    await loadAsk(want);
    if (location.hash !== askHash(want)) return;          // 기다리는 사이 다른 질문·화면으로 이동했다
    if (!M.ask || M.ask.q !== want) { location.hash = "#/map"; return; }   // 찾기 실패 (알림은 이미 보임)
  } else if (a !== "l") M.ask = null;         // 질문 결과에서 매물을 열었을 때는 결과를 유지한다
  if (M.ask) { M.matchIds = askMatchIds(); setMapScope("all", false); }
  if (a === "match" && b) {
    const [c, m] = await Promise.all([api("GET", `/customers/${b}`), api("GET", `/customers/${b}/matches`)]).catch((e) => { toast(e.message); return []; });
    if (c) { M.match = c.customer; M.matchIds = new Set(m.items.map((l) => l.id)); setMapScope("all", false); }
  }
  ensureMap();
  await loadListings();
  if (a === "l" && b) await renderDetail(Number(b));
  else { M.detailId = null; M.ask ? renderAsk() : renderList(); }
};

function ensureMap() {
  if (typeof window.L === "undefined") { $("#map-fail").hidden = false; return; }
  if (M.map) { setTimeout(() => M.map.invalidateSize(), 0); return; }
  M.map = L.map("map", { zoomControl: false }).setView([37.547, 126.951], 15);
  L.control.zoom({ position: "bottomleft" }).addTo(M.map);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(M.map);
  const legend = document.createElement("div");
  legend.className = "legend";
  legend.innerHTML = "색: 거래 단계 · 칸: 진행 정도<br>숫자: 연결된 고객 · 흐림: 동료 매물";
  $(".map-wrap").appendChild(legend);
  M.map.on("click", (e) => { if (M.pick) placeTemp(e.latlng.lat, e.latlng.lng); });
}

async function loadListings() {
  const mine = M.scope === "mine" && !M.match && !M.ask;
  try {
    M.listings = (await api("GET", `/listings${mine ? "?mine=true" : ""}`)).items;
  } catch (e) { toast(e.message); M.listings = []; }
  renderFilter();
  renderPins();
}

const visibleListings = () => M.listings.filter((l) => !M.hidden.has(l.stage));

function renderFilter() {
  const counts = {};
  M.listings.forEach((l) => { counts[l.stage] = (counts[l.stage] || 0) + 1; });
  $("#stage-filter").innerHTML = ["available", ...STAGES].map((s) =>
    `<button type="button" data-act="filter" data-s="${s}" aria-pressed="${!M.hidden.has(s)}">${stageTag(s)} <b class="num">${counts[s] || 0}</b></button>`).join("");
  const bar = $("#match-bar");
  if (M.match) {
    const c = M.match;
    bar.innerHTML = `<span><b>${esc(c.name)}</b> 조건 (${eok(c.budget_max)} 이하, ${c.area_min ?? "-"}㎡ 이상, 역 ${c.station_walk_max ?? "-"}분): 맞는 매물 ${M.matchIds.size}건 표시</span>
      <button type="button" class="btn btn--sm" data-act="clear-match">해제</button>`;
    bar.hidden = false;
  } else if (M.ask) {
    const n = M.ask.result.listings.length;
    bar.innerHTML = `<span>질문 결과: ${n ? `${M.ask.result.relaxed ? "조건에 가까운" : "맞는"} 매물 <b class="num">${n}</b>건 강조` : "맞는 매물 없음"}</span>
      <button type="button" class="btn btn--sm" data-act="clear-ask">해제</button>`;
    bar.hidden = false;
  } else bar.hidden = true;
}

function pinHtml(l) {
  const n = stageIdx(l.stage) + 1;
  const cls = ["pin", !l.mine && "is-other", M.matchIds && (M.matchIds.has(l.id) ? "is-match" : "is-dim"), M.detailId === l.id && "is-sel"].filter(Boolean).join(" ");
  return `<div class="${cls}" data-s="${esc(l.stage)}" data-id="${l.id}" style="--c:${STAGE_COLOR[l.stage]}" role="button" tabindex="0"
      aria-label="${esc(l.label)} ${esc(l.title)} ${eok(l.price)} ${esc(STAGE_LABEL[l.stage])}">
    ${l.mine ? "" : `<span class="pa" title="담당 ${esc(l.agent_name)}">${esc((l.agent_name || "?")[0])}</span>`}
    <span>${esc(l.label)} ${eok(l.price)}</span><span class="pp">${STAGES.map((_, i) => `<i class="${i < n ? "on" : ""}"></i>`).join("")}</span>
    ${l.active_deals ? `<span class="pc">${l.active_deals}</span>` : ""}</div>`;
}

/* 맞는 매물이 하나도 없으면 강조하지 않는다 (모든 핀이 흐려져 지도가 빈 것처럼 보이지 않도록) */
function askMatchIds() {
  const ids = M.ask ? M.ask.result.listings.map((l) => l.id) : [];
  return ids.length ? new Set(ids) : null;
}

/* 질문한 지역: 반경 원과 이름표. 지역에 맞는 매물이 없어도 지도가 그 지역으로 간다 */
function drawPlace() {
  if (M.placeLayer) { M.placeLayer.remove(); M.placeLayer = null; }
  const p = M.ask && M.ask.result.place;
  if (!p || !M.map) return null;
  M.placeLayer = L.layerGroup().addTo(M.map);
  const n = M.ask.result.listings.length;
  const label = `${p.name}${p.radius_m ? ` 반경 ${p.radius_m / 1000}km` : ""} · ${n ? `맞는 매물 ${n}건` : "등록된 매물 없음"}`;
  let bounds = L.latLngBounds([[p.lat, p.lng]]);
  if (p.radius_m) {
    const c = L.circle([p.lat, p.lng], { radius: p.radius_m, color: "#1b6c80", weight: 1.5, dashArray: "4 4", fillColor: "#1b6c80", fillOpacity: 0.06, interactive: false });
    c.addTo(M.placeLayer);
    bounds = c.getBounds();
  }
  L.marker([p.lat, p.lng], { interactive: false, keyboard: false,
    icon: L.divIcon({ className: "pin-wrap", html: `<div class="place-tag">${esc(label)}</div>`, iconSize: [0, 0] }) }).addTo(M.placeLayer);
  return bounds;
}

function renderPins() {
  if (!M.map) return;
  Object.values(M.markers).forEach((m) => m.remove());
  M.markers = {};
  const ls = visibleListings().filter((l) => l.lat && l.lng);
  ls.forEach((l) => {
    const m = L.marker([l.lat, l.lng], {
      icon: L.divIcon({ className: "pin-wrap", html: pinHtml(l), iconSize: [0, 0] }),
      zIndexOffset: M.detailId === l.id ? 1000 : stageIdx(l.stage) * 10, title: `${l.label} ${l.title}`,
    }).addTo(M.map);
    m.on("click", () => { if (!M.pick) location.hash = `#/map/l/${l.id}`; });
    M.markers[l.id] = m;
  });
  const key = `${M.scope}|${M.match ? M.match.id : ""}|${M.ask ? M.ask.key : ""}`;
  const placeBounds = drawPlace();
  const focus = M.matchIds && M.matchIds.size ? ls.filter((l) => M.matchIds.has(l.id)) : ls;  // 강조된 매물이 있으면 그 매물에 맞춘다
  if (M.fittedFor !== key && (focus.length || placeBounds)) {
    M.fittedFor = key;
    // 질문한 지역이 있으면 그 지역(과 맞는 매물)에, 없으면 매물에 맞춘다
    let b = placeBounds && !(M.matchIds && M.matchIds.size) ? placeBounds : L.latLngBounds(focus.map((l) => [l.lat, l.lng]));
    if (placeBounds && M.matchIds && M.matchIds.size) b = b.extend(placeBounds);
    // 처음 맞출 때는 애니메이션 없이 — 지도가 움직이는 동안 핀 클릭이 빗나가지 않도록
    M.map.fitBounds(b.pad(0.2), { animate: false, maxZoom: placeBounds && !focus.length ? 13 : 16 });
  }
}

function renderList() {
  const ls = visibleListings().sort((a, b) => stageIdx(b.stage) - stageIdx(a.stage) || a.price - b.price);
  const title = M.match ? `${M.match.name} 고객 조건` : M.scope === "mine" ? "내 매물" : "사무소 매물";
  $("#map-side").innerHTML = `
    <div class="side-h"><h1>${esc(title)} <span class="muted num">${ls.length}</span></h1>
      <button type="button" class="btn btn--sm" data-act="register">매물 등록</button></div>
    <table class="tbl"><thead><tr><th></th><th>매물</th><th class="r">가격</th><th>단계</th><th>고객</th></tr></thead><tbody>
    ${ls.map((l) => `<tr class="lrow clickable ${l.mine ? "" : "is-other"}" style="--c:${l.stage === "available" ? "var(--line)" : STAGE_COLOR[l.stage]}"
        data-act="open" data-id="${l.id}" tabindex="0">
      <td></td><td><b>${esc(l.label)}</b> ${esc(l.title)}${l.mine ? "" : `<br><span class="muted">담당 ${esc(l.agent_name)}</span>`}</td>
      <td class="r num">${eok(l.price)}</td><td>${stageTag(l.stage)}</td><td class="num">${l.active_deals || "-"}</td></tr>`).join("")
      || `<tr><td colspan="5" class="empty">표시할 매물이 없습니다.</td></tr>`}
    </tbody></table>`;
}

const canChange = (d) => S.user.role === "admin" || [d.agent_id, d.listing.agent_id].includes(S.user.id);

function dealBox(d) {
  if (d.stage === "dropped") {
    return `<div class="deal is-dropped" style="--c:${STAGE_COLOR.dropped}"><div class="deal-top"><a href="#/customers/${d.customer_id}">${esc(d.customer_name)}</a>
      <span class="muted">담당 ${esc(d.agent_name)}</span>${stageTag("dropped")}</div><div class="next">사유: ${esc(d.dropped_reason || "-")}</div></div>`;
  }
  const i = stageIdx(d.stage), can = canChange(d);
  const why = can ? "" : ` title="거래 담당·매물 담당 중개사나 관리자만 바꿀 수 있습니다"`;
  return `<div class="deal" style="--c:${STAGE_COLOR[d.stage]}">
    <div class="deal-top"><a href="#/customers/${d.customer_id}">${esc(d.customer_name)}</a>
      <span class="muted">담당 ${esc(d.agent_name)} · ${d.days_in_stage}일째</span>${stageTag(d.stage)}</div>
    <div class="next">다음: <b>${esc(d.next_action || "-")}</b></div>
    <div class="acts">
      <button type="button" class="btn btn--sm" data-act="prev" data-id="${d.id}" data-stage="${d.stage}" ${i <= 0 || !can ? "disabled" : ""}${why}>이전 단계</button>
      <button type="button" class="btn btn--sm btn--main" data-act="next" data-id="${d.id}" data-stage="${d.stage}" ${i >= 4 || !can ? "disabled" : ""}${why}>${i < 4 ? `${STAGE_LABEL[STAGES[i + 1]]}(으)로` : "완료"}</button>
      <button type="button" class="btn btn--sm" data-act="drop" data-id="${d.id}" ${can ? "" : "disabled"}${why}>무산</button>
    </div></div>`;
}

async function renderDetail(id) {
  M.detailId = id;
  renderPins();
  const side = $("#map-side");
  if (!side.querySelector(`.detail[data-id="${id}"]`)) side.innerHTML = `<p class="loading">불러오는 중…</p>`;
  let r;
  try { r = await api("GET", `/listings/${id}`); }
  catch (e) { toast(e.message); location.hash = "#/map"; return; }
  if (M.detailId !== id) return;
  const l = r.listing, n = stageIdx(l.stage) + 1;
  if (M.map && l.lat) M.map.panTo([l.lat, l.lng]);
  const done = r.checks.filter((c) => c.checked).length;
  const own = l.mine || S.user.role === "admin";
  const deals = r.deals.slice().sort((a, b) => (a.stage === "dropped") - (b.stage === "dropped") || stageIdx(b.stage) - stageIdx(a.stage));
  const tr = r.trade_reference;
  const hist = l.price_history.length > 1 ? l.price_history.map((h) => eok(h.price)).join("→") + ` (${day(l.price_history.at(-1).changed_at)})` : "";
  side.innerHTML = `
    <div class="detail" data-id="${l.id}">
      <div class="detail-top"><button type="button" class="btn btn--sm" data-act="back">${M.ask ? "질문 결과" : "목록"}</button>${stageTag(l.stage)}</div>
      <h2 id="listing-detail-title">${esc(l.label)} ${esc(l.title)}</h2>
      <div class="price num">${eok(l.price)}${hist ? ` <span class="muted" style="font-size:12px;font-weight:400">${esc(hist)}</span>` : ""}</div>
      ${prog(l.stage, true)}<div class="prog-labels">${STAGES.map((s, i) => `<span class="${i === n - 1 ? "cur" : ""}">${STAGE_LABEL[s]}</span>`).join("")}</div>

      <div class="sec"><div class="sec-h"><h2>거래</h2><span class="muted">진행 ${l.active_deals}건</span></div>
        ${deals.map(dealBox).join("") || `<p class="empty">연결된 고객이 없습니다.</p>`}
        <p style="margin:8px 0 0"><button type="button" class="btn btn--sm" data-act="link" data-id="${l.id}">고객 연결</button></p>
      </div>

      <div class="sec"><div class="sec-h"><h2>확인할 사항</h2><span class="muted">${done}/${r.checks.length} 확인</span></div>
        <ul class="checks">${r.checks.map((c) => `<li class="${c.level === "urgent" ? "bad" : c.level === "warn" ? "warn" : ""}">
          <input type="checkbox" id="ck-${esc(c.key)}" data-check="${esc(c.key)}" data-key="${esc(c.key)}" data-id="${l.id}" ${c.checked ? "checked" : ""} />
          <label class="txt" for="ck-${esc(c.key)}">${esc(c.text)}</label>
          <span class="src">${c.sources.length ? `출처: ${c.sources.map((s) => srcLink(s)).join(", ")}` : "출처 없음"}</span>
          ${c.checked ? `<span class="by">${esc(c.checked_by)} 확인 · ${dateTime(c.checked_at)}</span>` : ""}</li>`).join("")}</ul>
      </div>

      <div class="sec"><div class="sec-h"><h2>현장 메모</h2><span class="muted">질문 검색에 함께 쓰입니다</span></div>
        <ul class="notes">${r.notes.map((nt) => `<li>${esc(nt.text)}<span class="by">${esc(nt.by)} · ${dateTime(nt.created_at)}${
          nt.user_id === S.user.id || S.user.role === "admin" ? `<button type="button" data-act="del-note" data-id="${l.id}" data-note="${nt.id}">지우기</button>` : ""}</span></li>`).join("")
          || `<li class="muted">아직 메모가 없습니다.</li>`}</ul>
        <form class="note-form" id="note-form" data-id="${l.id}">
          <textarea name="text" rows="2" maxlength="1000" placeholder="예: 남향, 밤에 조용함, 주차 여유" aria-label="현장 메모"></textarea>
          <button type="submit" class="btn btn--sm">남기기</button></form>
      </div>

      <div class="sec"><div class="sec-h"><h2>매물 정보</h2><span class="muted">담당 ${esc(l.agent_name)}</span></div>
        <dl class="kv">
          <dt>전용면적</dt><dd class="num">${l.area_m2}㎡</dd><dt>층</dt><dd>${esc(l.floor || "-")}</dd>
          <dt>주소</dt><dd>${esc(l.address)}</dd>
          <dt>교통</dt><dd>${l.station ? `${esc(l.station)} 도보 ${l.station_walk_min ?? "-"}분` : "-"}</dd><dt>공원</dt><dd>${l.park_walk_min != null ? `도보 ${l.park_walk_min}분` : "-"}</dd>
          <dt>실거래</dt><dd>${tr ? `중위 ${eok(tr.median_price)} (${tr.count}건, ${esc(tr.period)})<br><span class="muted">과거 신고 거래 · 현재 호가 아님 · ${esc(tr.source)}</span>` : "자료 없음"}</dd>
          <dt>출처</dt><dd>${esc(l.source)} · ${esc(l.source_date)}</dd>
          ${l.description ? `<dt>메모</dt><dd>${esc(l.description)}</dd>` : ""}
        </dl>
        ${own ? `<div class="detail-acts"><button type="button" class="btn btn--sm" data-act="edit-listing" data-id="${l.id}">수정</button>
          <button type="button" class="btn btn--sm" id="listing-close-btn" data-act="close-listing" data-id="${l.id}">거래 종료</button></div>` : ""}
      </div>
    </div>`;
  M.current = l;
}

// ── 거래 단계 ─────────────────────────────────────────
async function changeStage(btn, dealId, stage, reason) {
  const r = await busy(btn, () => api("POST", `/deals/${dealId}/stage`, { stage, reason }));
  if (!r) return;
  toast(r.warnings.length ? `${STAGE_LABEL[stage]}(으)로 바꿨습니다. ${r.warnings.join(" ")}` : `${r.deal.customer_name} · ${r.deal.listing.label}: ${STAGE_LABEL[stage]}`, 4200);
  route();
}
ACTIONS.next = (el) => changeStage(el, el.dataset.id, STAGES[stageIdx(el.dataset.stage) + 1]);
ACTIONS.prev = (el) => changeStage(el, el.dataset.id, STAGES[stageIdx(el.dataset.stage) - 1]);
ACTIONS.drop = (el) => openDialog(`<h2>무산 처리</h2><label>사유<input id="drop-reason" value="고객 의사 변경" maxlength="200" /></label>
  <div class="btns"><button type="button" class="btn" data-act="close-dialog">취소</button>
  <button type="button" class="btn btn--main" data-act="drop-ok" data-id="${esc(el.dataset.id)}">무산 처리</button></div>`);
ACTIONS["drop-ok"] = (el) => changeStage(el, el.dataset.id, "dropped", $("#drop-reason").value.trim());
ACTIONS["close-dialog"] = closeDialog;

ACTIONS.open = (el) => { location.hash = `#/map/l/${el.dataset.id}`; };
ACTIONS.back = () => { location.hash = M.ask ? askHash(M.ask.q) : M.match ? `#/map/match/${M.match.id}` : "#/map"; };
ACTIONS.filter = (el) => {
  const s = el.dataset.s;
  M.hidden.has(s) ? M.hidden.delete(s) : M.hidden.add(s);
  renderFilter();
  renderPins();
  if (!M.detailId) renderList();
};
ACTIONS["clear-match"] = () => { location.hash = "#/map"; };

function setMapScope(scope, reload = true) {
  M.scope = scope;
  document.querySelectorAll("#view-map [data-scope]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.scope === scope)));
  if (reload) loadListings().then(() => { if (!M.detailId) renderList(); });
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("#view-map [data-scope]");
  if (b) setMapScope(b.dataset.scope);
});

// 확인할 사항 체크
document.addEventListener("change", async (e) => {
  const el = e.target.closest("input[data-check]");
  if (!el) return;
  el.disabled = true;
  try {
    await api("PUT", `/listings/${el.dataset.id}/checks/${el.dataset.check}`, { checked: el.checked });
    await renderDetail(Number(el.dataset.id));
  } catch (ex) { el.checked = !el.checked; toast(ex.message); }
  finally { el.disabled = false; }
});

// 현장 메모
document.addEventListener("submit", async (e) => {
  const form = e.target.closest("#note-form");
  if (!form) return;
  e.preventDefault();
  const text = form.text.value.trim();
  if (!text) { form.text.focus(); return; }
  const r = await busy(form.querySelector("button"), () => api("POST", `/listings/${form.dataset.id}/notes`, { text }));
  if (r) { if (M.ask) M.ask.key += "*"; toast("메모를 남겼습니다."); renderDetail(Number(form.dataset.id)); }  // 다음 질문 결과는 새로 찾는다
});
ACTIONS["del-note"] = async (el) => {
  if (!confirm("이 메모를 지울까요?")) return;
  const r = await busy(el, () => api("DELETE", `/listings/${el.dataset.id}/notes/${el.dataset.note}`));
  if (r) renderDetail(Number(el.dataset.id));
};

// 고객 연결
ACTIONS.link = async (el) => {
  const id = Number(el.dataset.id);
  const [cs, detail] = await Promise.all([api("GET", "/customers"), api("GET", `/listings/${id}`)]).catch((e) => { toast(e.message); return []; });
  if (!cs) return;
  const linked = new Set(detail.deals.map((d) => d.customer_id));
  const opts = cs.filter((c) => !linked.has(c.id));
  openDialog(`<h2>${esc(detail.listing.label)} ${esc(detail.listing.title)} · 고객 연결</h2>
    <label>고객<select id="link-customer">${opts.map((c) => `<option value="${c.id}">${esc(c.name)} (담당 ${esc(c.agent_name)})</option>`).join("")}</select></label>
    <label>다음 할 일<input id="link-next" value="매물 소개" maxlength="200" /></label>
    <div class="btns"><button type="button" class="btn" data-act="close-dialog">취소</button>
    <button type="button" class="btn btn--main" data-act="link-ok" data-id="${id}" ${opts.length ? "" : "disabled"}>연결 (소개 단계)</button></div>`);
};
ACTIONS["link-ok"] = async (el) => {
  const r = await busy(el, () => api("POST", "/deals", { listing_id: Number(el.dataset.id), customer_id: Number($("#link-customer").value), next_action: $("#link-next").value.trim() || null }));
  if (r) { closeDialog(); toast(`${r.customer_name} 고객을 연결했습니다.`); route(); }
};

// ── 매물 등록·수정·종료 ─────────────────────────────────────────
const FIELDS = [
  ["title", "매물 이름", "text", true], ["complex_name", "단지명", "text", true], ["address", "주소", "text", true],
  ["district", "구", "text", true], ["price", "매도 희망가 (만원)", "number", true], ["area_m2", "전용면적 (㎡)", "number", true],
  ["floor", "층", "text"], ["station", "가까운 역", "text"], ["station_walk_min", "역 도보 (분)", "number"],
  ["park_walk_min", "공원 도보 (분)", "number"], ["lat", "위도", "number", true], ["lng", "경도", "number", true],
];

function listingForm(l) {
  const v = (k, d = "") => esc(l ? l[k] ?? d : d);
  const input = ([k, label, type, req]) => `<label>${label}${req ? " *" : ""}<input name="${k}" type="${type}" ${type === "number" ? 'step="any"' : ""}
    value="${k === "district" && !l ? "마포구" : v(k)}" ${req ? "required" : ""} /><span class="field-error" data-err="${k}"></span></label>`;
  $("#map-side").innerHTML = `
    <form id="listing-form" class="form" data-id="${l ? l.id : ""}" novalidate>
      <div class="detail-top"><h2>${l ? "매물 수정" : "매물 등록"}</h2><button type="button" class="btn btn--sm" data-act="cancel-form">취소</button></div>
      ${FIELDS.slice(0, 4).map(input).join("")}
      <div class="row2">${FIELDS.slice(4, 6).map(input).join("")}</div>
      <div class="row2">${FIELDS.slice(6, 8).map(input).join("")}</div>
      <div class="row2">${FIELDS.slice(8, 10).map(input).join("")}</div>
      <p class="muted" style="margin:0">위치: 지도를 누르면 아래 좌표가 채워집니다.</p>
      <div class="row2">${FIELDS.slice(10).map(input).join("")}</div>
      <label>메모<textarea name="description" rows="3">${v("description")}</textarea></label>
      <div class="btns"><button type="submit" class="btn btn--main">${l ? "저장" : "등록"}</button></div>
    </form>`;
  M.pick = true;
  $("#pick-bar").hidden = false;
  if (l && l.lat) placeTemp(l.lat, l.lng);
}

function placeTemp(lat, lng) {
  const form = $("#listing-form");
  if (!form) return;
  form.lat.value = lat.toFixed(6);
  form.lng.value = lng.toFixed(6);
  if (!M.map) return;
  if (M.temp) M.temp.setLatLng([lat, lng]);
  else {
    M.temp = L.marker([lat, lng], { draggable: true, icon: L.divIcon({ className: "pin-wrap", html: '<div class="temp-pin"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }) }).addTo(M.map);
    M.temp.on("dragend", () => { const p = M.temp.getLatLng(); placeTemp(p.lat, p.lng); });
  }
}

function endPick() {
  M.pick = false;
  $("#pick-bar").hidden = true;
  if (M.temp) { M.temp.remove(); M.temp = null; }
}
addEventListener("hashchange", endPick);
// 지도 밖 화면으로 가면 질문 결과를 잊는다 (다른 화면에서 매물을 열었을 때 이전 질문으로 돌아가지 않도록)
addEventListener("hashchange", () => { if (!location.hash.startsWith("#/map")) M.ask = null; });

ACTIONS.register = () => listingForm(null);
ACTIONS["edit-listing"] = () => listingForm(M.current);
ACTIONS["cancel-form"] = () => { const id = $("#listing-form").dataset.id; endPick(); id ? renderDetail(Number(id)) : renderList(); };
ACTIONS["close-listing"] = async (el) => {
  if (!confirm("이 매물을 거래 종료로 바꿀까요? 지도와 목록에서 빠집니다.")) return;
  const r = await busy(el, () => api("POST", `/listings/${el.dataset.id}/close`));
  if (r) { toast(`${r.label} ${r.title}: 거래 종료`); location.hash = "#/map"; }
};

document.addEventListener("submit", async (e) => {
  const form = e.target.closest("#listing-form");
  if (!form) return;
  e.preventDefault();
  form.querySelectorAll("[data-err]").forEach((s) => { s.textContent = ""; });
  const body = {};
  [...FIELDS.map((f) => f[0]), "description"].forEach((k) => {
    const raw = form[k].value.trim();
    const num = FIELDS.find((f) => f[0] === k)?.[2] === "number";
    body[k] = raw === "" ? null : num ? Number(raw) : raw;
  });
  const id = form.dataset.id;
  const btn = form.querySelector("[type=submit]");
  btn.disabled = true;
  try {
    const l = await api(id ? "PUT" : "POST", id ? `/listings/${id}` : "/listings", body);
    endPick();
    toast(id ? "매물을 고쳤습니다." : `${l.label} ${l.title} 등록했습니다.`);
    if (location.hash === `#/map/l/${l.id}`) route(); else location.hash = `#/map/l/${l.id}`;
  } catch (ex) {
    Object.entries(ex.fields || {}).forEach(([k, msg]) => { const s = form.querySelector(`[data-err="${k}"]`); if (s) s.textContent = msg; });
    toast(ex.message, 4200);
  } finally { btn.disabled = false; }
});
