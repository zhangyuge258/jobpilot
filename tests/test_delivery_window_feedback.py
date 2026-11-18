import json
import tempfile
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

from bosshunter.db import get_db, insert_job
from bosshunter.throttle import SendWindowChecker
from bosshunter.web import server
from bosshunter.web.tasks import WorkbenchTask, WorkbenchTaskRunner
from tests import test_web_api_routes as routes


class DeliveryWindowTests(TestCase):
    _request = routes.WebApiRouteTests._request

    def setUp(self):
        self.original = server.BASE_DIR
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        server.set_base_dir(self.base)
        (self.base/'config.yaml').write_text('throttle:\n  send_windows: ["09:00-21:00"]\n', encoding='utf-8')
        self.db = get_db(self.base/'data/bosshunter.db')
        insert_job(self.db, {'id': 'selected', 'title': '工程师', 'company': '测试公司'})
        self.runner = patch.object(server, 'task_runner', WorkbenchTaskRunner())
        self.runner.start()

    def tearDown(self):
        self.runner.stop()
        self.db.close()
        server.set_base_dir(self.original)
        self.temp.cleanup()

    def test_0836_click_is_rejected_before_approval_or_task_start(self):
        with patch.object(SendWindowChecker, '_current_minutes', return_value=8*60+36), \
             patch.object(server.task_runner, 'start') as start:
            status, _, body = self._request('/api/workbench/deliver', 'POST',
                {'job_ids': ['selected'], 'custom_greeting': '我的招呼语'})
        self.assertTrue(status.startswith('409'), body)
        payload = json.loads(body)
        self.assertEqual(payload['code'], 'outside_send_window')
        self.assertIn('09:00-21:00', payload['error'])
        self.assertIn('本次未发送消息', payload['error'])
        start.assert_not_called()
        row = self.db.execute("SELECT status,greeting FROM jobs WHERE id='selected'").fetchone()
        self.assertEqual((row['status'], row['greeting']), ('pending', None))
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM history').fetchone()[0], 0)

    def test_0900_click_can_enqueue_without_claiming_delivery(self):
        with patch.object(SendWindowChecker, '_current_minutes', return_value=9*60), \
             patch.object(server.task_runner, 'start', return_value={'id': 'synthetic', 'status': 'running'}) as start:
            status, _, body = self._request('/api/workbench/deliver', 'POST',
                {'job_ids': ['selected'], 'custom_greeting': '我的招呼语'})
        self.assertTrue(status.startswith('200'), body)
        start.assert_called_once()
        self.assertEqual(self.db.execute("SELECT status FROM jobs WHERE id='selected'").fetchone()[0], 'approved')
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM history WHERE action='sent'").fetchone()[0], 0)

    def test_worker_window_block_records_deferred_reason_without_contacting_boss(self):
        self.db.execute("UPDATE jobs SET status='approved',greeting='我的招呼语' WHERE id='selected'")
        self.db.commit()
        task = WorkbenchTask(id='synthetic', mode='deliver', label='测试')
        config = {'_workbench_job_ids': ['selected'], '_workbench_skip_greeting': True,
                  'throttle': {'send_windows': ['09:00-21:00'], 'day_off_probability': 0}}
        with patch.object(SendWindowChecker, '_current_minutes', return_value=8*60+38), \
             patch('bosshunter.executor.sender._send_greeting_once') as outbound:
            server._execute_deliver_batch(task, config)
        outbound.assert_not_called()
        self.assertEqual(task.stop_reason, 'outside_window')
        self.assertEqual((task.metrics['send_success'], task.metrics['send_deferred']), (0, 1))
        self.assertTrue(any('未发送原因' in log and '发送时间窗口' in log for log in task.logs))
