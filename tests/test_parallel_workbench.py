"""Offline regression for independent work, ownership and short quota transactions."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Event
from unittest.mock import Mock

import pytest

from bosshunter import db as database
from bosshunter.ai import scorer
from bosshunter.executor import sender
from bosshunter.platform_safety import PlatformAccessGuard, PlatformSafetyStop
from bosshunter.web import server
from bosshunter.web.tasks import TaskAlreadyRunningError, WorkbenchTaskRunner
from bosshunter.collection.platforms.boss import BossCollector
from bosshunter.collection.platforms.zhilian import ZhilianBrowser, ZhilianCollector
from bosshunter.collection.models import PlatformCollectionRequest
import test_boss_collector as boss_helpers
from test_task_start_and_scoring_limits import runtime, request, seed_jobs, SCORE_RESPONSE


PLATFORMS = ["boss", "zhilian", "51job", "liepin"]


def collection_config(platforms):
    return {"_collection_options": {"platform_order": platforms, "auto_score": False,
            "platforms": {p: {} for p in platforms}}}


def test_four_collectors_have_independent_progress_and_stop_tokens():
    entered = {p: Event() for p in PLATFORMS}

    def collect(task, config):
        platform = config["_collection_options"]["platform_order"][0]
        task.progress = {"platforms": {platform: {"new": 1}}}
        entered[platform].set()
        task.stop_requested.wait(5)

    runner = WorkbenchTaskRunner({"collect": collect})
    try:
        started = runner.start("collect", collection_config(PLATFORMS))
        assert all(event.wait(2) for event in entered.values())
        assert len(started["tasks"]) == len(runner.status()["active_tasks"]) == 4
        with pytest.raises(TaskAlreadyRunningError):
            runner.start("collect", collection_config(["boss"]))
        runner.stop(started["tasks"][0]["id"])
        runner._threads[started["tasks"][0]["id"]].join(2)
        assert {task["platforms"][0] for task in runner.status()["active_tasks"]} == set(PLATFORMS[1:])
        assert all(task["progress"]["platforms"] for task in runner.status()["active_tasks"])
    finally:
        for task in runner.status()["active_tasks"]:
            runner.stop(task["id"])
        runner.wait(2)


@pytest.mark.parametrize("platform", PLATFORMS)
def test_collect_does_not_reject_scoring_delivery_or_labels(runtime, monkeypatch, platform):
    path, runner, ai = runtime
    seed_jobs(path, 2)
    entered, delivering = Event(), Event()

    def collect(task, config):
        db = database.get_db(path)
        try:
            db.execute("INSERT INTO jobs(id,title,company,jd,source_platform) VALUES ('new','嵌入式','新公司','开发','zhilian')")
            db.commit()
        finally:
            db.close()
        entered.set()
        task.stop_requested.wait(10)

    def deliver(task, config):
        assert config["_workbench_job_ids"] == ["0"]
        task.context["delivering"] = True
        delivering.set()
        task.stop_requested.wait(10)

    runner._executors.update(collect=collect, deliver=deliver)
    monkeypatch.setattr(server, "_delivery_window_error", lambda _: None)
    running = runner.start("collect", collection_config([platform]))
    assert entered.wait(3)
    status, score = request("/api/scoring/start", {"scope": "selected", "job_ids": ["1"]})
    assert status == 200, score
    status, delivery = request("/api/workbench/deliver", {"job_ids": ["0"], "custom_greeting": "您好，想进一步了解岗位。"})
    assert status == 200, delivery
    assert delivering.wait(2)
    for job_id in ["1", "new"]:
        status, result = request("/api/jobs/status", {"job_ids": [job_id], "status": "sent"})
        assert status == 200, result
    # A queued/sending job is protected, without blocking other rows.
    assert request("/api/jobs/status", {"job_ids": ["0"], "status": "skipped"})[0] == 409
    assert runner._tasks[running["id"]].status == "running"
    assert len(runner.status()["active_tasks"]) >= 2


def test_label_during_ai_call_is_preserved_with_score_and_evidence(runtime, monkeypatch):
    path, runner, ai = runtime
    seed_jobs(path, 1)
    entered, release = Event(), Event()

    def response(*args, **kwargs):
        entered.set()
        assert release.wait(5)
        return SCORE_RESPONSE

    ai.side_effect = response
    status, started = request("/api/scoring/start", {"scope": "selected", "job_ids": ["0"]})
    assert status == 200, started
    try:
        assert entered.wait(3)
        assert request("/api/jobs/status", {"job_ids": ["0"], "status": "sent"})[0] == 200
        assert request("/api/jobs/recruitment-type", {"job_ids": ["0"], "recruitment_type": "campus"})[0] == 200
    finally:
        release.set()
    runner.wait(5)
    db = database.get_db(path)
    try:
        job = dict(db.execute("SELECT * FROM jobs WHERE id='0'").fetchone())
        assert job["status"] == "sent" and job["recruitment_type"] == "campus"
        assert job["manual_labelled"] == 1 and job["score"] == 82 and job["score_reason"]
        assert db.execute("SELECT COUNT(*) FROM score_traces WHERE job_id='0'").fetchone()[0] == 1
    finally:
        db.close()


def test_full_releases_collection_before_review_and_waiting_chat_can_stop():
    review, entered_chat = Event(), Event()
    release = Event()

    def full(task, config):
        runner.release_collection(task)
        review.set()
        assert release.wait(5)
        with runner.operation(task, "deliver", {}) as acquired:
            if acquired:
                entered_chat.set()

    runner = WorkbenchTaskRunner({"full": full, "collect": lambda task, _: task.stop_requested.wait(5),
                                  "deliver": lambda task, _: task.stop_requested.wait(5)})
    try:
        chat = runner.start("deliver", {})
        started = runner.start("full", collection_config(["boss"]))
        assert review.wait(2)
        runner.start("collect", collection_config(["boss"]))
        release.set()
        runner.stop(started["id"])
        runner._threads[started["id"]].join(2)
        assert not entered_chat.is_set()
        assert runner._tasks[chat["id"]].status == "running"
    finally:
        release.set()
        for task in runner.status()["active_tasks"]:
            runner.stop(task["id"])
        runner.wait(2)


def test_sender_never_adopts_a_preexisting_matching_chat(monkeypatch):
    monkeypatch.setattr(sender, "_sleep_or_stop", lambda *_: False)
    monkeypatch.setattr(sender, "evaluate", lambda *_: "/job_detail/one.html")
    matches = Mock(return_value=True)
    monkeypatch.setattr(sender, "_chat_target_matches_job", matches)
    monkeypatch.setattr(sender, "get_page_targets", lambda: [
        {"targetId": "other-worker", "url": "https://www.zhipin.com/web/geek/chat"},
        {"targetId": "another-new-chat", "openerId": "another-worker", "url": "https://www.zhipin.com/web/geek/chat"},
        {"targetId": "spawned-by-send", "openerId": "own-job", "url": "https://www.zhipin.com/web/geek/chat"},
    ])
    result = sender._wait_for_chat_page("own-job", None, attempts=1, job={"id": "one"}, excluded_target_ids={"other-worker"})
    assert result["target_id"] == "spawned-by-send"
    matches.assert_called_once_with("spawned-by-send", {"id": "one"})


def test_boss_real_collector_and_chat_navigation_keep_separate_targets(monkeypatch):
    helpers = boss_helpers.BossCollectorCollectionTests()
    browser = helpers._make_browser(
        list_jobs=[{"title": "AI 工程师", "company": "示例科技", "salary": "20-30K", "url": "/job_detail/abc123.html"}],
        detail={"title": "AI 工程师", "company": "示例科技", "jd": "AI 开发"},
    )
    browser.new_tab = Mock(side_effect=["collect-search", "collect-detail"])
    browser.close_tab = Mock()
    hooks, collected = helpers._make_hooks()
    at_candidate, release = Event(), Event()

    def candidate(value):
        collected.append(value)
        at_candidate.set()
        assert release.wait(5)
        return True

    hooks.on_candidate = candidate
    collector = BossCollector(browser=browser, throttle_factory=lambda **_: helpers._make_throttle(), sleep=Mock())
    monkeypatch.setattr(sender, "_sleep_or_stop", lambda *_: False)
    monkeypatch.setattr(sender, "evaluate", lambda *_: "/job_detail/sending.html")
    monkeypatch.setattr(sender, "get_page_targets", lambda: [
        {"targetId": "collect-search", "url": "https://www.zhipin.com/web/geek/job"},
        {"targetId": "collect-detail", "url": "https://www.zhipin.com/job_detail/abc123.html"},
        {"targetId": "send-chat", "openerId": "send-job", "url": "https://www.zhipin.com/web/geek/chat"},
    ])
    monkeypatch.setattr(sender, "_chat_target_matches_job", lambda target, _: target == "send-chat")
    with ThreadPoolExecutor(1) as pool:
        result = pool.submit(collector.collect, PlatformCollectionRequest("boss", ["AI"], ["北京"], {"北京": "101010100"}, max_pages=1), hooks)
        try:
            assert at_candidate.wait(3)
            chat = sender._wait_for_chat_page("send-job", None, attempts=1, job={"id": "sending"}, excluded_target_ids={"collect-search", "collect-detail"})
            assert chat["target_id"] == "send-chat"
            assert not browser.close_tab.called
        finally:
            release.set()
        assert result.result(3).status == "completed"
    assert collected[0].source_job_id == "abc123"
    assert {call.args[0] for call in browser.close_tab.call_args_list} == {"collect-search"}
    assert browser.new_tab.call_count == 1  # Default collector reuses its own tab for details.


def test_zhilian_host_never_reuses_manual_application_tab():
    browser = ZhilianBrowser(get_page_targets=Mock(return_value=[{"targetId": "manual", "url": "https://jobs.zhaopin.com/one"}]),
                            new_tab=Mock(return_value="owned-collection"))
    collector = ZhilianCollector(browser=browser, sleep=Mock())
    assert collector._ensure_host_tab(PlatformCollectionRequest("zhilian", ["嵌入式"], ["天津"], {"天津": "531"})) == ("owned-collection", True)
    browser.get_page_targets.assert_not_called()
    assert browser.new_tab.call_args.kwargs["background"] is True


def test_parallel_collection_and_send_cannot_overbook_page_budget(tmp_path):
    path = tmp_path / "budget.db"
    database.get_db(path).close()
    barrier = Barrier(2)

    def reserve(stage):
        db = database.get_db(path)
        try:
            barrier.wait(3)
            guard = PlatformAccessGuard(db, {"safety": {"daily_platform_page_limit": 1}}, stage)
            try:
                guard.reserve("detail_page")
                return "reserved"
            except PlatformSafetyStop as exc:
                return exc.reason
        finally:
            db.close()

    with ThreadPoolExecutor(2) as pool:
        assert sorted(pool.map(reserve, ["collect", "send"])) == ["daily_platform_page_limit", "reserved"]


def test_disjoint_scoring_runs_are_allowed_but_overlap_is_rejected(runtime):
    path, runner, ai = runtime
    seed_jobs(path, 2)
    db = database.get_db(path)
    db.execute("UPDATE jobs SET source_platform='zhilian' WHERE id='1'")
    db.commit()
    db.close()
    entered, release = Event(), Event()

    def response(*_, **__):
        entered.set()
        assert release.wait(5)
        return SCORE_RESPONSE

    ai.side_effect = response
    try:
        status, first = request("/api/scoring/start", {"scope": "selected", "job_ids": ["0"]})
        assert status == 200 and first["task"]["platforms"] == ["boss"]
        assert entered.wait(2)
        status, second = request("/api/scoring/start", {"scope": "selected", "job_ids": ["1"]})
        assert status == 200 and second["task"]["platforms"] == ["zhilian"]
        assert request("/api/scoring/start", {"scope": "selected", "job_ids": ["0"]})[0] == 409
    finally:
        release.set()
    runner.wait(5)
    assert ai.call_count == 2


def test_concurrent_platform_start_preserves_each_platform_preferences(runtime, monkeypatch):
    _, runner, _ = runtime
    ready = Barrier(2)
    monkeypatch.setattr(server, "_preflight_messages", lambda *_: ready.wait(3) and [])
    runner._executors["collect"] = lambda task, _: task.stop_requested.wait(5)

    def start(platform):
        return request("/api/workbench/task", {"mode": "collect", "options": {
            "platform_order": [platform], "auto_score": False,
            "platforms": {platform: {"keywords": [f"{platform}-独立偏好"], "cities": ["北京"], "max_pages": 1}},
        }})

    with ThreadPoolExecutor(2) as pool:
        responses = list(pool.map(start, ["boss", "zhilian"]))
    assert all(status == 200 for status, _ in responses), responses
    config = server.load_config(server.CONFIG_PATH)
    assert config["platforms"]["boss"]["search"]["keywords"] == ["boss-独立偏好"]
    assert config["platforms"]["zhilian"]["search"]["keywords"] == ["zhilian-独立偏好"]
