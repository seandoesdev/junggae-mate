"use strict";
/* 거래 보드와 고객 화면 */

const P = { boardScope: "mine" };

// ── 거래 ─────────────────────────────────────────
VIEWS.deals = async () => {
  let deals;
  try { deals = await api("GET", `/deals${P.boardScope === "mine" ? "?mine=true" : ""}`); }
  catch (e) { toast(e.message); return; }
  $("#board").innerHTML = STAGES.map((s) => {
    const items = deals.filter((d) => d.stage === s);
    return `<section class="col" aria-label="${STAGE_LABEL[s]}"><div class="col-h">${stageTag(s)}<span class="num">${items.length}</span></div>
      ${items.map((d) => {
        const i = stageIdx(d.stage), can = canChange(d);
        return `<article class="dcard ${d.agent_id === S.user.id ? "" : "is-other"}">
          <div class="dcard-top"><a href="#/customers/${d.customer_id}">${esc(d.customer_name)}</a><span class="muted num">${d.days_in_stage}일</span></div>
          <button type="button" class="btn--link" style="text-align:left" data-act="open" data-id="${d.listing_id}">${esc(d.listing.label)} ${esc(d.listing.title)} · ${eok(d.listing.price)}</button>
          <div class="next">${esc(d.next_action || "")}</div>
          <div class="acts"><span class="who">담당 ${esc(d.agent_name)}</span>
            <span><button type="button" class="btn btn--sm" data-act="prev" data-id="${d.id}" data-stage="${d.stage}" ${i <= 0 || !can ? "disabled" : ""} aria-label="이전 단계">이전</button>
            <button type="button" class="btn btn--sm" data-act="next" data-id="${d.id}" data-stage="${d.stage}" ${i >= 4 || !can ? "disabled" : ""} aria-label="다음 단계">다음</button></span></div>
        </article>`;
      }).join("") || `<p class="col-empty">없음</p>`}</section>`;
  }).join("");
  const dropped = deals.filter((d) => d.stage === "dropped");
  $("#dropped").textContent = `무산 ${dropped.length}건${dropped.length ? ": " + dropped.map((d) => `${d.customer_name}–${d.listing.label} (${d.dropped_reason || "-"})`).join(", ") : ""}`;
};

document.addEventListener("click", (e) => {
  const b = e.target.closest("#view-deals [data-scope]");
  if (!b) return;
  P.boardScope = b.dataset.scope;
  document.querySelectorAll("#view-deals [data-scope]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  VIEWS.deals();
});

// ── 고객 ─────────────────────────────────────────
const REPORT_STATE = { draft: "작성 중", review: "검토 요청", approved: "승인", shared: "전달함" };

VIEWS.customers = async (id) => {
  let list;
  try { list = await api("GET", "/customers"); } catch (e) { toast(e.message); return; }
  const cid = Number(id) || list.find((c) => c.agent_id === S.user.id)?.id || list[0]?.id;
  $("#customer-list").innerHTML = `
    <div class="side-h"><h2>고객 <span class="muted num">${list.length}</span></h2>
      <button type="button" class="btn btn--sm" data-act="new-customer">고객 등록</button></div>
    <table class="tbl"><thead><tr><th>이름</th><th>담당</th><th>진행</th></tr></thead><tbody>
    ${list.map((c) => `<tr class="clickable ${c.id === cid ? "is-sel" : ""}" data-act="customer" data-id="${c.id}" tabindex="0">
      <td><b>${esc(c.name)}</b> <span class="muted">${esc(c.deal_type)}</span></td><td>${esc(c.agent_name)}</td>
      <td>${c.top_stage ? `${stageTag(c.top_stage)} <span class="muted num">${c.active_deals}건</span>` : `<span class="muted">-</span>`}</td></tr>`).join("")}
    </tbody></table>`;
  if (cid) await renderCustomer(cid);
  else $("#customer-detail").innerHTML = `<p class="empty">등록된 고객이 없습니다.</p>`;
};

async function renderCustomer(cid) {
  let d;
  try { d = await api("GET", `/customers/${cid}`); } catch (e) { toast(e.message); return; }
  const c = d.customer;
  P.customer = c;
  $("#customer-detail").innerHTML = `
    <div class="c-head"><div><h1>${esc(c.name)} <span class="muted" style="font-size:13px">${esc(c.deal_type)}</span></h1>
      <div class="meta">담당 ${esc(c.agent_name)}${c.phone ? ` · ${esc(c.phone)}` : ""}${c.first_home ? " · 생애최초 구입" : ""}</div></div>
      <div class="c-acts">
        <a class="btn" href="#/map/match/${c.id}">조건에 맞는 매물 지도에서 보기</a>
        <button type="button" class="btn btn--main" data-act="new-compare" data-id="${c.id}">비교표 작성</button>
        <button type="button" class="btn" data-act="new-answer" data-id="${c.id}">문의 답변 작성</button>
      </div></div>

    <div class="sec"><div class="sec-h"><h2>찾는 조건</h2><button type="button" class="btn--link" data-act="edit-customer">수정</button></div>
      <dl class="kv"><dt>예산</dt><dd>${c.budget_max ? `${eok(c.budget_max)} 이하` : "-"}</dd><dt>면적</dt><dd>${c.area_min ? `전용 ${c.area_min}㎡ 이상` : "-"}</dd>
        <dt>지역</dt><dd>${esc(c.district || "-")}${c.station_walk_max ? `, 역 도보 ${c.station_walk_max}분 이내` : ""}</dd>
        <dt>원하는 점</dt><dd>${esc(c.preferences.join(", ") || "-")}</dd></dl>
      <div id="customer-warnings"></div></div>

    <div class="cols-2">
      <div class="sec"><div class="sec-h"><h2>거래</h2><span class="muted">진행 ${c.active_deals}건</span></div>
        <table class="tbl"><thead><tr><th>매물</th><th class="r">가격</th><th>단계</th><th>다음 할 일</th></tr></thead><tbody>
        ${d.deals.map((x) => `<tr class="clickable" data-act="open" data-id="${x.listing_id}" tabindex="0">
          <td><b>${esc(x.listing.label)}</b> ${esc(x.listing.title)}</td><td class="r num">${eok(x.listing.price)}</td>
          <td>${stageTag(x.stage)}${x.stage === "dropped" ? "" : `<br>${prog(x.stage)}`}</td>
          <td>${esc(x.stage === "dropped" ? x.dropped_reason : x.next_action)}</td></tr>`).join("")
          || `<tr><td colspan="4" class="empty">연결된 매물이 없습니다. 지도에서 매물을 고른 뒤 "고객 연결"을 누르세요.</td></tr>`}
        </tbody></table></div>

      <div>
        <div class="sec"><div class="sec-h"><h2>고객 자료</h2></div>
          <table class="tbl"><thead><tr><th>자료</th><th>판</th><th>상태</th></tr></thead><tbody>
          ${d.reports.map((r) => `<tr class="clickable" data-act="report" data-id="${r.id}" tabindex="0"><td><a href="#/report/${r.id}">${esc(r.title)}</a>
            <span class="muted">${day(r.created_at)}</span></td><td class="num">${esc(r.version)}</td><td><span class="state" data-s="${r.state}">${REPORT_STATE[r.state]}</span></td></tr>`).join("")
            || `<tr><td colspan="3" class="empty">없음</td></tr>`}
          </tbody></table></div>
        <div class="sec"><div class="sec-h"><h2>상담 기록</h2></div>
          <form class="memo" id="memo-form"><input id="memo-text" placeholder="상담 메모 (예: 전화로 주말 방문 약속)" maxlength="1000" aria-label="상담 메모" />
            <button type="submit" class="btn btn--sm">기록</button></form>
          <ol class="timeline" style="margin-top:8px">${d.activities.map((a) => `<li><time>${day(a.at)}</time><span>${esc(a.text)}${a.user_name ? ` <span class="muted">· ${esc(a.user_name)}</span>` : ""}</span></li>`).join("")
            || `<li><time></time><span class="muted">기록 없음</span></li>`}</ol></div>
      </div>
    </div>`;
}

ACTIONS.customer = (el) => { location.hash = `#/customers/${el.dataset.id}`; };
ACTIONS.report = (el) => { location.hash = `#/report/${el.dataset.id}`; };

document.addEventListener("submit", async (e) => {
  if (e.target.id !== "memo-form") return;
  e.preventDefault();
  const text = $("#memo-text").value.trim();
  if (!text) return;
  const ok = await busy(e.target.querySelector("button"), () => api("POST", `/customers/${P.customer.id}/activities`, { text }));
  if (ok) renderCustomer(P.customer.id);
});

function customerFields(c) {
  const v = (k) => esc(c ? c[k] ?? "" : "");
  return `<label>이름 *<input id="cf-name" value="${v("name")}" maxlength="50" required /></label>
    <div class="row2"><label>거래 종류<input id="cf-deal_type" value="${c ? v("deal_type") : "아파트 매수"}" maxlength="20" /></label>
      <label>연락처<input id="cf-phone" value="${v("phone")}" maxlength="30" /></label></div>
    <div class="row2"><label>예산 상한 (만원)<input id="cf-budget_max" type="number" value="${v("budget_max")}" /></label>
      <label>최소 면적 (㎡)<input id="cf-area_min" type="number" step="any" value="${v("area_min")}" /></label></div>
    <div class="row2"><label>지역 (구)<input id="cf-district" value="${c ? v("district") : "마포구"}" maxlength="30" /></label>
      <label>역 도보 (분 이내)<input id="cf-station_walk_max" type="number" value="${v("station_walk_max")}" /></label></div>
    <label>원하는 점 (쉼표로 구분)<input id="cf-preferences" value="${esc(c ? c.preferences.join(", ") : "")}" /></label>
    <label class="check-row"><input id="cf-first_home" type="checkbox" ${c && c.first_home ? "checked" : ""} /> 생애최초 구입</label>`;
}

function customerBody() {
  const num = (id) => { const v = $(id).value.trim(); return v === "" ? null : Number(v); };
  return {
    name: $("#cf-name").value.trim(), deal_type: $("#cf-deal_type").value.trim() || "매수", phone: $("#cf-phone").value.trim() || null,
    budget_max: num("#cf-budget_max"), area_min: num("#cf-area_min"), district: $("#cf-district").value.trim() || null,
    station_walk_max: num("#cf-station_walk_max"), first_home: $("#cf-first_home").checked,
    preferences: $("#cf-preferences").value.split(",").map((s) => s.trim()).filter(Boolean),
  };
}

ACTIONS["new-customer"] = () => openDialog(`<h2>고객 등록</h2>${customerFields(null)}
  <div class="btns"><button type="button" class="btn" data-act="close-dialog">취소</button><button type="button" class="btn btn--main" data-act="customer-save">등록</button></div>`);
ACTIONS["edit-customer"] = () => openDialog(`<h2>찾는 조건 수정</h2>${customerFields(P.customer)}
  <div class="btns"><button type="button" class="btn" data-act="close-dialog">취소</button><button type="button" class="btn btn--main" data-act="customer-save" data-id="${P.customer.id}">저장</button></div>`);
ACTIONS["customer-save"] = async (el) => {
  const id = el.dataset.id;
  const r = await busy(el, () => api(id ? "PUT" : "POST", id ? `/customers/${id}` : "/customers", customerBody()));
  if (!r) return;
  closeDialog();
  if (id) {
    await renderCustomer(Number(id));
    if (r.warnings.length) $("#customer-warnings").innerHTML = `<ul class="warn-list">${r.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>`;
    toast("조건을 저장했습니다.");
  } else {
    toast(`${r.name} 고객을 등록했습니다.`);
    location.hash = `#/customers/${r.id}`;
  }
};

// ── 고객 자료 만들기 ─────────────────────────────────────────
async function createReport(btn, cid, body) {
  btn.textContent = "작성 중…";
  const r = await busy(btn, () => api("POST", `/customers/${cid}/reports`, body));
  if (r) location.hash = `#/report/${r.id}`;
  else if (btn.isConnected) btn.textContent = body.kind === "compare" ? "비교표 작성" : "작성";
}
ACTIONS["new-compare"] = (el) => createReport(el, el.dataset.id, { kind: "compare" });
ACTIONS["new-answer"] = (el) => openDialog(`<h2>문의 답변 작성</h2>
  <label>고객 문의<textarea id="q" rows="3" maxlength="1000"></textarea></label>
  <p class="muted" style="font-size:12px;margin:0">자료실의 법령·공식 정책·사무소 문서에서 관련 조항을 찾아 답변 초안을 만듭니다.</p>
  <div class="btns"><button type="button" class="btn" data-act="close-dialog">취소</button>
  <button type="button" class="btn btn--main" data-act="answer-ok" data-id="${esc(el.dataset.id)}">작성</button></div>`);
ACTIONS["answer-ok"] = (el) => {
  const question = $("#q").value.trim();
  if (!question) { toast("고객 문의 내용을 적어 주세요."); return; }
  createReport(el, el.dataset.id, { kind: "answer", question });
};
