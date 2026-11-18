import io
import json
import tempfile
from pathlib import Path
from unittest import TestCase
from unittest.mock import Mock, patch

from PIL import Image
from bosshunter.db import get_db, insert_job
from bosshunter.delivery_media import resolve_greeting_image, save_greeting_image
from bosshunter.executor import greeting_image, sender
from bosshunter.web import server
from bosshunter.web.tasks import WorkbenchTask, WorkbenchTaskRunner
from tests import test_web_api_routes as routes


def png():
    stream = io.BytesIO()
    Image.new('RGB', (2, 3), 'white').save(stream, 'PNG')
    return stream.getvalue()


class CustomDeliveryApiTests(TestCase):
    _request = routes.WebApiRouteTests._request

    def setUp(self):
        self.original = server.BASE_DIR
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        server.set_base_dir(self.base)
        (self.base/'config.yaml').write_text('throttle:\n  send_windows: []\n', encoding='utf-8')
        self.db = get_db(self.base / 'data/bosshunter.db')
        for job_id in ('one', 'two', 'unselected'):
            insert_job(self.db, {'id': job_id, 'title': '工程师', 'company': '公司', 'url': 'https://www.zhipin.com/job_detail/example.html'})
        self.runner = patch.object(server, 'task_runner', WorkbenchTaskRunner())
        self.runner.start()

    def tearDown(self):
        self.runner.stop()
        self.db.close()
        server.set_base_dir(self.original)
        self.temp.cleanup()

    def test_custom_text_and_image_do_not_require_ai_or_modify_unselected_jobs(self):
        token = save_greeting_image(self.base / 'data', png())
        text = '您好！这是我自己的招呼语。\n可以长期实习。'
        with patch.object(server.task_runner, 'start', side_effect=lambda *args, **kwargs: (kwargs['before_start'](), {'id': 'synthetic'})[1]) as start, \
             patch('bosshunter.ai.greeter.greeting_config_error', side_effect=AssertionError('Custom greeting must not require AI')):
            status, _, body = self._request('/api/workbench/deliver', 'POST',
                {'job_ids': ['one', 'two'], 'custom_greeting': text, 'greeting_image_id': token})
        self.assertTrue(status.startswith('200'), body)
        config = start.call_args.args[1]
        self.assertTrue(config['_workbench_skip_greeting'])
        for row in self.db.execute("SELECT * FROM jobs WHERE id IN ('one','two')"):
            self.assertEqual((row['greeting'], row['greeting_selection'], row['status'], row['score']), (text, 'edited', 'approved', 0))
            self.assertEqual((row['greeting_image_id'], row['greeting_image_status']), (token, 'pending'))
        self.assertEqual(self.db.execute("SELECT status FROM jobs WHERE id='unselected'").fetchone()[0], 'pending')

    def test_invalid_text_image_and_completed_selection_do_not_enqueue_or_mutate(self):
        bad_requests = [
            {'custom_greeting': ''}, {'custom_greeting': 'x'*301},
            {'custom_greeting': 'hello', 'greeting_image_id': '../config.yaml'},
            {'custom_greeting': 'hello', 'greeting_image_id': 'a'*32+'.png'},
            {'greeting_image_id': 'a'*32+'.png'},
        ]
        with patch.object(server.task_runner, 'start') as start:
            for extra in bad_requests:
                status, _, body = self._request('/api/workbench/deliver', 'POST', {'job_ids': ['one'], **extra})
                self.assertTrue(status.startswith('400'), body)
            start.assert_not_called()
        self.assertEqual(self.db.execute("SELECT status FROM jobs WHERE id='one'").fetchone()[0], 'pending')

    def test_native_upload_route_validates_and_previews_local_images(self):
        boundary = 'SyntheticImageBoundary'
        content = png()
        body = (f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="resume.png"\r\nContent-Type: image/png\r\n\r\n'.encode()
                + content + f'\r\n--{boundary}--\r\n'.encode())
        status, _, response = self._request('/api/workbench/greeting-images', 'POST', environ_overrides={
            'CONTENT_TYPE': f'multipart/form-data; boundary={boundary}', 'CONTENT_LENGTH': str(len(body)), 'wsgi.input': io.BytesIO(body)})
        self.assertTrue(status.startswith('200'), response)
        token = json.loads(response)['image_id']
        self.assertEqual(resolve_greeting_image(self.base/'data', token).read_bytes(), content)
        status, headers, preview = self._request('/api/workbench/greeting-images/'+token, 'HEAD')
        self.assertTrue(status.startswith('200'))
        self.assertEqual(headers['Content-Type'], 'image/png')
        # The route harness decodes text responses; byte identity is checked on disk above.
        with self.assertRaises(ValueError):
            save_greeting_image(self.base/'data', b'<html>not a picture</html>')

    def test_later_batch_cannot_replace_an_already_queued_custom_greeting(self):
        active = WorkbenchTask(id='active', mode='deliver', label='测试')
        active.context.update(delivering=True, delivery_scheduled_ids={'one'}, pending_deliveries=[])
        server.task_runner._tasks['active'] = active
        self.db.execute("UPDATE jobs SET status='approved',greeting='第一批原文' WHERE id='one'")
        self.db.commit()
        with patch.object(server.task_runner, 'status', return_value={'active': active.snapshot()}):
            status, _, body = self._request('/api/workbench/deliver', 'POST',
                {'job_ids': ['one', 'two'], 'custom_greeting': '第二批原文'})
        self.assertTrue(status.startswith('200'), body)
        self.assertEqual(json.loads(body)['queued_count'], 1)
        self.assertEqual(self.db.execute("SELECT greeting FROM jobs WHERE id='one'").fetchone()[0], '第一批原文')
        self.assertEqual(self.db.execute("SELECT greeting FROM jobs WHERE id='two'").fetchone()[0], '第二批原文')
        self.assertEqual(active.context['pending_deliveries'][0], {'job_ids': ['two'], 'direct_send': True})

    def test_partial_image_result_is_persisted_without_misreporting_text_or_regenerating(self):
        token = save_greeting_image(self.base/'data', png())
        with patch.object(server.task_runner, 'start', side_effect=lambda *args, **kwargs: (kwargs['before_start'](), {'id': 'synthetic'})[1]):
            status, _, body = self._request('/api/workbench/deliver', 'POST',
                {'job_ids': ['one'], 'custom_greeting': '我的原文', 'greeting_image_id': token})
        self.assertTrue(status.startswith('200'), body)
        def send(job, text, config):
            self.assertEqual(text, '我的原文')
            self.assertEqual(Path(job['_greeting_image_path']).read_bytes(), png())
            return {'success': True, 'image_result': {'success': False, 'state': 'unconfirmed', 'error': '请检查图片'}}, None
        task = WorkbenchTask(id='synthetic', mode='deliver', label='测试')
        config = {'_workbench_job_ids': ['one'], '_workbench_skip_greeting': True,
                  'throttle': {'send_windows': [], 'day_off_probability': 0, 'daily_limit': 10}}
        with patch.object(sender, '_send_greeting_once', side_effect=send) as outbound, \
             patch('bosshunter.ai.greeter.generate_greetings') as generate:
            server._execute_deliver_batch(task, config)
        generate.assert_not_called()
        outbound.assert_called_once()
        row = self.db.execute("SELECT * FROM jobs WHERE id='one'").fetchone()
        self.assertEqual((row['status'],row['greeting_image_status'],row['greeting']), ('sent','unconfirmed','我的原文'))
        self.assertIn('文字已发送', row['last_error'])
        self.assertEqual(task.metrics['send_image_unconfirmed'], 1)


class GreetingImageTests(TestCase):
    def test_window_expiry_after_permission_does_not_assign_files(self):
        window = Mock()
        window.is_active.side_effect = [True, False]
        with patch.object(greeting_image, '_read', side_effect=[[], {'ok': True}, {'allowed': True}]), \
             patch.object(greeting_image, 'evaluate'), patch.object(greeting_image, 'set_files') as upload:
            result = greeting_image.send_chat_image('chat', Path('synthetic.png'), {'_send_window_checker': window}, identity_check=lambda: True)
        upload.assert_not_called()
        self.assertFalse(result['success'])

    def test_native_permission_is_required_before_assigning_files(self):
        def read(_target, script):
            if script == greeting_image.JS_READ_OWN_IMAGES: return []
            if script == greeting_image.JS_OPEN_IMAGE_PICKER: return {'ok': True}
            return {'allowed': False}
        with patch.object(greeting_image, '_read', side_effect=read), \
             patch.object(greeting_image, 'evaluate'), patch.object(greeting_image.time, 'sleep'), \
             patch.object(greeting_image, 'set_files') as upload:
            result = greeting_image.send_chat_image('chat', Path('synthetic.png'), {}, identity_check=lambda: True)
        self.assertFalse(result['success'])
        upload.assert_not_called()

    def test_only_new_own_image_receipts_confirm_success(self):
        old = [{'key': 'old', 'state': 'delivered'}]
        delivered = old + [{'key': 'new', 'state': 'delivered'}]
        with patch.object(greeting_image, '_read', side_effect=[old, {'ok': True}, {'allowed': True}, delivered, delivered]), \
             patch.object(greeting_image, 'evaluate'), patch.object(greeting_image.time, 'sleep'), \
             patch.object(greeting_image, 'set_files', return_value=True) as upload:
            result = greeting_image.send_chat_image('chat', Path('synthetic.png'), {}, identity_check=lambda: True)
        self.assertEqual(result, {'success': True, 'state': 'sent'})
        self.assertEqual(upload.call_args.args[1], greeting_image.IMAGE_INPUT)
        self.assertNotIn('resume', upload.call_args.args[1])

    def test_old_image_alone_never_counts_as_new_send(self):
        old = [{'key': 'old', 'state': 'delivered'}]
        with patch.object(greeting_image, '_read', side_effect=[old, {'ok': True}, {'allowed': True}, old, old]), \
             patch.object(greeting_image, 'evaluate'), patch.object(greeting_image.time, 'sleep'), \
             patch.object(greeting_image, 'set_files', return_value=True):
            result = greeting_image.send_chat_image('chat', Path('synthetic.png'), {'_image_verification_attempts': 2}, identity_check=lambda: True)
        self.assertEqual(result['state'], 'unconfirmed')

    def test_wrong_recipient_never_opens_picker(self):
        with patch.object(greeting_image, 'evaluate') as browser, patch.object(greeting_image, 'set_files') as upload:
            result = greeting_image.send_chat_image('chat', Path('synthetic.png'), {}, identity_check=lambda: False)
        browser.assert_not_called()
        upload.assert_not_called()
        self.assertFalse(result['success'])

    def test_image_failure_does_not_turn_verified_text_into_a_failed_text_retry(self):
        with patch.object(sender, 'send_chat_image', return_value={'success': False, 'state': 'unconfirmed', 'error': 'check'}) as image, \
             patch.object(sender, 'evaluate', return_value=True), \
             patch.object(sender, 'close_tab') as close:
            result, target = sender._finish_verified_greeting('chat', {'_greeting_image_path': 'synthetic.png'}, {}, {'success': True, 'verified': True})
        self.assertTrue(result['success'])
        self.assertEqual(result['image_result']['state'], 'unconfirmed')
        self.assertIsNone(target)
        image.assert_called_once()
        close.assert_called_once_with('chat')

    def test_first_contact_enters_continue_chat_for_image_without_resending_text(self):
        job = {'_greeting_image_path': 'synthetic.png', 'company': '公司', 'title': '岗位'}
        with patch.object(sender, 'evaluate', side_effect=[False, {'ok': True}]), \
             patch.object(sender, 'click_at', return_value=True) as click, \
             patch.object(sender, '_wait_for_chat_page', return_value={'success': True, 'target_id': 'chat'}), \
             patch.object(sender, '_adopt_chat_target', return_value='chat'), \
             patch.object(sender, 'send_chat_image', return_value={'success': True, 'state': 'sent'}) as image, \
             patch.object(sender, '_submit_chat_message_background') as text, patch.object(sender, 'close_tab') as close:
            result, _ = sender._finish_verified_greeting('job-page', job, {}, {'success': True, 'verified': True})
        click.assert_called_once_with('job-page', '[data-bosshunter-image-chat="continue"]')
        self.assertEqual(image.call_args.args[0], 'chat')
        text.assert_not_called()
        self.assertTrue(result['image_result']['success'])
        close.assert_called_once_with('chat')
