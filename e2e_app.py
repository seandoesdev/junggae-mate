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
        body = page.inner_text("body").replace("Hood AI", "")  # 제품 메뉴 이름 'Hood AI'만 예외 (화면 문구에 'AI' 딱지는 쓰지 않는다)
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

        # ── 상단 질문창은 없다. Hood Chat(지도 왼쪽 메뉴)에서 묻고 '지도에서 보기'로 맞는 매물을 지도에 강조 ──
        assert page.locator("#ask-trigger, #ask-layer").count() == 0
        page.click('[data-nav="ai"]')
        page.mouse.move(760, 640)
        expect(page.locator(".hood-kicker")).to_contain_text("Hood Chat")
        expect(page.locator(".hood-hello")).to_contain_text("안녕하세요, 김선용")
        page.wait_for_timeout(300)
        page.screenshot(path=str(IMAGES / "app-hood-start.png"))
        page.fill("#ai-form textarea", "마포구 8억 이하 59㎡ 학교 가까운 집")
        page.press("#ai-form textarea", "Enter")
        expect(page.locator("#ai-main .turn:not(.is-pending)")).to_have_count(1, timeout=15000)
        page.click('#ai-main [data-act="hood-map"]')
        expect(side.locator("#ask-answer")).to_contain_text("마포초", timeout=15000)
        expect(side.locator(".cond")).to_have_count(4)
        assert side.locator("#ask-answer sup .srcref").count() >= 3, "답변 각주가 부족함"
        rows = side.locator("#ask-listings .lrow")
        n = rows.count()
        assert n >= 3
        expect(page.locator("#map .pin.is-match")).to_have_count(n)
        expect(page.locator("#match-bar")).to_contain_text("질문 결과")
        page.wait_for_timeout(500)
        page.screenshot(path=str(IMAGES / "app-ask.png"))
        side.locator('.cond[data-key="price"]').click()                       # 가격 조건 빼고 다시 찾기
        expect(side.locator("[data-act=ask-reset]")).to_be_visible(timeout=10000)
        expect(side.locator('.cond[data-key="price"]')).to_have_count(0)
        assert rows.count() > n
        rows.first.click()                                                    # 결과 매물 → 상세
        expect(side.locator(".detail")).to_be_visible(timeout=10000)
        side.locator("#note-form textarea").fill("E2E 메모: 밤에 조용함")         # 현장 메모
        side.locator("#note-form button").click()
        expect(side.locator(".notes")).to_contain_text("E2E 메모", timeout=10000)
        expect(side.locator("#pub-sec .pub")).to_be_visible(timeout=10000)   # 공공데이터 섹션
        side.locator("[data-act=back]").click()                               # 질문 결과로 (뺀 조건 유지)
        expect(side.locator("#ask-answer")).to_be_visible(timeout=10000)
        expect(side.locator("[data-act=ask-reset]")).to_be_visible()
        page.click("#map-side [data-act=clear-ask]")
        expect(page.locator("#match-bar")).to_be_hidden()

        # ── 지역 이름: 사무소 밖 지역은 지도를 그 지역으로 옮기고, 없다는 사실과 지금 있는 곳을 알려 준다 ──
        page.keyboard.press("/")                                              # '/' → Ask Hood 패널
        expect(page.locator("#hood-panel")).to_have_attribute("aria-hidden", "false")
        page.click('#hood-panel [data-act="hood-new"]')
        page.fill("#hood-q", "동탄 매물 보여줘")
        page.press("#hood-q", "Enter")
        expect(page.locator("#hood-body .turn:not(.is-pending)")).to_have_count(1, timeout=15000)
        page.click('#hood-body [data-act="hood-map"]')
        page.click('#hood-panel [data-act="hood-close"]')
        expect(side.locator("#ask-answer")).to_contain_text("마포구", timeout=15000)
        expect(page.locator("#map .place-tag")).to_contain_text("동탄")
        expect(side.locator("#ask-listings")).to_contain_text("등록된 매물이 없습니다")
        page.click("#map-side [data-act=clear-ask]")

        # ── Hood AI: 메뉴에 마우스를 올리면 목록, 누르면 전용 검색 화면, 이어 묻기 ──
        page.hover('[data-nav="ai"]')
        expect(page.locator(".nav-menu")).to_be_visible()
        expect(page.locator(".nav-menu")).to_contain_text("사용량")
        expect(page.locator('[data-nav="ai"]')).to_contain_text("Hood AI")
        page.click('[data-nav="ai"]')
        page.mouse.move(760, 640)
        expect(page.locator(".nav-menu")).to_be_hidden()
        expect(page.locator(".hood-hello")).to_be_visible()                  # 패널·이전 대화를 잇지 않고 새 대화로 시작
        page.fill("#ai-form textarea", "마포구 59㎡ 집")
        page.press("#ai-form textarea", "Enter")
        expect(page.locator("#ai-main .turn:not(.is-pending)")).to_have_count(1, timeout=15000)
        page.fill("#ai-form textarea", "그중 7.6억 이하만")
        page.press("#ai-form textarea", "Enter")
        expect(page.locator("#ai-main .turn:not(.is-pending)")).to_have_count(2, timeout=15000)
        expect(page.locator("#ai-main .turn").nth(1)).to_contain_text("이어서 찾은 조건")
        expect(page.locator("#ai-history")).to_contain_text("마포구 59㎡ 집")
        page.wait_for_timeout(600)
        page.screenshot(path=str(IMAGES / "app-hood.png"))

        # Ask Hood 패널: 다른 화면에서 열고, 시계로 이전 대화를 불러와 이어 묻기
        page.click("[data-nav=deals]")
        page.click("#ask-hood-btn")
        expect(page.locator("#hood-panel")).to_have_attribute("aria-hidden", "false")
        assert page.locator("#hood-history-btn").count() == 0                # 상단 시계는 없다 (패널 안에만)
        page.click('#hood-panel [data-act="hood-history"]')
        page.locator(".hood-hist button", has_text="마포구 59㎡ 집").click()
        expect(page.locator("#hood-body .turn")).to_have_count(2)
        page.fill("#hood-q", "그중 공원 가까운 곳")
        page.press("#hood-q", "Enter")
        expect(page.locator("#hood-body .turn:not(.is-pending)")).to_have_count(3, timeout=15000)
        page.wait_for_timeout(400)
        page.screenshot(path=str(IMAGES / "app-hood-panel.png"))
        page.click('#hood-panel [data-act="hood-close"]')
        expect(page.locator("#hood-panel")).to_have_attribute("aria-hidden", "true")

        # 보고서·사용량·설정
        page.evaluate("location.hash = '#/ai/usage'")
        expect(page.locator(".kpis")).to_contain_text("이번 달 질문", timeout=10000)
        page.screenshot(path=str(IMAGES / "app-hood-usage.png"))
        page.evaluate("location.hash = '#/ai/settings'")
        expect(page.locator(".notice")).to_contain_text("관리자만", timeout=10000)
        page.evaluate("location.hash = '#/ai/reports'")
        expect(page.locator(".tabs")).to_contain_text("검토 중", timeout=10000)

        # 매물 상세의 공공데이터: C 공덕역세권에 단지 후보를 확정 → Hood 답변에 세대수가 근거와 함께 나온다
        page.evaluate("location.hash = '#/map'")
        page.click("#view-map [data-scope=all]")
        page.locator("#map-side .lrow", has_text="공덕역세권").click()
        pub = page.locator("#pub-sec")
        expect(pub.locator('select[data-kind="complex"]')).to_be_visible(timeout=10000)
        pub.locator('[data-act="pub-link"][data-kind="complex"]').click()
        expect(pub.locator('[data-act="pub-unlink"][data-kind="complex"]')).to_be_visible(timeout=10000)   # 확정됨
        expect(pub.locator("dd").first).to_contain_text("254세대")
        expect(pub).to_contain_text("전세 3건")
        station_checks = pub.locator('input[name="station_ids"]')
        assert station_checks.count() >= 2, "공덕역 노선 후보가 2개보다 적음"
        pub.locator('[data-act="pub-link"][data-kind="station"]').click()
        expect(page.locator("#toast")).to_contain_text("1개 이상", timeout=5000)
        station_checks.nth(0).check()
        station_checks.nth(1).check()
        pub.locator('[data-act="pub-link"][data-kind="station"]').click()
        expect(pub.locator('[data-act="pub-unlink"][data-kind="station"]')).to_be_visible(timeout=10000)
        expect(pub).to_contain_text("5호선")
        expect(pub).to_contain_text("6호선")
        page.screenshot(path=str(IMAGES / "app-public-data.png"))
        page.click("#ask-hood-btn")
        page.click('#hood-panel [data-act="hood-new"]')
        page.fill("#hood-q", "공덕역세권 세대수와 전세 시세")
        page.press("#hood-q", "Enter")
        expect(page.locator("#hood-body .turn:not(.is-pending)")).to_contain_text("254세대", timeout=15000)
        expect(page.locator("#hood-body .turn")).to_contain_text("전세 3건")
        page.click('#hood-panel [data-act="hood-close"]')

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
        # 중개사가 직접 자료 추가 → 질문 검색에 바로 쓰인다
        page.click("[data-act=add-doc]")
        page.fill("#doc-title", "E2E 용강리버뷰 확인 내용")
        page.fill("#doc-text", "용강리버뷰 아파트는 2026년 학구도 기준 용강초 배정 구역입니다(교육지원청 확인).")
        page.click("[data-act=add-doc-ok]")
        expect(page.locator("#library-detail")).to_contain_text("용강초", timeout=10000)
        expect(page.locator("[data-act=del-doc]")).to_be_visible()
        page.fill("#lib-q", "학교 가까운 아파트")
        page.click("[data-act=lib-ask]")
        expect(page.locator("#ask-listings")).to_contain_text("용강초", timeout=15000)

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
        for h in ("#/map", "#/deals", "#/customers", "#/library", "#/ai", "#/ai/usage", "#/ai/settings"):
            page.set_viewport_size({"width": 390, "height": 844})
            page.evaluate(f"location.hash = '{h}'")
            page.wait_for_timeout(500)
            sw = page.evaluate("[document.documentElement.scrollWidth, document.documentElement.clientWidth]")
            assert sw[0] <= sw[1], f"모바일 가로 넘침 {h}: {sw}"
        page.evaluate("location.hash = '#/map'")
        page.wait_for_timeout(800)
        page.screenshot(path=str(IMAGES / "app-map-mobile.png"))

        # 휴대폰의 출처 시트: 대화상자로 동작(뒤 화면 스크롤 고정, Tab 가두기, 닫으면 연 버튼으로 포커스 복귀)
        page.locator("#map-side .lrow", has_text="마포한강뷰").first.click()   # 단지·역·전월세 근거가 있는 매물
        src = page.locator("#pub-sec .srcref").first
        expect(src).to_be_visible(timeout=10000)
        src.click()
        drawer = page.locator("#drawer")
        expect(drawer).to_have_attribute("role", "dialog")
        expect(drawer).to_have_attribute("aria-modal", "")
        assert page.evaluate("document.body.classList.contains('sheet-open')")
        for _ in range(8):
            page.keyboard.press("Tab")
            assert page.evaluate("document.getElementById('drawer').contains(document.activeElement)"), "포커스가 시트 밖으로 나감"
        page.wait_for_timeout(350)                                          # 열림 애니메이션이 끝난 뒤
        page.screenshot(path=str(IMAGES / "app-source-mobile.png"))
        page.mouse.click(195, 80)                                           # 어둡게 덮인 바깥을 누르면 닫힌다
        expect(drawer).to_be_hidden()
        src.click()
        expect(drawer).to_be_visible()
        page.keyboard.press("Escape")
        expect(drawer).to_be_hidden()
        assert not page.evaluate("document.body.classList.contains('sheet-open')")
        assert page.evaluate("document.activeElement.classList.contains('srcref')"), "닫은 뒤 포커스가 출처 버튼으로 돌아오지 않음"

        # 관리자 공공데이터 운영 화면: 키를 노출하지 않고 수집 폼·작업 이력을 제공한다
        page.click('[data-act="logout"]')
        page.fill("#login-email", "admin@hanul.test")
        page.fill("#login-password", "demo1234")
        page.click("#login-btn")
        expect(page.locator('[data-nav="public"]')).to_be_visible()
        page.click('[data-nav="public"]')
        expect(page.locator("#view-public form[data-collect]")).to_have_count(5, timeout=10000)
        expect(page.locator("#public-jobs")).not_to_contain_text("불러오는 중", timeout=10000)
        assert "API 키 값" in page.locator("#view-public").inner_text()
        assert "serviceKey" not in page.locator("#view-public").inner_text()
        sw = page.evaluate("[document.documentElement.scrollWidth, document.documentElement.clientWidth]")
        assert sw[0] <= sw[1], f"모바일 가로 넘침 #/public: {sw}"

        # 관리자 지도 기본 범위는 사무소 전체이고, 공공데이터 오류는 재시도 상태로 바뀐다
        expected_error_at = len(errors)
        page.route("**/api/listings/1/public", lambda route: route.fulfill(
            status=503, content_type="application/json", body='{"detail":"공공데이터 점검 중"}'))
        page.evaluate("location.hash = '#/map/l/1'")
        expect(page.locator('#view-map [data-scope="all"]')).to_have_attribute("aria-pressed", "true", timeout=10000)
        expect(page.locator("#pub-sec .pub-error")).to_be_visible(timeout=10000)
        expect(page.locator('#pub-sec [data-act="pub-retry"]')).to_be_visible()
        page.unroute("**/api/listings/1/public")
        page.click('#pub-sec [data-act="pub-retry"]')
        expect(page.locator("#pub-sec .pub")).to_be_visible(timeout=10000)
        forced_errors = errors[expected_error_at:]
        assert forced_errors and all("503" in error for error in forced_errors), forced_errors
        del errors[expected_error_at:]
        assert not errors, f"Browser errors: {errors}"
        browser.close()


if __name__ == "__main__":
    run()
    print("app e2e passed")
