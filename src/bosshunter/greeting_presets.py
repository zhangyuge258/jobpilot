"""Persistent text/image pairs, independent of job approval or sending."""
import sqlite3
from uuid import uuid4

MAX_GREETING_PRESETS = 5


def list_greeting_presets(conn: sqlite3.Connection) -> list[dict]:
    return [dict(row) for row in conn.execute("SELECT * FROM greeting_presets ORDER BY created_at, rowid")]


def save_greeting_preset(conn: sqlite3.Connection, body: dict) -> dict:
    if not isinstance(body, dict):
        raise ValueError("搭配内容必须是对象")
    name = body.get("name")
    text = body.get("custom_greeting")
    image_id = body.get("greeting_image_id") or ""
    preset_id = body.get("id") or ""
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= 40:
        raise ValueError("搭配名称需为 1 至 40 字")
    if not isinstance(text, str) or not 1 <= len(text.strip()) <= 300:
        raise ValueError("招呼语需为 1 至 300 字")
    if not isinstance(image_id, str) or not isinstance(preset_id, str):
        raise ValueError("搭配标识或图片标识无效")
    with conn:
        # Serialize the limit check and insertion across separate browser tabs.
        conn.execute("BEGIN IMMEDIATE")
        if preset_id:
            cursor = conn.execute(
                "UPDATE greeting_presets SET name=?, custom_greeting=?, greeting_image_id=?, "
                "updated_at=CURRENT_TIMESTAMP WHERE id=?",
                (name.strip(), text.strip(), image_id, preset_id),
            )
            if not cursor.rowcount:
                raise ValueError("搭配不存在，请刷新后重试")
        else:
            if conn.execute("SELECT COUNT(*) FROM greeting_presets").fetchone()[0] >= MAX_GREETING_PRESETS:
                raise ValueError("最多保存 5 组搭配，请更新已有搭配或删除后再新增")
            preset_id = uuid4().hex
            conn.execute("INSERT INTO greeting_presets(id,name,custom_greeting,greeting_image_id) VALUES(?,?,?,?)",
                         (preset_id, name.strip(), text.strip(), image_id))
        row = conn.execute("SELECT * FROM greeting_presets WHERE id=?", (preset_id,)).fetchone()
    return dict(row)


def delete_greeting_preset(conn: sqlite3.Connection, preset_id: str) -> bool:
    with conn:
        return bool(conn.execute("DELETE FROM greeting_presets WHERE id=?", (preset_id,)).rowcount)
