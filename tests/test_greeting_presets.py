import json
import sqlite3
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
from unittest import TestCase
from unittest.mock import patch

from bosshunter.db import get_db
from bosshunter.delivery_media import resolve_greeting_image, save_greeting_image
from bosshunter.greeting_presets import save_greeting_preset
from bosshunter.web import server
from tests import test_web_api_routes as routes
from tests.test_custom_delivery import png


class GreetingPresetTests(TestCase):
    _request = routes.WebApiRouteTests._request

    def setUp(self):
        self.original = server.BASE_DIR
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        server.set_base_dir(self.base)
        self.db = get_db(self.base / 'data/bosshunter.db')

    def tearDown(self):
        self.db.close()
        server.set_base_dir(self.original)
        self.temp.cleanup()

    def save(self, name='校招搭配', text='您好！\n这是我的原文。', image_id='', **fields):
        return self._request('/api/workbench/greeting-presets', 'POST',
                             {'name': name, 'custom_greeting': text, 'greeting_image_id': image_id, **fields})

    def test_text_and_image_pair_persists_without_job_mutation_or_sending(self):
        token = save_greeting_image(self.base/'data', png())
        with patch.object(server.task_runner, 'start') as start:
            status, _, body = self.save(image_id=token)
            self.assertTrue(status.startswith('200'), body)
            item = json.loads(body)['item']
            status, _, body = self._request('/api/workbench/greeting-presets')
            self.assertTrue(status.startswith('200'), body)
            saved = json.loads(body)
            self.assertEqual(saved['limit'], 5)
            self.assertEqual(saved['items'], [item])
            self.assertEqual((item['custom_greeting'],item['greeting_image_id']), ('您好！\n这是我的原文。',token))
            self.assertEqual(self.db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0], 0)
            self.assertEqual(self.db.execute('SELECT COUNT(*) FROM history').fetchone()[0], 0)
            start.assert_not_called()

    def test_five_limit_allows_update_and_delete_then_new_save(self):
        items = []
        for index in range(5):
            status, _, body = self.save(name=f'搭配{index}')
            self.assertTrue(status.startswith('200'), body)
            items.append(json.loads(body)['item'])
        status, _, body = self.save(name='第六条')
        self.assertTrue(status.startswith('400'), body)
        self.assertIn('最多保存 5 组', json.loads(body)['error'])
        status, _, body = self.save(name='修改后的搭配', text='更新后的文字', id=items[0]['id'])
        self.assertTrue(status.startswith('200'), body)
        self.assertEqual(json.loads(body)['item']['id'], items[0]['id'])
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM greeting_presets').fetchone()[0], 5)
        status, _, body = self._request('/api/workbench/greeting-presets/'+items[1]['id'], 'DELETE')
        self.assertTrue(status.startswith('200'), body)
        status, _, body = self.save(name='新的第五条')
        self.assertTrue(status.startswith('200'), body)

    def test_text_only_update_clears_pair_image_but_deleting_preset_keeps_shared_file(self):
        token = save_greeting_image(self.base/'data', png())
        _, _, body = self.save(image_id=token)
        preset_id = json.loads(body)['item']['id']
        status, _, body = self.save(text='只保留文字', id=preset_id)
        self.assertTrue(status.startswith('200'), body)
        self.assertEqual(json.loads(body)['item']['greeting_image_id'], '')
        self._request('/api/workbench/greeting-presets/'+preset_id, 'DELETE')
        self.assertTrue(resolve_greeting_image(self.base/'data', token).is_file())

    def test_invalid_text_or_image_does_not_create_preset(self):
        for extra in ({'name': ''}, {'custom_greeting': ''}, {'custom_greeting': 'x'*301},
                      {'greeting_image_id': '../config.yaml'}, {'greeting_image_id': 'a'*32+'.png'}):
            payload = {'name': '测试', 'custom_greeting': '我的文字', 'greeting_image_id': '', **extra}
            status, _, body = self._request('/api/workbench/greeting-presets', 'POST', payload)
            self.assertTrue(status.startswith('400'), body)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM greeting_presets').fetchone()[0], 0)

    def test_simultaneous_saves_cannot_exceed_five(self):
        for index in range(4):
            self.save(name=f'搭配{index}')
        barrier = Barrier(2)
        path = self.base/'data/bosshunter.db'
        def create(index):
            conn = sqlite3.connect(path, timeout=5)
            conn.row_factory = sqlite3.Row
            try:
                barrier.wait(timeout=5)
                try:
                    save_greeting_preset(conn, {'name': f'并发搭配{index}', 'custom_greeting': '原文'})
                    return True
                except ValueError:
                    return False
            finally:
                conn.close()
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(create, [0, 1]))
        self.assertEqual(sorted(results), [False, True])
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM greeting_presets').fetchone()[0], 5)
