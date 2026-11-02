"use strict";
/* 자료실(문서 근거 검색)과 고객 자료(비교표·문의 답변) */

const D = { q: "", type: "", items: [], sel: null, timer: null, docs: {} };
const LIB_TYPES = [["", "전체"], ["law", "법령"], ["policy", "정책"], ["office", "사무소"], ["news", "기사"]];

// ── 자료실 ─────────────────────────────────────────
VIEWS.library = () => {
  $("#library-side").innerHTML = `
    <div class="side-h"><h1>자료실</h1><span>
      <button type="button" class="btn btn--sm" data-act="add-doc">자료 추가</button>
      ${S.user.role === "admin" ? `<button type="button" class="btn btn--sm" data-act="upload">파일 등록</button>` : ""}</span></div>
    <form class="search" id="lib-form">
      <input id="lib-q" type="search" placeholder="예: 거래 신고 기한, 생애최초, 학구도" value="${esc(D.q)}" aria-label="자료 검색어" autocomplete="off" />
      <div class="types" role="group" aria-label="자료 종류">${LIB_TYPES.map(([t, w]) =>
        `<button type="button" data-act="lib-type" data-t="${t || "all"}" aria-pressed="${D.type === t}">${w}</button>`).join("")}</div>
      <button type="button" class="btn btn--sm" data-act="lib-ask" style="justify-self:start">이 내용으로 질문하기 (매물·실거래가 함께)</button>
    </form>
    <div id="lib-hits"><p class="loading">불러오는 중…</p></div>`;
  // 검색 결과에서도 '내가 추가한 자료'인지 알 수 있도록 문서 목록을 한 번 받아 둔다
  api("GET", "/documents").then((ds) => { D.docs = Object.fromEntries(ds.map((d) => [d.id, d])); }).catch(() => {}).finally(searchLibrary);
};

async function searchLibrary() {
  const q = D.q.trim();
  try {
    if (q) {
      const r = await api("GET", `/evidence/search?q=${encodeURIComponent(q)}${D.type ? `&type=${D.type}` : ""}`);
      D.items = r.items.map((e) => ({ kind: "hit", ev: remember(e) }));
    } else {
      const docs = await api("GET", `/documents${D.type ? `?type=${D.type}` : ""}`);
      docs.forEach((d) => { D.docs[d.id] = d; });
      D.items = docs.map((d) => ({ kind: "doc", doc: d }));
    }
  } catch (e) { toast(e.message); D.items = []; }
  if (q !== D.q.trim() || S.view !== "library") return;  // 더 새로운 검색이 진행 중
  renderHits();
}

function renderHits() {
  const hl = (t) => {
    let out = esc(t);
    D.q.trim().split(/\s+/).filter((w) => w.length > 1).forEach((w) => { out = out.split(esc(w)).join(`<mark>${esc(w)}</mark>`); });
    return out;
  };
  $("#lib-hits").innerHTML = D.items.map((it) => {
    if (it.kind === "doc") {
      const d = it.doc;
      return `<button type="button" class="hit ${D.sel === d.first_chunk ? "is-sel" : ""}" data-act="lib-open" data-src="${esc(d.first_chunk)}">
        <div class="t"><span class="typeword">${esc(d.type_label)}</span>${esc(d.title)}</div>
        <div class="m">${esc(d.org)} · ${esc(d.date)}${d.effective_date ? ` · 시행 ${esc(d.effective_date)}` : ""} · 조각 ${d.chunks}개</div></button>`;
    }
    const e = it.ev;
    return `<button type="button" class="hit ${D.sel === e.id ? "is-sel" : ""}" data-act="lib-open" data-src="${esc(e.id)}">
      <div class="t"><span class="typeword">${esc(e.type_label)}</span>${esc(e.title)}</div>
      <div class="m">${esc(e.org)} · ${esc(e.date)} · ${esc(e.location)}${e.state === "conflict" ? " · 공식 자료와 다름" : ""}</div>
      <div class="x">${hl(e.snippet)}</div></button>`;
  }).join("") || `<p class="empty">찾는 내용이 있는 문서가 없습니다.</p>`;
  const first = D.sel || (D.items[0] && (D.items[0].kind === "doc" ? D.items[0].doc.first_chunk : D.items[0].ev.id));
  if (first) showLibraryItem(first); else $("#library-detail").innerHTML = `<p class="empty">왼쪽에서 문서를 고르세요.</p>`;
}

async function showLibraryItem(id) {
  let ev = S.sources[id];
  if (!ev) {
    try { ev = remember(await api("GET", `/evidence/${id}`)); } catch (e) { toast(e.message); return; }
  }
  const doc = D.docs[ev.document_id];
  $("#library-detail").innerHTML = sourceBody(ev, { inLibrary: true, query: D.q })
    + (doc && doc.mine ? `<p><button type="button" class="btn btn--sm" data-act="del-doc" data-doc="${doc.id}">이 자료 지우기</button></p>` : "");
}

document.addEventListener("input", (e) => {
  if (e.target.id !== "lib-q") return;
  D.q = e.target.value;
  D.sel = null;
  $("#lib-hits").innerHTML = `<p class="loading">검색 중…</p>`;  // 이전 목록을 잘못 누르지 않도록
  clearTimeout(D.timer);
  D.timer = setTimeout(searchLibrary, 250);
});
document.addEventListener("submit", (e) => {
  if (e.target.id !== "lib-form") return;
  e.preventDefault();
  clearTimeout(D.timer);
  searchLibrary();
});
ACTIONS["lib-type"] = (el) => {
  D.type = el.dataset.t === "all" ? "" : el.dataset.t;
  D.sel = null;
  document.querySelectorAll("[data-act=lib-type]").forEach((b) => b.setAttribute("aria-pressed", String(b === el)));
  searchLibrary();
};
ACTIONS["lib-open"] = (el) => {
  D.sel = el.dataset.src;
  document.querySelectorAll("#lib-hits .hit").forEach((h) => h.classList.toggle("is-sel", h === el));
  showLibraryItem(D.sel);
};

ACTIONS.quote = async (el) => {
  const ev = S.sources[el.dataset.src];
  const cs = await api("GET", "/customers").catch((e) => { toast(e.message); return null; });
  if (!cs) return;
  openDialog(`<h2>고객 문의 답변에 인용</h2>
    <p class="muted" style="font-size:12px;margin:0 0 8px">인용할 자료: ${esc(ev ? ev.title : el.dataset.src)}</p>
    <label>고객<select id="quote-customer">${cs.map((c) => `<option value="${c.id}" ${c.agent_id === S.user.id ? "" : ""}>${esc(c.name)} (담당 ${esc(c.agent_name)})</option>`).join("")}</select></label>
    <label>고객 문의<textarea id="quote-q" rows="3" maxlength="1000"></textarea></label>
    <div class="btns"><button type="button" class="btn" data-act="close-dialog">취소</button>
    <button type="button" class="btn btn--main" data-act="quote-ok" data-src="${esc(el.dataset.src)}">답변 작성</button></div>`);
};
ACTIONS["quote-ok"] = async (el) => {
  const question = $("#quote-q").value.trim();
  if (!question) { toast("고객 문의 내용을 적어 주세요."); return; }
  const r = await busy(el, () => api("POST", `/customers/${$("#quote-customer").value}/reports`, { kind: "answer", question, quote_id: el.dataset.src }));
  if (r) location.hash = `#/report/${r.id}`;
};

ACTIONS["lib-ask"] = () => {
  const q = $("#lib-q").value.trim();
  if (!q) { toast("물어볼 내용을 검색창에 적어 주세요."); $("#lib-q").focus(); return; }
  location.hash = askHash(q);
};

// 중개사가 직접 적는 사무소 자료 (단지 정보, 현장 확인 내용, 학구도 확인 결과 등)
ACTIONS["add-doc"] = () => openDialog(`<h2>자료 추가</h2>
  <p class="muted" style="font-size:12px;margin:0 0 8px">우리 사무소에서만 보이며, 질문 검색과 고객 자료의 근거로 바로 쓰입니다. 단지 이름을 적으면 그 단지 매물을 찾을 때 함께 봅니다.</p>
  <label>제목<input id="doc-title" maxlength="200" placeholder="예: 용강리버뷰 단지 확인 내용" /></label>
  <label>내용<textarea id="doc-text" rows="8" maxlength="20000" placeholder="예: 용강리버뷰 아파트는 2026년 학구도 기준 용강초 배정 구역입니다(교육지원청 확인, 2026-10)."></textarea></label>
  <label>지역 (선택)<input id="doc-region" maxlength="30" placeholder="예: 마포구" /></label>
  <div class="btns"><button type="button" class="btn" data-act="close-dialog">취소</button><button type="button" class="btn btn--main" data-act="add-doc-ok">추가</button></div>`);
ACTIONS["add-doc-ok"] = async (el) => {
  const body = { title: $("#doc-title").value.trim(), text: $("#doc-text").value.trim(), region: $("#doc-region").value.trim() || null };
  if (!body.title || body.text.length < 5) { toast("제목과 내용을 적어 주세요."); return; }
  const r = await busy(el, () => api("POST", "/documents", body));
  if (!r) return;
  closeDialog();
  toast("자료를 추가했습니다. 질문 검색에 바로 쓰입니다.");
  D.q = ""; D.type = ""; D.sel = r.first_chunk;
  VIEWS.library();
};
ACTIONS["del-doc"] = async (el) => {
  if (!confirm("이 자료를 지울까요? 질문 검색과 이후 고객 자료에서 더 이상 쓰이지 않습니다.")) return;
  const r = await busy(el, () => api("DELETE", `/documents/${el.dataset.doc}`));
  if (r) { toast("자료를 지웠습니다."); D.sel = null; VIEWS.library(); }
};

ACTIONS.upload = () => openDialog(`<h2>파일 등록</h2>
  <label>파일 (txt, md, pdf)<input id="up-file" type="file" accept=".txt,.md,.pdf" /></label>
  <label>제목<input id="up-title" maxlength="200" /></label>
  <div class="row2"><label>종류<select id="up-type"><option value="office">사무소 문서</option><option value="law">법령</option><option value="policy">공식 정책</option><option value="news">기사(이용 허용분)</option></select></label>
    <label>공개 범위<select id="up-scope"><option value="tenant">우리 사무소만</option><option value="public">모든 사무소</option></select></label></div>
  <div class="row2"><label>발행 기관<input id="up-org" value="${esc(S.user.tenant_name)}" /></label><label>기준일<input id="up-date" type="date" /></label></div>
  <div class="row2"><label>시행일 (선택)<input id="up-eff" type="date" /></label><label>지역 (선택)<input id="up-region" placeholder="예: 서울" /></label></div>
  <div class="btns"><button type="button" class="btn" data-act="close-dialog">취소</button><button type="button" class="btn btn--main" data-act="upload-ok">등록</button></div>`);
ACTIONS["upload-ok"] = async (el) => {
  const file = $("#up-file").files[0];
  if (!file || !$("#up-title").value.trim() || !$("#up-date").value) { toast("파일, 제목, 기준일을 입력하세요."); return; }
  const f = new FormData();
  f.append("file", file);
  [["title", "#up-title"], ["source_type", "#up-type"], ["scope", "#up-scope"], ["publisher", "#up-org"], ["published_at", "#up-date"],
   ["effective_date", "#up-eff"], ["region", "#up-region"]].forEach(([k, sel]) => { const v = $(sel).value.trim(); if (v) f.append(k, v); });
  const r = await busy(el, () => api("POST", "/admin/documents", undefined, { form: f }));
  if (r) { closeDialog(); toast(r.job.detail || "등록했습니다."); D.q = ""; VIEWS.library(); }
};

// ── 고객 자료 ─────────────────────────────────────────
VIEWS.report = async (id) => {
  const view = $("#view-report");
  view.innerHTML = `<p class="loading">불러오는 중…</p>`;
  let r;
  try { r = await api("GET", `/reports/${id}`); } catch (e) { toast(e.message); location.hash = "#/customers"; return; }
  D.report = r;
  const order = [];
  const approved = ["approved", "shared"].includes(r.state);
  const flow = ["draft", "review", "approved", "shared"], cur = flow.indexOf(r.state);
  let table = "";
  if (r.kind === "compare" && r.listings.length) {
    const ls = r.listings;
    const row = (h, f) => `<tr><th>${h}</th>${ls.map((l) => `<td>${f(l)}</td>`).join("")}</tr>`;
    table = `<h2>매물 비교</h2><table class="ptbl"><thead><tr><th style="width:110px"></th>${ls.map((l) => `<th>${esc(l.label)} ${esc(l.title)}</th>`).join("")}</tr></thead><tbody>
      ${row("매도 희망가", (l) => `${eok(l.price)}${l.price_history.length > 1 ? `<br><small>${l.price_history.map((h) => eok(h.price)).join("→")}</small>` : ""}`)}
      ${row("전용면적 / 층", (l) => `${l.area_m2}㎡ / ${esc(l.floor || "-")}`)}
      ${row("교통", (l) => (l.station ? `${esc(l.station)} 도보 ${l.station_walk_min}분` : "-"))}
      ${row("공원", (l) => (l.park_walk_min != null ? `도보 ${l.park_walk_min}분` : "-"))}
      ${row("최근 실거래", (l) => (l.trade_reference ? `${eok(l.trade_reference.median_price)} (${l.trade_reference.count}건)` : "자료 없음"))}
      </tbody><tbody>${(() => {
        const conds = [...new Set(ls.flatMap((l) => l.checks.map((c) => c.condition)))];
        return conds.map((cn) => `<tr><th>${esc(cn)}</th>${ls.map((l) => { const c = l.checks.find((x) => x.condition === cn); return c ? `<td class="${c.ok ? "" : "x"}">${c.ok ? "맞음" : "차이"} <small>${esc(c.detail)}</small></td>` : "<td>-</td>"; }).join("")}</tr>`).join("");
      })()}</tbody></table>`;
  }
  const opinion = withNotes(r.opinion, r.sources, order);
  const checks = r.to_check.map((t) => `<li>${withNotes(t, r.sources, order)}</li>`).join("");
  const byId = Object.fromEntries(r.sources.map((s) => [s.id, s]));
  const foot = order.map((sid) => { const s = byId[sid]; return `<li>${esc(s.org)}, 「${esc(s.title)}」 ${esc(s.location || "")} (${esc(s.date)})${s.type === "news" ? " — 보조 자료" : ""}</li>`; }).join("");
  view.innerHTML = `
    <div class="paper-wrap"><article class="paper">
      ${approved ? "" : `<span class="stamp">${r.state === "draft" ? "작성 중" : "검토 중"} · 고객 전달 전</span>`}
      <header class="paper-h"><div><h1>${esc(r.title)}</h1><div class="to">${esc(r.customer_name)} 고객님께 · ${day(r.created_at)} · 제${esc(r.version)}판</div></div>
        <div class="from">${esc(S.user.tenant_name)}<br>공인중개사 ${esc(r.agent_name)}</div></header>
      ${r.question ? `<h2>문의 내용</h2><p class="opinion">${esc(r.question)}</p>` : ""}
      ${table}
      <h2>${r.kind === "answer" ? "답변" : "중개사 의견"}</h2>
      <p class="opinion" id="opinion" ${approved ? "" : 'contenteditable="true"'}>${opinion}</p>
      ${checks ? `<h2>추가로 확인할 사항</h2><ul class="tocheck">${checks}</ul>` : ""}
      <h2>출처</h2><ol class="foot">${foot || "<li>없음</li>"}</ol>
      <div class="paper-end"><span>${approved ? `공인중개사 ${esc(r.approved_by)} 확인 · ${day(r.approved_at)}` : "승인 전 문서입니다."}</span>
        <span>실거래가는 과거 신고 가격이며 현재 매도 희망가와 다를 수 있습니다.</span></div>
    </article></div>
    <aside class="rside">
      <a href="#/customers/${r.customer_id}">${esc(r.customer_name)} 고객으로</a>
      <div><h2 style="font-size:13.5px">진행</h2><ol class="flow">${["작성", "검토", "승인", "전달 (인쇄·링크)"].map((t, i) =>
        `<li class="${i < cur ? "done" : ""} ${i === cur ? "cur" : ""}">${t}</li>`).join("")}</ol></div>
      <div class="acts">
        ${!approved ? `<button type="button" class="btn" data-act="save-edit">수정 내용 저장</button>
          <p class="hint">의견 문단은 문서에서 바로 고칠 수 있습니다. 각주 번호를 누르면 원문이 열립니다.</p>` : ""}
        ${r.state === "draft" ? `<button type="button" class="btn btn--main" data-act="to-review">검토 요청</button>` : ""}
        ${r.state === "review" ? `<button type="button" class="btn btn--main" data-act="approve">출처 확인 후 승인</button>
          ${S.user.role === "admin" || S.user.id === r.agent_id ? "" : `<p class="hint">고객 담당(${esc(r.agent_name)})이나 관리자가 승인합니다.</p>`}` : ""}
        <button type="button" class="btn ${approved ? "btn--main" : ""}" data-act="print" ${approved ? "" : "disabled"}>인쇄 / PDF 저장</button>
        <button type="button" class="btn" data-act="share" ${approved ? "" : "disabled"}>링크로 보내기</button>
        ${approved ? "" : `<p class="hint">인쇄와 링크 전달은 승인한 판만 할 수 있습니다.</p>`}
        ${r.share ? `<div class="share"><b>보낸 링크</b><code>${esc(r.share.url)}</code>
          <span>${day(r.share.expires_at)}까지 · 열람 ${r.share.views}회${r.share.last_view ? ` (마지막 ${dateTime(r.share.last_view)})` : ""}</span></div>` : ""}
        ${r.history.length ? `<div><h2 style="font-size:13.5px;margin-top:6px">이력</h2><ol class="flow">${r.history.map((h) =>
          `<li class="done">${esc(h.version)}판 · ${esc(h.note)} · ${esc(h.by || "")} ${day(h.at)}</li>`).join("")}</ol></div>` : ""}
      </div>
    </aside>`;
};

async function reportAction(btn, method, path, body, msg) {
  const r = await busy(btn, () => api(method, path, body));
  if (r) { toast(msg); VIEWS.report(D.report.id); }
  return r;
}
ACTIONS["save-edit"] = (el) => {
  const opinion = textWithTokens($("#opinion"));
  if (!opinion) { toast("의견 문단이 비어 있습니다."); return; }
  reportAction(el, "PUT", `/reports/${D.report.id}`, { opinion }, "수정 내용을 새 판으로 저장했습니다.");
};
ACTIONS["to-review"] = (el) => reportAction(el, "POST", `/reports/${D.report.id}/review`, undefined, "검토를 요청했습니다.");
ACTIONS.approve = (el) => {
  if (!confirm("출처와 기준일, 추가로 확인할 사항을 확인했습니까? 승인하면 이 판은 고칠 수 없습니다.")) return;
  reportAction(el, "POST", `/reports/${D.report.id}/approve`, { confirm: true }, "승인했습니다. 인쇄와 링크 전달을 할 수 있습니다.");
};
ACTIONS.print = async (el) => {
  const w = window.open("", "_blank");
  await busy(el, async () => {
    const res = await fetch(`/api/reports/${D.report.id}/export`, { headers: { Authorization: `Bearer ${S.token}` } });
    if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => ({}))).detail);
    const url = URL.createObjectURL(new Blob([await res.text()], { type: "text/html;charset=utf-8" }));
    if (w) w.location.href = url; else window.open(url, "_blank");
  });
};
ACTIONS.share = async (el) => {
  const r = await busy(el, () => api("POST", `/reports/${D.report.id}/share`));
  if (!r) return;
  await VIEWS.report(D.report.id);
  openDialog(`<h2>링크로 보내기</h2><label>링크<input readonly value="${esc(r.share.url)}" id="share-url" /></label>
    <p class="muted" style="font-size:12px">승인한 ${esc(r.version)}판만 열립니다. ${day(r.share.expires_at)}까지 유효하며, 고객이 열면 상담 기록에 남습니다.</p>
    <div class="btns"><button type="button" class="btn" data-act="copy-share">복사</button><button type="button" class="btn btn--main" data-act="close-dialog">확인</button></div>`);
};
ACTIONS["copy-share"] = async () => {
  try { await navigator.clipboard.writeText($("#share-url").value); toast("링크를 복사했습니다."); }
  catch { $("#share-url").select(); toast("링크를 선택했습니다. Ctrl+C로 복사하세요."); }
};
