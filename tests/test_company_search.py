from contextlib import closing
from io import BytesIO
from threading import Event
from types import SimpleNamespace

import httpx
from openpyxl import Workbook

from bosshunter import company_search as search
from bosshunter.collection.models import JobCandidate, PlatformCollectionResult
from bosshunter.db import get_db, insert_job_if_new
from bosshunter.web.tasks import WorkbenchTaskRunner


def test_import_keeps_excel_row_and_column_order():
    book = Workbook()
    for row in [["序号", "企业名称"], [1, "甲科技有限公司"], [2, "乙科技有限公司"]]:
        book.active.append(row)
    file = BytesIO()
    book.save(file)
    assert search.import_rows("企业.xlsx", file.getvalue())["rows"] == [
        ("序号", "企业名称"), (1, "甲科技有限公司"), (2, "乙科技有限公司")
    ]


def test_company_search_links_all_platforms_and_only_falls_back_after_confirmed_empty(tmp_path, monkeypatch):
    db_path = tmp_path / "jobs.db"
    calls = []
    official = []
    options = search.prepare_options(["天津"], 2)
    names = ["甲技术有限公司", "乙技术有限公司", "丙技术有限公司"]
    ready_for_retry = False

    class Collector:
        def collect(self, request, hooks):
            company, = request.keywords
            platform = request.platform
            assert request.company_search
            calls.append((company, platform))
            if company == names[0]:
                candidate = JobCandidate(platform, "same-source-id", "嵌入式工程师", company,
                                         jd="嵌入式研发", education="本科",
                                         url="https://" + search.DOMAINS[platform] + "/job/1")
                assert hooks.on_list_candidate(candidate)
                assert hooks.on_candidate(candidate)
                unknown = JobCandidate(platform, "incomplete", "测试工程师", company, url=candidate.url)
                if platform == "zhilian" and not ready_for_retry:
                    hooks.on_candidate(unknown)
            if company == names[2] and platform == "51job" and not ready_for_retry:
                return PlatformCollectionResult(platform, "blocked", "login_required", "请登录")
            return PlatformCollectionResult(platform, "completed", "search_exhausted")

    monkeypatch.setattr(search, "COLLECTORS", {p: lambda **kwargs: Collector() for p in search.PLATFORMS})
    def lookup(company):
        official.append(company)
        return "https://example.org/careers", []
    monkeypatch.setattr(search, "official_site_search", lookup)
    task = SimpleNamespace(stop_requested=Event())

    with closing(get_db(db_path)) as db:
        search.init_store(db)
        ids = search.enqueue(db, [*names, names[0]], options)
        search.run(task, {"_company_ids": ids}, db_path)
        assert calls == [(name, platform) for name in names for platform in search.PLATFORMS]
        assert official == [names[1]]
        companies = search.library(db)
        assert [company["job_count"] for company in companies] == [3, 0, 0]
        assert companies[0]["platforms"]["zhilian"]["status"] == "review"
        assert companies[1]["website"] == "https://example.org/careers"
        assert companies[2]["platforms"]["51job"]["status"] == "retry"
        assert [job["education"] for job in search.company_jobs(db, ids[0])] == ["本科"] * 3
        assert db.execute("SELECT COUNT(*) FROM jobs").fetchone()[0] == 0
        assert search.pending_ids(db) == [ids[0], ids[2]]

        assert search.update_company_job(db, ids[0], "same-source-id", status="sent")
        assert search.update_company_job(db, ids[0], "same-source-id", removed=True)
        ready_for_retry = True
        search.run(task, {"_company_ids": search.pending_ids(db)}, db_path)
        assert calls[-2:] == [(names[0], "zhilian"), (names[2], "51job")]
        assert official == names[1:]
        search.run(task, {"_company_ids": search.enqueue(db, [names[0]], options)}, db_path)
        assert search.library(db)[0]["job_count"] == 2
        assert search.update_company_job(db, ids[0], "same-source-id", removed=False)
        assert search.company_jobs(db, ids[0])[0]["status"] == "sent"
        assert db.execute("SELECT COUNT(*) FROM jobs").fetchone()[0] == 0


def test_company_task_shares_collection_resources():
    runner = WorkbenchTaskRunner()
    assert runner._resources("company_search", {}) == {"collect:boss", "collect:zhilian", "collect:51job"}


def test_review_keeps_short_company_match_and_missing_jd_separate(tmp_path):
    class Collector:
        def collect(self, request, hooks):
            for job in (
                JobCandidate("boss", "short", "开发工程师", "极豪科技",
                             education="本科", jd="驱动开发", url="https://www.zhipin.com/job_detail/short.html"),
                JobCandidate("boss", "missing", "测试工程师", "极豪科技（天津）股份有限公司",
                             url="https://www.zhipin.com/job_detail/missing.html"),
                JobCandidate("boss", "unrelated", "工程师", "另一家科技有限公司",
                             jd="研发", url="https://www.zhipin.com/job_detail/unrelated.html"),
            ):
                if hooks.on_list_candidate(job):
                    hooks.on_candidate(job)
            return PlatformCollectionResult("boss", "completed_with_shortage", "search_page_not_advanced")

    with closing(get_db(tmp_path / "jobs.db")) as db:
        search.init_store(db)
        options = search.prepare_options(["天津"], 2)
        company_id, = search.enqueue(db, ["极豪科技（天津）股份有限公司"], options)
        company = db.execute("SELECT * FROM company_search_companies").fetchone()
        status, _, _ = search._platform_search(db, SimpleNamespace(stop_requested=Event()), company, "boss", Collector(), options)
        assert status == "retry"
        assert search.library(db)[0]["review_count"] == 2
        assert search.library(db)[0]["job_count"] == 0
        search.confirm_review_job(db, company_id, "short")
        assert search.library(db)[0]["job_count"] == 1
        assert search.library(db)[0]["review_count"] == 1
        import pytest
        with pytest.raises(ValueError, match="JD"):
            search.confirm_review_job(db, company_id, "missing")


def test_legacy_links_migrate_to_independent_records_and_keep_removal(tmp_path):
    with closing(get_db(tmp_path / "jobs.db")) as db:
        search.init_store(db)
        company_id, = search.enqueue(db, ["甲科技（天津）有限公司"], search.prepare_options(["天津"], 2))
        with db:
            db.execute("ALTER TABLE company_search_jobs DROP COLUMN record")
            db.execute("ALTER TABLE company_search_review DROP COLUMN removed")
        for job_id in ["keep", "removed"]:
            insert_job_if_new(db, {"id": job_id, "company": "甲科技(天津)有限公司", "title": "工程师",
                                   "city": "天津", "jd": "研发", "status": "sent"})
            with db:
                db.execute("INSERT INTO company_search_jobs VALUES (?,?,?)", (company_id, job_id, job_id == "removed"))
        search.init_store(db)
        assert [job["id"] for job in search.company_jobs(db, company_id)] == ["keep"]
        assert search.update_company_job(db, company_id, "keep", status="skipped")
        assert search.company_jobs(db, company_id)[0]["status"] == "skipped"
        assert db.execute("SELECT status FROM jobs WHERE id='keep'").fetchone()[0] == "sent"
        assert search.update_company_job(db, company_id, "removed", removed=False)
        assert search.library(db)[0]["job_count"] == 2


def test_official_search_prefers_verified_careers_and_leaves_brand_only_for_review(monkeypatch):
    contents = """<rss><channel>
      <item><title>甲乙科技有限公司官网</title><link>https://example.org/</link></item>
      <item><title>甲乙科技有限公司官方招聘</title><link>https://example.org/careers</link></item>
      <item><title>甲乙科技有限公司官网</title><link>https://www.qcc.com/123</link></item>
      <item><title>甲乙科技人才招聘</title><link>https://example.net/jobs</link></item>
    </channel></rss>"""
    monkeypatch.setattr(search.httpx, "get", lambda *args, **kwargs:
                        httpx.Response(200, text=contents, request=httpx.Request("GET", args[0])))
    website, candidates = search.official_site_search("甲乙科技有限公司")
    assert website == "https://example.org/careers"
    assert [candidate["url"] for candidate in candidates] == [website, "https://example.org/", "https://example.net/jobs"]
    assert not candidates[-1]["official"]
