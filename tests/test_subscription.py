from contextlib import closing
from datetime import datetime

from bosshunter import subscription as sub
from bosshunter.db import get_db, insert_job_if_new
from bosshunter.subscription_sources import ncss_state, window
from bosshunter.subscription_directory import CENTRAL, list_orgs
import httpx


def test_deadline_uses_application_dates_and_preserves_precision():
    assert window("笔试时间：2026年11月28日09:00\n报名时间：2026年11月16日8:30至2026年11月23日17时截止") == (
        "2026-11-16T08:30:00+08:00", "2026-11-23T17:00:00+08:00")
    assert window("本次招聘报名自公告发布之日起至2026年11月23日17时截止。") == (
        "", "2026-11-23T17:00:00+08:00")
    assert window("拟聘公示时间 2026年11月23日") == ("", "")


def test_reports_keep_cursor_stable_and_expiry_distinct_from_application(tmp_path):
    with closing(get_db(tmp_path / "jobs.db")) as db:
        sub.init(db)
        with db:
            db.executemany("INSERT INTO subscription_sources(id,state) VALUES(?,'ok')",
                           [(key,) for key in sub.SOURCES])
        base = dict(key="1", kind="job", category="state", company="测试公司", title="软件工程师",
                    jd="调试驱动", closes="2026-11-17", url="https://example.com/")
        sub.save_source(db, "phytium", [base], "2026-11-16T08:20:00+08:00", complete=True, message="")
        sub.create_report(db, datetime(2026, 11, 16, 8, 29, tzinfo=sub.CHINA))
        assert sub.latest_report(db) is None
        sub.create_report(db, datetime(2026, 11, 16, 8, 30, tzinfo=sub.CHINA))
        first = sub.latest_report(db)
        assert first["data"]["open_count"] == 1
        assert first["data"]["urgent"][0]["key"] == "1"
        sub.save_source(db, "phytium", [{**base, "closes": "2026-11-19"}],
                        "2026-11-16T08:30:10+08:00", complete=True, message="")
        with db:
            db.execute("UPDATE subscription_items SET sent=1")
        sub.create_report(db, datetime(2026, 11, 16, 8, 31, tzinfo=sub.CHINA))
        assert sub.latest_report(db) == first
        sub.create_report(db, datetime(2026, 11, 17, 8, 30, tzinfo=sub.CHINA))
        later = sub.latest_report(db)
        assert later["cursor"] > first["cursor"]
        assert later["data"]["open_count"] == 1
        assert later["data"]["urgent"] == []
        assert sub.listing(db, "state", "sent")[0]["jobs"][0]["sent"]


def test_partial_check_does_not_mark_missing_jobs_and_resumes_after_failure(tmp_path):
    with closing(get_db(tmp_path / "jobs.db")) as db:
        sub.init(db)
        with db:
            db.execute("INSERT INTO subscription_sources(id,state) VALUES('phytium','running')")
        insert_job_if_new(db, {"id": "existing", "title": "现有岗位", "company": "测试原平台", "source_platform": "zhilian"})
        sub.save_source(db, "phytium", [dict(key="1", kind="job", category="state", company="测试公司",
                        title="软件工程师", availability="open")], "2026-11-16T08:20:00+08:00", complete=True, message="")
        sub.save_source(db, "phytium", [], "2026-11-16T09:20:00+08:00", complete=False, message="详情待查")
        assert next(sub.official_items(db, sub.now_cn()))["availability"] == "open"
        state = sub.source_status(db)[0]
        assert state["state"] == "partial" and state["successful"] == "2026-11-16T08:20:00+08:00"
        assert sub.listing(db, "other", "all")[0]["jobs"][0]["key"] == "existing"
        sub.save_source(db, "phytium", [], "2026-11-16T10:20:00+08:00", complete=True, message="")
        assert next(sub.official_items(db, sub.now_cn()))["availability"] == "unknown"


def test_organisation_directory_does_not_create_jobs(tmp_path):
    with closing(get_db(tmp_path / "jobs.db")) as db:
        sub.init(db)
        organisations = list_orgs(db, sub.listing(db, "state", "all"), "state", "")
        assert len(organisations) == len(set(CENTRAL)) == 100
        assert all(org["jobs"] == 0 and org["notices"] == 0 and not org["sources"] for org in organisations)
        assert organisations[0]["links"]


def test_ncss_expected_openings_remain_a_single_announcement():
    raw = """<script>var comsList = [{"company":"测试单位","title":"校园招聘","link":"https://example.org/",
        "startDate":"2026年11月1日","endDate":"2026年12月1日","yjtggws":20}];</script>"""
    with httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(200, text=raw))) as client:
        items, complete, _ = ncss_state(client)
    assert complete and len(items) == 1
    assert items[0]["kind"] == "notice" and items[0]["closes"] == "2026-12-01"
