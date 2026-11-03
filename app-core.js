"use strict";
/* 중개메이트 작업 화면 — 공통: 상태, API, 로그인, 라우팅, 출처 패널, 각주. 화면별 코드는 app-map / app-people / app-docs. */

const STAGES = ["intro", "visit", "nego", "contract", "done"];
const STAGE_LABEL = { available: "거래 가능", intro: "소개", visit: "방문", nego: "협의", contract: "계약", done: "완료", dropped: "무산" };
const STAGE_COLOR = {
  available: "var(--st-available)", intro: "var(--st-intro)", visit: "var(--st-visit)", nego: "var(--st-nego)",
  contract: "var(--st-contract)", done: "var(--st-done)", dropped: "var(--st-dropped)",
};
const TYPE_WORD = { law: "법령", policy: "정책", office: "사무소", news: "기사", data: "데이터" };

const S = {
  token: sessionStorage.getItem("mate_token"),
  user: null,
  sources: {},          // 출처 id → evidence (출처 패널에서 다시 쓰기 위해 모아 둔다)
  view: null,
};
const ACTIONS = {};     // data-act 이름 → 처리 함수 (각 화면 파일이 등록)
const VIEWS = {};       // 라우트 이름 → 렌더 함수

// ── 유틸 ─────────────────────────────────────────
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const eok = (p) => (p == null ? "-" : `${(p / 10000).toFixed(2).replace(/\.?0+$/, "")}억`);
const stageIdx = (s) => STAGES.indexOf(s);
const stageTag = (s) => `<span class="stage" data-s="${esc(s)}">${esc(STAGE_LABEL[s] || s)}</span>`;
function prog(s, wide) {
  const n = stageIdx(s) + 1;
  return `<span class="prog ${wide ? "prog--wide" : ""}" style="--c:${STAGE_COLOR[s] || "var(--line)"}" aria-label="${esc(STAGE_LABEL[s] || "")} ${Math.max(n, 0)}/5">${STAGES.map((_, i) => `<i class="${i < n ? "on" : ""}"></i>`).join("")}</span>`;
}
const day = (iso) => (iso ? iso.slice(5, 10).replace("-", "/") : "");
const dateTime = (iso) => (iso ? `${iso.slice(5, 10).replace("-", "/")} ${iso.slice(11, 16)}` : "");

function toast(msg, ms = 2800) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, ms);
}

function openDialog(html) {
  const d = $("#dialog");
  d.innerHTML = html;
  if (!d.open) d.showModal();
  d.querySelector("input, select, textarea, button")?.focus();
}
const closeDialog = () => { if ($("#dialog").open) $("#dialog").close(); };

// ── API ─────────────────────────────────────────
class ApiError extends Error {
  constructor(status, detail) {
    const msg = Array.isArray(detail) ? detail.map((d) => `${(d.loc || []).slice(-1)[0] || ""}: ${d.msg}`).join(", ") : detail;
    super(msg || `요청이 실패했습니다 (${status})`);
    this.status = status;
    this.fields = Array.isArray(detail) ? Object.fromEntries(detail.map((d) => [(d.loc || []).slice(-1)[0], d.msg])) : {};
  }
}

async function api(method, path, body, { form } = {}) {
  const opts = { method, headers: {} };
  if (S.token) opts.headers.Authorization = `Bearer ${S.token}`;
  if (form) opts.body = form;
  else if (body !== undefined) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
  const res = await fetch(`/api${path}`, opts);
  if (res.status === 401 && path !== "/auth/login") { logout(); throw new ApiError(401, "다시 로그인해 주세요."); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.detail);
  return data;
}

/* 버튼을 잠깐 막고 실행. 오류는 알림으로 보여 주고 다시 던지지 않는다. */
async function busy(btn, fn) {
  if (btn) btn.disabled = true;
  try { return await fn(); }
  catch (e) { toast(e.message, 4200); return undefined; }
  finally { if (btn && btn.isConnected) btn.disabled = false; }
}

// ── 로그인 ─────────────────────────────────────────
$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#login-error");
  err.hidden = true;
  try {
    const r = await api("POST", "/auth/login", { email: $("#login-email").value.trim(), password: $("#login-password").value });
    S.token = r.access_token;
    sessionStorage.setItem("mate_token", S.token);
    S.user = r.user;
    showApp();
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  }
});

function logout() {
  S.token = null;
  S.user = null;
  sessionStorage.removeItem("mate_token");
  $("#app").hidden = true;
  $("#login-screen").hidden = false;
  closeDrawer();
}
ACTIONS.logout = logout;

function showApp() {
  $("#login-screen").hidden = true;
  $("#app").hidden = false;
  $("#me-name").textContent = `${S.user.name}${S.user.role === "admin" ? " (관리자)" : ""}`;
  $("#office-name").textContent = S.user.tenant_name;
  document.querySelectorAll("[data-admin]").forEach((el) => { el.hidden = S.user.role !== "admin"; });
  route();
}

// ── 라우팅 ─────────────────────────────────────────
function route() {
  if (!S.user) return;
  const [page = "map", a, b] = (location.hash || "#/map").slice(2).split("/");
  const name = VIEWS[page] ? page : "map";
  document.querySelectorAll("#app .view").forEach((v) => { v.hidden = true; });
  document.querySelectorAll(".nav a").forEach((n) => n.classList.toggle("is-active", n.dataset.nav === (name === "report" ? "customers" : name)));
  closeDrawer();
  closeDialog();
  const view = $(`#view-${name}`);
  view.hidden = false;
  // 보이는 화면을 상단바 바로 뒤로: 문서에서 그 화면의 제목(h1)이 먼저 읽히도록 (보이는 모양은 같다)
  if (view.previousElementSibling !== $("#app > .topbar")) $("#app > .topbar").after(view);
  S.view = name;
  VIEWS[name](a, b);
}
addEventListener("hashchange", route);

// ── 출처 (출처 패널 + 각주) ─────────────────────────────────────────
function remember(ev) { if (ev && ev.id) S.sources[ev.id] = ev; return ev; }

function srcLink(ev, label) {
  remember(ev);
  const title = String(ev.title || "").replace(/^\[샘플\]\s*/, "");
  const kind = ev.type_label || TYPE_WORD[ev.type] || "";
  const text = label || (title.includes(kind) ? title : `${kind} · ${title}`);  // 'A 마포한강뷰 59 매물 정보'처럼 종류가 제목에 있으면 한 번만
  return `<button type="button" class="srcref" data-act="source" data-src="${esc(ev.id)}">${esc(text)}</button>`;
}

function sourceBody(ev, { inLibrary = false, query = "" } = {}) {
  const hl = (t) => {
    let out = esc(t);
    query.trim().split(/\s+/).filter((w) => w.length > 1).forEach((w) => { out = out.split(esc(w)).join(`<mark>${esc(w)}</mark>`); });
    return out;
  };
  return `
    <div class="drawer-h"><div><span class="typeword">${esc(ev.type_label || TYPE_WORD[ev.type] || "")}</span><h2 style="display:inline">${esc(ev.title)}</h2></div>
      ${inLibrary ? "" : `<button type="button" class="btn btn--sm" data-act="close-drawer">닫기</button>`}</div>
    <dl class="kv" style="margin-top:10px"><dt>발행</dt><dd>${esc(ev.org)}</dd><dt>기준일</dt><dd>${esc(ev.date)}${ev.effective_date ? ` · 시행 ${esc(ev.effective_date)}` : ""}</dd>
      <dt>위치</dt><dd>${esc(ev.location || "-")}</dd></dl>
    <div class="excerpt">${hl(ev.snippet || "")}</div>
    ${ev.note ? `<p class="note" style="color:${ev.state === "ok" ? "var(--sub)" : "var(--warn)"}">${esc(ev.note)}</p>` : ""}
    ${ev.url ? `<p class="note"><a href="${esc(ev.url)}" target="_blank" rel="noopener noreferrer">원문 페이지 열기</a></p>` : ""}
    ${inLibrary && ev.kind === "chunk" ? `<p><button type="button" class="btn" data-act="quote" data-src="${esc(ev.id)}">고객 문의 답변에 인용</button></p>` : ""}`;
}

async function openDrawer(id) {
  let ev = S.sources[id];
  if (!ev && /^c\d+$/.test(id)) ev = remember(await api("GET", `/evidence/${id}`).catch(() => null));
  if (!ev) { toast("출처를 찾을 수 없습니다."); return; }
  const d = $("#drawer");
  if (d.hidden) drawerOpener = document.activeElement;   // 닫을 때 포커스를 돌려줄 곳
  d.innerHTML = sourceBody(ev);
  d.hidden = false;
  // 휴대폰 폭에서는 화면 대부분을 덮는 시트라 대화상자처럼 다룬다: 뒤 화면 스크롤 막기 + 포커스 가두기
  const sheet = SHEET_MEDIA.matches;
  d.setAttribute("role", sheet ? "dialog" : "complementary");
  d.toggleAttribute("aria-modal", sheet);
  document.body.classList.toggle("sheet-open", sheet);
  d.querySelector("button")?.focus();
}
const SHEET_MEDIA = matchMedia("(max-width: 900px)");
let drawerOpener = null;
function closeDrawer() {
  const d = $("#drawer");
  if (d.hidden) return;
  d.hidden = true;
  document.body.classList.remove("sheet-open");
  if (drawerOpener && drawerOpener.isConnected) drawerOpener.focus({ preventScroll: true });
  drawerOpener = null;
}
// 휴대폰 시트일 때 어둡게 덮인 바깥을 누르면 닫는다 (여는 클릭과 겹치지 않게 pointerdown에서 판단)
let swallowClick = 0;
document.addEventListener("pointerdown", (e) => {
  if (!document.body.classList.contains("sheet-open") || e.target.closest("#drawer")) return;
  closeDrawer();
  swallowClick = Date.now();   // 닫으려고 누른 것이 아래 화면의 버튼·링크까지 누르지 않게
});
document.addEventListener("click", (e) => {
  if (swallowClick && Date.now() - swallowClick < 600) { e.preventDefault(); e.stopPropagation(); }
  swallowClick = 0;
}, true);
// 휴대폰 시트일 때 Tab이 뒤 화면으로 빠져나가지 않게
$("#drawer").addEventListener("keydown", (e) => {
  if (e.key !== "Tab" || !SHEET_MEDIA.matches) return;
  const f = [...$("#drawer").querySelectorAll("a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex='-1'])")]
    .filter((x) => x.offsetParent !== null);
  if (!f.length) return;
  if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f.at(-1).focus(); }
  else if (!e.shiftKey && document.activeElement === f.at(-1)) { e.preventDefault(); f[0].focus(); }
});
ACTIONS.source = (el) => openDrawer(el.dataset.src);
ACTIONS["close-drawer"] = closeDrawer;

/* "…입니다[t3]." 의 출처 표시를 각주 번호로 바꾼다. order는 문서 전체에서 공유해 처음 나온 순서로 번호를 매긴다. */
function withNotes(text, sources, order) {
  const byId = Object.fromEntries((sources || []).map((s) => [s.id, s]));
  return esc(text).replace(/\[([cltrkbs]\d+)\]/g, (_, id) => {
    const ev = byId[id];
    if (!ev) return "";
    if (!order.includes(id)) order.push(id);
    remember(ev);
    return `<sup data-token="${id}"><button type="button" class="srcref" data-act="source" data-src="${id}" contenteditable="false">${order.indexOf(id) + 1})</button></sup>`;
  });
}

/* 고친 문단을 저장할 때: 각주 버튼을 다시 [id] 표시로 되돌린 뒤 글자만 꺼낸다. */
function textWithTokens(el) {
  const copy = el.cloneNode(true);
  copy.querySelectorAll("sup[data-token]").forEach((sup) => sup.replaceWith(`[${sup.dataset.token}]`));
  return copy.textContent.replace(/\s+/g, " ").trim();
}

// ── 이벤트 (모든 화면 공통 위임) ─────────────────────────────────────────
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el || el.tagName === "FORM" || el.tagName === "INPUT") return;
  const fn = ACTIONS[el.dataset.act];
  if (fn) { e.preventDefault(); fn(el, e); }
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#drawer").hidden) closeDrawer(); });

/* 모든 파일이 로드된 뒤 시작 */
addEventListener("DOMContentLoaded", async () => {
  if (!S.token) return;
  try {
    S.user = await api("GET", "/me");
    showApp();
  } catch { /* 401이면 logout()이 로그인 화면을 보여 준다 */ }
});
