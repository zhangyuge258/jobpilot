from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

import pytest

from bosshunter.db import get_db, insert_job
from bosshunter.executor import sender
from bosshunter.web import server
from bosshunter.web.tasks import WorkbenchTask


@pytest.fixture
def chat_flow():
    # Every interaction is mocked: these tests never attach to a live browser.
    with ExitStack() as stack:
        for name, value in {
            'get_page_targets': [], 'new_tab': 'chat', 'evaluate': {'success': True},
            '_sleep_or_stop': False, '_click_chat_button': {'success': True, 'button_text': '继续沟通'},
            '_handle_greet_popup': {'success': True, 'action': 'no_popup'},
            '_wait_for_chat_page': {'success': True, 'target_id': 'chat'},
            '_chat_target_matches_job': True,
        }.items():
            stack.enter_context(patch.object(sender, name, return_value=value))
        mocks = {name: stack.enter_context(patch.object(sender, name)) for name in (
            '_prior_outbound_state', '_message_delivery_state', '_submit_chat_message_background',
            '_fill_chat_input', 'send_chat_image', 'close_tab',
        )}
        yield mocks


def send_once():
    return sender._send_greeting_once(
        {'id': 'job', 'company': '测试公司', 'title': '测试岗位', 'url': 'https://www.zhipin.com/job_detail/test.html',
         '_greeting_image_path': 'synthetic.png'},
        '与历史消息完全不同的新招呼语', {'browse_before_greet': False},
    )


def test_prior_success_skips_both_different_text_and_image(chat_flow):
    chat_flow['_prior_outbound_state'].return_value = 'delivered'
    result, tab = send_once()
    assert result['success'] and result['already_contacted'] and result['verified']
    assert tab is None
    for name in ('_message_delivery_state', '_submit_chat_message_background', '_fill_chat_input', 'send_chat_image'):
        chat_flow[name].assert_not_called()
    chat_flow['close_tab'].assert_called_once_with('chat')


@pytest.mark.parametrize('state', ['pending', 'failed', 'unknown', 'stopped', 'outside_window'])
def test_uncertain_conversations_never_submit_or_upload(chat_flow, state):
    chat_flow['_prior_outbound_state'].return_value = state
    result, tab = send_once()
    assert not result['success'] and result['skip_backoff']
    assert tab == 'chat'
    for name in ('_submit_chat_message_background', '_fill_chat_input', 'send_chat_image'):
        chat_flow[name].assert_not_called()


def test_verified_empty_conversation_can_send_and_verify_current_text_and_image(chat_flow):
    chat_flow['_prior_outbound_state'].return_value = 'empty'
    chat_flow['_message_delivery_state'].side_effect = ['missing', 'delivered', 'delivered']
    chat_flow['_submit_chat_message_background'].return_value = {'success': True}
    chat_flow['send_chat_image'].return_value = {'success': True, 'state': 'sent'}
    result, tab = send_once()
    assert result['success'] and not result.get('already_contacted') and tab is None
    chat_flow['_submit_chat_message_background'].assert_called_once()
    chat_flow['send_chat_image'].assert_called_once()


def test_newly_appearing_message_between_checks_also_skips_image(chat_flow):
    chat_flow['_prior_outbound_state'].return_value = 'empty'
    chat_flow['_message_delivery_state'].return_value = 'delivered'
    result, _ = send_once()
    assert result['already_contacted']
    chat_flow['_submit_chat_message_background'].assert_not_called()
    chat_flow['send_chat_image'].assert_not_called()


def test_history_must_be_stably_empty_and_identity_must_match():
    readings = [{'success': True, 'state': state} for state in ('empty', 'unknown', 'empty', 'empty')]
    with patch.object(sender, '_chat_target_matches_job', return_value=True), \
         patch.object(sender, 'evaluate', side_effect=readings) as read, \
         patch.object(sender, '_sleep_or_stop', return_value=False):
        assert sender._prior_outbound_state('chat', {}, {}) == 'empty'
        assert read.call_count == 4
    with patch.object(sender, '_chat_target_matches_job', return_value=False), patch.object(sender, 'evaluate') as read:
        assert sender._prior_outbound_state('wrong-chat', {}, {}) == 'unknown'
        read.assert_not_called()


def test_skipped_contact_persists_sent_without_claiming_new_send_or_using_quota(tmp_path):
    original = server.BASE_DIR
    server.set_base_dir(tmp_path)
    db = get_db(tmp_path / 'data/bosshunter.db')
    try:
        insert_job(db, {'id': 'job', 'company': '测试公司', 'title': '测试岗位', 'url': 'https://www.zhipin.com/job_detail/test.html'})
        db.execute("UPDATE jobs SET status='approved',greeting='新招呼语',filter_library=1,greeting_image_id=?,greeting_image_status='pending'", ('a'*32+'.png',))
        db.commit()
        task = WorkbenchTask(id='offline-dedup', mode='deliver', label='离线测试')
        config = {'_workbench_job_ids': ['job'], '_workbench_skip_greeting': True,
                  'throttle': {'send_windows': [], 'day_off_probability': 0, 'daily_limit': 5}}
        with patch.object(sender, 'resolve_greeting_image', return_value=Path('synthetic.png')), \
             patch.object(sender, '_send_greeting_once', return_value=({'success': True, 'already_contacted': True, 'verified': True}, None)), \
             patch.object(sender.RequestThrottle, 'mark') as mark, \
             patch.object(sender, 'send_greetings', wraps=sender.send_greetings) as send:
            server._execute_deliver_batch(task, config)
        mark.assert_not_called()
        report = send.call_args.args[0]['_workbench_send_report']
        assert (report['sent_count'], report['existing_contact_count'], report['deferred_count'], report['failed_count']) == (0, 1, 0, 0)
        assert (task.metrics['send_success'], task.metrics['send_existing_contact'], task.metrics['send_deferred']) == (0, 1, 0)
        row = db.execute("SELECT status,greeting_image_status,filter_library FROM jobs WHERE id='job'").fetchone()
        assert tuple(row) == ('sent', 'skipped', 1)
        assert db.execute("SELECT count(*) FROM history WHERE action='sent'").fetchone()[0] == 0
        assert db.execute("SELECT count(*) FROM history WHERE action='existing_contact'").fetchone()[0] == 1
        assert any('已沟通跳过 1' in line for line in task.logs)
    finally:
        db.close()
        server.set_base_dir(original)
