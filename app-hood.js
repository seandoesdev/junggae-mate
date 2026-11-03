"use strict";
/* Hood AI: 전용 화면(#/ai: 채팅·보고서·사용량·설정)과 어느 화면에서든 여는 오른쪽 Ask Hood 패널(시계로 이전 대화).
   질문 하나는 /api/search가 답하고 대화(세션)에 쌓인다. 전용 화면과 패널은 각자의 대화를 가진다:
   상단 Hood AI를 누르면 늘 새 대화로 시작하고, 패널에서 하던 대화는 패널에 남는다. 둘 다 '이전 대화' 목록에 쌓인다. */

const H = { sessions: [], panel: false, panelView: "thread", maps: [], page: null };
const blankConv = () => ({ sid: null, title: "", turns: [], pending: null });
// main: 전용 화면의 대화, side: Ask Hood 패널의 대화. 새 대화는 객체를 바꿔 끼워, 늦게 온 이전 답이 새 대화에 섞이지 않게 한다
const CONV = { main: blankConv(), side: blankConv() };
const convOf = (el) => (el.closest("#hood-panel") ? CONV.side : CONV.main);
const TYPE_NAME = { data: "매물·실거래가", law: "법령", policy: "정책", office: "사무소 자료", news: "기사" };
const ROUTE_NAME = { listing: "매물", trade: "매매 실거래가", rent: "전월세 실거래가", complex: "단지(K-apt)", building: "건축물대장", station: "지하철 노선", document: "법령·정책·자료" };
const STATE_NAME = { draft: "작성 중", review: "검토 중", approved: "승인", shared: "전달됨" };

const when = (iso) => {
  if (!iso) return "";
  const d = new Date(iso), now = new Date();
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;  // taste-skill-ignore: 시각 표시
  if (d.toDateString() === now.toDateString()) return `오늘 ${hm}`;
  if (new Date(now - 864e5).toDateString() === d.toDateString()) return `어제 ${hm}`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

// ── 대화 ─────────────────────────────────────────
async function loadSessions() {
  try { H.sessions = await api("GET", "/ai/sessions"); } catch { H.sessions = []; }
  renderHistory();
}
async function loadConv(id) {
  const s = await api("GET", `/ai/sessions/${id}`);
  return { sid: s.id, title: s.title, turns: s.messages, pending: null };
}

async function hoodAsk(conv, q, { drop = [], replace = false, news = H.news !== false } = {}) {
  if (conv.pending) return;
  conv.pending = replace ? null : q;
  renderAll();
  try {
    const r = await api("POST", "/search", { q, drop, session_id: conv.sid || undefined, exclude_types: news ? [] : ["news"] });
    const i = conv.turns.findIndex((t) => t.message_id === r.message_id);
    if (i >= 0) conv.turns[i] = r; else conv.turns.push(r);
    if (!conv.sid) conv.title = q;
    conv.sid = r.session_id;
  } catch (e) { toast(e.message, 4800); }
  finally { conv.pending = null; }
  renderAll();
  loadSessions();
  if (conv === CONV.main && S.view === "ai" && H.page === "search" && conv.sid && location.hash !== `#/ai/s/${conv.sid}`) {
    history.replaceState(null, "", `#/ai/s/${conv.sid}`);
  }
}

// ── 답변 한 칸 ─────────────────────────────────────────
function turnHtml(t, idx, compact) {
  const order = [];
  const opinion = withNotes(t.opinion, t.sources, order);
  const checks = t.to_check.map((x) => `<li>${withNotes(x, t.sources, order)}</li>`).join("");
  const byId = Object.fromEntries(t.sources.map((s) => [s.id, s]));
  const foot = order.map((id) => byId[id]).filter(Boolean);
  const ls = compact ? t.listings.slice(0, 5) : t.listings;
  const dropAll = t.understood.length ? `<button type="button" class="btn btn--sm" data-act="hood-drop-all" data-i="${idx}">조건 빼고 사무소 매물 보기</button>` : "";
  const place = t.understood.find((c) => c.key === "place" || c.key === "district");
  const listBlock = t.listing_intent || t.listings.length ? `
    <section class="turn-sec">
      <h3>${t.relaxed ? "조건에 가까운 매물" : "맞는 매물"} <span class="muted num">${t.listings.length}</span></h3>
      ${!compact && (t.listings.length || t.place) ? `<div class="turn-map" data-i="${idx}" role="img" aria-label="맞는 매물 지도"></div>` : ""}
      ${ls.length ? `<ul class="turn-list">${ls.map((l) => `
        <li><a href="#/map/l/${l.id}" style="--c:${l.stage === "available" ? "var(--line)" : STAGE_COLOR[l.stage]}">
          <span class="tl-name"><b>${esc(l.label)}</b> ${esc(l.title)}</span><span class="tl-price num">${eok(l.price)}</span>
          <span class="tl-why">${[...l.matched.map((m) => `${esc(m.want)}: ${esc(m.text)}`), ...l.unmet.map((u) => `차이: ${esc(u)}`)].join(" · ") || `${esc(l.district)} · 전용 ${l.area_m2}㎡ · ${esc(STAGE_LABEL[l.stage])}`}</span>
        </a></li>`).join("")}</ul>
        ${compact && t.listings.length > ls.length ? `<p class="muted turn-more">외 ${t.listings.length - ls.length}건은 지도에서 볼 수 있습니다.</p>` : ""}`
      : `<p class="turn-empty">${place ? `${esc(place.label)} 안에 등록된 매물이 없습니다.` : "맞는 매물이 없습니다."} ${dropAll}</p>`}
    </section>` : "";
  return `
  <article class="turn" data-i="${idx}">
    <p class="turn-q">${esc(t.question)}</p>
    ${t.effective_query && t.effective_query !== t.question ? `<p class="turn-ctx">이어서 찾은 조건: ${esc(t.effective_query)}</p>` : ""}
    ${t.understood.length || (t.dropped || []).length ? `<div class="understood">
      ${t.understood.map((c) => `<button type="button" class="cond" data-act="hood-drop" data-i="${idx}" data-key="${esc(c.key)}" title="이 조건을 빼고 다시 찾기">${esc(c.label)}<b aria-hidden="true">×</b></button>`).join("")}
      ${(t.dropped || []).length ? `<button type="button" class="btn btn--sm" data-act="hood-undrop" data-i="${idx}">뺀 조건 되돌리기</button>` : ""}</div>` : ""}
    ${listBlock}
    <section class="turn-sec">
      <h3>답변</h3>
      <p class="opinion">${opinion}</p>
      ${checks ? `<h4>추가로 확인할 사항</h4><ul class="tocheck">${checks}</ul>` : ""}
      ${foot.length ? `<ol class="foot-list">${foot.map((s) => `<li>${srcLink(s)} <span class="muted">${esc(s.date)}</span></li>`).join("")}</ol>` : ""}
    </section>
    <div class="turn-acts">
      <button type="button" class="btn btn--sm" data-act="hood-map" data-i="${idx}">지도에서 보기</button>
      <button type="button" class="btn btn--sm" data-act="ask-report" data-q="${esc(t.effective_query || t.question)}" data-drop="${esc(JSON.stringify(t.dropped || []))}">고객 자료로 만들기</button>
      <span class="muted turn-time">${when(t.asked_at)}</span>
    </div>
  </article>`;
}

const pendingHtml = (conv) => (conv.pending ? `<article class="turn is-pending"><p class="turn-q">${esc(conv.pending)}</p><p class="loading" style="padding:8px 0">매물·실거래가·법령·정책·자료를 찾는 중…</p></article>` : "");
const threadHtml = (conv, compact) => conv.turns.map((t, i) => turnHtml(t, i, compact)).join("") + pendingHtml(conv);

/* 답변 안의 작은 지도: 맞는 매물과 질문한 지역 */
function drawTurnMaps(root) {
  H.maps.forEach((m) => m.remove());
  H.maps = [];
  if (typeof window.L === "undefined") return;
  root.querySelectorAll(".turn-map").forEach((el) => {
    const t = CONV.main.turns[Number(el.dataset.i)];
    // 만들자마자 위치를 정해 둔다 (위치가 없는 지도에는 도형이 바로 붙지 않아 범위 계산이 실패한다)
    const map = L.map(el, { zoomControl: false, scrollWheelZoom: false, attributionControl: false })
      .setView(t.place ? [t.place.lat, t.place.lng] : [37.547, 126.951], 13);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
    const pts = [];
    if (t.place) {
      if (t.place.radius_m) {
        L.circle([t.place.lat, t.place.lng], { radius: t.place.radius_m, color: "#1b6c80", weight: 1.5, dashArray: "4 4", fillOpacity: 0.06, interactive: false }).addTo(map);
        const box = L.latLng(t.place.lat, t.place.lng).toBounds(t.place.radius_m * 2);
        pts.push(box.getSouthWest(), box.getNorthEast());
      } else pts.push(L.latLng(t.place.lat, t.place.lng));
      if (!t.listings.length) {
        L.marker([t.place.lat, t.place.lng], { interactive: false, icon: L.divIcon({ className: "pin-wrap", html: `<div class="place-tag">${esc(t.place.name)} · 등록된 매물 없음</div>`, iconSize: [0, 0] }) }).addTo(map);
      }
    }
    const ls = t.listings.filter((l) => l.lat && l.lng);
    ls.forEach((l) => {
      L.marker([l.lat, l.lng], { icon: L.divIcon({ className: "pin-wrap", iconSize: [0, 0],
        html: `<div class="pin" data-s="${esc(l.stage)}" style="--c:${STAGE_COLOR[l.stage]}"><span>${esc(l.label)} ${eok(l.price)}</span></div>` }) })
        .on("click", () => { location.hash = `#/map/l/${l.id}`; }).addTo(map);
    });
    // 매물이 있으면 매물에 맞추고(질문한 지역 반경 포함), 없으면 질문한 지역에 맞춘다
    const all = ls.length ? [...ls.map((l) => L.latLng(l.lat, l.lng)), ...(t.place && t.place.radius_m ? pts : [])] : pts;
    if (all.length) map.fitBounds(L.latLngBounds(all).pad(0.25), { animate: false, maxZoom: ls.length ? 15 : 12 });
    H.maps.push(map);
  });
}

// ── 그리기 ─────────────────────────────────────────
function renderAll() {
  if (S.view === "ai" && H.page === "search") renderSearchPage();
  if (H.panel) renderPanel();
}

const CLIP_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m20.5 11.5-8.2 8.2a5 5 0 0 1-7.1-7.1l8.6-8.6a3.4 3.4 0 0 1 4.8 4.8l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9"/></svg>`;
const SEND_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>`;
const SPARK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l1.9 5.2 5.1 1.9-5.1 1.9L12 17.7l-1.9-5.2L5 10.6l5.1-1.9z"/></svg>`;

/* 입력창: 여러 줄 질문 + 아래 줄에 '자료 추가'(Hood가 근거로 쓸 사무소 자료), '기사 포함' 토글, 보내기 */
function composer(id, placeholder, size = "", conv = CONV.main) {
  return `<form class="composer ${size}" id="${id}" autocomplete="off">
    <textarea rows="${size === "composer--lg" ? 3 : 1}" maxlength="500" aria-label="Hood에게 질문" placeholder="${esc(placeholder)}"></textarea>
    <div class="composer-bar">
      <button type="button" class="icon-btn" data-act="add-doc" aria-label="자료 추가 (Hood가 근거로 쓸 사무소 자료)" title="자료 추가">${CLIP_ICON}</button>
      <label class="composer-toggle"><input type="checkbox" name="news" ${H.news === false ? "" : "checked"} /><span class="track" aria-hidden="true"></span>기사 포함</label>
      <button type="submit" class="composer-send" aria-label="보내기" ${conv.pending ? "disabled" : ""}>${SEND_ICON}</button>
    </div></form>`;
}

/* 다시 그려도 입력하던 질문은 남긴다 */
function keepDraft(root, sel, render) {
  const draft = root.querySelector(sel)?.value || "";
  render();
  const ta = root.querySelector(sel);
  if (ta && draft) ta.value = draft;
}

function renderSearchPage() {
  const main = $("#ai-main");
  keepDraft(main, "#ai-form textarea", () => drawSearchPage(main));
}

function drawSearchPage(main) {
  const c = CONV.main;
  main.classList.toggle("is-thread", c.turns.length > 0 || !!c.pending);
  if (!c.turns.length && !c.pending) {
    H.maps.forEach((m) => m.remove());
    H.maps = [];
    main.innerHTML = `
      <div class="ai-start">
        <p class="hood-kicker">${SPARK_ICON}<span>Hood Chat</span><b class="hood-new">NEW</b></p>
        <h1 class="hood-hello">안녕하세요, <span>${esc(S.user.name)}</span></h1>
        ${composer("ai-form", "매물·실거래가·전월세·법령을 물어보세요", "composer--lg")}
        <p class="ai-sub">매물·현장 메모, 매매·전월세 실거래가, 단지·건축물·지하철 공공데이터, 법령·정책, 사무소 자료, 기사에서 찾아 문장마다 출처를 붙입니다.</p>
        <ul class="ai-examples">${ASK_EXAMPLES.map((q) => `<li><button type="button" class="ask-pick" data-act="hood-example" data-q="${esc(q)}">${PICK_ICON}<span>${esc(q)}</span></button></li>`).join("")}</ul>
        <p class="ai-tip">답을 받은 뒤 <b>그중 7억 이하만</b>처럼 이어서 물으면 앞 조건에 더해 찾습니다.</p>
        ${H.sessions.length ? `<section class="ai-recent"><h2>최근 대화</h2><ul>${H.sessions.slice(0, 4).map((s) => `<li><a href="#/ai/s/${s.id}">
          <span class="h-title">${esc(s.title)}</span><span class="h-meta">${when(s.updated_at)} · 질문 ${s.messages}개</span></a></li>`).join("")}</ul></section>` : ""}
      </div>`;
  } else {
    main.innerHTML = `
      <header class="ai-thread-h"><h1>${esc(c.title || "새 대화")}</h1><span class="muted">질문 ${c.turns.length}개${c.turns.length ? ` · ${when(c.turns.at(-1).asked_at)}` : ""}</span></header>
      <div class="ai-thread" id="ai-thread">${threadHtml(c, false)}</div>
      <div class="ai-dock">${composer("ai-form", "이어서 물어보세요 (예: 그중 7억 이하만)")}</div>`;
    drawTurnMaps(main);
    const th = $("#ai-thread");
    th.scrollTop = th.scrollHeight;
  }
  if (!c.pending) main.querySelector("#ai-form textarea")?.focus({ preventScroll: true });
}

function renderHistory() {
  const items = H.sessions.map((s) => `
    <li class="${s.id === CONV.main.sid ? "is-cur" : ""}"><a href="#/ai/s/${s.id}"><span class="h-title">${esc(s.title)}</span>
      <span class="h-meta">${when(s.updated_at)} · 질문 ${s.messages}개</span></a>
      <button type="button" class="h-del" data-act="hood-del" data-sid="${s.id}" aria-label="${esc(s.title)} 대화 지우기" title="지우기">×</button></li>`).join("");
  const rail = $("#ai-history");
  if (rail) rail.innerHTML = items || `<li class="h-empty">아직 대화가 없습니다.</li>`;
  if (S.view === "ai" && H.page === "search" && !CONV.main.turns.length && !CONV.main.pending && !$(".ai-recent") && H.sessions.length) renderSearchPage();
  if (H.panel && H.panelView === "history") renderPanel();
}

// ── 전용 화면 #/ai ─────────────────────────────────────────
VIEWS.ai = async (a, b) => {
  const page = a === "s" ? "search" : a || "search";
  H.page = page;
  document.querySelectorAll(".ai-nav a").forEach((x) => x.classList.toggle("is-active", x.dataset.ai === page));
  loadSessions();
  if (a === "s" && b && Number(b) !== CONV.main.sid) {
    $("#ai-main").innerHTML = `<p class="loading">대화를 불러오는 중…</p>`;
    try { CONV.main = await loadConv(Number(b)); } catch (e) { toast(e.message); location.hash = "#/ai"; return; }
  } else if (page === "search" && a !== "s") {
    CONV.main = blankConv();   // 상단 Hood AI(#/ai)로 들어오면 늘 새 대화. 하던 대화는 이전 대화 목록에서 다시 연다
  }
  if (page === "search") renderSearchPage();
  else if (page === "reports") renderReports(b);
  else if (page === "usage") renderUsage();
  else if (page === "settings") renderSettings();
  else location.hash = "#/ai";
};

// 질문 보내기 (전용 화면·패널 공통): Enter로 보내고 Shift+Enter는 줄바꿈. 한글 조합 중 Enter는 무시
document.addEventListener("keydown", (e) => {
  const ta = e.target.closest(".composer textarea");
  if (!ta || e.key !== "Enter" || e.shiftKey || e.isComposing || e.keyCode === 229) return;
  e.preventDefault();
  ta.form.requestSubmit();
});
document.addEventListener("input", (e) => {
  const ta = e.target.closest(".composer textarea");
  if (ta) { ta.style.height = "auto"; ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`; }
});
document.addEventListener("submit", (e) => {
  const form = e.target.closest(".composer");
  if (!form) return;
  e.preventDefault();
  const ta = form.querySelector("textarea");
  const q = ta.value.trim();
  if (!q) { ta.focus(); return; }
  const conv = convOf(form);
  if (conv.pending) { toast("앞 질문의 답을 찾는 중입니다. 답이 나온 뒤 보내 주세요."); return; }   // 적은 질문은 지우지 않는다
  ta.value = "";
  ta.style.height = "auto";
  rememberQuestion(q);
  H.news = form.news ? form.news.checked : H.news;
  hoodAsk(conv, q);
});
document.addEventListener("change", (e) => {
  if (e.target.matches(".composer [name=news]")) H.news = e.target.checked;   // 다른 입력창에도 같은 선택을 보여 준다
});

const turnAt = (el) => convOf(el).turns[Number(el.dataset.i)];
ACTIONS["hood-example"] = (el) => { rememberQuestion(el.dataset.q); hoodAsk(convOf(el), el.dataset.q); };
ACTIONS["hood-drop"] = (el) => { const t = turnAt(el); hoodAsk(convOf(el), t.question, { drop: [...(t.dropped || []), el.dataset.key], replace: true }); };
ACTIONS["hood-undrop"] = (el) => hoodAsk(convOf(el), turnAt(el).question, { drop: [], replace: true });
ACTIONS["hood-drop-all"] = (el) => { const t = turnAt(el); hoodAsk(convOf(el), t.question, { drop: [...new Set([...(t.dropped || []), ...t.understood.map((c) => c.key)])], replace: true }); };
ACTIONS["hood-map"] = (el) => {
  // 답변을 그대로 지도 질문 결과로 넘긴다 (다시 묻지 않는다)
  const t = turnAt(el), q = t.effective_query || t.question, drop = t.dropped || [];
  M.ask = { q, drop, key: `${q}|${drop.join(",")}`, result: t };
  location.hash = askHash(q);
};
ACTIONS["hood-new-page"] = () => { CONV.main = blankConv(); renderHistory(); if (location.hash === "#/ai") renderSearchPage(); else location.hash = "#/ai"; };
ACTIONS["hood-del"] = async (el) => {
  if (!confirm("이 대화를 지울까요?")) return;
  const id = Number(el.dataset.sid);
  if (!(await busy(el, () => api("DELETE", `/ai/sessions/${id}`)))) return;
  if (CONV.main.sid === id) { CONV.main = blankConv(); if (S.view === "ai" && H.page === "search") { history.replaceState(null, "", "#/ai"); renderSearchPage(); } }
  if (CONV.side.sid === id) { CONV.side = blankConv(); if (H.panel) renderPanel(); }
  loadSessions();
};

// ── Ask Hood 패널 (오른쪽) ─────────────────────────────────────────
function setPanel(open, view = H.panelView) {
  H.panel = open;
  H.panelView = view;
  const p = $("#hood-panel");
  p.classList.toggle("is-open", open);
  p.setAttribute("aria-hidden", String(!open));
  $("#ask-hood-btn").setAttribute("aria-expanded", String(open));
  if (open) { renderPanel(); if (view === "history") loadSessions(); else setTimeout(() => $("#hood-q").focus(), 150); }
}

function renderPanel() {
  const body = $("#hood-body");
  const c = CONV.side;
  $("#hood-expand").setAttribute("href", c.sid ? `#/ai/s/${c.sid}` : "#/ai");
  document.querySelectorAll('#hood-panel [data-act="hood-history"]').forEach((b) => b.setAttribute("aria-pressed", String(H.panelView === "history")));
  if (H.panelView === "history") {
    body.innerHTML = `<div class="hood-hist"><h3>이전 대화</h3>
      <ul>${H.sessions.map((s) => `<li class="${s.id === c.sid ? "is-cur" : ""}"><button type="button" data-act="hood-load" data-sid="${s.id}">
        <span class="h-title">${esc(s.title)}</span><span class="h-meta">${when(s.updated_at)} · 질문 ${s.messages}개${s.last_question && s.messages > 1 ? ` · 마지막: ${esc(s.last_question)}` : ""}</span></button></li>`).join("")
        || `<li class="h-empty">아직 대화가 없습니다. 아래에 질문을 적어 보세요.</li>`}</ul></div>`;
    return;
  }
  body.innerHTML = c.turns.length || c.pending ? threadHtml(c, true)
    : `<div class="hood-empty"><p class="hood-hello hood-hello--sm">안녕하세요, <span>${esc(S.user.name)}</span></p>
        <p>보고 있는 화면을 떠나지 않고 물어볼 수 있습니다. 답은 이전 대화에 남습니다.</p>
        <ul>${ASK_EXAMPLES.slice(0, 3).map((q) => `<li><button type="button" class="ask-pick" data-act="hood-example" data-q="${esc(q)}">${PICK_ICON}<span>${esc(q)}</span></button></li>`).join("")}</ul></div>`;
  body.scrollTop = body.scrollHeight;
  $("#hood-form .composer-send").disabled = !!c.pending;
  const tg = $("#hood-form [name=news]");
  if (tg) tg.checked = H.news !== false;
}

ACTIONS["hood-toggle"] = () => setPanel(!H.panel, "thread");
ACTIONS["hood-close"] = () => setPanel(false);
ACTIONS["hood-history"] = () => {
  // 패널 안의 시계: 이전 대화 목록과 지금 대화를 오간다
  if (H.panel && H.panelView === "history") setPanel(true, "thread"); else setPanel(true, "history");
};
ACTIONS["hood-new"] = () => { CONV.side = blankConv(); setPanel(true, "thread"); };
ACTIONS["hood-load"] = async (el) => {
  try { CONV.side = await loadConv(Number(el.dataset.sid)); } catch (e) { toast(e.message); return; }
  setPanel(true, "thread");
};
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && H.panel && $("#drawer").hidden && !$("#dialog").open) setPanel(false);
});

// ── 보고서 ─────────────────────────────────────────
function aiLoading(title) {
  const main = $("#ai-main");
  main.classList.remove("is-thread");
  H.maps.forEach((m) => m.remove());
  H.maps = [];
  main.innerHTML = `<div class="ai-page"><header class="title-row"><div><h1>${title}</h1></div></header><p class="loading">불러오는 중…</p></div>`;
  return main;
}

async function renderReports(state) {
  const main = aiLoading("보고서");
  let r;
  try { r = await api("GET", `/reports${state ? `?state=${state}` : ""}`); } catch (e) { toast(e.message); return; }
  if (S.view !== "ai" || H.page !== "reports") return;
  const c = r.counts;
  const tabs = [["", "전체", c.all], ["draft", "작성 중", c.draft], ["review", "검토 중", c.review], ["done", "승인·전달", c.done]];
  const pill = (s) => `<span class="pill pill--${s === "review" ? "warn" : s === "draft" ? "neutral" : "ok"}">${STATE_NAME[s]}</span>`;
  main.innerHTML = `
    <div class="ai-page">
      <header class="title-row"><div><h1>보고서</h1>
        <p class="sub">Hood AI 답변과 비교표로 만든 고객 자료 ${c.all}건${c.review ? ` · 승인을 기다리는 자료 ${c.review}건` : ""}</p></div>
        <a class="btn" href="#/customers">고객 화면에서 새로 만들기</a></header>
      <nav class="tabs" aria-label="상태">${tabs.map(([k, w, n]) => `<a href="#/ai/reports${k ? `/${k}` : ""}" class="${(state || "") === k ? "is-active" : ""}">${w} <span class="num">${n}</span></a>`).join("")}</nav>
      <table class="tbl rtable">
        <thead><tr><th>자료</th><th>고객</th><th>상태</th><th class="r">판</th><th>만든 사람</th><th class="r">만든 날</th><th class="r">링크 열람</th></tr></thead>
        <tbody>${r.items.map((x) => `
          <tr class="clickable" data-act="hood-report" data-id="${x.id}" tabindex="0">
            <td><b>${esc(x.title)}</b><span class="why">${x.kind === "answer" ? esc(x.question || "문의 답변") : "매물 비교표"}</span></td>
            <td>${esc(x.customer_name)}</td><td>${pill(x.state)}</td><td class="r num">${esc(x.version)}</td>
            <td>${esc(x.created_by || "-")}</td><td class="r num">${x.created_at.slice(0, 10)}</td>
            <td class="r num">${x.state === "shared" ? x.share_views : '<span class="muted">-</span>'}</td></tr>`).join("")
          || `<tr><td colspan="7" class="empty">이 상태의 고객 자료가 없습니다. Hood AI 답변 아래의 '고객 자료로 만들기'로 만들 수 있습니다.</td></tr>`}</tbody>
      </table>
    </div>`;
}
ACTIONS["hood-report"] = (el) => { location.hash = `#/report/${el.dataset.id}`; };

// ── 사용량 ─────────────────────────────────────────
function niceMax(v) {
  if (v <= 4) return 4;
  const step = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * step >= v * 1.1) return m * step;
  return 10 * step;
}

/* 일별 질문 막대: 한 색, 각진 막대, 0부터 눈금 5개, 날짜는 이틀 간격 */
function dailyBars(daily) {
  const W = 640, Hh = 250, L0 = 34, B = 24, T = 8;
  const max = niceMax(Math.max(...daily.map((d) => d.count), 0));
  const pw = W - L0 - 8, ph = Hh - B - T, bw = pw / daily.length;
  const y = (v) => T + ph - (v / max) * ph;
  const ticks = [0, 1, 2, 3, 4].map((i) => (max / 4) * i);
  return `<svg viewBox="0 0 ${W} ${Hh}" class="bars" role="img" aria-label="최근 ${daily.length}일 일별 질문 수">
    ${ticks.map((t) => `<line x1="${L0}" x2="${W - 8}" y1="${y(t)}" y2="${y(t)}" class="${t ? "grid" : "base"}"/>
      <text x="${L0 - 8}" y="${y(t) + 4}" class="tick" text-anchor="end">${Number.isInteger(t) ? t : t.toFixed(1)}</text>`).join("")}
    ${daily.map((d, i) => `${d.count ? `<rect x="${L0 + i * bw + bw * 0.18}" y="${y(d.count)}" width="${bw * 0.64}" height="${y(0) - y(d.count)}" class="bar"><title>${d.date} · ${d.count}건</title></rect>` : ""}
      ${(daily.length - 1 - i) % 2 === 0 ? `<text x="${L0 + i * bw + bw / 2}" y="${Hh - 6}" class="tick" text-anchor="middle">${i === daily.length - 1 ? "오늘" : `${+d.date.slice(5, 7)}/${+d.date.slice(8)}`}</text>` : ""}`).join("")}
  </svg>`;
}

async function renderUsage() {
  const main = aiLoading("사용량");
  let u;
  try { u = await api("GET", "/ai/usage"); } catch (e) { toast(e.message); return; }
  if (S.view !== "ai" || H.page !== "usage") return;
  const month = `${+u.month_start.slice(0, 4)}년 ${+u.month_start.slice(5, 7)}월`;
  const lim = u.monthly_limit;
  const maxUser = Math.max(1, ...u.by_user.map((x) => x.count));
  const maxType = Math.max(1, ...u.by_source_type.map((x) => x.count));
  const share = (n) => (u.month_total ? `${Math.round((n / u.month_total) * 100)}%` : "-");
  main.innerHTML = `
    <div class="ai-page">
      <header class="title-row"><div><h1>사용량</h1>
        <p class="sub">${month} 질문 ${u.month_total}건 · ${lim ? `월 한도 ${lim}건 중 ${Math.max(lim - u.month_total, 0)}건 남음` : "월 한도 없음"} · 답변 방식 ${u.llm_answers ? `Claude ${u.llm_answers}건` : "규칙 기반 문장틀"}</p></div>
        <a class="btn" href="#/ai/settings">한도·자료 설정</a></header>
      <div class="kpis">
        <div class="kpi kpi--lead"><span class="k-l">이번 달 질문</span><span class="k-v num">${u.month_total}<small>건</small></span>
          ${lim ? `<span class="meter" aria-label="한도 ${lim}건 중 ${u.month_total}건"><i style="width:${Math.min(100, (u.month_total / lim) * 100)}%"></i></span><span class="k-c">한도 ${lim}건</span>` : `<span class="k-c">${month} 1일부터</span>`}</div>
        <div class="kpi"><span class="k-l">오늘</span><span class="k-v num">${u.today_total}<small>건</small></span><span class="k-c">${u.today.slice(5).replace("-", "/")}</span></div>
        <div class="kpi"><span class="k-l">내 질문</span><span class="k-v num">${u.mine_month}<small>건</small></span><span class="k-c">이번 달 중 ${share(u.mine_month)}</span></div>
        <div class="kpi"><span class="k-l">매물을 찾은 답변</span><span class="k-v num">${u.with_listings}<small>건</small></span><span class="k-c">이번 달 중 ${share(u.with_listings)}</span></div>
        <div class="kpi"><span class="k-l">고객 자료로 만든 답변</span><span class="k-v num">${u.reports_from_answers}<small>건</small></span><span class="k-c">이번 달</span></div>
      </div>
      <div class="ugrid">
        <section class="card card--chart"><div class="card-h"><h2>일별 질문</h2><span class="muted">최근 ${u.daily.length}일</span></div>${dailyBars(u.daily)}
          <div class="card-foot"><span>${u.daily.length}일 합계 <b class="num">${u.daily.reduce((a, d) => a + d.count, 0)}건</b></span>
            <span>가장 많은 날 <b class="num">${(() => { const top = u.daily.reduce((a, d) => (d.count > a.count ? d : a), u.daily[0]); return top.count ? `${+top.date.slice(5, 7)}/${+top.date.slice(8)} ${top.count}건` : "-"; })()}</b></span><span>질문한 날 <b class="num">${u.daily.filter((d) => d.count).length}일</b></span></div></section>
        <div class="ucol">
          <section class="card"><div class="card-h"><h2>사람별</h2><span class="muted">이번 달</span></div>
            ${u.by_user.length ? `<ul class="barlist">${u.by_user.map((x, i) => `<li><span>${esc(x.name)}</span><span class="num">${x.count}</span><i style="width:${(x.count / maxUser) * 100}%" class="${i ? "" : "top"}"></i></li>`).join("")}</ul>`
              : `<p class="empty-box">이번 달 질문이 아직 없습니다.</p>`}</section>
          <section class="card"><div class="card-h"><h2>답변에 쓴 출처</h2><span class="muted">${u.avg_sources != null ? `답변당 평균 ${u.avg_sources}개` : "이번 달"}</span></div>
            <ul class="barlist">${u.by_source_type.map((x) => `<li><span>${TYPE_NAME[x.type] || esc(x.type)}</span><span class="num">${x.count}</span><i style="width:${(x.count / maxType) * 100}%"></i></li>`).join("")}</ul></section>
        </div>
      </div>
      <section class="card route-card"><div class="card-h"><h2>검색 경로</h2>
          <span class="muted">${u.traces ? `이번 달 ${u.traces}건 · 평균 응답 ${u.latency_avg_ms}ms · p95 ${u.latency_p95_ms}ms · 오래된 공공데이터를 쓴 답변 ${u.stale_answers}건` : "이번 달 기록 없음"}</span></div>
        ${u.by_route.length ? `<ul class="barlist barlist--cols">${u.by_route.map((x) => `<li><span>${ROUTE_NAME[x.route] || esc(x.route)}</span><span class="num">${x.count}</span><i style="width:${(x.count / Math.max(...u.by_route.map((y) => y.count))) * 100}%"></i></li>`).join("")}</ul>`
          : `<p class="empty-box">질문을 하면 매물·실거래가·전월세·단지·건축물·노선·문서 중 어떤 경로를 썼는지 여기에 쌓입니다.</p>`}</section>
    </div>`;
}

// ── 설정 ─────────────────────────────────────────
async function renderSettings() {
  const main = aiLoading("설정");
  let s;
  try { s = await api("GET", "/ai/settings"); } catch (e) { toast(e.message); return; }
  if (S.view !== "ai" || H.page !== "settings") return;
  const dis = s.can_edit ? "" : "disabled";
  const types = [["law", "법령", "법제처 법령 조문"], ["policy", "정책", "정부·지자체 공식 안내"], ["office", "사무소 자료", "중개사가 추가한 자료·내부 문서"], ["news", "기사", "시장 분위기 보조 자료 (사실 근거로는 쓰지 않음)"]];
  main.innerHTML = `
    <div class="ai-page">
      <header class="title-row"><div><h1>설정</h1>
        <p class="sub">Hood AI가 답할 때 쓰는 자료와 방식입니다. ${esc(S.user.tenant_name)} 전체에 적용됩니다.</p></div></header>
      ${s.can_edit ? "" : `<p class="notice">관리자만 바꿀 수 있습니다. 지금 값을 보여 드립니다.</p>`}
      <form id="ai-settings" class="settings">
        <div class="set-row"><div class="set-l"><h2>답변에 쓸 자료</h2><p>매물 정보·현장 메모와 실거래가는 늘 씁니다. 끈 자료는 답변과 출처에서 빠집니다.</p></div>
          <div class="set-p">${types.map(([k, w, d]) => `<label class="check"><input type="checkbox" name="types" value="${k}" ${s.source_types.includes(k) ? "checked" : ""} ${dis} /><span><b>${w}</b><small>${d}</small></span></label>`).join("")}</div></div>
        <div class="set-row"><div class="set-l"><h2>자세히 설명할 매물 수</h2><p>맞는 매물 중 답변 문장으로 하나씩 설명하는 수입니다. 나머지는 목록과 지도에만 나옵니다.</p></div>
          <div class="set-p"><div class="seg" role="radiogroup" aria-label="자세히 설명할 매물 수">${[1, 2, 3, 4, 5].map((n) => `<label><input type="radio" name="detail" value="${n}" ${s.detail_count === n ? "checked" : ""} ${dis} /><span>${n}건</span></label>`).join("")}</div></div></div>
        <div class="set-row"><div class="set-l"><h2>맞는 매물이 없을 때</h2><p>예: 8억 이하로 찾았는데 없으면 8.8억까지, 59㎡로 찾았는데 없으면 53㎡까지 넓혀 차이와 함께 보여 줍니다.</p></div>
          <div class="set-p"><label class="switch"><input type="checkbox" name="near" ${s.near_miss ? "checked" : ""} ${dis} /><span class="track" aria-hidden="true"></span><span>조건을 조금 넓혀 가까운 매물 보여 주기</span></label></div></div>
        <div class="set-row"><div class="set-l"><h2>월 질문 한도</h2><p>사무소 전체가 한 달에 할 수 있는 질문 수입니다. 비워 두면 제한하지 않습니다.</p></div>
          <div class="set-p"><label class="inline">한도 <input type="number" name="limit" min="1" max="100000" inputmode="numeric" value="${s.monthly_limit ?? ""}" placeholder="제한 없음" ${dis} /> 건</label>
            <p class="muted" style="margin:8px 0 0">이번 달 ${s.month_used}건 사용</p></div></div>
        <div class="set-row"><div class="set-l"><h2>답변 작성 방식</h2><p>서버 설정(.env)으로 정합니다.</p></div>
          <div class="set-p"><p style="margin:0">${s.llm.enabled ? `Claude (${esc(s.llm.model)})가 찾은 출처 안에서 문장을 다듬고, 출처 없는 문장은 확인할 사항으로 돌립니다.` : "규칙 기반 문장틀로 씁니다. ANTHROPIC_API_KEY를 넣으면 Claude가 같은 출처 안에서 문장을 다듬습니다."}</p></div></div>
        <div class="set-foot"><span class="muted" id="set-stamp">${s.updated_at ? `${esc(s.updated_by || "")} · ${when(s.updated_at)} 저장` : "기본값"}</span>
          ${s.can_edit ? `<button type="submit" class="btn btn--main">저장</button>` : ""}</div>
      </form>
    </div>`;
}
document.addEventListener("submit", async (e) => {
  const f = e.target.closest("#ai-settings");
  if (!f) return;
  e.preventDefault();
  const body = {
    source_types: [...f.querySelectorAll("[name=types]:checked")].map((x) => x.value),
    detail_count: Number(f.querySelector("[name=detail]:checked").value),
    near_miss: f.querySelector("[name=near]").checked,
    monthly_limit: f.limit.value ? Number(f.limit.value) : null,
  };
  if (!body.source_types.length) { toast("답변에 쓸 자료를 하나 이상 골라 주세요."); return; }
  const r = await busy(f.querySelector("[type=submit]"), () => api("PUT", "/ai/settings", body));
  if (r) { toast("설정을 저장했습니다. 다음 질문부터 적용됩니다."); $("#set-stamp").textContent = `${r.updated_by} · ${when(r.updated_at)} 저장`; }
});
