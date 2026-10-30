"use strict";

// ═══════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatPrice(manwon) {
  if (manwon == null) return "-";
  const eok = manwon / 10000;
  return (eok % 1 === 0 ? eok.toFixed(0) : eok.toFixed(1)) + "억";
}

function formatDate(iso) {
  if (!iso) return "-";
  return String(iso).slice(0, 10);
}

function formatDateTime(iso) {
  if (!iso) return "-";
  try {
    return new Intl.DateTimeFormat("ko-KR", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return String(iso).slice(0, 16).replace("T", " ");
  }
}

// ═══════════════════════════════════════════════════════
// APPLICATION STATE
// ═══════════════════════════════════════════════════════

const state = {
  token: null,
  user: null,
  consultations: [],
  currentConsultationId: null,
  currentConsultation: null,
  currentMode: "advise",
  listings: [],
  asOf: null,
  selectedListingIds: new Set(),
  compareResult: null,
  draftList: [],
  currentDraftId: null,
  currentDraft: null,
};

// ═══════════════════════════════════════════════════════
// API WRAPPER
// ═══════════════════════════════════════════════════════

async function api(method, path, body) {
  const headers = { "Content-Type": "application/json" };
  if (state.token) headers["Authorization"] = "Bearer " + state.token;
  const opts = { method, headers };
  if (body !== undefined) opts.body = JSON.stringify(body);
  let res;
  try {
    res = await fetch("/api" + path, opts);
  } catch (err) {
    throw new Error("네트워크 오류: 서버에 연결할 수 없습니다.");
  }
  if (res.status === 401) {
    logout();
    throw Object.assign(new Error("401"), { status: 401 });
  }
  let data;
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (!res.ok) {
    const detail = data.detail;
    let message;
    if (Array.isArray(detail)) {
      // FastAPI 422 validation errors: detail is [{loc, msg, type}]
      message = detail.map(d => {
        const field = d.loc && d.loc[1] ? String(d.loc[1]) + ": " : "";
        return field + (d.msg || "유효성 오류");
      }).join(" / ");
    } else {
      message = detail || "오류가 발생했습니다.";
    }
    throw Object.assign(
      new Error(message),
      { code: data.code, status: res.status, _rawDetail: detail }
    );
  }
  return data;
}

// ═══════════════════════════════════════════════════════
// TOAST / LOADING
// ═══════════════════════════════════════════════════════

let toastTimer = null;

function showToast(message, type = "error") {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.className = "toast toast-" + type;
  el.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 6000);
}

function setLoading(btn, loading) {
  if (!btn) return;
  if (loading) {
    btn.classList.add("is-loading");
    btn.disabled = true;
  } else {
    btn.classList.remove("is-loading");
    btn.disabled = false;
  }
}

// ═══════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════

function showLogin() {
  document.getElementById("login-screen").hidden = false;
  document.getElementById("app").hidden = true;
}

function showApp() {
  document.getElementById("login-screen").hidden = true;
  document.getElementById("app").hidden = false;
  renderTopbarUser();
  loadConsultations();
  handleHashChange();
}

function renderTopbarUser() {
  const u = state.user;
  if (!u) return;
  const el = document.getElementById("topbar-user-text");
  el.textContent = u.name + " · " + u.tenant_name;
}

function logout() {
  state.token = null;
  state.user = null;
  sessionStorage.removeItem("jungme_token");
  showLogin();
}

document.getElementById("logout-btn").addEventListener("click", logout);

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = document.getElementById("login-error");
  errEl.hidden = true;
  const btn = document.getElementById("login-btn");
  setLoading(btn, true);
  try {
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || "로그인에 실패했습니다.");
    state.token = data.access_token;
    state.user = data.user;
    sessionStorage.setItem("jungme_token", state.token);
    showApp();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  } finally {
    setLoading(btn, false);
    // re-enable since setLoading disabled it
    btn.disabled = false;
    btn.classList.remove("is-loading");
  }
});

// ═══════════════════════════════════════════════════════
// CONSULTATIONS
// ═══════════════════════════════════════════════════════

async function loadConsultations() {
  try {
    const list = await api("GET", "/consultations");
    state.consultations = list;
    const sel = document.getElementById("consultation-select");
    sel.innerHTML = '<option value="">-- 상담을 선택하세요 --</option>' +
      list.map(c =>
        `<option value="${escapeHtml(String(c.id))}">${escapeHtml(c.customer_name)} · ${escapeHtml(c.deal_type)}</option>`
      ).join("");
  } catch (err) {
    showToast("상담 목록 로드 실패: " + err.message);
  }
}

document.getElementById("consultation-select").addEventListener("change", (e) => {
  const id = e.target.value;
  if (!id) {
    state.currentConsultationId = null;
    state.currentConsultation = null;
    resetAppState();
    return;
  }
  selectConsultation(id);
});

async function selectConsultation(id) {
  state.currentConsultationId = id;
  try {
    const c = await api("GET", "/consultations/" + id);
    state.currentConsultation = c;
    applyConsultation(c);
    await loadDraftList();
  } catch (err) {
    showToast("상담 로드 실패: " + err.message);
  }
}

function applyConsultation(c) {
  // Topbar status chip
  const chip = document.getElementById("context-status");
  chip.textContent = c.customer_name + " · " + c.deal_type;

  // Context title
  document.getElementById("context-title").textContent = c.customer_name;

  // Conditions form
  renderConditionsForm(c.conditions || {});

  // Candidates
  renderCandidateList(c.candidates || []);

  // Memory summary — counts come from list endpoint; derive from candidates if absent
  const mem = document.getElementById("context-memory");
  const memList = document.getElementById("memory-list");
  const candidates = c.candidates || [];
  const cnt = c.counts || {
    interest: candidates.filter(ca => ca.status === "interest").length,
    excluded: candidates.filter(ca => ca.status === "excluded").length,
    history: (c.history || []).length,
  };
  mem.hidden = false;
  memList.innerHTML = [
    cnt.interest ? `<li><span class="memory-dot memory-dot--interest"></span>관심 매물 ${cnt.interest}개</li>` : "",
    cnt.excluded ? `<li><span class="memory-dot memory-dot--excluded"></span>제외 매물 ${cnt.excluded}개</li>` : "",
    cnt.history ? `<li><span class="memory-dot memory-dot--history"></span>이전 상담 ${cnt.history}회</li>` : "",
  ].join("");

  // Enable controls
  document.getElementById("conditions-save-btn").disabled = false;
  document.getElementById("search-listings-btn").disabled = false;
  document.getElementById("advise-btn").disabled = false;
  document.getElementById("ask-btn").disabled = false;
}

function renderConditionsForm(cond) {
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val != null ? String(val) : "";
  };
  set("cond-budget", cond.budget_max);
  set("cond-area", cond.area_min);
  set("cond-district", cond.district);
  set("cond-walk", cond.station_walk_max);
  set("cond-prefs", Array.isArray(cond.preferences) ? cond.preferences.join(", ") : (cond.preferences || ""));
  updateBudgetHint();
}

function updateBudgetHint() {
  const val = parseFloat(document.getElementById("cond-budget").value);
  const hint = document.getElementById("budget-hint");
  if (!isNaN(val) && val > 0) {
    hint.textContent = "= " + formatPrice(val);
  } else {
    hint.textContent = "";
  }
}

document.getElementById("cond-budget").addEventListener("input", updateBudgetHint);

document.getElementById("conditions-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!state.currentConsultationId) return;
  const btn = document.getElementById("conditions-save-btn");
  setLoading(btn, true);
  try {
    const prefs = document.getElementById("cond-prefs").value
      .split(",").map(s => s.trim()).filter(Boolean);
    const body = {
      budget_max: parseFloat(document.getElementById("cond-budget").value) || null,
      area_min: parseFloat(document.getElementById("cond-area").value) || null,
      district: document.getElementById("cond-district").value.trim() || null,
      station_walk_max: parseFloat(document.getElementById("cond-walk").value) || null,
      preferences: prefs,
    };
    const result = await api("PUT", "/consultations/" + state.currentConsultationId + "/conditions", body);
    state.currentConsultation = result.consultation;
    applyConsultation(result.consultation);

    const warnEl = document.getElementById("conditions-warnings");
    const warnings = result.warnings || [];
    if (warnings.length) {
      warnEl.innerHTML = "<strong>조건 확인 필요</strong><ul>" +
        warnings.map(w => `<li>${escapeHtml(w)}</li>`).join("") + "</ul>";
      warnEl.hidden = false;
    } else {
      warnEl.hidden = true;
    }
    showToast("조건이 저장되었습니다.", "ok");
  } catch (err) {
    showToast("조건 저장 실패: " + err.message);
  } finally {
    btn.disabled = false;
    btn.classList.remove("is-loading");
  }
});

// ── Candidate list ────────────────────────────────────

function renderCandidateList(candidates) {
  const el = document.getElementById("candidate-list");
  if (!candidates.length) {
    el.innerHTML = '<p class="candidate-empty">후보 매물이 없습니다.</p>';
    return;
  }
  el.innerHTML = candidates.map(c => {
    const l = c.listing || {};
    const label = l.title || l.label || "매물 #" + c.listing_id;
    const sub = [l.price != null ? formatPrice(l.price) : null, l.area_m2 ? l.area_m2 + "㎡" : null]
      .filter(Boolean).join(" · ");
    const isInterest = c.status === "interest";
    const isCompare = c.status === "compare";
    const isExcluded = c.status === "excluded";
    return `
      <div class="candidate-row" data-listing-id="${escapeHtml(String(c.listing_id))}">
        <div class="candidate-info">
          <strong>${escapeHtml(label)}</strong>
          ${sub ? `<small>${escapeHtml(sub)}</small>` : ""}
          <a href="#/map/listing/${escapeHtml(String(c.listing_id))}"
            class="map-link">지도에서 보기</a>
        </div>
        <div class="candidate-toggles">
          <button type="button" class="toggle-btn ${isInterest ? "is-active-interest" : ""}"
            data-action="interest" aria-pressed="${isInterest}"
            aria-label="${escapeHtml(label)} 관심">관심</button>
          <button type="button" class="toggle-btn ${isCompare ? "is-active-compare" : ""}"
            data-action="compare" aria-pressed="${isCompare}"
            aria-label="${escapeHtml(label)} 비교">비교</button>
          <button type="button" class="toggle-btn ${isExcluded ? "is-active-excluded" : ""}"
            data-action="excluded" aria-pressed="${isExcluded}"
            aria-label="${escapeHtml(label)} 제외">제외</button>
        </div>
      </div>`;
  }).join("");

  el.querySelectorAll(".toggle-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const row = btn.closest(".candidate-row");
      const listingId = row.dataset.listingId;
      const action = btn.dataset.action;
      const candidate = (state.currentConsultation.candidates || [])
        .find(c => String(c.listing_id) === listingId);
      // Toggle off if already active
      const newStatus = (candidate && candidate.status === action) ? "none" : action;
      await toggleCandidate(listingId, newStatus);
    });
  });
}

async function toggleCandidate(listingId, status) {
  if (!state.currentConsultationId) return;
  try {
    const result = await api(
      "PUT",
      `/consultations/${state.currentConsultationId}/candidates/${listingId}`,
      { status }
    );
    state.currentConsultation = result;
    renderCandidateList(result.candidates || []);
  } catch (err) {
    showToast("후보 상태 변경 실패: " + err.message);
  }
}

// ── Mini Map ──────────────────────────────────────────

function renderMiniMap(candidates) {
  const mapEl = document.getElementById("mini-map");
  if (!mapEl) return; // mini-map removed from new UI
  // Remove existing pins and empty message
  mapEl.querySelectorAll(".map-pin, .map-empty-msg, .station").forEach(n => n.remove());

  const withCoords = candidates.filter(c => c.listing && c.listing.lat != null && c.listing.lng != null);

  const emptyMsg = document.createElement("span");
  emptyMsg.className = "map-empty-msg";
  emptyMsg.id = "map-empty-msg";

  if (!withCoords.length) {
    emptyMsg.textContent = withCoords.length === 0 && candidates.length > 0
      ? "좌표 정보가 없어 목록만 표시합니다"
      : "매물을 선택하면 지도에 표시됩니다";
    mapEl.appendChild(emptyMsg);
    return;
  }

  const lats = withCoords.map(c => c.listing.lat);
  const lngs = withCoords.map(c => c.listing.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latRange = maxLat - minLat || 0.001;
  const lngRange = maxLng - minLng || 0.001;

  const alpha = "ABCDEFGHIJ";

  withCoords.forEach((c, i) => {
    // lat: higher = north = smaller top% (inverted)
    const topPct = (1 - (c.listing.lat - minLat) / latRange) * 70 + 10;
    const leftPct = ((c.listing.lng - minLng) / lngRange) * 70 + 10;
    const label = alpha[i] || String(i + 1);
    const title = c.listing.title || c.listing.label || "매물 " + label;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "map-pin" + (c.status === "compare" ? " is-selected" : "");
    btn.style.top = topPct.toFixed(1) + "%";
    btn.style.left = leftPct.toFixed(1) + "%";
    btn.dataset.listingId = String(c.listing_id);
    btn.setAttribute("aria-label", "후보 " + label + " " + title);
    btn.setAttribute("aria-pressed", c.status === "compare" ? "true" : "false");
    btn.textContent = label;
    mapEl.appendChild(btn);

    btn.addEventListener("click", () => {
      // Scroll candidate row into view
      const row = document.querySelector(
        `.candidate-row[data-listing-id="${CSS.escape(String(c.listing_id))}"]`
      );
      if (row) row.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  });

  // Station label from first candidate that has one
  const withStation = withCoords.find(c => c.listing.station);
  if (withStation) {
    const st = document.createElement("span");
    st.className = "station";
    st.textContent = withStation.listing.station;
    mapEl.appendChild(st);
  }
}

function resetAppState() {
  document.getElementById("context-title").textContent = "고객 정보";
  document.getElementById("context-status").textContent = "상담을 선택하세요";
  document.getElementById("candidate-list").innerHTML = '<p class="candidate-empty">상담을 선택하면 후보 목록이 표시됩니다.</p>';
  document.getElementById("context-memory").hidden = true;
  document.getElementById("listings-result").innerHTML = '<p class="listings-empty">상담을 선택하고 매물을 검색하세요.</p>';
  document.getElementById("compare-bar").hidden = true;
  document.getElementById("compare-result").hidden = true;
  document.getElementById("draft-view").hidden = true;
  document.getElementById("draft-select").innerHTML = '<option value="">-- 새 초안 --</option>';
  document.getElementById("evidence-list").innerHTML = '<div class="evidence-empty">아직 연결된 근거가 없습니다.</div>';
  document.getElementById("evidence-count").textContent = "0건";
  document.getElementById("workflow-status").textContent = "초안 없음";
  state.selectedListingIds.clear();
  state.compareResult = null;
  state.currentDraftId = null;
  state.currentDraft = null;
  state.listings = [];
  document.getElementById("conditions-save-btn").disabled = true;
  document.getElementById("search-listings-btn").disabled = true;
  document.getElementById("advise-btn").disabled = true;
  document.getElementById("ask-btn").disabled = true;
}

// ═══════════════════════════════════════════════════════
// LISTINGS
// ═══════════════════════════════════════════════════════

document.getElementById("search-listings-btn").addEventListener("click", searchListings);

async function searchListings() {
  if (!state.currentConsultationId) return;
  const btn = document.getElementById("search-listings-btn");
  setLoading(btn, true);
  try {
    const cond = (state.currentConsultation && state.currentConsultation.conditions) || {};
    const params = new URLSearchParams();
    if (cond.district) params.set("district", cond.district);
    if (cond.budget_max) params.set("max_price", String(cond.budget_max));
    if (cond.area_min) params.set("min_area", String(cond.area_min));
    if (cond.station_walk_max) params.set("max_station_walk", String(cond.station_walk_max));
    const sort = document.getElementById("sort-select").value;
    if (sort) params.set("sort", sort);

    const result = await api("GET", "/listings?" + params.toString());
    state.listings = result.items || [];
    state.asOf = result.as_of || null;
    state.selectedListingIds.clear();
    renderListingsTable(state.listings, result.as_of);
  } catch (err) {
    showToast("매물 검색 실패: " + err.message);
  } finally {
    btn.disabled = false;
    btn.classList.remove("is-loading");
  }
}

function renderListingsTable(items, asOf) {
  const container = document.getElementById("listings-result");
  const compareBar = document.getElementById("compare-bar");

  if (!items.length) {
    container.innerHTML = '<p class="listings-empty">조건에 맞는 매물이 없습니다.</p>';
    compareBar.hidden = true;
    return;
  }

  const asOfNote = asOf ? `<p style="margin:0 0 6px;color:var(--ink-muted);font-size:0.68rem;">기준: ${escapeHtml(formatDate(asOf))}</p>` : "";

  const rows = items.map(l => {
    const ph = (l.price_history || []).slice(0, 2).map(p =>
      `${formatPrice(p.price)} (${formatDate(p.changed_at)})`
    ).join(" → ");

    return `<tr>
      <td><input type="checkbox" class="listing-checkbox" data-id="${escapeHtml(String(l.id))}"
        aria-label="${escapeHtml(l.title || l.label || "")} 선택" /></td>
      <td>${escapeHtml(l.title || l.label || "")}</td>
      <td class="price-cell">
        ${escapeHtml(formatPrice(l.price))}
        ${ph ? `<div class="price-history">변동: ${escapeHtml(ph)}</div>` : ""}
      </td>
      <td>${l.area_m2 != null ? escapeHtml(String(l.area_m2)) + "㎡" : "-"}</td>
      <td>${l.station_walk_min != null ? escapeHtml(String(l.station_walk_min)) + "분" : "-"}</td>
      <td class="source-cell">${escapeHtml(l.source || "-")}<br>${escapeHtml(formatDate(l.source_date))}</td>
    </tr>`;
  }).join("");

  container.innerHTML = asOfNote + `
    <div class="listings-table-wrap">
      <table class="listings-table">
        <thead>
          <tr>
            <th aria-label="선택"></th>
            <th>매물명</th>
            <th>가격</th>
            <th>면적</th>
            <th>역 도보</th>
            <th>출처 / 기준일</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  compareBar.hidden = false;
  updateCompareBar();

  container.querySelectorAll(".listing-checkbox").forEach(cb => {
    cb.addEventListener("change", () => {
      const id = cb.dataset.id;
      if (cb.checked) {
        state.selectedListingIds.add(id);
      } else {
        state.selectedListingIds.delete(id);
      }
      updateCompareBar();
    });
  });
}

function updateCompareBar() {
  const n = state.selectedListingIds.size;
  const label = document.getElementById("compare-count-label");
  const btn = document.getElementById("compare-btn");
  label.textContent = n + "개 선택";
  btn.disabled = n < 2 || n > 5;
  btn.textContent = n >= 2 && n <= 5
    ? `비교표 생성 (${n}개)`
    : "비교표 생성 (2~5개 선택)";
}

document.getElementById("compare-btn").addEventListener("click", compareListings);

async function compareListings() {
  if (!state.currentConsultationId) return;
  const ids = [...state.selectedListingIds];
  if (ids.length < 2 || ids.length > 5) return;
  const btn = document.getElementById("compare-btn");
  setLoading(btn, true);
  try {
    const result = await api("POST", "/compare", {
      consultation_id: parseInt(state.currentConsultationId, 10) || state.currentConsultationId,
      listing_ids: ids.map(id => parseInt(id, 10) || id),
    });
    state.compareResult = result;
    renderCompareTable(result.rows || []);
  } catch (err) {
    showToast("비교표 생성 실패: " + err.message);
  } finally {
    btn.disabled = false;
    btn.classList.remove("is-loading");
    updateCompareBar();
  }
}

function renderCompareTable(rows) {
  const el = document.getElementById("compare-result");
  el.hidden = false;

  if (!rows.length) {
    el.innerHTML = '<p class="listings-empty">비교 결과가 없습니다.</p>';
    return;
  }

  // Collect all condition keys
  const conditionKeys = [];
  const seenKeys = new Set();
  rows.forEach(r => {
    (r.checks || []).forEach(c => {
      if (!seenKeys.has(c.condition)) {
        seenKeys.add(c.condition);
        conditionKeys.push(c.condition);
      }
    });
  });

  const headerCells = rows.map(r => {
    const l = r.listing || {};
    return `<th>${escapeHtml(l.title || l.label || "")}<br><small>${escapeHtml(formatPrice(l.price))}</small></th>`;
  }).join("");

  const conditionRows = conditionKeys.map(key => {
    const cells = rows.map(r => {
      const check = (r.checks || []).find(c => c.condition === key);
      if (!check) return "<td>-</td>";
      const mark = check.ok
        ? '<span class="check-ok">✓</span>'
        : '<span class="check-fail">✗</span>';
      return `<td>${mark} ${escapeHtml(check.detail || "")}</td>`;
    }).join("");
    return `<tr><td><strong>${escapeHtml(key)}</strong></td>${cells}</tr>`;
  }).join("");

  const tradeRow = `<tr>
    <td><strong>실거래가 참고</strong><br><small style="color:var(--ink-muted);">과거 신고 거래 · 현재 호가 아님</small></td>
    ${rows.map(r => {
      const tr = r.trade_reference;
      if (!tr) return "<td class=\"trade-ref-cell\">데이터 없음</td>";
      return `<td class="trade-ref-cell">
        <strong>${escapeHtml(formatPrice(tr.median_price))}</strong>
        중위 · ${escapeHtml(String(tr.count || 0))}건<br>
        ${escapeHtml(tr.period || "")}<br>
        <small>${escapeHtml(tr.source || "")} · ${escapeHtml(formatDate(tr.as_of))}</small>
      </td>`;
    }).join("")}
  </tr>`;

  el.innerHTML = `
    <p class="compare-title">매물 비교표</p>
    <p class="compare-trade-note">
      실거래가 참고 수치는 <strong>과거 신고된 거래 기준</strong>이며,
      현재 매물의 호가·거래 가능 상태가 아닙니다.
    </p>
    <div class="compare-table-wrap">
      <table class="compare-table">
        <thead>
          <tr><th>조건</th>${headerCells}</tr>
        </thead>
        <tbody>
          ${conditionRows}
          ${tradeRow}
        </tbody>
      </table>
    </div>`;
}

// ═══════════════════════════════════════════════════════
// DRAFTS — GENERATE
// ═══════════════════════════════════════════════════════

document.getElementById("advise-btn").addEventListener("click", generateAdvise);

async function generateAdvise() {
  if (!state.currentConsultationId) return;
  const btn = document.getElementById("advise-btn");
  setLoading(btn, true);
  try {
    // Use checked listing ids, or fall back to compare-status candidates
    const ids = [...state.selectedListingIds];
    const body = {
      consultation_id: parseInt(state.currentConsultationId, 10) || state.currentConsultationId,
    };
    if (ids.length >= 2 && ids.length <= 5) {
      body.listing_ids = ids.map(id => parseInt(id, 10) || id);
    }
    const draft = await api("POST", "/advise", body);
    state.currentDraftId = draft.id;
    state.currentDraft = draft;
    renderDraft(draft);
    await loadDraftList();
    document.getElementById("draft-view").hidden = false;
    document.getElementById("draft-view").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    if (err.status === 503) {
      showToast(
        "AI 초안 생성이 일시 중단되었습니다. 매물 비교와 근거 목록은 계속 사용할 수 있습니다.",
        "warning"
      );
    } else {
      showToast("초안 생성 실패: " + err.message);
    }
  } finally {
    btn.disabled = false;
    btn.classList.remove("is-loading");
  }
}

document.getElementById("ask-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!state.currentConsultationId) return;
  const btn = document.getElementById("ask-btn");
  setLoading(btn, true);
  try {
    const question = document.getElementById("ask-question").value.trim();
    const asOf = document.getElementById("ask-as-of").value;
    if (!question) {
      showToast("질문을 입력하세요.");
      return;
    }
    const body = {
      consultation_id: parseInt(state.currentConsultationId, 10) || state.currentConsultationId,
      question,
    };
    if (asOf) body.as_of = asOf;
    const draft = await api("POST", "/ask", body);
    state.currentDraftId = draft.id;
    state.currentDraft = draft;
    renderDraft(draft);
    await loadDraftList();
    document.getElementById("draft-view").hidden = false;
    document.getElementById("draft-view").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    if (err.status === 503) {
      showToast(
        "AI 초안 생성이 일시 중단되었습니다. 매물 비교와 근거 목록은 계속 사용할 수 있습니다.",
        "warning"
      );
    } else {
      showToast("질의응답 생성 실패: " + err.message);
    }
  } finally {
    btn.disabled = false;
    btn.classList.remove("is-loading");
  }
});

// ═══════════════════════════════════════════════════════
// DRAFTS — LOAD & RENDER
// ═══════════════════════════════════════════════════════

async function loadDraftList() {
  if (!state.currentConsultationId) return;
  try {
    const list = await api("GET", "/drafts?consultation_id=" + state.currentConsultationId);
    state.draftList = list;
    const sel = document.getElementById("draft-select");
    sel.innerHTML = '<option value="">-- 새 초안 --</option>' +
      list.map(d =>
        `<option value="${escapeHtml(String(d.id))}">${escapeHtml(d.version_label || "")} · ${escapeHtml(d.mode)} · ${escapeHtml(formatDateTime(d.created_at))}</option>`
      ).join("");
    // Keep current draft selected if it exists
    if (state.currentDraftId) {
      sel.value = String(state.currentDraftId);
    }
  } catch {
    // Non-critical
  }
}

document.getElementById("draft-select").addEventListener("change", async (e) => {
  const id = e.target.value;
  if (!id) {
    state.currentDraftId = null;
    state.currentDraft = null;
    document.getElementById("draft-view").hidden = true;
    renderEvidence([]);
    return;
  }
  try {
    const draft = await api("GET", "/drafts/" + id);
    state.currentDraftId = draft.id;
    state.currentDraft = draft;
    renderDraft(draft);
    document.getElementById("draft-view").hidden = false;
  } catch (err) {
    showToast("초안 로드 실패: " + err.message);
  }
});

function renderDraft(draft) {
  // Gate banner
  renderGateBanner(draft.gate);

  // Meta row
  document.getElementById("draft-version-label").textContent = draft.version_label || "";
  const genMap = { anthropic: "Anthropic AI 생성", template: "규칙 기반 초안" };
  document.getElementById("draft-generator-label").textContent = genMap[draft.generator] || draft.generator || "";

  // AI warning banner: hide when approved
  document.getElementById("ai-warning-banner").hidden = draft.state === "approved";

  // Claims
  renderClaims(draft.claims || [], draft.evidence || []);

  // Editor
  const editor = document.getElementById("draft-editor");
  editor.value = draft.text || "";
  editor.disabled = draft.state === "approved";

  // Approval timeline & buttons
  renderApprovalUI(draft);

  // Evidence panel
  renderEvidence(draft.evidence || []);

  // Workflow status
  const statusMap = { draft: "AI 초안", review: "검토 중", approved: "승인 완료" };
  document.getElementById("workflow-status").textContent = statusMap[draft.state] || draft.state;

  // History
  renderDraftHistory(draft.history || []);
}

function renderGateBanner(gate) {
  const el = document.getElementById("gate-banner");
  if (!gate) { el.className = "gate-banner"; el.innerHTML = ""; return; }

  const cls = { ok: "gate-ok", insufficient: "gate-insufficient", conflict: "gate-conflict" };
  const label = { ok: "근거 충분 — 생성 가능", insufficient: "근거 부족", conflict: "자료 충돌" };
  el.className = "gate-banner " + (cls[gate.status] || "");
  const msgs = (gate.messages || []).map(m => `<li>${escapeHtml(m)}</li>`).join("");
  el.innerHTML = `<strong>${escapeHtml(label[gate.status] || gate.status)}</strong>` +
    (msgs ? `<ul>${msgs}</ul>` : "");
}

function renderClaims(claims, evidence) {
  // Build a map from chunk_id (string) → evidence item
  const evidenceMap = {};
  (evidence || []).forEach(ev => {
    evidenceMap[ev.chunk_id] = ev;
  });

  const el = document.getElementById("claims-list");
  if (!claims.length) {
    el.innerHTML = '<p class="claims-empty">생성된 주장이 없습니다.</p>';
    return;
  }

  const statusConfig = {
    verified: { label: "근거 확인", cls: "badge--verified" },
    warning: { label: "추가 확인", cls: "badge--warning" },
    conflict: { label: "자료 불일치", cls: "badge--conflict" },
    unverifiable: { label: "확인 불가", cls: "badge--unverifiable" },
  };

  el.innerHTML = claims.map((claim, ci) => {
    const sc = statusConfig[claim.status] || { label: claim.status, cls: "" };
    // Citations: opaque string chunk_ids
    const chips = (claim.citations || []).map((cid, ni) => {
      return `<button type="button" class="citation-chip"
        data-claim-index="${ci}" data-citation-index="${ni}"
        data-chunk-id="${escapeHtml(cid)}"
        aria-label="인용 ${ni + 1} 상세 보기">[${ni + 1}]</button>`;
    }).join("");

    return `<div class="claim-item" data-state="${escapeHtml(claim.status)}">
      <div class="claim-header">
        <span class="evidence-badge ${escapeHtml(sc.cls)}">${escapeHtml(sc.label)}</span>
      </div>
      <p class="claim-text">${escapeHtml(claim.text)} ${chips}</p>
    </div>`;
  }).join("");

  // Attach citation chip handlers — look up by string equality
  el.querySelectorAll(".citation-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const cid = chip.dataset.chunkId; // opaque string e.g. "c12", "l3", "t3"
      const ev = evidenceMap[cid];
      if (ev) {
        openEvidenceDialog(ev);
      } else {
        showToast("해당 인용의 근거 정보를 찾을 수 없습니다.");
      }
    });
  });
}

function renderDraftHistory(history) {
  const container = document.getElementById("revision-history");
  const list = document.getElementById("history-list");
  if (!history.length) {
    container.hidden = true;
    return;
  }
  container.hidden = false;
  list.innerHTML = history.map(h =>
    `<li>${escapeHtml(h.version_label || "")} · ${escapeHtml(h.note || "")} · ${escapeHtml(h.by || "")} · ${escapeHtml(formatDateTime(h.at))}</li>`
  ).join("");
}

function renderApprovalUI(draft) {
  const s = draft.state;

  // Timeline
  const tld = document.getElementById("tl-draft");
  const tlr = document.getElementById("tl-review");
  const tla = document.getElementById("tl-approved");
  tld.className = s === "draft" ? "is-current" : "is-complete";
  tlr.className = s === "review" ? "is-current" : s === "approved" ? "is-complete" : "";
  tla.className = s === "approved" ? "is-current" : "";

  // Record
  const rec = document.getElementById("approval-record");
  if (s === "approved" && draft.approved_by) {
    rec.textContent = `${draft.version_label} · ${draft.approved_by} · ${formatDateTime(draft.approved_at)} · 승인 기록 저장됨`;
  } else {
    rec.textContent = `${draft.version_label} · 승인자와 승인 시각은 최종 승인 후 기록됩니다.`;
  }

  // Buttons
  const btnSave = document.getElementById("btn-save-draft");
  const btnReview = document.getElementById("btn-review");
  const btnApprove = document.getElementById("btn-approve");
  const btnExport = document.getElementById("btn-export");

  btnSave.disabled = s === "approved";
  btnReview.disabled = s !== "draft";
  btnApprove.disabled = s !== "review";
  btnExport.disabled = s !== "approved";
}

// ═══════════════════════════════════════════════════════
// DRAFTS — APPROVAL ACTIONS
// ═══════════════════════════════════════════════════════

document.getElementById("btn-save-draft").addEventListener("click", saveDraftText);
document.getElementById("btn-review").addEventListener("click", startReview);
document.getElementById("btn-approve").addEventListener("click", approveDraft);
document.getElementById("btn-export").addEventListener("click", exportDraft);

async function saveDraftText() {
  if (!state.currentDraftId) return;
  const text = document.getElementById("draft-editor").value.trim();
  if (!text) { showToast("내용을 입력한 뒤 저장하세요."); return; }
  const btn = document.getElementById("btn-save-draft");
  setLoading(btn, true);
  try {
    const draft = await api("PUT", "/drafts/" + state.currentDraftId, { text });
    state.currentDraft = draft;
    renderDraft(draft);
    await loadDraftList();
    showToast("저장되었습니다.", "ok");
  } catch (err) {
    if (err.status === 409) {
      showToast("승인된 초안은 수정할 수 없습니다.");
    } else {
      showToast("저장 실패: " + err.message);
    }
  } finally {
    btn.disabled = false;
    btn.classList.remove("is-loading");
  }
}

async function startReview() {
  if (!state.currentDraftId) return;
  const btn = document.getElementById("btn-review");
  setLoading(btn, true);
  try {
    const draft = await api("POST", "/drafts/" + state.currentDraftId + "/review");
    state.currentDraft = draft;
    renderDraft(draft);
    await loadDraftList();
    showToast("검토 상태로 전환되었습니다.", "ok");
  } catch (err) {
    showToast("검토 전환 실패: " + err.message);
  } finally {
    btn.disabled = false;
    btn.classList.remove("is-loading");
  }
}

async function approveDraft() {
  if (!state.currentDraftId) return;
  const confirmed = window.confirm(
    "출처·기준일·확인 불가 항목을 검토했습니까?\n승인하면 이 버전을 고객 상담에 사용할 수 있습니다."
  );
  if (!confirmed) return;
  const btn = document.getElementById("btn-approve");
  setLoading(btn, true);
  try {
    const draft = await api("POST", "/drafts/" + state.currentDraftId + "/approve", { confirm: true });
    state.currentDraft = draft;
    renderDraft(draft);
    await loadDraftList();
    showToast("승인이 완료되었습니다.", "ok");
  } catch (err) {
    if (err.status === 409) {
      showToast("검토 상태에서만 승인할 수 있습니다.");
    } else {
      showToast("승인 실패: " + err.message);
    }
  } finally {
    btn.disabled = false;
    btn.classList.remove("is-loading");
  }
}

async function exportDraft() {
  if (!state.currentDraftId) return;
  const btn = document.getElementById("btn-export");
  setLoading(btn, true);
  try {
    const res = await fetch("/api/drafts/" + state.currentDraftId + "/export", {
      headers: { Authorization: "Bearer " + state.token },
    });
    if (res.status === 401) { logout(); return; }
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.detail || "내보내기 실패");
    }
    const html = await res.text();
    const blob = new Blob([html], { type: "text/html; charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, "_blank");
    if (!win) showToast("팝업이 차단되었습니다. 팝업을 허용한 뒤 다시 시도하세요.", "warning");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (err) {
    showToast("인쇄 준비 실패: " + err.message);
  } finally {
    btn.disabled = false;
    btn.classList.remove("is-loading");
  }
}

// ═══════════════════════════════════════════════════════
// EVIDENCE
// ═══════════════════════════════════════════════════════

function evidenceSourceLabel(ev) {
  // structured evidence: chunk_ids starting with l* or t*
  if (ev.source_type === "listing") return "매물 데이터";
  if (ev.source_type === "trade") return "실거래가";
  return ev.publisher || ev.source_type || "출처 미상";
}

function renderEvidence(evidence) {
  const countEl = document.getElementById("evidence-count");
  const listEl = document.getElementById("evidence-list");
  countEl.textContent = evidence.length + "건";

  if (!evidence.length) {
    listEl.innerHTML = '<div class="evidence-empty">연결된 근거가 없습니다.</div>';
    return;
  }

  listEl.innerHTML = evidence.map((ev, i) =>
    `<button class="evidence-card" type="button"
      data-state="${escapeHtml(ev.state || "draft")}"
      data-ev-index="${i}"
      aria-label="${escapeHtml(ev.title || "")} 상세 열기">
      <header>
        <h3>${escapeHtml(ev.title || "")}</h3>
        <span class="evidence-badge">${escapeHtml(ev.badge || ev.state || "")}</span>
      </header>
      <p>${escapeHtml(evidenceSourceLabel(ev))} · ${escapeHtml(formatDate(ev.date))}</p>
    </button>`
  ).join("");

  listEl.querySelectorAll(".evidence-card").forEach(card => {
    card.addEventListener("click", () => {
      const idx = parseInt(card.dataset.evIndex, 10);
      openEvidenceDialog(evidence[idx]);
    });
  });
}

function openEvidenceDialog(ev) {
  document.getElementById("evidence-dialog-title").textContent = ev.title || "근거 문서";
  document.getElementById("dialog-publisher").textContent = evidenceSourceLabel(ev);
  document.getElementById("dialog-date").textContent = formatDate(ev.date);

  const effRow = document.getElementById("dialog-effective-row");
  if (ev.effective_date) {
    document.getElementById("dialog-effective-date").textContent = formatDate(ev.effective_date);
    effRow.hidden = false;
  } else {
    effRow.hidden = true;
  }

  document.getElementById("dialog-location").textContent = ev.location || "-";
  document.getElementById("dialog-snippet").textContent = ev.snippet || "";

  const linkRow = document.getElementById("dialog-link-row");
  if (ev.url) {
    document.getElementById("dialog-link").href = ev.url;
    document.getElementById("dialog-link").textContent = "원문 보기";
    linkRow.hidden = false;
  } else {
    linkRow.hidden = true;
  }

  const dialog = document.getElementById("evidence-dialog");
  if (typeof dialog.showModal === "function") {
    dialog.showModal();
  } else {
    dialog.setAttribute("open", "");
  }
}

// Dialog close handlers
document.querySelector(".dialog-close").addEventListener("click", () => {
  document.getElementById("evidence-dialog").close();
});

document.getElementById("evidence-dialog").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) e.currentTarget.close();
});

// Evidence search
document.getElementById("evidence-search-btn").addEventListener("click", searchEvidence);
document.getElementById("evidence-search").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); searchEvidence(); }
});

async function searchEvidence() {
  const q = document.getElementById("evidence-search").value.trim();
  if (!q) return;
  const btn = document.getElementById("evidence-search-btn");
  setLoading(btn, true);
  try {
    const result = await api("GET", "/evidence/search?q=" + encodeURIComponent(q));
    const items = result.items || [];
    renderEvidence(items);
    if (!items.length) showToast("검색 결과가 없습니다.", "warning");
  } catch (err) {
    showToast("근거 검색 실패: " + err.message);
  } finally {
    btn.disabled = false;
    btn.classList.remove("is-loading");
  }
}

// ═══════════════════════════════════════════════════════
// MODE TABS
// ═══════════════════════════════════════════════════════

function setMode(mode) {
  state.currentMode = mode;

  document.querySelectorAll(".mode-tab").forEach(tab => {
    const active = tab.dataset.mode === mode;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  });

  document.getElementById("advise-area").hidden = mode !== "advise";
  document.getElementById("ask-area").hidden = mode !== "ask";
}

document.querySelectorAll(".mode-tab").forEach(tab => {
  tab.addEventListener("click", () => setMode(tab.dataset.mode));
  tab.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next = state.currentMode === "advise" ? "ask" : "advise";
    setMode(next);
    document.querySelector(`[data-mode="${next}"]`).focus();
  });
});

// ═══════════════════════════════════════════════════════
// HASH ROUTING
// ═══════════════════════════════════════════════════════

function handleHashChange() {
  if (!state.token) return; // not logged in yet
  const hash = location.hash || "#/map";

  if (hash.startsWith("#/map/listing/")) {
    const id = hash.slice("#/map/listing/".length);
    showView("map");
    ensureMapView().then(() => {
      if (id) selectListing(id);
    });
  } else if (hash === "#/map" || hash === "" || hash === "#") {
    showView("map");
    ensureMapView();
  } else if (hash === "#/consult") {
    showView("consult");
  } else {
    location.hash = "#/map";
  }
}

function showView(view) {
  document.getElementById("map-view").hidden = view !== "map";
  document.getElementById("consult-view").hidden = view !== "consult";
  document.getElementById("nav-map").classList.toggle("is-active", view === "map");
  document.getElementById("nav-consult").classList.toggle("is-active", view === "consult");
  document.getElementById("nav-map").setAttribute("aria-current", view === "map" ? "page" : "false");
  document.getElementById("nav-consult").setAttribute("aria-current", view === "consult" ? "page" : "false");
  if (view === "map" && mapState.leafletMap) {
    setTimeout(() => mapState.leafletMap.invalidateSize(), 60);
  }
}

window.addEventListener("hashchange", () => {
  if (state.token) handleHashChange();
});

// ═══════════════════════════════════════════════════════
// MAP STATE
// ═══════════════════════════════════════════════════════

const mapState = {
  leafletMap: null,
  markers: {},       // id (string) → { marker, data }
  selectedId: null,
  allListings: [],
  filterMine: false,
  mapFailed: false,
  mapInitDone: false,
  tempMarker: null,
  editListingId: null,
  listingDetail: null,
};

// ═══════════════════════════════════════════════════════
// MAP INIT
// ═══════════════════════════════════════════════════════

async function ensureMapView(forceReload) {
  if (!mapState.mapInitDone) {
    mapState.mapInitDone = true;
    if (typeof window.L !== "undefined") {
      initLeaflet();
    } else {
      mapState.mapFailed = true;
      showMapFallback();
    }
    forceReload = true;
  }
  if (forceReload || mapState.allListings.length === 0) {
    await loadListings();
  }
}

function initLeaflet() {
  const mapEl = document.getElementById("map");
  if (!mapEl || mapState.leafletMap) return;
  mapState.leafletMap = L.map("map").setView([37.548, 126.952], 14);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors",
    maxZoom: 19,
  }).addTo(mapState.leafletMap);
  mapState.leafletMap.on("click", onMapClick);
}

function showMapFallback() {
  const el = document.getElementById("listing-map-fallback");
  if (el) el.hidden = false;
}

// ═══════════════════════════════════════════════════════
// MAP VIEW — LOAD & RENDER LISTINGS
// ═══════════════════════════════════════════════════════

async function loadListings() {
  const params = new URLSearchParams();
  if (mapState.filterMine) params.set("mine", "true");
  const sortEl = document.getElementById("listing-sort");
  if (sortEl && sortEl.value) params.set("sort", sortEl.value);
  try {
    const result = await api("GET", "/listings?" + params.toString());
    mapState.allListings = result.items || [];
    document.getElementById("listing-count").textContent = String(mapState.allListings.length);
    renderListingCards(mapState.allListings);
    renderMarkers(mapState.allListings);
  } catch (err) {
    showToast("매물 목록 로드 실패: " + err.message);
  }
}

function renderListingCards(listings) {
  const container = document.getElementById("listing-cards");
  if (!listings.length) {
    container.innerHTML = '<p class="listings-empty">등록된 매물이 없습니다.</p>';
    return;
  }
  container.innerHTML = listings.map(l => {
    const price = formatPrice(l.price);
    const area = l.area_m2 ? escapeHtml(String(l.area_m2)) + "㎡" : "";
    const floor = l.floor ? escapeHtml(String(l.floor)) : "";
    const mineBadge = l.mine ? '<span class="mine-badge">내 매물</span>' : "";
    const isSelected = String(l.id) === mapState.selectedId;
    return `<button type="button"
      class="listing-card${l.mine ? " is-mine" : ""}${isSelected ? " is-selected" : ""}"
      data-listing-id="${escapeHtml(String(l.id))}"
      aria-label="${escapeHtml(l.title || l.label || "")} 상세 보기">
      <div class="listing-card-header">
        <span class="listing-card-label">${escapeHtml(l.label || "")}</span>
        ${mineBadge}
      </div>
      <strong class="listing-card-title">${escapeHtml(l.title || l.complex_name || "")}</strong>
      <div class="listing-card-price">${escapeHtml(price)}</div>
      <div class="listing-card-sub">
        ${area ? `<span>${area}</span>` : ""}
        ${floor ? `<span>${floor}</span>` : ""}
        ${l.district ? `<span>${escapeHtml(l.district)}</span>` : ""}
      </div>
    </button>`;
  }).join("");

  container.querySelectorAll(".listing-card").forEach(card => {
    card.addEventListener("click", () => {
      const id = card.dataset.listingId;
      history.pushState(null, "", "#/map/listing/" + id);
      selectListing(id);
    });
  });
}

// ── Leaflet markers ───────────────────────────────────

function renderMarkers(listings) {
  Object.values(mapState.markers).forEach(m => m.marker.remove());
  mapState.markers = {};
  if (!mapState.leafletMap) return;

  const valid = listings.filter(l => l.lat && l.lng);
  if (!valid.length) return;

  valid.forEach(l => {
    const id = String(l.id);
    const isSelected = id === mapState.selectedId;
    const icon = createPriceIcon(l, isSelected);
    const marker = L.marker([l.lat, l.lng], { icon });
    marker.addTo(mapState.leafletMap);
    marker.on("click", () => {
      history.pushState(null, "", "#/map/listing/" + id);
      selectListing(id);
    });
    mapState.markers[id] = { marker, data: l };
  });

  // Fit bounds to all markers
  const pts = valid.map(l => [l.lat, l.lng]);
  try {
    // 처음 로드할 때 애니메이션 없이 맞춤 — 지도가 움직이는 동안 마커 클릭이 빗나가지 않도록
    mapState.leafletMap.fitBounds(L.latLngBounds(pts).pad(0.15), { animate: false });
  } catch {}
}

function createPriceIcon(listing, isSelected) {
  const id = String(listing.id);
  const price = formatPrice(listing.price);
  const classes = [
    "listing-marker",
    listing.mine ? "is-mine" : "is-muted",
    isSelected ? "is-selected" : "",
  ].filter(Boolean).join(" ");
  return L.divIcon({
    className: "listing-marker-wrap",
    html: `<div class="${classes}" data-listing-id="${escapeHtml(id)}">${escapeHtml(price)}</div>`,
    iconSize: [72, 30],
    iconAnchor: [36, 38],
    popupAnchor: [0, -40],
  });
}

function updateMarkerStyle(id, isSelected) {
  const m = mapState.markers[id];
  if (!m) return;
  const el = m.marker.getElement();
  if (!el) return;
  const inner = el.querySelector(".listing-marker");
  if (!inner) return;
  if (isSelected) {
    inner.classList.add("is-selected");
    inner.classList.remove("is-mine", "is-muted");
  } else {
    inner.classList.remove("is-selected");
    inner.classList.toggle("is-mine", m.data.mine);
    inner.classList.toggle("is-muted", !m.data.mine);
  }
}

// ═══════════════════════════════════════════════════════
// LISTING SELECTION & DETAIL
// ═══════════════════════════════════════════════════════

async function selectListing(id) {
  const prevId = mapState.selectedId;
  mapState.selectedId = id;

  // Update marker styles
  if (prevId && prevId !== id) updateMarkerStyle(prevId, false);
  updateMarkerStyle(id, true);

  // Pan to marker
  const m = mapState.markers[id];
  if (m && mapState.leafletMap) {
    mapState.leafletMap.panTo(m.marker.getLatLng());
  }

  // Highlight card
  document.querySelectorAll(".listing-card").forEach(card => {
    card.classList.toggle("is-selected", card.dataset.listingId === id);
  });

  // Switch to detail panel and load
  showListingPanel("detail");
  await loadListingDetail(id);
}

async function loadListingDetail(id) {
  try {
    const data = await api("GET", "/listings/" + id);
    mapState.listingDetail = data;
    populateDetailEl(data);
  } catch (err) {
    showToast("매물 상세 로드 실패: " + err.message);
    showListingPanel("list");
  }
}

function showListingPanel(panelState) {
  document.getElementById("listing-list-view").hidden = panelState !== "list";
  document.getElementById("listing-detail-view").hidden = panelState !== "detail";
  document.getElementById("listing-form-view").hidden = panelState !== "form";
}

function populateDetailEl(data) {
  const l = data.listing || {};
  const candidates = data.candidates || [];

  // Title & label
  document.getElementById("listing-detail-title").textContent = l.title || l.complex_name || "";
  document.getElementById("ld-label").textContent = l.label || "";

  // Price
  document.getElementById("ld-price").textContent = formatPrice(l.price);

  // Price history
  const phEl = document.getElementById("ld-price-history");
  const ph = (l.price_history || []).slice(0, 3);
  if (ph.length) {
    phEl.innerHTML = ph.map(p =>
      `<span>${escapeHtml(formatPrice(p.price))} <small>(${escapeHtml(formatDate(p.changed_at))})</small></span>`
    ).join(" → ");
  } else {
    phEl.innerHTML = "";
  }

  // Facts
  const setEl = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val != null ? String(val) : "-";
  };
  const areaFloor = [l.area_m2 ? l.area_m2 + "㎡" : "", l.floor || ""].filter(Boolean).join(" / ") || "-";
  setEl("ld-area", areaFloor);
  setEl("ld-address", l.address || "-");
  setEl("ld-district", l.district || "-");
  setEl("ld-station", l.station
    ? l.station + (l.station_walk_min ? " 도보 " + l.station_walk_min + "분" : "")
    : "-");
  setEl("ld-park", l.park_walk_min ? l.park_walk_min + "분" : "-");

  // Description
  const descWrap = document.getElementById("ld-description-wrap");
  if (l.description) {
    document.getElementById("ld-description").textContent = l.description;
    descWrap.hidden = false;
  } else {
    descWrap.hidden = true;
  }

  // Registration info
  setEl("ld-registered-by", l.registered_by_name || "-");
  setEl("ld-created-at", formatDate(l.created_at));
  setEl("ld-source", l.source || "-");
  setEl("ld-source-date", formatDate(l.source_date));

  // Trade reference
  const trEl = document.getElementById("ld-trade-ref");
  const tr = data.trade_reference;
  if (tr) {
    trEl.innerHTML = `
      <h3 class="ld-section-title">실거래가 참고</h3>
      <dl class="trade-ref-dl">
        <div><dt>중위가</dt><dd>${escapeHtml(formatPrice(tr.median_price))}</dd></div>
        <div><dt>거래 건수</dt><dd>${escapeHtml(String(tr.count || 0))}건</dd></div>
        <div><dt>기간</dt><dd>${escapeHtml(tr.period || "-")}</dd></div>
        <div><dt>출처</dt><dd>${escapeHtml(tr.source || "-")}</dd></div>
        <div><dt>기준일</dt><dd>${escapeHtml(formatDate(tr.as_of))}</dd></div>
      </dl>
      <p class="trade-ref-note">과거 신고 거래 · 현재 호가 아님 (거래 가능 상태를 뜻하지 않습니다)</p>`;
  } else {
    trEl.innerHTML = '<h3 class="ld-section-title">실거래가 참고</h3><p class="trade-ref-none">실거래 자료 없음</p>';
  }

  // Consultations this listing appears in
  const consEl = document.getElementById("ld-consultations");
  const consList = document.getElementById("ld-consultation-list");
  if (candidates.length) {
    consList.innerHTML = candidates.map(c => {
      const statusLabel = { interest: "관심", compare: "비교", excluded: "제외" }[c.status] || c.status;
      return `<li>
        <strong>${escapeHtml(c.customer_name || "상담 #" + c.consultation_id)}</strong>
        <span class="candidate-status-badge candidate-status-badge--${escapeHtml(c.status || "")}">${escapeHtml(statusLabel)}</span>
        ${c.reason ? `<small>${escapeHtml(c.reason)}</small>` : ""}
      </li>`;
    }).join("");
    consEl.hidden = false;
  } else {
    consEl.hidden = true;
  }

  // Add-to-consultation select
  populateAddConsultSelect();

  // Manage actions (own listings only)
  const mgmtEl = document.getElementById("listing-mgmt-actions");
  if (l.mine) {
    mgmtEl.hidden = false;
    document.getElementById("btn-edit-listing").onclick = () => showListingForm(l);
    document.getElementById("listing-close-btn").onclick = () => closeListing(String(l.id));
  } else {
    mgmtEl.hidden = true;
  }
}

function populateAddConsultSelect() {
  const sel = document.getElementById("add-consult-select");
  if (!sel) return;
  sel.innerHTML = '<option value="">상담 선택...</option>' +
    state.consultations.map(c =>
      `<option value="${escapeHtml(String(c.id))}">${escapeHtml(c.customer_name)} \xb7 ${escapeHtml(c.deal_type)}</option>`
    ).join("");
}

// Add to consultation
document.getElementById("add-to-consult").addEventListener("click", async (e) => {
  const btn = e.target.closest(".toggle-btn[data-status]");
  if (!btn) return;
  const status = btn.dataset.status;
  const cid = document.getElementById("add-consult-select").value;
  if (!cid) { showToast("상담을 선택하세요.", "warning"); return; }
  const listingId = mapState.selectedId;
  if (!listingId) return;
  try {
    await api("PUT", "/consultations/" + cid + "/candidates/" + listingId, { status });
    showToast("후보에 추가했습니다.", "ok");
    await loadListingDetail(listingId);
  } catch (err) {
    showToast("후보 추가 실패: " + err.message);
  }
});

// ═══════════════════════════════════════════════════════
// LISTING FORM (REGISTER / EDIT)
// ═══════════════════════════════════════════════════════

function showListingForm(editListing) {
  mapState.editListingId = editListing ? String(editListing.id) : null;
  document.getElementById("listing-form-title").textContent = editListing ? "매물 수정" : "매물 등록";
  document.getElementById("listing-form-submit").textContent = editListing ? "수정 저장" : "등록";
  document.getElementById("form-map-hint").hidden = !!editListing;

  const form = document.getElementById("listing-form");
  form.reset();
  document.getElementById("listing-form-error").hidden = true;

  if (editListing) {
    const set = (name, val) => {
      const el = form.elements[name];
      if (el && val != null) el.value = String(val);
    };
    set("title", editListing.title);
    set("complex_name", editListing.complex_name);
    set("address", editListing.address);
    set("district", editListing.district);
    set("price", editListing.price);
    set("area_m2", editListing.area_m2);
    set("floor", editListing.floor);
    set("station", editListing.station);
    set("station_walk_min", editListing.station_walk_min);
    set("park_walk_min", editListing.park_walk_min);
    set("lat", editListing.lat);
    set("lng", editListing.lng);
    set("description", editListing.description);
  }
  showListingPanel("form");
}

document.getElementById("listing-register-btn").addEventListener("click", () => {
  showListingForm(null);
});

document.getElementById("listing-form-cancel-btn").addEventListener("click", () => {
  clearTempMarker();
  if (mapState.selectedId) {
    showListingPanel("detail");
  } else {
    showListingPanel("list");
  }
});

document.getElementById("listing-back-btn").addEventListener("click", () => {
  const prevId = mapState.selectedId;
  mapState.selectedId = null;
  if (prevId) updateMarkerStyle(prevId, false);
  history.pushState(null, "", "#/map");
  showListingPanel("list");
});

// Map click → fill lat/lng when form is open
function onMapClick(e) {
  const formView = document.getElementById("listing-form-view");
  if (!formView || formView.hidden) return;
  const { lat, lng } = e.latlng;
  document.getElementById("lf-lat").value = lat.toFixed(6);
  document.getElementById("lf-lng").value = lng.toFixed(6);
  clearTempMarker();
  if (mapState.leafletMap) {
    mapState.tempMarker = L.marker([lat, lng], { draggable: true }).addTo(mapState.leafletMap);
    mapState.tempMarker.on("dragend", (ev) => {
      const pos = ev.target.getLatLng();
      document.getElementById("lf-lat").value = pos.lat.toFixed(6);
      document.getElementById("lf-lng").value = pos.lng.toFixed(6);
    });
  }
}

function clearTempMarker() {
  if (mapState.tempMarker) {
    mapState.tempMarker.remove();
    mapState.tempMarker = null;
  }
}

// Submit listing form (POST new / PUT edit)
document.getElementById("listing-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = document.getElementById("listing-form-submit");
  setLoading(btn, true);
  const errEl = document.getElementById("listing-form-error");
  errEl.hidden = true;

  const form = e.target;
  const body = {};
  const numericFields = ["price", "area_m2", "station_walk_min", "park_walk_min", "lat", "lng"];

  for (const el of form.elements) {
    if (!el.name || el.name === "") continue;
    const val = el.value.trim();
    if (!val) continue;
    body[el.name] = numericFields.includes(el.name) ? parseFloat(val) : val;
  }

  try {
    let result;
    if (mapState.editListingId) {
      result = await api("PUT", "/listings/" + mapState.editListingId, body);
    } else {
      result = await api("POST", "/listings", body);
    }
    clearTempMarker();
    showToast(mapState.editListingId ? "수정되었습니다." : "등록되었습니다.", "ok");
    await loadListings();
    const newId = String(result.id || mapState.editListingId);
    mapState.selectedId = newId;
    history.pushState(null, "", "#/map/listing/" + newId);
    showListingPanel("detail");
    await loadListingDetail(newId);
  } catch (err) {
    const raw = err._rawDetail;
    if (Array.isArray(raw)) {
      errEl.textContent = raw.map(d =>
        (d.loc && d.loc[1] ? d.loc[1] + ": " : "") + d.msg
      ).join("\n");
    } else {
      errEl.textContent = err.message;
    }
    errEl.hidden = false;
  } finally {
    btn.disabled = false;
    btn.classList.remove("is-loading");
  }
});

// Close listing
async function closeListing(id) {
  if (!window.confirm("이 매물을 거래 종료 처리하시겠습니까? 목록에서 제외됩니다.")) return;
  try {
    await api("POST", "/listings/" + id + "/close");
    showToast("거래 종료 처리되었습니다.", "ok");
    mapState.selectedId = null;
    history.pushState(null, "", "#/map");
    await loadListings();
    showListingPanel("list");
  } catch (err) {
    showToast("거래 종료 실패: " + err.message);
  }
}

// Listing filter / sort listeners
document.getElementById("listing-filter-mine").addEventListener("change", (e) => {
  mapState.filterMine = e.target.checked;
  loadListings();
});

document.getElementById("listing-sort").addEventListener("change", () => {
  loadListings();
});

// ═══════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════

async function init() {
  const saved = sessionStorage.getItem("jungme_token");
  if (saved) {
    state.token = saved;
    try {
      state.user = await (async () => {
        const res = await fetch("/api/me", {
          headers: { Authorization: "Bearer " + saved },
        });
        if (!res.ok) throw new Error("session expired");
        return res.json();
      })();
      showApp();
    } catch {
      sessionStorage.removeItem("jungme_token");
      state.token = null;
      showLogin();
    }
  } else {
    showLogin();
  }
}

init();
