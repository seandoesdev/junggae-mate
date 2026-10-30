from pathlib import Path
from playwright.sync_api import sync_playwright


ROOT = Path(__file__).parent
IMAGES = ROOT / "docs" / "images"


def run():
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            executable_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        )
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
        page.on("pageerror", lambda exc: errors.append(str(exc)))
        page.goto((ROOT / "index.html").resolve().as_uri())
        page.wait_for_load_state("networkidle")

        assert page.title() == "중개메이트 사용자 워크플로우"
        assert page.locator(".step-button").count() == 7
        assert page.locator("#progress-current").inner_text() == "1"
        assert page.locator(".data-source-row").count() == 6
        assert page.locator('.data-source-row a[href*="15126468"]').count() == 1
        assert page.locator('.data-source-row a[href*="15126474"]').count() == 1
        assert page.locator('.data-source-row a[href*="15058453"]').count() == 1
        assert page.locator('.data-source-row a[href*="15134735"]').count() == 1
        assert page.locator('.data-source-row a[href*="15057358"]').count() == 1
        assert page.locator('.data-source-row a[href*="15098554"]').count() == 1
        assert "현재 판매 매물, 호가, 거래 가능 상태가 아닙니다" in page.locator(".data-ledger").inner_text()
        assert "무단 크롤링은 사용하지 않습니다" in page.locator(".data-boundary").inner_text()
        assert "ai_cls_24-2_RAG_App_main.py" in page.locator(".implementation-reference").inner_text()
        assert "부동산 공개데이터 API 연동은 포함하지 않습니다" in page.locator(".implementation-reference").inner_text()
        assert "qdrant.yaml" in page.locator(".implementation-reference").inner_text()
        assert page.locator(".rag-lane").count() == 3
        assert page.locator(".rag-pipeline li").count() == 10
        assert "벡터화하지 않음" in page.locator(".rag-lane--structured").inner_text()
        assert "공용 벡터 인덱스에 저장하지 않습니다" in page.locator(".rag-architecture__header").inner_text()
        assert "/ask" in page.locator(".mode-retrieval").inner_text()
        assert "/advise" in page.locator(".mode-retrieval").inner_text()
        assert "tenant" in page.locator(".rag-safety").inner_text()
        assert "현행 법령" in page.locator(".evidence-policy").inner_text()
        assert page.locator(".service-architecture").count() == 1
        assert page.locator(".architecture-path").count() == 2
        assert page.locator(".architecture-foundation article").count() == 4
        assert page.locator(".architecture-external span").count() == 3
        assert "LLM" in page.locator(".architecture-external").inner_text()
        assert page.locator(".architecture-ingestion li").count() == 5
        assert "클라이언트의 tenant 값을 믿지 않습니다" in page.locator(".architecture-operations").inner_text()
        assert "AI 장애가 매물 비교를 막지 않습니다" in page.locator(".architecture-operations__fallback").inner_text()
        assert "FastAPI 애플리케이션 1개" in page.locator(".architecture-deployment").inner_text()
        assert page.locator(".mcp-layer").count() == 1
        assert page.locator(".mcp-servers article").count() == 1
        assert "브라우저가 아닌 FastAPI 내부" in page.locator(".mcp-policy").inner_text()
        assert "읽기 전용 MCP Server 1개" in page.locator(".mcp-boundary").inner_text()
        assert "서버 주도의 모델 호출" in page.locator(".mcp-capability").inner_text()
        assert page.locator(".technology-stack__grid article").count() == 6
        stack_text = page.locator(".technology-stack").inner_text()
        for expected in ["HTML", "JavaScript", "FastAPI", "PostgreSQL", "pgvector", "pytest", "Playwright"]:
            assert expected in stack_text
        for excluded in ["React 재구현", "Redis·Celery", "OpenTelemetry·Prometheus/Grafana", "MCP 필수 연동"]:
            assert excluded in page.locator(".technology-stack__excluded").inner_text()

        for _ in range(6):
            page.locator("#next-step").click()
        assert page.locator("#progress-current").inner_text() == "7"
        assert "AI 초안" in page.locator("#workflow-status").inner_text()
        assert page.locator("#approve-result").is_disabled()
        assert page.locator("#export-result").is_disabled()
        original = page.locator("#approval-editor").input_value()
        page.locator("#approval-editor").fill(original + " 고객 요청사항을 재확인했습니다.")
        page.locator("#save-draft").click()
        assert "v0.2" in page.locator(".revision-history").inner_text()
        page.locator("#start-review").click()
        assert "검토 중" in page.locator("#workflow-status").inner_text()
        page.once("dialog", lambda dialog: dialog.accept())
        page.locator("#approve-result").click()
        assert "승인 완료" in page.locator("#workflow-status").inner_text()
        assert page.locator("#export-result").is_enabled()
        assert page.locator("#approval-editor").is_disabled()
        page.evaluate("window.__printed = false; window.print = () => { window.__printed = true; }")
        page.locator("#export-result").click()
        assert page.evaluate("window.__printed") is True

        page.get_by_role("tab", name="/ask", exact=False).click()
        assert page.locator("#progress-current").inner_text() == "1"
        page.locator('[data-step="5"]').click()
        assert "확인 불가" in page.locator("#stage-demo").inner_text()

        page.locator(".evidence-card.is-demo").first.click()
        assert page.locator("#evidence-dialog").get_attribute("open") is not None
        assert page.locator("#dialog-source").inner_text() == "시연용 데이터 · 실제 출처 미연결"
        assert "실제 문서의 원문 조각이 아니며" in page.locator("#dialog-snippet").inner_text()
        assert page.locator("#dialog-demo-warning").is_visible()
        page.get_by_role("button", name="근거 상세 닫기").click()

        page.locator('.candidate-item[data-candidate="b"]').click()
        assert page.locator('.candidate-item[data-candidate="b"]').get_attribute("aria-pressed") == "true"
        assert page.locator('.map-pin[data-candidate="b"]').get_attribute("aria-pressed") == "true"
        assert page.locator('.candidate-item[data-candidate="a"]').get_attribute("aria-pressed") == "false"

        page.evaluate("window.scrollTo(0, 0)")
        page.wait_for_timeout(100)
        page.screenshot(path=str(IMAGES / "workflow-preview-desktop.png"), full_page=True)

        page.set_viewport_size({"width": 390, "height": 844})
        page.wait_for_timeout(200)
        overflow = page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth")
        assert not overflow

        page.locator('[data-step="6"]').click()
        page.wait_for_timeout(200)
        active_visible = page.evaluate("""
            () => {
              const active = document.querySelector('.step-button.is-active');
              const nav = document.querySelector('.step-nav');
              const a = active.getBoundingClientRect();
              const n = nav.getBoundingClientRect();
              return a.left >= n.left - 1 && a.right <= n.right + 1;
            }
        """)
        assert active_visible

        page.evaluate("window.scrollTo(0, 0)")
        page.wait_for_timeout(100)
        page.screenshot(path=str(IMAGES / "workflow-preview-mobile.png"), full_page=True)
        assert not errors, f"Browser errors: {errors}"
        browser.close()


if __name__ == "__main__":
    run()
    print("workflow tests passed")
