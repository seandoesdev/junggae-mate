"""archify로 만든 문서 4개에 같은 상단 링크 바를 넣는다 (상대경로, index.html이 메인).

archify finalize로 페이지를 다시 만든 뒤 이 스크립트를 다시 실행한다. 여러 번 실행해도 바는 하나만 남는다.
    python link-pages.py
"""
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
START, END = "<!-- docs-nav:start -->", "<!-- docs-nav:end -->"

PAGES = [  # (파일, 탭 이름, [(앵커, 이름)])
    ("system.html", "시스템 구조", []),
    ("components.html", "컴포넌트 역할", [
        ("request-path", "요청 순서"), ("frontend-roles", "화면·배포"), ("edge-roles", "서버 앞단"),
        ("backend-roles", "백엔드 모듈"), ("data-roles", "데이터·외부")]),
    ("api.html", "API", [
        ("api-overview", "한눈에"), ("api-auth", "인증·사용자 4"), ("api-listings", "매물 11"),
        ("api-customers", "고객 6"), ("api-deals", "거래 4"), ("api-reports", "보고서 8"),
        ("api-hood", "Hood AI 7"), ("api-library", "자료실·근거 5"), ("api-admin", "관리자·수집 9"),
        ("api-public-data", "공공데이터 조회 4"), ("api-system", "상태·API 밖 경로 1+4")]),
    ("rag.html", "RAG 설계", [
        ("ingest-pipeline", "수집 파이프라인"), ("data-sources", "사용 데이터"), ("chunking", "청킹·임베딩"),
        ("query-flow", "질문 처리 순서"), ("ranking", "순위"), ("evidence-gate", "근거 게이트"),
        ("llm-role", "Claude 역할"), ("tracing", "추적")]),
]

CSS = """
#docs-nav{position:relative;top:0;z-index:30;background:#fff;border-bottom:1px solid #dfe3e8;
  font:14px/1.5 "Pretendard","Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif;color:#14181f}
#docs-nav .row{display:flex;align-items:center;gap:20px;padding:0 20px;height:48px;overflow-x:auto}
#docs-nav a{color:#5b6472;text-decoration:none;white-space:nowrap}
#docs-nav a:hover{color:#14181f}
#docs-nav .home{font-weight:700;color:#14181f}
#docs-nav .tabs{display:flex;gap:4px;height:100%}
#docs-nav .tabs a{display:flex;align-items:center;padding:0 12px;font-weight:600;border-bottom:2px solid transparent}
#docs-nav .tabs a[aria-current="page"]{color:#0f766e;border-bottom-color:#0f766e}
#docs-nav .chips{display:flex;flex-wrap:wrap;gap:6px;padding:8px 20px 10px;border-top:1px solid #eef0f3}
#docs-nav .chips a{padding:3px 10px;border:1px solid #dfe3e8;border-radius:999px;font-size:13px}
#docs-nav .chips a:hover{border-color:#5b6472}
#docs-nav .chips a.on{color:#0f766e;border-color:#0f766e;background:#e6f4f2}
#docs-nav a:focus-visible{outline:2px solid #0f766e;outline-offset:-2px}
@media (prefers-color-scheme:dark){
  #docs-nav{background:#161b22;border-color:#2a313b;color:#e8ecf1}
  #docs-nav a{color:#9aa4b2} #docs-nav a:hover,#docs-nav .home{color:#e8ecf1}
  #docs-nav .tabs a[aria-current="page"]{color:#2dd4bf;border-bottom-color:#2dd4bf}
  #docs-nav .chips{border-color:#222831} #docs-nav .chips a{border-color:#2a313b}
  #docs-nav .chips a.on{color:#2dd4bf;border-color:#2dd4bf;background:#12302d}}
@media print{#docs-nav{display:none}}
"""

# 앵커로 들어오면, 문서가 패널 배치를 마친 뒤 그 위치로 다시 맞춘다. 상단 바 높이만큼 띄운다.
JS = """
(function(){
  var nav=document.getElementById('docs-nav');
  function mark(){var h=decodeURIComponent(location.hash.slice(1));
    nav.querySelectorAll('.chips a').forEach(function(a){a.classList.toggle('on',a.getAttribute('href')==='#'+h);});}
  function go(){var h=decodeURIComponent(location.hash.slice(1)),el=h&&document.getElementById(h);
    if(el){window.scrollTo(0,el.getBoundingClientRect().top+window.scrollY-nav.offsetHeight-8);} mark();}
  // 본문 여백이 있는 문서(시스템 구조도)에서도 바가 화면 끝까지 닿게 한다
  //   위쪽은 본문 위 여백만큼, 좌우는 바가 화면 끝에서 떨어진 만큼 당긴다 (바는 본문 첫 요소)
  function bleed(){nav.style.margin='0';
    var r=nav.getBoundingClientRect(),w=document.documentElement.clientWidth,
        top=parseFloat(getComputedStyle(document.body).paddingTop)||0;
    nav.style.margin=(-top)+'px '+(-(w-r.right))+'px 0 '+(-r.left)+'px';}
  window.addEventListener('hashchange',go);
  window.addEventListener('resize',bleed);
  window.addEventListener('load',function(){bleed();setTimeout(go,600);});
  bleed();mark();
})();
"""


def nav_html(current: str) -> str:
    tabs = ""
    for file, name, _ in PAGES:
        here = ' aria-current="page"' if file == current else ""
        tabs += f'<a href="{file}"{here}>{name}</a>'
    chips = next(c for f, _, c in PAGES if f == current)
    chip_row = ""
    if chips:
        chip_row = ('<div class="chips" aria-label="이 문서의 항목">'
                    + "".join(f'<a href="#{a}">{n}</a>' for a, n in chips) + "</div>")
    # 시스템 구조도는 뷰어 도구 막대(테마·내보내기)가 위에 붙어 있으므로 바를 고정하지 않는다
    sticky = "" if current == "system.html" else "<style>#docs-nav{position:sticky;z-index:2147483000}</style>"
    return (f'{START}<style>{CSS}</style>{sticky}<nav id="docs-nav" aria-label="중개메이트 시스템 문서">'
            f'<div class="row"><a class="home" href="index.html">중개메이트 문서</a>'
            f'<div class="tabs">{tabs}</div></div>{chip_row}</nav><script>{JS}</script>{END}')


def main() -> None:
    for file, _, _ in PAGES:
        path = HERE / file
        html = path.read_text(encoding="utf-8")
        html = re.sub(re.escape(START) + ".*?" + re.escape(END), "", html, flags=re.S)  # 예전 바 제거
        html, n = re.subn(r"<body[^>]*>", lambda m: m.group(0) + nav_html(file), html, count=1)
        if n != 1:
            raise SystemExit(f"{file}: <body>를 찾지 못했습니다")
        path.write_text(html, encoding="utf-8")
        print(f"{file}: 상단 링크 바를 넣었습니다")


if __name__ == "__main__":
    main()
