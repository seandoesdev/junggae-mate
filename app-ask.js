"use strict";
/* 질문 검색: 상단바의 질문 버튼 → 뒤가 흐려지며 질문 창이 내려온다 → 답변(각주 출처) + 맞는 매물(지도 강조).
   질문 창은 바깥 아무 곳이나 누르거나 Esc를 누르면 닫힌다. 결과는 지도 화면 왼쪽에 보인다. */

const ASK_EXAMPLES = ["마포구 8억 이하 59㎡ 학교 가까운 집", "공원 가까운 조용한 집", "생애최초 지원 받을 수 있는 아파트", "거래 신고는 계약 후 며칠 안에?"];
const askHash = (q) => `#/map/ask/${encodeURIComponent(q)}`;

const RECENT_KEY = "mate_recent_questions";
const recentQuestions = () => { try { return JSON.parse(sessionStorage.getItem(RECENT_KEY)) || []; } catch { return []; } };
function rememberQuestion(q) {
  sessionStorage.setItem(RECENT_KEY, JSON.stringify([q, ...recentQuestions().filter((x) => x !== q)].slice(0, 5)));
}

// ── 질문 창 열기·닫기 ─────────────────────────────────────────
const PICK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>`;
const RECENT_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>`;
const askLayer = () => $("#ask-layer");
const isAskOpen = () => askLayer().classList.contains("is-open");

function openAsk() {
  const pick = (q, icon) => `<li><button type="button" class="ask-pick" data-act="ask-example" data-q="${esc(q)}">${icon}<span>${esc(q)}</span></button></li>`;
  $("#ask-examples").innerHTML = ASK_EXAMPLES.map((q) => pick(q, PICK_ICON)).join("");
  const recent = recentQuestions();
  $("#ask-recent").innerHTML = recent.map((q) => pick(q, RECENT_ICON)).join("");
  $("#ask-recent-h").hidden = !recent.length;
  $("#ask-uses").hidden = recent.length > 0;
  const input = $("#ask-q");
  input.value = M.ask ? M.ask.q : "";
  askLayer().classList.add("is-open");
  askLayer().setAttribute("aria-hidden", "false");
  $("#ask-trigger").setAttribute("aria-expanded", "true");
  setTimeout(() => { input.focus(); input.select(); }, 60);
}
function closeAsk({ restoreFocus = true } = {}) {
  if (!isAskOpen()) return;
  askLayer().classList.remove("is-open");
  askLayer().setAttribute("aria-hidden", "true");
  $("#ask-trigger").setAttribute("aria-expanded", "false");
  if (restoreFocus) $("#ask-trigger").focus();
}
/* 상단바 질문 버튼: 지금 보고 있는 질문을 보여 준다 */
function setAskLabel() {
  const has = !!(M.ask && location.hash.startsWith("#/map"));
  $("#ask-trigger-label").textContent = has ? M.ask.q : "매물·법령·정책을 물어보세요";
  $("#ask-trigger").classList.toggle("has-q", has);
}
ACTIONS["ask-open"] = openAsk;
ACTIONS["ask-close"] = () => closeAsk();   // 흐린 바깥 아무 곳이나 누르면 닫힌다
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && isAskOpen()) { e.preventDefault(); e.stopPropagation(); closeAsk(); return; }
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
  if (e.key === "/" && !typing && !isAskOpen() && S.user && !$("#dialog").open) { e.preventDefault(); openAsk(); }
}, true);
// 질문 창 안에서 Tab이 뒤의 화면으로 빠져나가지 않게
askLayer().addEventListener("keydown", (e) => {
  if (e.key !== "Tab") return;
  const f = [...askLayer().querySelectorAll("input, button")].filter((x) => x.offsetParent !== null);
  if (!f.length) return;
  if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f.at(-1).focus(); }
  else if (!e.shiftKey && document.activeElement === f.at(-1)) { e.preventDefault(); f[0].focus(); }
});
addEventListener("hashchange", () => { closeAsk({ restoreFocus: false }); setAskLabel(); });

function ask(q) {
  rememberQuestion(q);
  closeAsk({ restoreFocus: false });
  if (location.hash === askHash(q)) { M.ask = null; route(); }   // 같은 질문을 다시 누르면 새로 찾는다
  else location.hash = askHash(q);
}

document.addEventListener("submit", (e) => {
  if (e.target.id !== "ask-form") return;
  e.preventDefault();
  const input = $("#ask-q");
  const q = input.value.trim();
  if (!q) { input.focus(); return; }
  ask(q);
});

/* 같은 질문으로 돌아올 때(매물 상세 → 질문 결과)는 뺀 조건과 결과를 그대로 쓴다. */
/* 실패하면 같은 질문의 이전 결과를 그대로 두고 null을 돌려준다. 늦게 도착한 이전 요청의 응답은 버린다. */
async function loadAsk(q, drop) {
  drop = drop || (M.ask && M.ask.q === q ? M.ask.drop : []);
  const key = `${q}|${drop.join(",")}`;
  if (M.ask && M.ask.key === key) return M.ask;
  const prev = M.ask && M.ask.q === q ? M.ask : null;
  const seq = (M.askSeq = (M.askSeq || 0) + 1);
  $("#ask-q").value = q;
  $("#map-side").innerHTML = `<p class="loading">찾는 중…</p>`;
  try {
    const result = await api("POST", "/search", { q, drop, session_id: prev ? prev.result.session_id : undefined });
    if (seq !== M.askSeq) return null;
    M.ask = { q, drop, key, result };
    return M.ask;
  } catch (e) {
    if (seq === M.askSeq) { toast(e.message, 4200); M.ask = prev; }
    return null;
  }
}

function renderAsk() {
  const { q, drop, result: r } = M.ask;
  const order = [];
  const opinion = withNotes(r.opinion, r.sources, order);
  const checks = r.to_check.map((t) => `<li>${withNotes(t, r.sources, order)}</li>`).join("");
  const byId = Object.fromEntries(r.sources.map((s) => [s.id, s]));
  const foot = order.map((id) => byId[id]).filter(Boolean);
  const live = Object.fromEntries(M.listings.map((l) => [l.id, l]));   // 단계는 지금 상태로
  const ls = r.listings;
  setAskLabel();
  $("#map-side").innerHTML = `
    <div class="side-h"><h1>질문 결과</h1><span><button type="button" class="btn btn--sm" data-act="ask-open">다시 묻기</button>
      <button type="button" class="btn btn--sm" data-act="clear-ask">닫기</button></span></div>
    <div class="ask-res">
      <p class="ask-q">${esc(q)}</p>
      ${r.understood.length || drop.length ? `<div class="understood"><span class="lbl">찾은 조건</span>
        ${r.understood.map((c) => `<button type="button" class="cond" data-act="ask-drop" data-key="${esc(c.key)}" title="이 조건을 빼고 다시 찾기">${esc(c.label)}<b aria-hidden="true">×</b></button>`).join("")}
        ${drop.length ? `<button type="button" class="btn btn--sm" data-act="ask-reset">뺀 조건 되돌리기</button>` : ""}</div>` : ""}

      ${ls.length || r.listing_intent ? `<div class="sec" id="ask-listings"><div class="sec-h"><h2>${r.relaxed ? "조건에 가까운 매물" : "맞는 매물"} <span class="muted num">${ls.length}</span></h2>
          <span class="muted">지도에 강조</span></div>
        <table class="tbl"><thead><tr><th></th><th>매물</th><th class="r">가격</th><th>단계</th></tr></thead><tbody>
        ${ls.map((l) => {
          const st = (live[l.id] || l).stage;
          return `<tr class="lrow clickable ${l.mine ? "" : "is-other"}" style="--c:${st === "available" ? "var(--line)" : STAGE_COLOR[st]}" data-act="open" data-id="${l.id}" tabindex="0">
            <td></td><td><b>${esc(l.label)}</b> ${esc(l.title)}${l.mine ? "" : ` <span class="muted">· ${esc(l.agent_name)}</span>`}
              ${l.matched.map((m) => `<span class="why">${esc(m.want)}: ${esc(m.text)}</span>`).join("")}
              ${l.unmet.map((u) => `<span class="why gap">차이: ${esc(u)}</span>`).join("")}</td>
            <td class="r num">${eok(l.price)}</td><td>${stageTag(st)}</td></tr>`;
        }).join("") || `<tr><td colspan="4" class="empty">${emptyListingText(r)}</td></tr>`}
        </tbody></table></div>` : ""}

      <div class="sec"><div class="sec-h"><h2>답변</h2></div>
        <p class="opinion" id="ask-answer">${opinion}</p>
        ${checks ? `<div class="sec-h" style="margin-top:12px;border-bottom-width:1px"><h2>추가로 확인할 사항</h2></div><ul class="tocheck">${checks}</ul>` : ""}
        ${foot.length ? `<ol class="foot-list">${foot.map((s) => `<li>${srcLink(s)} <span class="muted">${esc(s.date)}</span></li>`).join("")}</ol>` : ""}
        <p style="margin:10px 0 0"><button type="button" class="btn btn--sm" data-act="ask-report">고객 자료로 만들기</button></p>
      </div>
    </div>`;
}

/* 맞는 매물이 없을 때 표 안의 한 문장과 다음 행동 */
function emptyListingText(r) {
  const p = r.understood.find((c) => c.key === "place" || c.key === "district");
  const reset = r.understood.length ? `<br><button type="button" class="btn btn--sm" style="margin-top:8px" data-act="ask-drop-all">조건 빼고 사무소 매물 보기</button>` : "";
  return `${p ? `${esc(p.label)} 안에 등록된 매물이 없습니다.` : "맞는 매물이 없습니다. 위 조건을 눌러 빼고 다시 찾아 보세요."}${reset}`;
}

async function rerunAsk(drop) {
  if (!(await loadAsk(M.ask.q, drop))) { if (M.ask && S.view === "map" && !M.detailId) renderAsk(); return; }
  M.matchIds = askMatchIds();
  renderFilter();
  renderPins();
  renderAsk();
}
ACTIONS["ask-drop"] = (el) => rerunAsk([...M.ask.drop, el.dataset.key]);
ACTIONS["ask-reset"] = () => rerunAsk([]);
ACTIONS["ask-drop-all"] = () => rerunAsk([...new Set([...M.ask.drop, ...M.ask.result.understood.map((c) => c.key)])]);
ACTIONS["clear-ask"] = () => { M.ask = null; $("#ask-q").value = ""; setAskLabel(); location.hash = "#/map"; };
ACTIONS["ask-example"] = (el) => ask(el.dataset.q);

ACTIONS["ask-report"] = async (el) => {
  const q = el?.dataset.q || M.ask.q;
  const drop = el?.dataset.drop ? JSON.parse(el.dataset.drop) : M.ask.drop;
  const cs = await api("GET", "/customers").catch((e) => { toast(e.message); return null; });
  if (!cs) return;
  const mineFirst = cs.slice().sort((a, b) => (b.agent_id === S.user.id) - (a.agent_id === S.user.id));
  openDialog(`<h2>고객 자료로 만들기</h2>
    <p class="muted" style="font-size:12px;margin:0 0 8px">질문: ${esc(q)}<br>뺀 조건은 그대로 빼고, 질문에 없는 예산·면적·지역은 고객 조건으로 채워 다시 찾습니다. 만든 뒤 문서에서 고치고 승인하면 인쇄·링크로 보낼 수 있습니다.</p>
    <label>고객<select id="ask-customer">${mineFirst.map((c) => `<option value="${c.id}">${esc(c.name)} (담당 ${esc(c.agent_name)})</option>`).join("")}</select></label>
    <div class="btns"><button type="button" class="btn" data-act="close-dialog">취소</button>
    <button type="button" class="btn btn--main" data-act="ask-report-ok" data-q="${esc(q)}" data-drop="${esc(JSON.stringify(drop))}" ${cs.length ? "" : "disabled"}>만들기</button></div>`);
};
ACTIONS["ask-report-ok"] = async (el) => {
  const r = await busy(el, () => api("POST", `/customers/${$("#ask-customer").value}/reports`, { kind: "answer", question: el.dataset.q, drop: JSON.parse(el.dataset.drop || "[]") }));
  if (r) location.hash = `#/report/${r.id}`;
};
