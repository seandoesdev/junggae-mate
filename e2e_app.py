"""상담 작업대(app.html) E2E 테스트. `docker compose up -d` 후 실행: python e2e_app.py"""
import os
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

BASE = os.getenv("APP_URL", "http://localhost:8000")
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
ROOT = Path(__file__).parent
IMAGES = ROOT / "docs" / "images"


def run():
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=CHROME if Path(CHROME).exists() else None)
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.on("pageerror", lambda exc: errors.append(str(exc)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "401" not in m.text else None)
        page.goto(f"{BASE}/app.html")

        page.fill("#login-email", "agent@hanul.test")
        page.fill("#login-password", "demo1234")
        page.click("#login-btn")
        expect(page.locator("#topbar-user-text")).to_contain_text("하늘공인중개사")
        expect(page.locator("#login-screen")).to_be_hidden()

        # ── 매물 지도 (로그인 후 기본 화면) ──
        expect(page.locator("#map-view")).to_be_visible()
        markers = page.locator("#map .listing-marker")
        expect(markers).to_have_count(7, timeout=15000)
        assert "/advise" not in page.inner_text("body") and "/ask" not in page.inner_text("body"), "API 경로가 화면에 노출됨"

        # 마커 클릭 → 좌측 상세
        first_id = markers.first.get_attribute("data-listing-id")
        markers.first.click()
        expect(page.locator("#listing-detail")).to_be_visible()
        expect(page.locator("#listing-detail")).to_contain_text("등록")
        expect(page.locator("#listing-detail")).to_contain_text("실거래가 참고")
        assert page.url.endswith(f"#/map/listing/{first_id}")
        page.reload()  # 해시로 같은 매물 상세 복원
        expect(page.locator("#listing-detail")).to_be_visible(timeout=15000)
        page.click("#listing-back-btn")

        # 내가 등록한 매물 필터
        page.click("#listing-filter-mine")
        expect(page.locator(".listing-card")).to_have_count(5)
        page.click("#listing-filter-mine")
        expect(page.locator(".listing-card")).to_have_count(7)

        # 지도 클릭으로 위치를 정해 직접 등록 → 상세 → 거래 종료
        page.click("#listing-register-btn")
        box = page.locator("#map").bounding_box()
        page.mouse.click(box["x"] + box["width"] - 80, box["y"] + 80)
        form = page.locator("#listing-form")
        expect(form.locator("[name=lat]")).not_to_have_value("")
        for name, value in {"title": "E2E 등록 매물", "complex_name": "이투이숲", "address": "서울 마포구 테스트로 1",
                            "district": "마포구", "price": "70000", "area_m2": "59.9"}.items():
            form.locator(f"[name={name}]").fill(value)
        form.locator("[type=submit]").click()
        expect(page.locator("#listing-detail-title")).to_contain_text("E2E 등록 매물", timeout=10000)
        expect(markers).to_have_count(8)
        page.once("dialog", lambda d: d.accept())
        page.click("#listing-close-btn")
        expect(markers).to_have_count(7, timeout=10000)
        page.screenshot(path=str(IMAGES / "app-map-desktop.png"))

        # ── 상담 작업대 ──
        page.click("#nav-consult")
        expect(page.locator("#consultation-select option", has_text="김하늘")).to_have_count(1)
        page.select_option("#consultation-select", label="김하늘 · 아파트 매수")
        expect(page.locator("#cond-district")).to_have_value("마포구", timeout=10000)

        # 구조화 검색 → 비교
        page.click("#search-listings-btn")
        boxes = page.locator(".listing-checkbox")
        expect(boxes).to_have_count(4)
        for i in range(3):
            boxes.nth(i).check()
        page.click("#compare-btn")
        expect(page.locator("#compare-result")).to_contain_text("현재 호가 아님")

        # /advise 초안 → 근거 확인 → 승인
        page.click("#advise-btn")
        expect(page.locator("#claims-list .claim-item").first).to_be_visible(timeout=15000)
        expect(page.locator("#claims-list")).to_contain_text("확인 불가")
        expect(page.locator("#draft-version-label")).to_contain_text("v0.1")
        assert page.locator("#evidence-list .evidence-card").count() > 0
        page.locator(".citation-chip").first.click()
        expect(page.locator("#evidence-dialog")).to_have_attribute("open", "")
        page.keyboard.press("Escape")

        expect(page.locator("#btn-approve")).to_be_disabled()
        expect(page.locator("#btn-export")).to_be_disabled()
        editor = page.locator("#draft-editor")
        editor.fill(editor.input_value() + "\n- 고객 요청사항을 재확인했습니다.")
        page.click("#btn-save-draft")
        expect(page.locator("#draft-version-label")).to_contain_text("v0.2")
        page.click("#btn-review")
        expect(page.locator("#workflow-status")).to_contain_text("검토 중")
        page.once("dialog", lambda d: d.accept())
        page.click("#btn-approve")
        expect(page.locator("#workflow-status")).to_contain_text("승인 완료")
        expect(page.locator("#btn-export")).to_be_enabled()
        expect(editor).to_be_disabled()

        # /ask → 불일치·확인 불가
        page.click("#tab-ask")
        page.fill("#ask-question", "마포구 생애최초 주택 구입 지원 적용 여부")
        page.fill("#ask-as-of", "2026-10-29")
        page.click("#ask-btn")
        expect(page.locator("#gate-banner")).to_contain_text("불일치", timeout=15000)
        expect(page.locator("#evidence-list .evidence-card[data-state='conflict']")).to_have_count(1)

        # 근거 직접 검색
        page.fill("#evidence-search", "부동산 거래 신고 30일")
        page.click("#evidence-search-btn")
        expect(page.locator("#evidence-list")).to_contain_text("거래신고")

        page.screenshot(path=str(IMAGES / "app-preview-desktop.png"), full_page=True)
        page.set_viewport_size({"width": 390, "height": 844})
        page.wait_for_timeout(300)
        assert not page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth"), "모바일 가로 넘침"
        page.screenshot(path=str(IMAGES / "app-preview-mobile.png"), full_page=True)
        assert not errors, f"Browser errors: {errors}"
        browser.close()


if __name__ == "__main__":
    run()
    print("app e2e passed")
