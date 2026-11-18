"""Local UI fixture check. Intercepts all API calls; never contacts recruiters."""
import base64
import json
import time
from pathlib import Path
from urllib.parse import urlsplit, unquote

from patchright.sync_api import sync_playwright
from bosshunter.browser import new_tab, close_tab


OUT = Path(__file__).resolve().parents[1] / "data" / "qa-v246"
OUT.mkdir(parents=True, exist_ok=True)
URL = f"http://127.0.0.1:8686/jobs?qa=v246-{time.time_ns()}"
TOKEN = "a" * 32 + ".png"
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=")
JOBS = [{"id": f"{platform}:qa", "source_platform": platform, "title": "嵌入式软件工程师", "company": f"{name}验证公司",
         "salary": "10-18K", "city": "天津", "education": "本科", "experience": "应届生", "recruitment_type": "campus",
         "jd": "岗位要求：STM32 外设驱动开发、UART / I2C / SPI 联调，参与嵌入式系统开发。", "status": "pending", "score": 0,
         "created_at": "2026-11-05 05:31:00", "hr_active": "今日活跃", "url": url}
        for platform, name, url in [("zhilian", "智联", "https://jobs.zhaopin.com/CC123.htm"),
                                    ("51job", "前程", "https://jobs.51job.com/tianjin/123.html"),
                                    ("liepin", "猎聘", "https://www.liepin.com/job/123.shtml")]]
TASKS = [
    {"id": "collect-boss", "mode": "collect", "label": "单独采集", "status": "running", "stop_requested": False,
     "platforms": ["boss"], "resources": ["collect:boss"], "logs": ["正在采集 BOSS 岗位"], "metrics": {"collect_seen": 35, "collect_new": 5},
     "progress": {"outcome": "running", "platforms": {"boss": {"status": "running", "new": 5, "target": 20, "seen": 35, "phase": "collecting"}}}},
    {"id": "score-zhilian", "mode": "score", "label": "单独 AI 评分", "status": "running", "stop_requested": False,
     "platforms": ["zhilian"], "resources": ["score:qa"], "logs": ["评分进度 3/8"], "metrics": {"ai_total": 8, "ai_completed": 3, "ai_passed": 2, "ai_filtered": 1}},
]
WORKBENCH = {"task": TASKS[0], "tasks": TASKS, "active_tasks": TASKS, "last_task": TASKS[-1], "funnel": {"采集总数": 3}, "funnel_today": {},
             "pending_confirmation": [], "pending_greetings": [], "send_errors": [], "needs_resume": [],
             "send_quota": {"daily_limit": 30, "sent": 0, "remaining": 30, "exhausted": False}}
posts = []
errors = []


def intercept(route):
    request = route.request
    path = unquote(urlsplit(request.url).path)
    if request.method != "GET":
        posts.append(path)
        if not path.endswith("/greeting-optimize"):
            route.abort()
            raise AssertionError(f"Unexpected mutation during UI QA: {path}")
        route.fulfill(json={"greeting": "您好，我熟悉 STM32 开发与 UART、I2C、SPI 联调，希望进一步了解本岗。",
                            "company": JOBS[0]["company"], "title": JOBS[0]["title"], "highlights": [
                                {"jd_quote": "STM32 外设驱动开发", "evidence_quote": "STM32 开发与外设联调", "reason": "驱动和联调经验与本岗相关"}]})
    elif path == "/api/workbench":
        route.fulfill(json=WORKBENCH)
    elif path == "/api/jobs/search":
        route.fulfill(json={"items": JOBS, "total": 3, "all_total": 3, "city_options": ["天津"], "title_options": ["嵌入式软件工程师"], "limit": 15, "offset": 0})
    elif path == "/api/workbench/greeting-presets":
        route.fulfill(json={"items": [{"id": "qa-preset", "name": "嵌入式校招", "custom_greeting": "您好，我熟悉 STM32 开发与外设联调。", "greeting_image_id": TOKEN}]})
    elif path.startswith("/api/workbench/greeting-images/"):
        route.fulfill(body=PNG, content_type="image/png")
    elif path.startswith("/api/jobs/"):
        route.fulfill(json=next((job for job in JOBS if job["id"] == path.removeprefix("/api/jobs/")), JOBS[0]))
    elif path.startswith(("/api/history", "/api/activity", "/api/top-companies")):
        route.fulfill(json={"count": 0} if "count" in path else [])
    else:
        route.fulfill(json={})


target = new_tab(URL, background=True)
assert target, "Could not open local QA tab"
try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.connect_over_cdp("http://127.0.0.1:9222")
        page = next(page for context in browser.contexts for page in context.pages if page.url == URL)
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.route("**/api/**", intercept)
        page.add_init_script("Object.defineProperty(navigator, 'clipboard', {value: {writeText: async value => { window.qaClipboard = value }}})")
        page.set_viewport_size({"width": 1366, "height": 900})
        page.reload()
        page.get_by_role("button", name="打开平台", exact=True).first.wait_for()
        page.screenshot(path=str(OUT / "jobs-1366.png"), full_page=True)
        assert page.locator('[aria-label="岗位表格"]').evaluate("e => e.scrollWidth <= e.clientWidth + 1")
        page.get_by_role("button", name="打开平台", exact=True).first.click()
        dialog = page.get_by_role("dialog", name="手动投递 · 招呼语准备")
        dialog.get_by_text(JOBS[0]["jd"], exact=True).wait_for()
        dialog.get_by_role("button", name="导入搭配 嵌入式校招").click()
        dialog.get_by_role("button", name="按所选岗位 JD 优化", exact=True).click()
        text = dialog.get_by_label(f'{JOBS[0]["company"]} {JOBS[0]["title"]} 发送正文')
        text.wait_for()
        page.wait_for_function("() => document.querySelector('[aria-label$=\"发送正文\"]').value.includes('希望进一步')")
        dialog.get_by_text("生成时匹配依据", exact=True).click()
        text.fill("我已编辑的岗位招呼语")
        dialog.get_by_role("button", name="复制最终招呼语").click()
        try:
            page.wait_for_function("window.qaClipboard === '我已编辑的岗位招呼语'", timeout=4000)
        except Exception:
            page.screenshot(path=str(OUT / "copy-debug.png"))
            print(json.dumps({"clipboard": page.evaluate("window.qaClipboard"), "dialog": dialog.inner_text(), "errors": errors}, ensure_ascii=False))
            raise
        link = dialog.get_by_role("link", name="打开岗位网页（手动投递）")
        assert link.get_attribute("href") == JOBS[0]["url"]
        dialog.evaluate("e => { e.scrollTop = 0 }")
        page.screenshot(path=str(OUT / "manual-dialog-1366.png"))
        page.set_viewport_size({"width": 760, "height": 900})
        assert dialog.evaluate("e => e.scrollWidth <= e.clientWidth + 1")
        link.scroll_into_view_if_needed()
        page.screenshot(path=str(OUT / "manual-dialog-760.png"))
        dialog.get_by_role("button", name="取消", exact=True).click()
        page.set_viewport_size({"width": 1366, "height": 900})
        page.goto("http://127.0.0.1:8686/?qa=v246")
        region = page.get_by_role("region", name="独立运行任务")
        region.wait_for()
        assert region.get_by_role("article").count() == 2
        assert region.get_by_role("button", name="停止此任务").count() == 2
        region.get_by_role("button", name="智联招聘 · 单独 AI 评分", exact=False).click()
        assert page.get_by_role("progressbar", name="AI 评分进度").get_attribute("aria-valuenow") == "37"
        page.screenshot(path=str(OUT / "independent-tasks-1366.png"), full_page=True)
        assert not errors, errors
        assert posts == ["/api/jobs/zhilian:qa/greeting-optimize"], posts
        print(json.dumps({"screenshots": str(OUT), "checked": ["column fit", "manual JD/preset/optimization/edit/copy/link", "760px dialog", "independent task progress/stop controls"], "api_mutations": posts, "errors": errors}, ensure_ascii=False))
        # Do not close the user's Chrome; only our own target is closed below.
finally:
    close_tab(target)
