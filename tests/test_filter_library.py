import csv
import io
import json
import sqlite3
import tempfile
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

from bosshunter.collection.models import JobCandidate, PlatformCollectionRequest
from bosshunter.collection.orchestrator import _SharedProcessor
from bosshunter.db import get_db, insert_job, _migrate_filter_library
from bosshunter.job_export import export_jobs
from bosshunter.web import server
from bosshunter.web.tasks import WorkbenchTask, WorkbenchTaskRunner
from tests import test_web_api_routes as route_harness


class FilterLibraryTests(TestCase):
    _request = route_harness.WebApiRouteTests._request

    def setUp(self):
        self.original_base = server.BASE_DIR
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        server.set_base_dir(self.base)
        (self.base/'config.yaml').write_text('throttle:\n  send_windows: []\n', encoding='utf-8')
        self.db = get_db(self.base / "data/bosshunter.db")
        self.runner = patch.object(server, "task_runner", WorkbenchTaskRunner())
        self.runner.start()

    def tearDown(self):
        self.runner.stop()
        self.db.close()
        server.set_base_dir(self.original_base)
        self.temp.cleanup()

    def insert(self, job_id, **fields):
        insert_job(self.db, {"id": job_id, "title": "嵌入式工程师", "company": "测试公司", "city": "天津",
                             "jd": "原始岗位描述", "source_platform": "boss", "source_job_id": job_id,
                             "url": f"https://www.zhipin.com/job_detail/{job_id}.html", **fields})

    def search(self, library="all"):
        status, _, body = self._request(f"/api/jobs/search?library={library}")
        self.assertTrue(status.startswith("200"), body)
        return json.loads(body)

    def test_filtered_record_is_isolated_and_shared_with_sent_library_after_manual_tag(self):
        self.insert("normal")
        self.insert("filtered", status="filtered", filter_library=1, filter_reason="关键词不匹配")
        self.assertEqual([row["id"] for row in self.search()["items"]], ["normal"])
        filtered = self.search("filtered")
        self.assertEqual(filtered["all_total"], 1)
        self.assertEqual(filtered["items"][0]["filter_reason"], "关键词不匹配")
        self.assertEqual(filtered["items"][0]["jd"], "原始岗位描述")
        status, _, body = self._request("/api/jobs/status", "POST", {"job_ids": ["filtered"], "status": "sent"})
        self.assertTrue(status.startswith("200"), body)
        self.assertEqual([row["id"] for row in self.search()["items"]], ["normal"])
        self.assertEqual(self.search("sent")["items"][0]["status"], "sent")
        self.assertEqual(self.search("filtered")["items"][0]["status"], "sent")
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM jobs WHERE id='filtered'").fetchone()[0], 1)

    def test_blocked_company_records_remain_visible_in_filter_library(self):
        (self.base / "config.yaml").write_text("profile:\n  blocked_companies: [屏蔽公司]\n", encoding="utf-8")
        self.insert("blocked", company="屏蔽公司", status="filtered", filter_library=1, filter_reason="公司被屏蔽")
        self.assertEqual(self.search("filtered")["total"], 1)
        self.assertEqual(self.search()["total"], 0)

    def test_collection_filters_save_fields_without_entering_auto_scoring_ids_or_overwriting_tags(self):
        processor = _SharedProcessor(self.db, PlatformCollectionRequest("boss", ["嵌入式"], ["天津"], {}),
                                     run_id="test", platform_index=1, platform_total=1,
                                     stop_event=None, config={}, emit=lambda _: None)
        candidate = JobCandidate("boss", "excluded", "硬件工程师", "公司", city="天津", jd="原始描述", url="https://www.zhipin.com/job_detail/excluded.html")
        processor.event(increment_filtered=True, filtered_candidate=candidate, message="薪资低于要求")
        row = dict(self.db.execute("SELECT * FROM jobs WHERE id='excluded'").fetchone())
        self.assertEqual((row["status"], row["filter_library"], row["filter_reason"], row["jd"]), ("filtered", 1, "薪资低于要求", "原始描述"))
        self.assertEqual(processor.new_job_ids, [])
        self._request("/api/jobs/status", "POST", {"job_ids": ["excluded"], "status": "sent"})
        processor.event(increment_filtered=True, filtered_candidate=candidate, message="另一轮采集过滤")
        self.assertEqual(self.db.execute("SELECT status FROM jobs WHERE id='excluded'").fetchone()[0], "sent")

    def test_batch_delivery_approves_only_selected_unscored_jobs_without_marking_sent_early(self):
        self.insert("pending")
        self.insert("filtered", status="filtered", filter_library=1, filter_reason="薪资不符")
        self.insert("unselected")
        with patch.object(server.task_runner, "start", return_value={"id": "synthetic-task"}) as start, \
             patch("bosshunter.ai.greeter.greeting_config_error", return_value=None), \
             patch("bosshunter.ai.scorer.score_jobs") as score:
            status, _, body = self._request("/api/workbench/deliver", "POST", {"job_ids": ["pending", "filtered"]})
        self.assertTrue(status.startswith("200"), body)
        self.assertEqual(start.call_args.args[1]["_workbench_job_ids"], ["pending", "filtered"])
        score.assert_not_called()
        rows = {row["id"]: row["status"] for row in self.db.execute("SELECT id,status FROM jobs")}
        self.assertEqual(rows, {"pending": "approved", "filtered": "approved", "unselected": "pending"})
        self.assertEqual(self.search("sent")["total"], 0)
        self.assertEqual(self.search("filtered")["items"][0]["id"], "filtered")

    def test_completed_job_rejects_entire_delivery_batch_without_changing_other_rows(self):
        self.insert("pending")
        self.insert("sent", status="sent")
        with patch.object(server.task_runner, "start") as start, \
             patch("bosshunter.ai.greeter.greeting_config_error", return_value=None):
            status, _, body = self._request("/api/workbench/deliver", "POST", {"job_ids": ["pending", "sent"]})
        self.assertTrue(status.startswith("409"), body)
        self.assertEqual(json.loads(body)["already_sent_ids"], ["sent"])
        start.assert_not_called()
        self.assertEqual(self.db.execute("SELECT status FROM jobs WHERE id='pending'").fetchone()[0], "pending")

    def test_success_is_marked_sent_while_failure_and_unselected_jobs_are_not(self):
        self.insert("success", status="filtered", filter_library=1, filter_reason="薪资低于要求")
        self.insert("failure")
        self.insert("unselected", status="approved")
        with patch.object(server.task_runner, "start", return_value={"id": "synthetic"}), \
             patch("bosshunter.ai.greeter.greeting_config_error", return_value=None):
            status, _, body = self._request("/api/workbench/deliver", "POST", {"job_ids": ["success", "failure"]})
        self.assertTrue(status.startswith("200"), body)
        task = WorkbenchTask(id="synthetic", mode="deliver", label="测试投递")
        config = {"profile": {"ai_greeting_enabled": False, "fixed_greeting": "合成测试招呼语"},
                  "throttle": {"send_windows": [], "day_off_probability": 0, "daily_limit": 10},
                  "_workbench_job_ids": ["success", "failure"]}
        with patch("bosshunter.executor.sender._send_greeting_once", side_effect=[
            ({"success": True}, None), ({"success": False, "error": "synthetic_failure"}, None),
        ]) as outbound, patch("bosshunter.executor.sender.RequestThrottle.wait", return_value=False), \
             patch("bosshunter.executor.sender.ProgressiveBackoff.record_error", return_value=0), \
             patch("bosshunter.ai.greeter._call_claude") as ai, \
             patch("bosshunter.ai.scorer.score_jobs") as score:
            server._execute_deliver_batch(task, config)
        ai.assert_not_called()
        score.assert_not_called()
        self.assertEqual([call.args[0]["id"] for call in outbound.call_args_list], ["success", "failure"])
        rows = {row["id"]: (row["status"], row["score"]) for row in self.db.execute("SELECT id,status,score FROM jobs")}
        self.assertEqual(rows, {"success": ("sent", 0), "failure": ("error", 0), "unselected": ("approved", 0)})
        self.assertEqual([row["id"] for row in self.search("sent")["items"]], ["success"])
        self.assertNotIn("success", [row["id"] for row in self.search()["items"]])
        self.assertEqual(task.metrics["send_success"], 1)
        self.assertEqual(task.metrics["send_failed"], 1)

    def test_exports_follow_library_membership(self):
        self.insert("normal")
        self.insert("excluded", status="filtered", filter_library=1, filter_reason="薪资低于要求")
        def ids(scope, filters=None):
            content, _, _ = export_jobs(self.db, format="csv", scope=scope, filters=filters)
            return {row["岗位 ID"] for row in csv.DictReader(io.StringIO(content.decode("utf-8-sig")))}
        self.assertEqual(ids("all"), {"normal"})
        self.assertEqual(ids("filtered", {"library": "filtered"}), {"excluded"})

    def test_existing_filtered_rows_are_migrated_once_and_keep_membership_after_sent(self):
        legacy = sqlite3.connect(":memory:")
        try:
            legacy.executescript("CREATE TABLE jobs(id TEXT, status TEXT); INSERT INTO jobs VALUES('old','filtered');")
            _migrate_filter_library(legacy)
            legacy.execute("UPDATE jobs SET status='sent'")
            _migrate_filter_library(legacy)
            self.assertEqual(legacy.execute("SELECT filter_library,filter_reason,status FROM jobs").fetchone(), (1, "", "sent"))
        finally:
            legacy.close()
