"use strict";

const workflows = {
  advise: {
    description:
      "고객 조건과 상담 기록을 바탕으로 후보를 비교하고, 근거가 연결된 설명 초안을 만듭니다.",
    steps: [
      {
        label: "고객 선택",
        role: "중개사 입력",
        title: "고객과 상담을 선택합니다",
        description:
          "새 상담을 만들거나 이전 상담을 불러와 고객의 요구와 과거 결정 맥락을 이어갑니다.",
        actions: ["김하늘 고객의 매수 상담을 선택", "이전 상담 내용과 제외 사유를 확인"],
        system: ["고객별 조건과 상담 이력을 불러오기", "사무소 권한 범위 안의 정보만 표시"],
        status: "상담 선택",
        demo: [
          ["상담 유형", "아파트 매수", "2026-10-29 생성"],
          ["이전 상담", "2회", "최근 상담 10월 24일"],
          ["담당 중개사", "김선용", "승인 권한 있음"],
        ],
        evidence: [],
      },
      {
        label: "조건 입력",
        role: "중개사 입력",
        title: "고객 조건을 구조화합니다",
        description:
          "예산·면적·입지처럼 필터에 쓰는 조건과 통학·공원처럼 설명에 반영할 선호를 나눠 기록합니다.",
        actions: ["필수 조건과 선호 조건을 구분", "관심·제외 매물과 제외 사유를 확인"],
        system: ["검색 가능한 조건으로 변환", "누락되거나 서로 충돌하는 조건을 표시"],
        status: "조건 확인",
        demo: [
          ["필수", "8억 이하", "예산 상한"],
          ["필수", "전용 59㎡ 이상", "면적 하한"],
          ["선호", "공원·통학", "설명에 반영"],
        ],
        evidence: [],
      },
      {
        label: "매물 검색",
        role: "구조화 데이터",
        title: "조건에 맞는 매물을 찾습니다",
        description:
          "매물 검색은 AI의 추측이 아니라 가격·면적·위치·기준일이 있는 구조화 데이터로 수행합니다.",
        actions: ["예산·면적·입지 필터를 적용", "가격순 또는 최신순으로 결과를 정렬"],
        system: ["필터에 맞는 결과만 반환", "각 매물의 정보 기준일과 가격 출처를 표시"],
        status: "12건 검색",
        demo: [
          ["검색 결과", "12개", "조건 일치"],
          ["정보 기준일", "2026-10-28", "최신성 확인"],
          ["가격 변동", "3개", "변경 이력 있음"],
        ],
        evidence: [
          {
            title: "매물 데이터 기준일",
            text: "제휴 데이터 · 2026-10-28 수집",
            state: "verified",
            badge: "근거 확인",
          },
        ],
      },
      {
        label: "후보 비교",
        role: "중개사 선택",
        title: "2~5개 후보를 같은 기준으로 비교합니다",
        description:
          "후보별 적합 여부와 가격 변화를 한 화면에서 보고, 중개사가 상담에 포함할 매물을 직접 고릅니다.",
        actions: ["후보 A·B·C를 비교 목록에 추가", "관심 후보와 제외 후보를 확정"],
        system: ["가격·면적·입지·변경 이력을 같은 순서로 표시", "고객 조건과 다른 항목을 숨기지 않고 표시"],
        status: "3개 비교",
        demo: [
          ["후보 A", "7.8억 · 59㎡", "역 7분"],
          ["후보 B", "7.5억 · 62㎡", "공원 3분"],
          ["후보 C", "8.0억 · 59㎡", "역 4분"],
        ],
        evidence: [
          {
            title: "후보 B 가격 변경",
            text: "7.7억 → 7.5억 · 10월 22일 변경",
            state: "verified",
            badge: "근거 확인",
          },
        ],
      },
      {
        label: "근거 검색",
        role: "RAG 검색",
        title: "정책·기사·사무소 문서에서 근거를 찾습니다",
        description:
          "후보가 있는 지역과 고객 질문에 맞는 문서를 검색하고, 적용 지역·기준일·이용 조건을 함께 확인합니다.",
        actions: ["확인할 질문을 선택하거나 직접 입력", "검색된 원문 조각과 출처를 열어 확인"],
        system: ["권한이 있는 자료만 검색", "자료가 충돌하거나 오래됐으면 경고"],
        status: "근거 3건",
        demoType: "warning",
        demo: {
          title: "자료 간 불일치가 발견되었습니다",
          text: "기사의 시행일과 공식 정책 문서의 시행일이 다릅니다. 공식 문서를 우선 확인하고 상담 전에 적용일을 다시 검토하세요.",
        },
        evidence: [
          {
            title: "생애최초 주택 구입 지원 안내",
            text: "국토교통부 · 2026-09-30 갱신 · 4쪽",
            state: "verified",
            badge: "근거 확인",
          },
          {
            title: "서울 주택시장 동향 기사",
            text: "이용 허용 기사 · 2026-10-21 · 3문단",
            state: "warning",
            badge: "추가 확인",
          },
          {
            title: "지원정책 시행일",
            text: "공식 문서와 기사에 서로 다른 날짜가 기재됨",
            state: "conflict",
            badge: "자료 불일치",
          },
        ],
      },
      {
        label: "AI 초안",
        role: "AI 보조",
        title: "추천 이유와 확인 사항을 초안으로 정리합니다",
        description:
          "각 추천 사유를 고객 조건 또는 문서 근거에 연결합니다. 근거가 없는 내용은 생성하지 않고 확인 불가로 남깁니다.",
        actions: ["후보별 설명이 실제 조건과 일치하는지 확인", "인용을 눌러 원문과 기준일을 대조"],
        system: ["후보별 장단점과 확인 사항을 생성", "검증 가능한 사실 주장마다 인용 연결"],
        status: "AI 초안",
        demoType: "warning",
        demo: {
          title: "확인 불가: 후보 C의 학군 배정",
          text: "현재 검색된 자료만으로는 배정 학교를 확정할 수 없습니다. 관할 교육기관의 최신 자료를 추가로 확인하세요.",
        },
        evidence: [
          {
            title: "후보 B 추천 사유",
            text: "공원 도보 3분 · 고객 선호 ‘공원’과 연결",
            state: "verified",
            badge: "조건 연결",
          },
          {
            title: "상담 설명 초안",
            text: "중개사 검토 전 · 고객에게 전달할 수 없음",
            state: "draft",
            badge: "AI 초안",
          },
          {
            title: "후보 C 학군",
            text: "직접 근거 부족 · 추가 확인 필요",
            state: "warning",
            badge: "확인 불가",
          },
        ],
      },
      {
        label: "검토·승인",
        role: "중개사 결정",
        title: "중개사가 수정하고 최종 승인합니다",
        description:
          "중개사는 매물 정보와 인용 원문을 다시 확인하고, 필요한 표현을 수정한 뒤 고객 상담에 사용할 버전을 승인합니다.",
        actions: ["근거·기준일·확인 불가 항목을 최종 점검", "표현을 수정하고 승인 완료로 전환"],
        system: ["초안과 승인본을 분리해 보관", "승인자·승인 시각·수정 이력을 기록"],
        status: "검토 필요",
        demoType: "approval",
        demo: null,
        evidence: [
          {
            title: "상담자료 초안",
            text: "근거 4건 · 확인 불가 1건 포함 · 승인 전",
            state: "draft",
            badge: "검토 필요",
          },
        ],
      },
    ],
  },
  ask: {
    description:
      "매물·지역·정책 질문을 입력하면 허용된 문서에서 근거를 찾고, 출처와 기준일이 연결된 답변 초안을 만듭니다.",
    steps: [
      {
        label: "상담 선택",
        role: "중개사 입력",
        title: "질문이 속한 상담을 선택합니다",
        description: "현재 고객과 검토 중인 매물을 선택해 질문에 필요한 맥락을 불러옵니다.",
        actions: ["김하늘 고객의 매수 상담을 선택", "질문과 관련된 후보 B를 지정"],
        system: ["상담 조건과 후보 정보를 불러오기", "사무소 권한 범위를 확인"],
        status: "상담 선택",
        demo: [["질문 대상", "후보 B", "공원앞 아파트"], ["상담", "매수", "김하늘 고객"], ["담당", "김선용", "승인 가능"]],
        evidence: [],
      },
      {
        label: "질문 입력",
        role: "중개사 입력",
        title: "확인할 질문을 구체적으로 적습니다",
        description: "대상·지역·시점이 분명할수록 적용 가능한 근거를 정확하게 찾을 수 있습니다.",
        actions: ["‘마포구 생애최초 지원 적용 여부’ 입력", "확인이 필요한 기준일을 지정"],
        system: ["질문의 대상·지역·시점을 구조화", "모호한 조건이 있으면 추가 입력 안내"],
        status: "질문 입력",
        demo: [["대상", "생애최초 구입자", "김하늘 고객"], ["지역", "서울 마포구", "후보 B"], ["기준일", "2026-10-29", "상담일"]],
        evidence: [],
      },
      {
        label: "질문 해석",
        role: "검색 준비",
        title: "검색 범위와 확인 항목을 정합니다",
        description: "공식 정책을 우선하고, 허용된 기사와 사무소 문서를 보조 근거로 검색합니다.",
        actions: ["검색 범위와 키워드를 확인", "필요하면 질문의 지역·대상을 수정"],
        system: ["정책명·적용 대상·지역 키워드 추출", "권한 없는 문서를 검색 범위에서 제외"],
        status: "검색 준비",
        demo: [["우선 출처", "공식 정책", "공공기관"], ["보조 출처", "허용 기사", "원문 링크"], ["내부 자료", "사무소 문서", "권한 확인"]],
        evidence: [],
      },
      {
        label: "문서 검색",
        role: "RAG 검색",
        title: "적용 가능한 문서와 원문 조각을 찾습니다",
        description: "질문과 같은 대상·지역·시점에 적용되는지 확인할 수 있도록 원문 위치를 함께 제공합니다.",
        actions: ["상위 검색 결과의 제목과 날짜를 확인", "관련 본문 조각을 원문과 대조"],
        system: ["질문과 관련된 문서를 검색·재정렬", "제목·출처·날짜·원문 위치를 표시"],
        status: "근거 3건",
        demo: [["공식 정책", "관련도 높음", "2026-09-30"], ["보도자료", "관련도 높음", "2026-10-02"], ["시장 기사", "보조 근거", "2026-10-21"]],
        evidence: [
          { title: "생애최초 주택 구입 지원 안내", text: "국토교통부 · 2026-09-30 · 4쪽", state: "verified", badge: "공식 근거" },
          { title: "지원정책 보도자료", text: "서울시 · 2026-10-02 · 2문단", state: "verified", badge: "근거 확인" },
        ],
      },
      {
        label: "근거 판정",
        role: "안전 장치",
        title: "근거의 충분성과 충돌 여부를 확인합니다",
        description: "적용 지역이나 기준일이 맞지 않거나 자료가 충돌하면 답변 생성 전에 경고합니다.",
        actions: ["공식 문서의 적용 대상을 확인", "충돌한 자료 중 어떤 내용을 상담에 쓸지 검토"],
        system: ["사실 주장을 뒷받침할 직접 근거 확인", "충돌·누락·오래된 자료에 상태 부여"],
        status: "충돌 1건",
        demoType: "warning",
        demo: { title: "시행일을 추가로 확인해야 합니다", text: "기사와 공식 문서의 시행일이 다릅니다. 답변에는 불일치를 표시하고 공식 문서를 우선 인용합니다." },
        evidence: [
          { title: "공식 문서 시행일", text: "2026-11-01 시행", state: "verified", badge: "근거 확인" },
          { title: "기사 기재 시행일", text: "2026-10-15로 기재 · 원문과 불일치", state: "conflict", badge: "자료 불일치" },
        ],
      },
      {
        label: "답변 초안",
        role: "AI 보조",
        title: "인용이 연결된 답변 초안을 만듭니다",
        description: "직접 확인된 사실만 답변하고, 현재 시점에 확정할 수 없는 적용 여부는 확인 불가로 구분합니다.",
        actions: ["각 사실 주장 옆 인용을 열어 확인", "확인 불가 항목과 추가 확인 방법을 검토"],
        system: ["검증 가능한 주장마다 인용 연결", "근거 부족 내용은 확인 불가로 표시"],
        status: "AI 초안",
        demoType: "warning",
        demo: { title: "현재 적용 여부는 확인 불가", text: "공식 시행일이 상담일 이후이므로 현재 적용된다고 단정할 수 없습니다. 시행일 이후 담당 기관에 다시 확인하세요." },
        evidence: [
          { title: "정책 적용 요건", text: "공식 문서 4쪽의 대상 요건과 연결", state: "verified", badge: "인용 연결" },
          { title: "답변 초안", text: "중개사 검토 전 · 고객 전달 불가", state: "draft", badge: "AI 초안" },
          { title: "현재 적용 여부", text: "시행 전 · 확인 불가", state: "warning", badge: "추가 확인" },
        ],
      },
      {
        label: "검토·승인",
        role: "중개사 결정",
        title: "중개사가 답변을 검토하고 승인합니다",
        description: "출처와 기준일을 다시 확인하고 표현을 수정한 뒤 고객 상담에 사용할 답변으로 승인합니다.",
        actions: ["원문·기준일·확인 불가 문구를 최종 확인", "답변을 수정하고 승인 완료로 전환"],
        system: ["초안과 승인본을 분리해 저장", "승인자·시각·수정 이력을 기록"],
        status: "검토 필요",
        demoType: "approval",
        demo: null,
        evidence: [
          { title: "정책 답변 초안", text: "인용 2건 · 확인 불가 1건 · 승인 전", state: "draft", badge: "검토 필요" },
        ],
      },
    ],
  },
};

const elements = {
  tabs: [...document.querySelectorAll(".mode-tab")],
  modeDescription: document.querySelector("#mode-description"),
  stepList: document.querySelector("#step-list"),
  progressCurrent: document.querySelector("#progress-current"),
  progressBar: document.querySelector(".progress-track"),
  progressFill: document.querySelector("#progress-fill"),
  detailStep: document.querySelector("#detail-step"),
  detailRole: document.querySelector("#detail-role"),
  detailTitle: document.querySelector("#detail-title"),
  detailDescription: document.querySelector("#detail-description"),
  actionList: document.querySelector("#action-list"),
  systemList: document.querySelector("#system-list"),
  stageDemo: document.querySelector("#stage-demo"),
  evidenceCount: document.querySelector("#evidence-count"),
  workflowStatus: document.querySelector("#workflow-status"),
  evidenceList: document.querySelector("#evidence-list"),
  prevButton: document.querySelector("#prev-step"),
  nextButton: document.querySelector("#next-step"),
  detail: document.querySelector("#workflow-detail"),
  evidenceDialog: document.querySelector("#evidence-dialog"),
  dialogTitle: document.querySelector("#evidence-dialog-title"),
  dialogSource: document.querySelector("#dialog-source"),
  dialogDate: document.querySelector("#dialog-date"),
  dialogLocation: document.querySelector("#dialog-location"),
  dialogSnippet: document.querySelector("#dialog-snippet"),
  dialogDemoWarning: document.querySelector("#dialog-demo-warning"),
  dialogClose: document.querySelector(".dialog-close"),
};

let currentMode = "advise";
let currentStep = 0;
const approvalStates = {
  advise: {
    state: "draft",
    approver: null,
    approvedAt: null,
    version: 1,
    draftText: "후보 B는 고객의 공원 접근성 선호와 예산 조건에 부합합니다. 학군 배정 정보는 현재 근거만으로 확인할 수 없어 추가 확인이 필요합니다.",
    changes: [{ version: "v0.1", note: "AI 초안 생성", at: "현재 세션" }],
  },
  ask: {
    state: "draft",
    approver: null,
    approvedAt: null,
    version: 1,
    draftText: "공식 문서상 지원정책 시행일은 상담일 이후입니다. 현재 적용 여부는 확인할 수 없으며, 시행일 이후 담당 기관에 다시 확인해야 합니다.",
    changes: [{ version: "v0.1", note: "AI 초안 생성", at: "현재 세션" }],
  },
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderSteps() {
  const steps = workflows[currentMode].steps;
  elements.stepList.innerHTML = steps
    .map(
      (step, index) => `
        <li>
          <button
            class="step-button${index === currentStep ? " is-active" : ""}${index < currentStep ? " is-complete" : ""}"
            type="button"
            data-step="${index}"
            aria-current="${index === currentStep ? "step" : "false"}"
            aria-label="${index + 1}단계 ${escapeHtml(step.label)}"
          >
            <span class="step-number">${index < currentStep ? "✓" : index + 1}</span>
            <span class="step-label">${escapeHtml(step.label)}</span>
          </button>
        </li>`
    )
    .join("");

  elements.stepList.querySelectorAll(".step-button").forEach((button) => {
    button.addEventListener("click", () => setStep(Number(button.dataset.step), true));
  });
}

function renderList(target, items) {
  target.innerHTML = items.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

function approvalLabel(state) {
  if (state === "approved") return "승인 완료";
  if (state === "review") return "검토 중";
  return "AI 초안";
}

function approvalVersion(approval) {
  return approval.state === "approved" ? `v1.${approval.version - 1}` : `v0.${approval.version}`;
}

function saveDraftFromEditor(note = "중개사 수정 저장") {
  const approval = approvalStates[currentMode];
  const editor = document.querySelector("#approval-editor");
  if (!editor || approval.state === "approved") return false;
  const nextText = editor.value.trim();
  if (!nextText) {
    window.alert("상담에 사용할 내용을 입력한 뒤 저장하세요.");
    editor.focus();
    return false;
  }
  if (nextText === approval.draftText) return true;
  approval.draftText = nextText;
  approval.version += 1;
  const at = new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit" }).format(new Date());
  approval.changes.unshift({ version: `v0.${approval.version}`, note, at });
  return true;
}

function renderApprovalDemo() {
  const approval = approvalStates[currentMode];
  const draftClass = approval.state === "draft" ? "is-current" : "is-complete";
  const reviewClass = approval.state === "review" ? "is-current" : approval.state === "approved" ? "is-complete" : "";
  const approvedClass = approval.state === "approved" ? "is-current" : "";
  const record = approval.state === "approved"
    ? `${approvalVersion(approval)} · ${approval.approver} · ${approval.approvedAt} · 승인 기록 저장됨`
    : `${approvalVersion(approval)} · 승인자와 승인 시각은 최종 승인 후 자동으로 기록됩니다.`;
  const historyItems = approval.changes
    .slice(0, 4)
    .map((change) => `<li>${escapeHtml(change.version)} · ${escapeHtml(change.note)} · ${escapeHtml(change.at)}</li>`)
    .join("");

  elements.stageDemo.innerHTML = `
    <div class="approval-demo">
      <ol class="approval-timeline" aria-label="승인 상태">
        <li class="${draftClass}">AI 초안</li>
        <li class="${reviewClass}">검토 중</li>
        <li class="${approvedClass}">승인 완료</li>
      </ol>
      <p class="approval-record">${escapeHtml(record)}</p>
      <div class="approval-editor">
        <label for="approval-editor">상담에 사용할 내용</label>
        <textarea id="approval-editor" ${approval.state === "approved" ? "disabled" : ""}>${escapeHtml(approval.draftText)}</textarea>
      </div>
      <div class="revision-history">
        <strong>런타임 변경 이력</strong>
        <ul>${historyItems}</ul>
      </div>
      <div class="approval-actions">
        <button class="approval-button" id="save-draft" type="button" ${approval.state === "approved" ? "disabled" : ""}>수정 저장</button>
        <button class="approval-button" id="start-review" type="button" ${approval.state !== "draft" ? "disabled" : ""}>검토 시작</button>
        <button class="approval-button approval-button--primary" id="approve-result" type="button" ${approval.state !== "review" ? "disabled" : ""}>최종 승인</button>
        <button class="approval-button" id="export-result" type="button" ${approval.state !== "approved" ? "disabled" : ""}>승인본 인쇄</button>
      </div>
    </div>`;

  document.querySelector("#save-draft")?.addEventListener("click", () => {
    if (!saveDraftFromEditor()) return;
    renderApprovalDemo();
  });

  document.querySelector("#start-review")?.addEventListener("click", () => {
    if (!saveDraftFromEditor("검토 시작 전 저장")) return;
    approval.state = "review";
    updateApprovalView();
  });

  document.querySelector("#approve-result")?.addEventListener("click", () => {
    if (!saveDraftFromEditor("최종 승인 전 저장")) return;
    const confirmed = window.confirm(
      "출처·기준일·확인 불가 항목을 검토했습니까? 승인하면 이 버전을 고객 상담에 사용할 수 있습니다."
    );
    if (!confirmed) return;
    approval.state = "approved";
    approval.approver = "김선용 공인중개사";
    approval.approvedAt = new Intl.DateTimeFormat("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date());
    updateApprovalView();
  });

  document.querySelector("#export-result")?.addEventListener("click", () => {
    window.print();
  });
}

function getApprovalEvidence(step) {
  const approval = approvalStates[currentMode];
  if (approval.state === "approved") {
    return [{
      title: `${currentMode === "ask" ? "정책 답변" : "상담자료"} ${approvalVersion(approval)}`,
      text: `${approval.approver} 승인 · ${approval.approvedAt}`,
      state: "verified",
      badge: "승인 완료",
      source: "중개메이트 승인 이력",
      date: approval.approvedAt,
      location: `현재 상담 · 승인본 ${approvalVersion(approval)}`,
      snippet: approval.draftText,
    }];
  }
  return step.evidence.map((item) => ({
    ...item,
    badge: approval.state === "review" ? "검토 중" : item.badge,
    text: approval.state === "review" ? `${item.text} · 중개사 검토 중` : item.text,
  }));
}

function updateApprovalView() {
  const step = workflows[currentMode].steps[currentStep];
  const approval = approvalStates[currentMode];
  elements.workflowStatus.textContent = approvalLabel(approval.state);
  renderApprovalDemo();
  renderEvidence(getApprovalEvidence(step));
}

function renderDemo(step) {
  if (step.demoType === "approval") {
    renderApprovalDemo();
    return;
  }

  if (step.demoType === "warning") {
    elements.stageDemo.innerHTML = `
      <div class="demo-note">
        <span aria-hidden="true">!</span>
        <div><strong>${escapeHtml(step.demo.title)}</strong>${escapeHtml(step.demo.text)}</div>
      </div>`;
    return;
  }

  elements.stageDemo.innerHTML = `
    <div class="demo-strip">
      ${step.demo
        .map(
          ([label, value, note]) => `
            <div class="demo-item">
              <span>${escapeHtml(label)}</span>
              <strong>${escapeHtml(value)}</strong>
              <small>${escapeHtml(note)}</small>
            </div>`
        )
        .join("")}
    </div>`;
}

function renderEvidence(evidence) {
  elements.evidenceCount.textContent = `${evidence.length}건`;
  if (!evidence.length) {
    elements.evidenceList.innerHTML =
      '<div class="evidence-empty">아직 연결된 근거가 없습니다.<br />근거 검색 단계에서 출처와 상태를 확인합니다.</div>';
    return;
  }

  elements.evidenceList.innerHTML = evidence
    .map(
      (item, index) => {
        const metadata = evidenceMetadata(item);
        return `
        <button class="evidence-card${metadata.isDemo ? " is-demo" : ""}" type="button" data-state="${escapeHtml(item.state)}" data-evidence-index="${index}" aria-label="${escapeHtml(item.title)} ${metadata.isDemo ? "시연용 데이터 " : ""}상세 열기">
          <header>
            <h3>${escapeHtml(item.title)}${metadata.isDemo ? '<span class="demo-data-label">시연용</span>' : ""}</h3>
            <span class="evidence-badge">${escapeHtml(item.badge)}</span>
          </header>
          <p>${escapeHtml(item.text)}</p>
        </button>`;
      }
    )
    .join("");

  elements.evidenceList.querySelectorAll(".evidence-card").forEach((card) => {
    card.addEventListener("click", () => openEvidenceDialog(evidence[Number(card.dataset.evidenceIndex)]));
  });
}

function evidenceMetadata(item) {
  const hasCompleteMetadata = Boolean(item.source && item.date && item.location && item.snippet);
  return {
    source: hasCompleteMetadata ? item.source : "시연용 데이터 · 실제 출처 미연결",
    date: hasCompleteMetadata ? item.date : "시연용 기준일 · 실제 검증 필요",
    location: hasCompleteMetadata ? item.location : "실제 원문 없음/확인 불가",
    snippet: hasCompleteMetadata
      ? item.snippet
      : "시연용 문구입니다. 실제 문서의 원문 조각이 아니며 출처 확인에 사용할 수 없습니다.",
    isDemo: !hasCompleteMetadata,
  };
}

function openEvidenceDialog(item) {
  const metadata = evidenceMetadata(item);
  elements.dialogTitle.textContent = item.title;
  elements.dialogSource.textContent = metadata.source;
  elements.dialogDate.textContent = metadata.date;
  elements.dialogLocation.textContent = metadata.location;
  elements.dialogSnippet.textContent = metadata.snippet;
  elements.dialogDemoWarning.hidden = !metadata.isDemo;
  if (typeof elements.evidenceDialog.showModal === "function") {
    elements.evidenceDialog.showModal();
  } else {
    elements.evidenceDialog.setAttribute("open", "");
  }
}

function setStep(index, shouldFocus = false) {
  const steps = workflows[currentMode].steps;
  currentStep = Math.max(0, Math.min(index, steps.length - 1));
  const step = steps[currentStep];

  renderSteps();
  elements.progressCurrent.textContent = String(currentStep + 1);
  elements.progressBar.setAttribute("aria-valuenow", String(currentStep + 1));
  elements.progressFill.style.width = `${((currentStep + 1) / steps.length) * 100}%`;
  elements.detailStep.textContent = `${currentStep + 1}단계`;
  elements.detailRole.textContent = step.role;
  elements.detailTitle.textContent = step.title;
  elements.detailDescription.textContent = step.description;
  elements.workflowStatus.textContent = step.demoType === "approval"
    ? approvalLabel(approvalStates[currentMode].state)
    : step.status;
  renderList(elements.actionList, step.actions);
  renderList(elements.systemList, step.system);
  renderDemo(step);
  renderEvidence(step.demoType === "approval" ? getApprovalEvidence(step) : step.evidence);

  elements.prevButton.disabled = currentStep === 0;
  elements.nextButton.disabled = currentStep === steps.length - 1;
  elements.nextButton.textContent = currentStep === steps.length - 2 ? "검토·승인 보기" : "다음 단계";

  if (shouldFocus) {
    elements.detail.focus({ preventScroll: true });
  }

  if (window.matchMedia("(max-width: 820px)").matches) {
    const activeStep = elements.stepList.querySelector(".step-button.is-active");
    activeStep?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "nearest",
      inline: "center",
    });
  }
}

function setMode(mode) {
  if (!workflows[mode]) return;
  currentMode = mode;
  currentStep = 0;
  elements.tabs.forEach((tab) => {
    const selected = tab.dataset.mode === mode;
    tab.classList.toggle("is-active", selected);
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  elements.modeDescription.textContent = workflows[mode].description;
  elements.detail.setAttribute("aria-labelledby", `tab-${mode}`);
  setStep(0);
}

elements.tabs.forEach((tab) => {
  tab.addEventListener("click", () => setMode(tab.dataset.mode));
  tab.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const nextMode = currentMode === "advise" ? "ask" : "advise";
    setMode(nextMode);
    document.querySelector(`[data-mode="${nextMode}"]`).focus();
  });
});

elements.prevButton.addEventListener("click", () => setStep(currentStep - 1, true));
elements.nextButton.addEventListener("click", () => setStep(currentStep + 1, true));

document.addEventListener("keydown", (event) => {
  if (event.target.matches("button, a, input, textarea, select")) return;
  if (event.key === "ArrowLeft") setStep(currentStep - 1, true);
  if (event.key === "ArrowRight") setStep(currentStep + 1, true);
});

function selectCandidate(candidateId) {
  document.querySelectorAll("[data-candidate]").forEach((item) => {
    const selected = item.dataset.candidate === candidateId;
    item.classList.toggle("is-selected", selected);
    item.setAttribute("aria-pressed", String(selected));
  });
}

document.querySelectorAll("[data-candidate]").forEach((item) => {
  item.addEventListener("click", () => selectCandidate(item.dataset.candidate));
});

elements.dialogClose.addEventListener("click", () => elements.evidenceDialog.close());
elements.evidenceDialog.addEventListener("click", (event) => {
  if (event.target === elements.evidenceDialog) elements.evidenceDialog.close();
});

setMode("advise");
