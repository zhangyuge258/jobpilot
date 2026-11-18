"""Send a confirmed chat image using BOSS's native image control and permission gate."""
import json
from pathlib import Path
import time

from bosshunter.browser import evaluate, set_files

IMAGE_INPUT = 'input[type="file"][accept="image/gif,image/jpeg,image/jpg,image/png"]'

JS_OPEN_IMAGE_PICKER = """
(() => {
  const input = document.querySelector('input[type="file"][accept="image/gif,image/jpeg,image/jpg,image/png"]');
  const button = input?.closest('.btn-sendimg, [aria-label="发送图片"]');
  if (!document.querySelector('#chat-input') || !input || !button || input.disabled)
    return JSON.stringify({ok:false, error:'image_control_unavailable'});
  delete input.dataset.bosshunterImageAllowed;
  // Let the actual toolbar handler perform its platform permission check.
  // Only intercept the ensuing picker opening, then populate this same input.
  input.__bosshunterPickerCancel = event => {
    event.preventDefault(); event.stopPropagation();
    input.dataset.bosshunterImageAllowed = 'true';
  };
  input.addEventListener('click', input.__bosshunterPickerCancel, {once:true});
  button.click();
  return JSON.stringify({ok:true});
})()
"""

JS_IMAGE_PICKER_STATE = """
JSON.stringify({allowed:document.querySelector('input[data-bosshunter-image-allowed="true"]') !== null})
"""

JS_CLOSE_IMAGE_PICKER = """
(() => {
  const input=document.querySelector('input[type="file"][accept="image/gif,image/jpeg,image/jpg,image/png"]');
  if (input) {
    if(input.__bosshunterPickerCancel) input.removeEventListener('click',input.__bosshunterPickerCancel);
    delete input.__bosshunterPickerCancel; delete input.dataset.bosshunterImageAllowed;
  }
  return true;
})()
"""

JS_READ_OWN_IMAGES = """
JSON.stringify(Array.from(document.querySelectorAll('.chat-record .message-item.item-myself, .chat-record .message-item.item-self'))
  .filter(row=>row.querySelector('img.message-image')).map(row=>{
    const image=row.querySelector('img.message-image');
    const status=row.querySelector('.message-status');
    const css=String(status?.className||'');
    return {key:row.getAttribute('data-mid')||image.getAttribute('src')||'',
      state:css.includes('status-error')?'failed':css.includes('status-loading')?'pending':status?'delivered':'pending'};
  }))
"""


def _read(target_id, script):
    value = evaluate(target_id, script, timeout=5)
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return None
    return value


def send_chat_image(target_id: str, path: Path, config: dict, *, identity_check) -> dict:
    stop = config.get("_workbench_stop_event")
    window = config.get("_send_window_checker")

    def permitted():
        return not (stop and stop.is_set()) and not (window and not window.is_active())

    def pause(seconds):
        if stop:
            return stop.wait(seconds)
        time.sleep(seconds)
        return False

    if not permitted() or not identity_check():
        return {"success": False, "state": "failed", "error": "图片发送已停止、已超出发送时间或会话不匹配"}
    before = _read(target_id, JS_READ_OWN_IMAGES)
    if not isinstance(before, list):
        return {"success": False, "state": "failed", "error": "无法读取图片消息，未执行图片发送"}
    known = {row.get("key") for row in before if isinstance(row, dict)}
    opened = _read(target_id, JS_OPEN_IMAGE_PICKER)
    if not isinstance(opened, dict) or not opened.get("ok"):
        return {"success": False, "state": "failed", "error": "当前会话没有可用的发送图片控件"}
    try:
        for _ in range(20):
            state = _read(target_id, JS_IMAGE_PICKER_STATE)
            if isinstance(state, dict) and state.get("allowed"):
                break
            if not permitted() or pause(0.25):
                return {"success": False, "state": "failed", "error": "图片选择前任务已停止或发送时间已结束"}
        else:
            return {"success": False, "state": "failed", "error": "BOSS 当前未允许选择图片，请查看平台提示或等待 HR 回复"}
        if not permitted() or not identity_check():
            return {"success": False, "state": "failed", "error": "图片发送前任务已停止或会话发生变化"}
        if not set_files(target_id, IMAGE_INPUT, [str(path)]):
            return {"success": False, "state": "failed", "error": "图片未能交给 BOSS 图片上传控件"}
        stable_key = None
        for _ in range(int(config.get("_image_verification_attempts", 40))):
            records = _read(target_id, JS_READ_OWN_IMAGES)
            fresh = [row for row in records if isinstance(row, dict) and row.get("key") not in known] if isinstance(records, list) else []
            if any(row.get("state") == "failed" for row in fresh):
                return {"success": False, "state": "failed", "error": "BOSS 将新图片标记为发送失败"}
            delivered = next((row for row in fresh if row.get("key") and row.get("state") == "delivered"), None)
            if delivered and delivered["key"] == stable_key:
                return {"success": True, "state": "sent"}
            stable_key = delivered["key"] if delivered else None
            if pause(2.0 if stable_key else 0.5):
                break
        return {"success": False, "state": "unconfirmed", "error": "图片已提交但未确认送达，请到 BOSS 检查；不会自动重发文字或图片"}
    finally:
        evaluate(target_id, JS_CLOSE_IMAGE_PICKER, timeout=5)
