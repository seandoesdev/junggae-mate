"use strict";
/* 관리자 공공데이터 운영: 키를 노출하지 않고 승인된 API를 수집하고 작업 결과를 확인한다. */

const PUBLIC_LABEL = {
  trades: "아파트 매매 실거래가",
  "public_data:15126474": "아파트 전월세 실거래가",
  "public_data:15058453": "공동주택 단지정보",
  "public_data:15134735": "건축물대장",
  "public_data:15098554": "지하철역 정보",
};

const publicMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
};

function collectCard({ id, title, help, action, fields }) {
  return `<section class="card collect-card"><h2>${esc(title)}</h2><p>${esc(help)}</p>
    <form class="collect-form" data-collect="${esc(id)}" data-action="${esc(action)}">
      ${fields.map((f) => `<label class="${f.wide ? "wide" : ""}">${esc(f.label)}
        ${f.select ? `<select name="${esc(f.name)}">${f.select.map(([v, w]) => `<option value="${esc(v)}">${esc(w)}</option>`).join("")}</select>`
          : `<input name="${esc(f.name)}" value="${esc(f.value || "")}" placeholder="${esc(f.placeholder || "")}" ${f.required === false ? "" : "required"}
              ${f.pattern ? `pattern="${esc(f.pattern)}"` : ""} ${f.inputmode ? `inputmode="${esc(f.inputmode)}"` : ""} />`}
        ${f.note ? `<small>${esc(f.note)}</small>` : ""}</label>`).join("")}
      <button type="submit" class="btn btn--main">수집</button>
    </form><p class="collect-result" id="collect-result-${esc(id)}" role="status" aria-live="polite"></p></section>`;
}

const PUBLIC_CARDS = [
  { id: "trades", title: "아파트 매매 실거래가", help: "시군구와 계약월 단위로 신고 매매 자료를 갱신합니다.", action: "/admin/collect/trades", fields: [
    { name: "lawd_cd", label: "법정동 시군구 코드", value: "11440", pattern: "[0-9]{5}", inputmode: "numeric", note: "5자리 코드 (예: 서울 마포구 11440)" },
    { name: "deal_ymd", label: "계약월", value: publicMonth(), pattern: "[0-9]{6}", inputmode: "numeric", note: "YYYYMM" },
  ] },
  { id: "rents", title: "아파트 전월세 실거래가", help: "시군구와 계약월 단위로 신고 자료를 갱신합니다.", action: "/admin/collect/rents", fields: [
    { name: "lawd_cd", label: "법정동 시군구 코드", value: "11440", pattern: "[0-9]{5}", inputmode: "numeric", note: "5자리 코드 (예: 서울 마포구 11440)" },
    { name: "deal_ymd", label: "계약월", value: publicMonth(), pattern: "[0-9]{6}", inputmode: "numeric", note: "YYYYMM" },
  ] },
  { id: "complexes", title: "공동주택 단지정보", help: "K-apt 단지코드로 기본정보를 갱신합니다.", action: "/admin/collect/complexes", fields: [
    { name: "kapt_code", label: "K-apt 단지코드", placeholder: "예: A10024875", pattern: "[A-Za-z0-9]+", note: "영문과 숫자로 된 단지코드", wide: true },
  ] },
  { id: "buildings", title: "건축물대장 표제부", help: "법정동과 지번을 기준으로 건축물 정보를 수집합니다.", action: "/admin/collect/buildings", fields: [
    { name: "sigungu_cd", label: "시군구 코드", value: "11440", pattern: "[0-9]{5}", inputmode: "numeric" },
    { name: "bjdong_cd", label: "법정동 코드", placeholder: "예: 10100", pattern: "[0-9]{5}", inputmode: "numeric" },
    { name: "plat_gb_cd", label: "대지 구분", required: false, select: [["", "전체"], ["0", "대지"], ["1", "산"], ["2", "블록"], ["3", "기타"]] },
    { name: "bun", label: "본번", placeholder: "예: 123", pattern: "[0-9]{1,4}", inputmode: "numeric", required: false },
    { name: "ji", label: "부번", placeholder: "예: 4", pattern: "[0-9]{1,4}", inputmode: "numeric", required: false },
  ] },
  { id: "stations", title: "지하철역 정보", help: "역명으로 노선별 역 정보를 갱신합니다.", action: "/admin/collect/subway-stations", fields: [
    { name: "station_name", label: "역명", placeholder: "예: 공덕", note: "‘역’을 제외한 이름도 사용할 수 있습니다.", wide: true },
  ] },
];

function publicJobRows(jobs) {
  const rows = jobs.filter((j) => j.kind === "trades" || j.kind.startsWith("public_data:"));
  if (!rows.length) return `<p class="empty-box">아직 공공데이터 수집 기록이 없습니다.</p>`;
  return `<ul class="job-list">${rows.map((j) => {
    const state = j.status === "done" ? ["pill--ok", "완료"] : j.status === "failed" ? ["pill--warn", "실패"] : ["pill--neutral", "진행 중"];
    return `<li><span class="job-kind">${esc(PUBLIC_LABEL[j.kind] || j.kind)}</span><span class="pill ${state[0]} job-state">${state[1]}</span>
      <span class="job-detail">${esc(j.detail || "-")}</span><time class="job-time">${esc(dateTime(j.finished_at || j.created_at) || "-")}</time></li>`;
  }).join("")}</ul>`;
}

async function loadPublicJobs() {
  const host = $("#public-jobs");
  if (!host) return;
  try { host.innerHTML = publicJobRows(await api("GET", "/admin/jobs")); }
  catch (e) { host.innerHTML = `<div class="pub-error" role="alert"><p>수집 기록을 불러오지 못했습니다.</p><span>${esc(e.message)}</span><button type="button" class="btn btn--sm" data-act="public-jobs-retry">다시 시도</button></div>`; }
}

VIEWS.public = async () => {
  if (S.user.role !== "admin") { location.hash = "#/map"; return; }
  const view = $("#view-public");
  view.innerHTML = `<header class="page-head"><div><h1>공공데이터</h1></div><button type="button" class="btn btn--sm" data-act="public-jobs-retry">기록 새로고침</button></header>
    <p class="public-intro">승인된 공공데이터포털 API를 서버 키로 수집합니다. API 키 값은 이 화면에 표시하거나 브라우저로 전송하지 않습니다.</p>
    <div class="collect-grid">${PUBLIC_CARDS.map(collectCard).join("")}</div>
    <section class="job-sec"><div class="sec-h"><h2>최근 수집 작업</h2><span class="muted">최근 50개 작업 중 공공데이터</span></div><div id="public-jobs"><p class="loading">불러오는 중…</p></div></section>`;
  await loadPublicJobs();
};

ACTIONS["public-jobs-retry"] = loadPublicJobs;

document.addEventListener("submit", async (e) => {
  const form = e.target.closest("form[data-collect]");
  if (!form) return;
  e.preventDefault();
  const out = $(`#collect-result-${form.dataset.collect}`);
  const btn = form.querySelector("button[type=submit]");
  const body = Object.fromEntries(new FormData(form));
  Object.keys(body).forEach((key) => { if (body[key] === "") delete body[key]; });
  btn.disabled = true;
  out.className = "collect-result";
  out.textContent = "수집 중입니다. 데이터 양에 따라 시간이 걸릴 수 있습니다…";
  try {
    const r = await api("POST", form.dataset.action, body);
    const summary = r.job?.detail || `${r.received || 0}건 수신, ${r.inserted || 0}건 신규 저장`;
    out.className = "collect-result is-ok";
    out.textContent = `완료: ${summary}`;
    await loadPublicJobs();
  } catch (err) {
    out.className = "collect-result is-error";
    out.textContent = `실패: ${err.message}`;
  } finally { btn.disabled = false; }
});
