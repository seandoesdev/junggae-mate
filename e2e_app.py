"""작업대(app.html) E2E 테스트. 실행: docker compose down -v && docker compose up -d --build 후 python e2e_app.py

시드 데이터 기준으로 동작하므로 깨끗한 DB에서 실행한다 (단계 변경·등록을 실제로 저장한다).
"""
import os
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

BASE = os.getenv("APP_URL", "http://localhost:8000")
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
IMAGES = Path(__file__).parent / "docs" / "images"


def run():
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=CHROME if Path(CHROME).exists() else None)
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.on("pageerror", lambda exc: errors.append(str(exc)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "401" not in m.text else None)
        page.goto(f"{BASE}/app.html")

        page.fill("#login-email", "agent@hanul.test")
        page.fill("#login-password", "demo1234")
        page.click("#login-btn")
        expect(page.locator("#login-screen")).to_be_hidden()

        # ── 지도: 내 매물, 단계 색 핀 ──
        pins = page.locator("#map .pin")
        expect(pins).to_have_count(6, timeout=15000)
        body = page.inner_text("body")
        for word in ("AI", "/advise", "/ask", "근거 확인"):
            assert word not in body, f"'{word}'가 화면에 보임"
        expect(page.locator('#map .pin[data-id="1"]')).to_have_attribute("data-s", "nego")
        page.wait_for_timeout(800)
        page.screenshot(path=str(IMAGES / "app-map-desktop.png"))

        # 핀 → 좌측 상세 (거래·확인할 사항·출처)
        page.locator('#map .pin[data-id="1"]').click()
        side = page.locator("#map-side")
        expect(side.locator(".deal")).to_have_count(2, timeout=10000)
        expect(side.locator(".checks li").first).to_be_visible()
        assert side.locator(".checks li").count() >= 5
        side.locator(".deal").first.locator("[data-act=next]").click()          # 김하늘: 협의 → 계약
        expect(page.locator('#map .pin[data-id="1"]')).to_have_attribute("data-s", "contract", timeout=10000)
        expect(side.locator(".checks")).to_contain_text("30일 이내", timeout=10000)
        side.locator(".checks .srcref").first.click()
        expect(page.locator("#drawer")).to_be_visible()
        page.keyboard.press("Escape")
        expect(page.locator("#drawer")).to_be_hidden()
        side.locator("input[data-key=registry]").check()
        expect(side.locator("input[data-key=registry]")).to_be_checked()
        page.screenshot(path=str(IMAGES / "app-map-detail.png"))

        # 범위·단계 필터
        page.click("#view-map [data-scope=all]")
        expect(pins).to_have_count(12)
        page.click('#stage-filter [data-s="available"]')
        assert pins.count() < 12
        page.click('#stage-filter [data-s="available"]')
        expect(pins).to_have_count(12)

        # 지도 클릭으로 매물 등록 → 거래 종료
        page.click("#map-side [data-act=back]")
        page.click("[data-act=register]")
        box = page.locator("#map").bounding_box()
        page.mouse.click(box["x"] + box["width"] - 90, box["y"] + 120)
        form = page.locator("#listing-form")
        expect(form.locator("[name=lat]")).not_to_have_value("")
        for name, value in {"title": "E2E 등록 59", "complex_name": "이투이숲", "address": "서울 마포구 테스트로 1",
                            "district": "마포구", "price": "70000", "area_m2": "59.9"}.items():
            form.locator(f"[name={name}]").fill(value)
        form.locator("[type=submit]").click()
        expect(side).to_contain_text("E2E 등록 59", timeout=10000)
        expect(pins).to_have_count(13)
        page.once("dialog", lambda d: d.accept())
        page.click("#listing-close-btn")
        expect(pins).to_have_count(12, timeout=10000)

        # ── 거래 ──
        page.click("[data-nav=deals]")
        expect(page.locator(".col")).to_have_count(5)
        page.screenshot(path=str(IMAGES / "app-deals.png"))

        # ── 자료실 ──
        page.click("[data-nav=library]")
        page.fill("#lib-q", "학구도")
        expect(page.locator(".hit").first).to_contain_text("학구도", timeout=10000)
        page.locator(".hit").first.click()
        expect(page.locator("#library-detail")).to_contain_text("학구도")
        page.fill("#lib-q", "생애최초 시행")
        page.click('[data-act=lib-type][data-t="news"]')
        expect(page.locator(".hit .typeword").first).to_have_text("기사", timeout=10000)
        page.locator(".hit").first.click()
        expect(page.locator("#library-detail")).to_contain_text("보조 자료")
        page.screenshot(path=str(IMAGES / "app-library.png"))

        # ── 고객 → 비교표 → 승인 → 링크 ──
        page.click("[data-nav=customers]")
        page.locator("#customer-list").get_by_text("김하늘", exact=True).click()
        expect(page.locator("#customer-detail h1")).to_contain_text("김하늘", timeout=10000)
        page.screenshot(path=str(IMAGES / "app-customer.png"))
        page.click("[data-act=new-compare]")
        paper = page.locator(".paper")
        expect(paper).to_be_visible(timeout=15000)
        expect(page.locator(".paper .stamp")).to_be_visible()
        assert page.locator(".paper sup .srcref").count() >= 3, "각주 출처가 부족함"
        expect(page.locator(".paper .foot li").first).to_be_visible()
        expect(page.locator(".opinion[contenteditable=true]")).to_have_count(1)
        page.locator(".paper sup .srcref").first.click()
        expect(page.locator("#drawer")).to_be_visible()
        page.keyboard.press("Escape")
        expect(page.locator("[data-act=print]")).to_be_disabled()
        page.locator(".opinion[contenteditable=true]").click()
        page.keyboard.press("Control+End")
        page.keyboard.type(" 주말 방문을 권해 드립니다.")
        page.click("[data-act=save-edit]")
        expect(paper).to_contain_text("0.2판", timeout=10000)
        expect(page.locator(".paper sup .srcref").first).to_be_visible()  # 저장 후에도 출처 표시가 남아야 함
        page.click("[data-act=to-review]")
        page.once("dialog", lambda d: d.accept())
        page.click("[data-act=approve]")
        expect(page.locator("[data-act=print]")).to_be_enabled(timeout=10000)
        expect(page.locator(".opinion[contenteditable=true]")).to_have_count(0)
        page.click("[data-act=share]")
        share_url = page.locator("#dialog input, .share code").first
        expect(share_url).to_be_visible(timeout=10000)
        url = share_url.input_value() if share_url.evaluate("e => e.tagName") == "INPUT" else share_url.inner_text()
        if page.locator("#dialog[open] [data-act=close-dialog]").count():
            page.click("#dialog [data-act=close-dialog]")
        page.screenshot(path=str(IMAGES / "app-report.png"))
        shared = browser.new_page()
        shared.goto(url)
        expect(shared.locator("body")).to_contain_text("김하늘 고객님께")
        expect(shared.locator("body")).to_contain_text("주말 방문")
        shared.close()

        # 문의 답변 (공식 안내와 기사 불일치 반영)
        page.click("[data-nav=customers]")
        page.locator("#customer-list").get_by_text("김하늘", exact=True).click()
        page.click("[data-act=new-answer]")
        page.fill("#q", "마포구 아파트를 사면 생애최초 주택 구입 지원을 받을 수 있나요?")
        page.click("[data-act=answer-ok]")
        expect(page.locator(".paper")).to_contain_text("공식 자료인", timeout=15000)

        # 모바일 가로 넘침 없음
        for h in ("#/map", "#/deals", "#/customers", "#/library"):
            page.set_viewport_size({"width": 390, "height": 844})
            page.evaluate(f"location.hash = '{h}'")
            page.wait_for_timeout(500)
            sw = page.evaluate("[document.documentElement.scrollWidth, document.documentElement.clientWidth]")
            assert sw[0] <= sw[1], f"모바일 가로 넘침 {h}: {sw}"
        page.evaluate("location.hash = '#/map'")
        page.wait_for_timeout(800)
        page.screenshot(path=str(IMAGES / "app-map-mobile.png"))
        assert not errors, f"Browser errors: {errors}"
        browser.close()


if __name__ == "__main__":
    run()
    print("app e2e passed")
