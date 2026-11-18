import json
import tempfile
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

import pytest

from bosshunter.ai import greeting_optimizer
from bosshunter.ai.credentials import AIRequestError
from bosshunter.db import get_db, insert_job
from bosshunter.executor import sender
from bosshunter.web import server
from bosshunter.web.tasks import WorkbenchTaskRunner, WorkbenchTask
from tests import test_web_api_routes as routes

ORIGINAL = '您好，我是2027届本科生，熟悉 C 语言和 STM32 开发，可以长期实习。'
RESUME = '曾在电子公司实习，完成 STM32 外设驱动与软硬件联调。'
JD = '负责 STM32 外设驱动开发，要求熟悉 C 语言和硬件调试。'
RESULT = {
    'greeting': '您好，我是2027届本科生，熟悉 C 语言，曾完成 STM32 外设驱动与软硬件联调，希望应聘贵司嵌入式岗位，可以长期实习。',
    'highlights': [{'jd_quote': 'STM32 外设驱动开发', 'evidence_quote': '完成 STM32 外设驱动与软硬件联调', 'reason': '驱动开发与联调经历对应岗位核心职责'}],
}


def test_optimizer_uses_original_resume_and_current_jd_with_real_evidence():
    with patch.object(greeting_optimizer, '_get_resume_text', return_value=RESUME), \
         patch.object(greeting_optimizer, '_call_claude', return_value=json.dumps(RESULT, ensure_ascii=False)) as call:
        result = greeting_optimizer.optimize_greeting({'title': '嵌入式工程师', 'company': '测试公司', 'jd': JD}, ORIGINAL, {})
    prompt = call.call_args.args[0]
    assert ORIGINAL in prompt and RESUME in prompt and JD in prompt and '测试公司' in prompt
    assert '不得把 JD 要求当成用户经历' in prompt
    assert result == RESULT


@pytest.mark.parametrize('payload', [
    {'greeting': 'a'*301, 'highlights': RESULT['highlights']},
    {'greeting': '正常正文', 'highlights': []},
    {'greeting': '正常正文', 'highlights': [{**RESULT['highlights'][0], 'evidence_quote': '十年带队开发经验'}]},
    {'greeting': '正常正文', 'highlights': [{**RESULT['highlights'][0], 'jd_quote': '负责云原生架构'}]},
    {'greeting': '请访问 https://invented.example.com', 'highlights': RESULT['highlights']},
])
def test_invalid_or_ungrounded_preview_is_not_returned(payload):
    with patch.object(greeting_optimizer, '_get_resume_text', return_value=RESUME), \
         patch.object(greeting_optimizer, '_call_claude', return_value=json.dumps(payload)):
        with pytest.raises(ValueError):
            greeting_optimizer.optimize_greeting({'jd': JD}, ORIGINAL, {})


class GreetingOptimizerApiTests(TestCase):
    _request = routes.WebApiRouteTests._request

    def setUp(self):
        self.original_base = server.BASE_DIR
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        server.set_base_dir(self.base)
        (self.base/'config.yaml').write_text('throttle:\n  send_windows: []\n  day_off_probability: 0\n  interval_min: 0\n  interval_max: 0\n', encoding='utf-8')
        self.db = get_db(self.base/'data/bosshunter.db')
        for job_id in ('one', 'two', 'other'):
            insert_job(self.db, {'id': job_id, 'title': '嵌入式工程师', 'company': f'{job_id}公司', 'jd': JD, 'url': 'https://www.zhipin.com/job_detail/test.html'})
        self.runner = patch.object(server, 'task_runner', WorkbenchTaskRunner())
        self.runner.start()

    def tearDown(self):
        self.runner.stop()
        self.db.close()
        server.set_base_dir(self.original_base)
        self.temp.cleanup()

    def test_preview_does_not_save_approve_score_label_or_start_sending(self):
        self.db.execute("UPDATE jobs SET manual_labelled=1,status='skipped',score=75 WHERE id='one'")
        self.db.commit()
        with patch.object(greeting_optimizer, 'optimize_greeting', return_value=RESULT), \
             patch.object(server.task_runner, 'start') as start, patch.object(sender, '_send_greeting_once') as send:
            status, _, body = self._request('/api/jobs/one/greeting-optimize', 'POST', {'original': ORIGINAL})
        self.assertTrue(status.startswith('200'), body)
        self.assertEqual(json.loads(body), {'job_id': 'one', 'title': '嵌入式工程师', 'company': 'one公司', **RESULT})
        start.assert_not_called()
        send.assert_not_called()
        self.assertEqual(tuple(self.db.execute("SELECT status,score,manual_labelled,greeting FROM jobs WHERE id='one'").fetchone()), ('skipped',75,1,None))
        self.assertEqual(self.db.execute('SELECT count(*) FROM history').fetchone()[0], 0)

    def test_invalid_original_missing_job_and_rate_limit_have_clear_errors(self):
        with patch.object(greeting_optimizer, 'optimize_greeting') as optimize:
            status, _, _ = self._request('/api/jobs/one/greeting-optimize', 'POST', {'original': ''})
            self.assertTrue(status.startswith('400'))
            status, _, _ = self._request('/api/jobs/missing/greeting-optimize', 'POST', {'original': ORIGINAL})
            self.assertTrue(status.startswith('404'))
            optimize.assert_not_called()
        with patch.object(greeting_optimizer, 'optimize_greeting', side_effect=AIRequestError('rate_limit','AI 频率限制',429)):
            status, _, body = self._request('/api/jobs/one/greeting-optimize', 'POST', {'original': ORIGINAL})
        self.assertTrue(status.startswith('429'), body)
        self.assertEqual(json.loads(body)['code'], 'rate_limit')
        self.assertEqual(json.loads(body)['company'], 'one公司')

    def test_incomplete_per_job_confirmation_does_not_mutate_any_job(self):
        for texts in ({'one':'a'}, {'one':'a','two':'b','other':'c'}, {'one':'a','two':'x'*301}):
            status, _, body = self._request('/api/workbench/deliver', 'POST', {'job_ids':['one','two'], 'custom_greeting': ORIGINAL, 'custom_greetings':texts})
            self.assertTrue(status.startswith('400'), body)
        self.assertEqual(self.db.execute("SELECT count(*) FROM jobs WHERE status='pending' AND greeting IS NULL").fetchone()[0], 3)

    def test_confirmed_texts_are_atomic_and_sender_never_regenerates_them(self):
        texts = {'one': '我确认的软件方向正文', 'two': '我确认的硬件方向正文'}
        with patch.object(server.task_runner, 'start', side_effect=lambda *args, **kwargs: (kwargs['before_start'](), {'id':'synthetic'})[1]) as start:
            status, _, body = self._request('/api/workbench/deliver', 'POST', {'job_ids':['one','two'], 'custom_greeting': ORIGINAL, 'custom_greetings':texts})
        self.assertTrue(status.startswith('200'), body)
        config = start.call_args.args[1]
        self.assertTrue(config['_workbench_skip_greeting'])
        for job_id, text in texts.items():
            row=self.db.execute('SELECT greeting,greeting_original,greeting_optimized,status,score FROM jobs WHERE id=?',(job_id,)).fetchone()
            self.assertEqual(tuple(row),(text,ORIGINAL,text,'approved',0))
        self.assertIsNone(self.db.execute("SELECT greeting FROM jobs WHERE id='other'").fetchone()[0])
        actual = {}
        def fake_send(job, greeting, _config):
            actual[job['id']] = greeting
            return {'success':True},None
        task=WorkbenchTask(id='offline',mode='deliver',label='离线测试')
        with patch.object(sender, '_send_greeting_once', side_effect=fake_send), patch('bosshunter.ai.greeter.generate_greetings') as generate:
            server._execute_deliver_batch(task, config)
        generate.assert_not_called()
        self.assertEqual(actual,texts)

    def test_queued_overlap_cannot_replace_the_in_flight_greeting(self):
        active=WorkbenchTask(id='active',mode='deliver',label='离线队列')
        active.context.update(delivering=True, delivery_scheduled_ids={'one'}, pending_deliveries=[])
        server.task_runner._tasks['active']=active
        self.db.execute("UPDATE jobs SET status='approved',greeting='正在发送的第一批' WHERE id='one'")
        self.db.commit()
        with patch.object(server.task_runner,'status',return_value={'active':active.snapshot()}):
            status,_,body=self._request('/api/workbench/deliver','POST',{'job_ids':['one','two'],'custom_greeting':ORIGINAL,'custom_greetings':{'one':'不应覆盖','two':'本次确认内容'}})
        self.assertTrue(status.startswith('200'),body)
        self.assertEqual(self.db.execute("SELECT greeting FROM jobs WHERE id='one'").fetchone()[0],'正在发送的第一批')
        self.assertEqual(self.db.execute("SELECT greeting FROM jobs WHERE id='two'").fetchone()[0],'本次确认内容')
