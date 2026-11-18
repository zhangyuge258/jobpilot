"""Independent recruitment monitoring, local job projection and daily inbox."""
from contextlib import closing
from datetime import datetime, timedelta, timezone
import json
import re
from threading import Event, Lock, Thread

from bosshunter.db import get_db
from bosshunter import subscription_directory
from bosshunter.subscription_sources import SOURCES, read_source

CHINA = timezone(timedelta(hours=8))
SENT = ("sent", "replied", "resume_sent", "needs_resume", "follow_up_sent")
LOCK = Lock()


def now_cn():
    return datetime.now(CHINA)


def init(db):
    db.executescript("""
        CREATE TABLE IF NOT EXISTS subscription_sources (
            id TEXT PRIMARY KEY, attempted TEXT, successful TEXT, state TEXT, message TEXT
        );
        CREATE TABLE IF NOT EXISTS subscription_items (
            source TEXT NOT NULL, key TEXT NOT NULL, data TEXT NOT NULL,
            first_seen TEXT NOT NULL, checked TEXT NOT NULL, score INTEGER,
            score_reason TEXT, sent INTEGER NOT NULL DEFAULT 0,
            hidden INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(source,key)
        );
        CREATE TABLE IF NOT EXISTS subscription_events (
            id INTEGER PRIMARY KEY, source TEXT NOT NULL, key TEXT NOT NULL,
            seen TEXT NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS subscription_reports (
            day TEXT PRIMARY KEY, cursor INTEGER NOT NULL, created TEXT NOT NULL,
            data TEXT NOT NULL, read INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS subscription_org_categories (
            name TEXT PRIMARY KEY, category TEXT NOT NULL
        );
    """)
    subscription_directory.init(db)


def status_of(item, now):
    if item.get("availability") in {"withdrawn", "closed"}:
        return item["availability"]
    closes = item.get("closes")
    opens = item.get("opens")
    # When the publisher only gives a date, keep that date eligible all day.
    if closes and (now.date().isoformat() > closes if len(closes) == 10 else now.isoformat() >= closes):
        return "closed"
    if opens and now.isoformat() < opens:
        return "upcoming"
    if closes or item.get("availability") == "open":
        return "open"
    return "unknown"


def save_source(db, source, records, checked, *, complete, message):
    baseline = not db.execute("SELECT 1 FROM subscription_items WHERE source=? LIMIT 1", (source,)).fetchone()
    with db:
        for item in records:
            key = item["key"]
            row = db.execute("SELECT data FROM subscription_items WHERE source=? AND key=?", (source, key)).fetchone()
            old = json.loads(row["data"]) if row else None
            jd_changed = old is not None and old.get("jd") != item.get("jd")
            encoded = json.dumps(item, ensure_ascii=False, sort_keys=True)
            db.execute("""
                INSERT INTO subscription_items(source,key,data,first_seen,checked) VALUES(?,?,?,?,?)
                ON CONFLICT(source,key) DO UPDATE SET data=excluded.data,checked=excluded.checked,
                    score=CASE WHEN ? THEN NULL ELSE score END,
                    score_reason=CASE WHEN ? THEN NULL ELSE score_reason END
            """, (source, key, encoded, checked, checked, jd_changed, jd_changed))
            compared = ("url",) if source == "phytium" else ()
            if not old or any(old.get(k) != v for k,v in item.items() if k not in compared):
                kind = "initial" if baseline else "changed" if old else "new"
                if old is not None and item.get("availability") == "withdrawn":
                    kind = "withdrawn"
                db.execute("INSERT INTO subscription_events(source,key,seen,kind,data) VALUES(?,?,?,?,?)",
                           (source, key, checked, kind, encoded))
        if complete and source in {"phytium", "dji", "xiaomi", "xiaopeng"}:
            missing = db.execute("SELECT key,data FROM subscription_items WHERE source=? AND checked<?", (source, checked)).fetchall()
            for row in missing:
                item = json.loads(row["data"])
                if item.get("availability") != "open":
                    continue
                item["availability"] = "unknown"
                encoded = json.dumps(item, ensure_ascii=False, sort_keys=True)
                db.execute("UPDATE subscription_items SET data=? WHERE source=? AND key=?", (encoded, source, row["key"]))
                db.execute("INSERT INTO subscription_events(source,key,seen,kind,data) VALUES(?,?,?,?,?)",
                           (source, row["key"], checked, "changed", encoded))
        db.execute("""
            UPDATE subscription_sources SET state=?, message=?,
                successful=CASE WHEN ? THEN ? ELSE successful END WHERE id=?
        """, ("ok" if complete else "partial", message, complete, checked, source))


def collect(path, *, force=False, morning=False, source_ids=None):
    if not LOCK.acquire(blocking=False):
        return False
    try:
        with closing(get_db(path)) as db:
            init(db)
            for source, settings in SOURCES.items():
                if source_ids is not None and source not in source_ids:
                    continue
                checked = now_cn()
                attempted = checked.isoformat()
                due = (checked - timedelta(minutes=settings["minutes"])).isoformat()
                if morning and settings["minutes"] == 60:
                    due = max(due, checked.replace(hour=8, minute=5, second=0, microsecond=0).isoformat())
                with db:
                    # Reserve the run in SQLite as well as this process, since
                    # two locally launched servers can briefly coexist.
                    db.execute("INSERT OR IGNORE INTO subscription_sources(id) VALUES(?)", (source,))
                    claimed = db.execute("""
                        UPDATE subscription_sources SET attempted=?,state='running'
                        WHERE id=? AND (attempted IS NULL OR (attempted<=? AND state='running')
                            OR (state!='running' AND (attempted<=? OR (? AND attempted<=?))))
                    """, (attempted, source, (checked-timedelta(minutes=12)).isoformat(),
                          due, force, (checked-timedelta(seconds=20)).isoformat())).rowcount
                if not claimed:
                    continue
                try:
                    records, complete, message = read_source(source)
                    save_source(db, source, records, checked.isoformat(), complete=complete, message=message)
                except Exception as exc:
                    with db:
                        db.execute("UPDATE subscription_sources SET state='error',message=? WHERE id=?",
                                   (str(exc)[:220] or type(exc).__name__, source))
            subscription_directory.refresh(db, now_cn())
        return True
    finally:
        LOCK.release()


def official_items(db, now):
    for row in db.execute("SELECT * FROM subscription_items WHERE hidden=0"):
        item = json.loads(row["data"])
        yield {**item, "source": row["source"], "first_seen": row["first_seen"], "checked": row["checked"],
               "score": row["score"], "score_reason": row["score_reason"] or "",
               "sent": bool(row["sent"]), "availability": status_of(item, now)}


def source_status(db):
    states = {row["id"]: dict(row) for row in db.execute("SELECT * FROM subscription_sources")}
    return [{"id": key, **value, **states.get(key, {"state": "pending"})} for key, value in SOURCES.items()]


def create_report(db, now):
    if (now.hour, now.minute) < (8, 30):
        return
    day = now.date().isoformat()
    db.execute("BEGIN IMMEDIATE")
    with db:
        if db.execute("SELECT 1 FROM subscription_reports WHERE day=?", (day,)).fetchone():
            return
        previous = db.execute("SELECT cursor FROM subscription_reports ORDER BY day DESC LIMIT 1").fetchone()
        cursor = previous["cursor"] if previous else 0
        events = list(db.execute("SELECT * FROM subscription_events WHERE id>? ORDER BY id", (cursor,)))
        sources = source_status(db)
        if not previous:
            if any(source["state"] in {"pending","running"} for source in sources):
                return
        end = events[-1]["id"] if events else cursor
        items = list(official_items(db, now))
        by_key = {(item["source"], item["key"]): item for item in items}
        deadline = (now.date() + timedelta(days=3)).isoformat()
        urgent = [item for item in items if item["availability"] == "open" and not item["sent"]
                  and item.get("closes") and item["closes"][:10] <= deadline and item.get("kind") == "job"]
        latest = {}
        for event in events:
            pair = (event["source"], event["key"])
            item = by_key.get(pair)
            if item and (event["kind"] in {"changed", "withdrawn"} or
                         (not item["sent"] and item["availability"] in {"open", "upcoming", "unknown"})):
                latest[pair] = {**item, "event_kind": event["kind"]}
        changes = sorted(latest.values(), key=lambda item: (item["score"] is None, -(item["score"] or 0)))
        report = {
            "first": previous is None,
            "open_count": sum(item["availability"] == "open" and item["kind"] == "job" for item in items),
            "urgent": sorted(urgent, key=lambda item: item["closes"]),
            "changes": changes,
            "sources": sources,
        }
        db.execute("INSERT INTO subscription_reports(day,cursor,created,data) VALUES(?,?,?,?)",
                   (day, end, now.isoformat(), json.dumps(report, ensure_ascii=False)))


def latest_report(db):
    row = db.execute("SELECT * FROM subscription_reports ORDER BY day DESC LIMIT 1").fetchone()
    return {**dict(row), "data": json.loads(row["data"])} if row else None


def listing(db, category, mode, query="", city=""):
    now = now_cn()
    cats = {row["name"]: row["category"] for row in db.execute("SELECT * FROM subscription_org_categories")}
    officials = list(official_items(db, now))
    known = {row["org_key"]: row["category"] for row in db.execute("SELECT org_key,category FROM subscription_organisation_directory")}
    known.update({subscription_directory.key(item["company"]): item["category"] for item in officials})
    result = []
    for item in officials:
        if item["kind"] != "job":
            continue
        result.append({**item, "category": cats.get(item["company"], item["category"])})
    for row in db.execute("""
        SELECT id,title,company,city,education,experience,jd,url,score,score_reason,status,recruitment_type,
               source_platform,created_at, EXISTS(SELECT 1 FROM score_traces t WHERE t.job_id=jobs.id) AS traced
        FROM jobs WHERE deleted_at IS NULL
    """):
        job = dict(row)
        reason = str(job["score_reason"] or "")
        score = job["score"] if job["traced"] or job["score"] or (reason and not reason.startswith(("AI评分失败", "评分失败", "AI 评分失败"))) else None
        result.append({**job, "source": "pool", "key": job["id"], "platform": job["source_platform"],
                       "category": cats.get(job["company"], known.get(subscription_directory.key(job["company"]), "other")),
                       "availability": "unknown", "score": score, "sent": job["status"] in SENT})
    # Merge only exact matches with evidence. Similar titles or different
    # locations stay distinct, and every original sending route is retained.
    exact = {}
    separate = []
    for job in result:
        identity = tuple(re.sub(r"\s+", "", str(job.get(field) or "")).casefold()
                         for field in ("company","title","city","jd"))
        if all(identity):
            exact.setdefault(identity, []).append(job)
        else:
            separate.append(job)
    for rows in exact.values():
        channels = [row.get("platform") or row["source"] for row in rows]
        if len(rows) == 1 or len(set(channels)) != len(channels):
            separate.extend(rows)
            continue
        best = max(rows, key=lambda item: (item["score"] is not None, item["score"] or 0))
        tracked = next((item for item in rows if item["source"] == "pool"), best)
        routes = [{key: item.get(key) for key in ("source","platform","url","availability")} for item in rows]
        separate.append({**tracked, "routes": routes, "sent": any(item["sent"] for item in rows),
                         "score": best["score"], "score_reason": best.get("score_reason"),
                         "availability": "open" if any(item["availability"] == "open" for item in rows) else tracked["availability"]})
    needle = query.casefold().strip()
    groups = {}
    for job in sorted(separate, key=lambda item: (item["score"] is None, -(item["score"] or 0), item["title"] or "")):
        if job["category"] != category or (mode == "sent" and not job["sent"]):
            continue
        if city and city not in (job.get("city") or ""):
            continue
        if needle and needle not in (str(job["company"]) + " " + str(job["title"])).casefold():
            continue
        groups.setdefault(job["company"], []).append(job)
    return [{"company": company, "jobs": jobs} for company, jobs in groups.items()]


def score_official(path, source, key, config):
    from bosshunter.ai.scorer import _load_resume, _score_job_with_ai

    with closing(get_db(path)) as db:
        row = db.execute("SELECT data,score,score_reason FROM subscription_items WHERE source=? AND key=?", (source,key)).fetchone()
        if not row:
            raise ValueError("岗位不存在")
        if row["score"] is not None:
            return {"score": row["score"], "score_reason": row["score_reason"]}
        item = json.loads(row["data"])
        if item["kind"] != "job" or not item.get("jd"):
            raise ValueError("需要完整岗位描述才能评分")
        resume = _load_resume(config)
        if not resume:
            raise ValueError("请先在 BossHunter 中上传简历")
        outcome = _score_job_with_ai(item, resume, config, 1)
        if not outcome.result:
            raise ValueError(outcome.pause_reason or "未取得有效评分")
        result = outcome.result
        with db:
            changed = db.execute("""
                UPDATE subscription_items SET score=?,score_reason=?
                WHERE source=? AND key=? AND data=?
            """, (result.score, result.reason, source, key, row["data"])).rowcount
        if not changed:
            raise ValueError("评分期间岗位已更新，请刷新后重试")
        return {"score": result.score, "score_reason": result.reason}


def start_worker(path):
    stop = Event()

    def run():
        counter = 0
        morning_done = None
        while not stop.is_set():
            try:
                now = now_cn()
                with closing(get_db(path)) as db:
                    init(db)
                    create_report(db, now)
                morning = now.hour == 8 and 10 <= now.minute < 26 and morning_done != now.date()
                if (counter % 3 == 0 or morning) and not LOCK.locked():
                    Thread(target=collect, args=(path,), kwargs={"morning": morning}, daemon=True, name="subscription-scan").start()
                    if morning:
                        morning_done = now.date()
                counter += 1
            except Exception:
                import logging
                logging.exception("招聘订阅定时检查失败")
            stop.wait(20)

    Thread(target=run, daemon=True, name="subscription-clock").start()
    return stop
