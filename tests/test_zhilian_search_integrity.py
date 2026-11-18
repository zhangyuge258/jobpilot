"""Offline regressions for search drift; these never contact Zhilian."""
import json
import re
import shutil
import subprocess
from dataclasses import replace
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

from bosshunter.collection.base import CollectionError, CollectorHooks
from bosshunter.collection.models import JobCandidate, PlatformCollectionRequest
from bosshunter.collection.platforms.zhilian import (
    JS_EXTRACT_DETAIL, JS_EXTRACT_LIST, JS_NAVIGATE_PAGE, JS_READ_SEARCH_STATE,
    ZhilianBrowser, ZhilianCollector,
)


class SearchIntegrityTests(TestCase):
    def candidate(self, **changes):
        job = JobCandidate("zhilian", "test", "嵌入式工程师", "测试公司",
                           city="天津·滨海新区", jd="开发嵌入式系统软件", source_keyword="嵌入式软件")
        return replace(job, **changes)

    def test_admission_uses_actual_city_and_content(self):
        check = ZhilianCollector._search_mismatch_reason
        self.assertEqual(check(self.candidate(), "天津", ["嵌入式软件"]), "")
        self.assertEqual(check(self.candidate(city="天津市·南开区"), "天津", ["嵌入式软件"]), "")
        for job in (
            self.candidate(city="合肥·包河区"), self.candidate(city=""),
            self.candidate(city="上海·天津路"),
            self.candidate(title="销售助理", jd="客户维护与销售"),
            self.candidate(title="嵌入式硬件工程师", jd="电路设计"),
        ):
            with self.subTest(job=job):
                self.assertTrue(check(job, "天津", ["嵌入式软件"]))

    def test_any_configured_keyword_passes_regardless_of_source_keyword(self):
        keywords = ["嵌入式软件", "嵌入式硬件"]
        check = ZhilianCollector._search_mismatch_reason
        hardware = self.candidate(title="高级嵌入式硬件工程师", jd="负责原理图及 PCB 设计", source_keyword="嵌入式软件")
        software = self.candidate(title="嵌入式软件工程师", jd="单片机开发", source_keyword="嵌入式硬件")
        self.assertEqual(check(hardware, "天津", keywords), "")
        self.assertEqual(check(software, "天津", keywords), "")
        self.assertTrue(check(replace(hardware, city="合肥"), "天津", keywords))
        unrelated = self.candidate(title="销售专员", jd="客户维护")
        reason = check(unrelated, "天津", keywords)
        self.assertIn("未匹配任一关键词", reason)
        self.assertIn("嵌入式软件、嵌入式硬件", reason)

    def test_detail_keeps_list_metadata_without_inventing_city(self):
        base = ZhilianCollector._candidate_from_list({
            "id": "123", "title": "嵌入式工程师", "company": "公司", "city": "天津",
            "experience": "应届生", "education": "本科",
        }, "天津", "嵌入式软件", "531")
        final = ZhilianCollector._candidate_from_detail({"jd": "嵌入式软件开发"}, base)
        record = final.as_job_record()
        self.assertEqual((final.experience, final.education, final.city_code), ("应届生", "本科", "531"))
        self.assertEqual(record["recruitment_type"], "campus")
        self.assertEqual(record["source_city_code"], "531")
        unknown = ZhilianCollector._candidate_from_list({"id": "124", "title": "嵌入式工程师"}, "天津", "嵌入式软件")
        self.assertEqual(unknown.city, "")
        api_unknown = ZhilianCollector._item_to_candidate({"jobId": "125", "jobName": "嵌入式软件"}, "天津", "531", "嵌入式软件")
        self.assertEqual(api_unknown.city, "")

    def test_context_rejects_recommendations_wrong_city_and_wrong_keyword(self):
        good = {"url": "https://www.zhaopin.com/jobs/?jl=531&kw=嵌入式软件", "input": "嵌入式软件", "signature": "one"}
        states = [
            good,
            dict(good, input=""),
            dict(good, url="https://www.zhaopin.com/jobs/?jl=531&pageMode=recommend"),
            dict(good, url="https://www.zhaopin.com/jobs/?jl=489&kw=嵌入式软件"),
            dict(good, url="https://www.zhaopin.com/jobs/?jl=531&kw=销售"),
            dict(good, url="https://www.zhaopin.com/jobs/?kw=嵌入式软件"),
        ]
        for i, state in enumerate(states):
            collector = ZhilianCollector(browser=ZhilianBrowser(evaluate=lambda *_: state))
            if i == 0:
                collector._check_search_context("tab", "嵌入式软件", "531")
            else:
                with self.subTest(state=state), self.assertRaises(CollectionError):
                    collector._check_search_context("tab", "嵌入式软件", "531")

    def run_collection(self, detail, *, lose_context_on_page_two=False, pagination_missing=False, configured_keywords=None):
        page = 1
        state_calls = 0
        lists = []
        collected = []
        events = []

        def evaluate(_target, script):
            nonlocal page, state_calls
            if "item_count" in script:
                state_calls += 1
                initial = state_calls == 1
                lost = page == 2 and lose_context_on_page_two
                return {"url": "https://www.zhaopin.com/jobs/?jl=531" + ("" if initial or lost else "&kw=嵌入式软件"),
                        "input": "" if initial or lost else "嵌入式软件",
                        "signature": "initial" if initial else f"page-{page}"}
            if "pagination_not_found" in script:
                if pagination_missing:
                    return {"ok": False, "reason": "pagination_not_found"}
                page = 2
                return {"ok": True}
            if "submitted_by" in script:
                return {"ok": True, "value": "嵌入式软件"}
            if "descriptionCard" in script:
                return dict(detail, status="ready", url="https://www.zhaopin.com/jobdetail/test.htm")
            if "card.click()" in script:
                return {"ok": True}
            lists.append(page)
            return {"items": [{"card_index": 0}], "status": "ready"}

        browser = ZhilianBrowser(new_tab=lambda *_a, **_k: "tab", close_tab=lambda *_: True,
                                 wait_for_load=lambda *_a, **_k: True, scroll=lambda *_a, **_k: True,
                                 evaluate=evaluate)
        hooks = CollectorHooks(stop_event=None, on_list_candidate=lambda _: True,
                               on_candidate=lambda job: collected.append(job) or True,
                               on_parse_failed=lambda reason: self.fail(reason),
                               on_event=lambda **event: events.append(event))
        with patch("bosshunter.collection.platforms.zhilian.SendWindowChecker.is_active", return_value=True), \
             patch("bosshunter.collection.platforms.zhilian.should_take_day_off", return_value=False), \
             patch("bosshunter.collection.platforms.zhilian.time.sleep"):
            collector = ZhilianCollector(browser=browser, sleep=lambda _: None)
            # A lost keyword fails immediately in this offline test while exercising
            # the same per-page wait and context checks as the real collector.
            original_wait = collector._wait_for_search_results
            collector._wait_for_search_results = lambda tab, keyword, before: original_wait(tab, keyword, before, timeout=0.01)
            result = collector.collect(PlatformCollectionRequest("zhilian", configured_keywords or ["嵌入式软件"], ["天津"], {"天津": "531"}, max_pages=2), hooks)
        return result, collected, lists, events

    def test_lost_page_two_context_stops_before_reading_or_saving_it(self):
        result, jobs, lists, _ = self.run_collection(
            {"title": "嵌入式软件工程师", "company": "公司", "city": "天津", "jd": "嵌入式软件开发"},
            lose_context_on_page_two=True)
        self.assertEqual(result.reason_code, "search_not_applied")
        self.assertEqual(lists, [1])
        self.assertEqual(len(jobs), 1)
        self.assertEqual(jobs[0].city_code, "531")

    def test_unrelated_detail_never_reaches_save_callback(self):
        result, jobs, _, events = self.run_collection(
            {"title": "销售助理", "company": "公司", "city": "合肥", "jd": "销售工作"}, pagination_missing=True)
        self.assertEqual(result.reason_code, "pagination_not_applied")
        self.assertEqual(jobs, [])
        self.assertTrue(any(event.get("increment_filtered") for event in events))

    def test_hardware_job_from_software_search_reaches_save_callback(self):
        _, jobs, _, events = self.run_collection(
            {"title": "高级嵌入式硬件工程师", "company": "天津百利智慧能源科技有限公司", "city": "天津", "jd": "负责原理图和 PCB 设计"},
            pagination_missing=True, configured_keywords=["嵌入式软件", "嵌入式硬件"])
        self.assertEqual(len(jobs), 1)
        self.assertEqual(jobs[0].title, "高级嵌入式硬件工程师")
        self.assertEqual(jobs[0].source_keyword, "嵌入式软件")
        self.assertFalse(any(event.get("increment_filtered") for event in events))


class ScrollCollectionTests(TestCase):
    def run_scroll_collection(self, *, saved_page=0, max_pages=2, end_after=3, prefetch=False):
        loaded = 1
        active = 0
        state_calls = 0
        navigated = []
        collected = []
        checkpoints = []
        keyword = "嵌入式软件"

        def evaluate(_target, script):
            nonlocal loaded, active, state_calls
            if "item_count" in script:
                state_calls += 1
                initial = state_calls == 1
                return {"url": "https://www.zhaopin.com/jobs/?jl=531&kw=" + keyword,
                        "input": "" if initial else keyword,
                        "signature": "before" if initial else "unchanged-first-card",
                        "list_mode": "append", "list_count": loaded, "list_end": loaded >= end_after}
            if "submitted_by" in script:
                return {"ok": True, "value": keyword}
            if "pagination_not_found" in script:
                loaded += 1
                navigated.append(loaded)
                return {"ok": True, "mode": "append"}
            if "card.click()" in script:
                active = int(re.search(r"\[(\d+)\]", script)[1])
                return {"ok": True}
            if "descriptionCard" in script:
                return {"status": "ready", "title": keyword + "工程师", "company": "公司", "city": "天津",
                        "jd": keyword + "开发", "url": f"https://www.zhaopin.com/jobdetail/job-{active}.htm"}
            result = {"status": "ready", "list_mode": "append", "items": [{"card_index": i} for i in range(loaded)]}
            if prefetch and loaded == 1:
                loaded = 2
            return result

        browser = ZhilianBrowser(new_tab=lambda *_a, **_k: "tab", close_tab=lambda *_: True,
                                 evaluate=evaluate, wait_for_load=lambda *_a, **_k: True,
                                 scroll=lambda *_a, **_k: self.fail("Reading an append batch must not trigger prefetch"))
        hooks = CollectorHooks(stop_event=None, on_list_candidate=lambda _: True,
                               on_candidate=lambda job: collected.append(job.source_job_id) or True,
                               on_parse_failed=lambda reason: self.fail(reason), on_event=lambda **_: None)
        with patch("bosshunter.collection.platforms.zhilian.SendWindowChecker.is_active", return_value=True), \
             patch("bosshunter.collection.platforms.zhilian.should_take_day_off", return_value=False), \
             patch("bosshunter.collection.platforms.zhilian.prune_collected_combos"), \
             patch("bosshunter.collection.platforms.zhilian.prune_page_progress"), \
             patch("bosshunter.collection.platforms.zhilian.get_collected_combos", return_value=set()), \
             patch("bosshunter.collection.platforms.zhilian.get_page_progress", return_value=saved_page), \
             patch("bosshunter.collection.platforms.zhilian.upsert_page_progress", side_effect=lambda *args: checkpoints.append(args[-1])), \
             patch("bosshunter.collection.platforms.zhilian.mark_combo_collected"), \
             patch("bosshunter.collection.platforms.zhilian.delete_page_progress"):
            result = ZhilianCollector(browser=browser, safety_conn=object(), sleep=lambda _: None,
                                      uniform=lambda *_: 0).collect(
                PlatformCollectionRequest("zhilian", [keyword], ["天津"], {"天津": "531"}, max_pages=max_pages), hooks)
        return result, collected, navigated, checkpoints

    def test_appended_cards_are_collected_once_even_when_first_cards_do_not_change(self):
        result, jobs, pages, checkpoints = self.run_scroll_collection()
        self.assertEqual(result.status, "completed")
        self.assertEqual(jobs, ["job-0", "job-1"])
        self.assertEqual(pages, [2])
        self.assertEqual(checkpoints, [1, 2])

    def test_one_page_limit_does_not_scroll_into_a_second_batch(self):
        result, jobs, pages, checkpoints = self.run_scroll_collection(max_pages=1)
        self.assertEqual(result.status, "completed")
        self.assertEqual((jobs, pages, checkpoints), (["job-0"], [], [1]))

    def test_resume_loads_intermediate_batches_before_reading_the_target_batch(self):
        result, jobs, pages, checkpoints = self.run_scroll_collection(saved_page=2, max_pages=3)
        self.assertEqual(result.status, "completed")
        self.assertEqual((jobs, pages, checkpoints), (["job-2"], [2, 3], [3]))

    def test_native_prefetch_is_consumed_without_an_extra_request(self):
        result, jobs, pages, checkpoints = self.run_scroll_collection(prefetch=True)
        self.assertEqual(result.status, "completed")
        self.assertEqual((jobs, pages, checkpoints), (["job-0", "job-1"], [], [1, 2]))

    def test_explicit_end_is_normal_completion(self):
        result, jobs, pages, checkpoints = self.run_scroll_collection(max_pages=5, end_after=2)
        self.assertEqual(result.status, "completed")
        self.assertEqual((jobs, pages, checkpoints), (["job-0", "job-1"], [2], [1, 2]))


class SearchDOMTests(TestCase):
    def run_js(self, script, html, setup=""):
        root = Path(__file__).resolve().parents[1]
        node = shutil.which("node") or "D:/ruanjian/AI/nodejs/node.exe"
        jsdom = root / "src/bosshunter/web/frontend/node_modules/jsdom"
        if not Path(node).exists() or not jsdom.exists():
            self.skipTest("Node and frontend jsdom are required for DOM tests")
        harness = """
const fs = require('fs');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const {JSDOM} = require(input.jsdom);
const dom = new JSDOM(input.html, {url: 'https://www.zhaopin.com/jobs/?jl=531&kw=embedded', runScripts: 'outside-only'});
Object.defineProperty(dom.window.HTMLElement.prototype, 'innerText', {get() {return this.textContent;}});
dom.window.eval(input.setup);
const result = JSON.parse(dom.window.eval(input.script));
process.stdout.write(JSON.stringify({result, url: dom.window.location.href, clicked: dom.window.clicked || 0}));
"""
        completed = subprocess.run([node, "-e", harness], input=json.dumps({
            "jsdom": str(jsdom), "script": script, "html": html, "setup": setup,
        }), text=True, encoding="utf-8", capture_output=True, check=True)
        return json.loads(completed.stdout)

    def test_native_pagination_click_keeps_search_url(self):
        output = self.run_js(JS_NAVIGATE_PAGE.replace("__PAGE__", "2"),
                             '<div class="pagination"><button>1</button><button id="next">2</button></div>',
                             "document.getElementById('next').onclick = () => { window.clicked = 2; };")
        self.assertTrue(output["result"]["ok"])
        self.assertEqual(output["clicked"], 2)
        self.assertIn("jl=531&kw=embedded", output["url"])
        missing = self.run_js(JS_NAVIGATE_PAGE.replace("__PAGE__", "2"), '<button>2</button>')
        self.assertFalse(missing["result"]["ok"])
        self.assertNotIn("/p2", missing["url"])
        last = self.run_js(JS_NAVIGATE_PAGE.replace("__PAGE__", "3"),
                           '<div class="pagination"><button class="active">2</button><button class="next" disabled>下一页</button></div>')
        self.assertTrue(last["result"]["exhausted"])

    def test_live_selectors_extract_education_experience_and_actual_city(self):
        detail = self.run_js(JS_EXTRACT_DETAIL.replace("__EXPECTED_CITY__", "天津"), '''
<h1 class="job-detail-summary__title-text">嵌入式软件</h1>
<span class="job-detail-summary__tag">合肥·包河区</span>
<span class="job-detail-summary__tag">应届生</span><span class="job-detail-summary__tag">本科</span>
<div class="job-detail">嵌入式软件开发</div>''')["result"]
        self.assertEqual((detail["city"], detail["experience"], detail["education"]), ("合肥·包河区", "应届生", "本科"))
        items = self.run_js(JS_EXTRACT_LIST.replace("__EXPECTED_CITY__", "天津"), '''
<div class="joblist-item"><a class="jobinfo__name" href="/jobdetail/123.htm">嵌入式硬件</a>
<span class="jobinfo__other-info-item">天津·南开区</span>
<span class="jobinfo__other-info-item">1-3年</span><span class="jobinfo__other-info-item">硕士</span></div>''')["result"]["items"]
        self.assertEqual((items[0]["city"], items[0]["experience"], items[0]["education"]), ("天津·南开区", "1-3年", "硕士"))

    def test_current_layout_loads_more_by_scroll_without_changing_the_route(self):
        html = '<div class="job-list-panel"><div class="job-card">first</div></div>'
        output = self.run_js(JS_NAVIGATE_PAGE.replace("__PAGE__", "2"), html,
                             "window.scrollTo = () => {}; window.addEventListener('scroll', () => { window.clicked++; }); window.clicked = 0;")
        self.assertEqual(output["result"], {"ok": True, "mode": "append"})
        self.assertEqual(output["clicked"], 1)
        self.assertIn("jl=531&kw=embedded", output["url"])
        html = '<div class="job-list-panel">' + ''.join(f'<div class="job-card">job{i}</div>' for i in range(9)) + '<div class="job-list-panel__status">没有更多了</div></div>'
        state = self.run_js(JS_READ_SEARCH_STATE, html)["result"]
        self.assertEqual((state["list_count"], state["item_count"], state["list_mode"], state["list_end"]), (9, 8, "append", True))
