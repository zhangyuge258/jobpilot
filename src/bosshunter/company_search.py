"""Import a company list and search each company on all supported platforms."""

from __future__ import annotations

from contextlib import closing
from dataclasses import replace
from io import BytesIO
import json
from pathlib import Path
import re
from threading import Lock
import unicodedata
from urllib.parse import urlsplit
from xml.etree import ElementTree

import httpx

from bosshunter.ai.credentials import ai_http_options
from bosshunter.collection.base import CollectionError, CollectorHooks
from bosshunter.collection.models import PlatformCollectionRequest
from bosshunter.collection.platforms.boss import BossCollector
from bosshunter.collection.platforms.job51 import Job51Collector
from bosshunter.collection.platforms.zhilian import ZhilianCollector
from bosshunter.collection.orchestrator import validate_collection_options
from bosshunter.db import get_db, MANUAL_STATUS_TARGETS


PLATFORMS = ("boss", "zhilian", "51job")
COLLECTORS = dict(zip(PLATFORMS, (BossCollector, ZhilianCollector, Job51Collector)))
DOMAINS = dict(zip(PLATFORMS, ("zhipin.com", "zhaopin.com", "51job.com")))
MAX_IMPORT_BYTES = 8 * 1024 * 1024
_ocr_lock = Lock()
_ocr = None


def company_key(value: str) -> str:
    return re.sub(r"[^\w]+|_", "", unicodedata.normalize("NFKC", value).casefold())


def import_rows(name: str, content: bytes) -> dict:
    if not content or len(content) > MAX_IMPORT_BYTES:
        raise ValueError("请选择 8 MB 以内的 Excel 或图片")
    suffix = Path(name).suffix.lower()
    if suffix == ".xlsx":
        from openpyxl import load_workbook

        book = load_workbook(BytesIO(content), read_only=True, data_only=True, keep_links=False)
        try:
            rows = list(book.worksheets[0].iter_rows(max_row=1001, max_col=min(book.worksheets[0].max_column or 30, 30), values_only=True))
            return {"rows": rows, "source": book.worksheets[0].title}
        finally:
            book.close()
    if suffix == ".xls":
        import xlrd

        sheet = xlrd.open_workbook(file_contents=content).sheet_by_index(0)
        return {"rows": [sheet.row_values(i, end_colx=min(sheet.ncols, 30)) for i in range(min(sheet.nrows, 1001))],
                "source": sheet.name}
    if suffix not in {".png", ".jpg", ".jpeg", ".webp", ".bmp"}:
        raise ValueError("支持 XLSX、XLS、PNG、JPEG、WEBP 和 BMP")

    from PIL import Image, ImageOps
    import numpy as np
    from rapidocr_onnxruntime import RapidOCR

    global _ocr
    with Image.open(BytesIO(content)) as image:
        if image.width * image.height > 24_000_000:
            raise ValueError("图片像素过大，请裁剪到企业名单区域后重试")
        pixels = np.array(ImageOps.exif_transpose(image).convert("RGB"))[:, :, ::-1].copy()
    with _ocr_lock:
        if _ocr is None:
            _ocr = RapidOCR(intra_op_num_threads=2, inter_op_num_threads=1)
        result, _ = _ocr(pixels)
    if not result:
        raise ValueError("图片中未识别到文字，请上传清晰截图")
    # Group boxes by their vertical centres, then align columns using the
    # detected header (or the widest row when the screenshot has no header).
    boxes = []
    for points, value, _ in result:
        xs, ys = zip(*points)
        boxes.append((min(xs), sum(ys) / len(ys), max(ys) - min(ys), value))
    lines = []
    for box in sorted(boxes, key=lambda box: box[1]):
        if lines and abs(lines[-1][0][1] - box[1]) < max(4, min(lines[-1][0][2], box[2]) * 0.55):
            lines[-1].append(box)
        else:
            lines.append([box])
    reference = next((line for line in lines if any(
        company_key(box[3]) in {"公司", "企业", "单位", "公司名称", "企业名称", "单位名称", "招聘单位"} for box in line
    )), max(lines, key=len))
    columns = sorted(box[0] for box in reference)
    rows = []
    for line in lines:
        row = [""] * len(columns)
        for x, _, _, value in sorted(line):
            column = min(range(len(columns)), key=lambda i: abs(columns[i] - x))
            row[column] = (row[column] + " " + value).strip()
        rows.append(row)
    return {"rows": rows, "source": "图片文字识别"}


def init_store(db):
    db.executescript("""
        CREATE TABLE IF NOT EXISTS company_search_companies (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            name_key TEXT NOT NULL UNIQUE,
            options TEXT NOT NULL,
            queue_position INTEGER NOT NULL,
            website TEXT NOT NULL DEFAULT '',
            website_status TEXT NOT NULL DEFAULT '',
            website_candidates TEXT NOT NULL DEFAULT '[]'
        );
        CREATE TABLE IF NOT EXISTS company_search_platforms (
            company_id INTEGER NOT NULL,
            platform TEXT NOT NULL,
            status TEXT NOT NULL,
            message TEXT NOT NULL DEFAULT '',
            PRIMARY KEY (company_id, platform)
        );
        CREATE TABLE IF NOT EXISTS company_search_jobs (
            company_id INTEGER NOT NULL,
            job_id TEXT NOT NULL,
            removed INTEGER NOT NULL DEFAULT 0,
            record TEXT,
            PRIMARY KEY (company_id, job_id)
        );
        CREATE TABLE IF NOT EXISTS company_search_review (
            company_id INTEGER NOT NULL,
            job_id TEXT NOT NULL,
            record TEXT NOT NULL,
            reason TEXT NOT NULL,
            removed INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (company_id, job_id)
        );
    """)
    if "record" not in {row["name"] for row in db.execute("PRAGMA table_info(company_search_jobs)")}:
        db.execute("BEGIN IMMEDIATE")
        with db:
            if "record" not in {row["name"] for row in db.execute("PRAGMA table_info(company_search_jobs)")}:
                db.execute("ALTER TABLE company_search_jobs ADD COLUMN record TEXT")
                rows = db.execute("SELECT DISTINCT j.* FROM jobs j JOIN company_search_jobs s ON s.job_id=j.id").fetchall()
                db.executemany("UPDATE company_search_jobs SET record=?, removed=MAX(removed, ?) WHERE job_id=?",
                               ((json.dumps(dict(row), ensure_ascii=False), bool(row["deleted_at"]), row["id"]) for row in rows))
            if "removed" not in {row["name"] for row in db.execute("PRAGMA table_info(company_search_review)")}:
                db.execute("ALTER TABLE company_search_review ADD COLUMN removed INTEGER NOT NULL DEFAULT 0")


def prepare_options(cities, max_pages):
    if not isinstance(cities, list) or not 1 <= len(cities) <= 10 or any(not isinstance(v, str) for v in cities):
        raise ValueError("请填写 1 到 10 个搜索城市")
    if type(max_pages) is not int or not 1 <= max_pages <= 20:
        raise ValueError("每城每平台的搜索页数须为 1 到 20")
    clean = list(dict.fromkeys(v.strip() for v in cities if v.strip()))
    options = validate_collection_options({
        "platform_order": list(PLATFORMS),
        "platforms": {p: {"keywords": ["企业检索"], "cities": clean, "max_pages": max_pages} for p in PLATFORMS},
    })["platforms"]
    from bosshunter.config import CITY_CODES

    unknown = [city for city in clean if city not in CITY_CODES]
    if unknown:
        raise ValueError("BOSS 未识别城市：" + "、".join(unknown))
    return options


def enqueue(db, names, options):
    if not isinstance(names, list) or not 1 <= len(names) <= 1000:
        raise ValueError("请导入 1 到 1000 家企业")
    unique = {}
    for value in names:
        if not isinstance(value, str) or len(value) > 150 or not company_key(value):
            raise ValueError("企业名称应为 1 到 150 个有效字符")
        unique.setdefault(company_key(value), value.strip())
    ids = []
    with db:
        base = db.execute("SELECT COALESCE(MAX(queue_position), 0) FROM company_search_companies").fetchone()[0]
        for index, (key, name) in enumerate(unique.items(), start=1):
            row = db.execute("""
                INSERT INTO company_search_companies (name, name_key, options, queue_position)
                VALUES (?, ?, ?, ?) ON CONFLICT(name_key) DO UPDATE SET
                options=excluded.options, queue_position=excluded.queue_position, website_status=''
                RETURNING id
            """, (name, key, json.dumps(options, ensure_ascii=False), base + index)).fetchone()
            ids.append(row["id"])
            db.execute("DELETE FROM company_search_platforms WHERE company_id=?", (row["id"],))
    return ids


def pending_ids(db):
    return [row["id"] for row in db.execute("""
        SELECT id FROM company_search_companies c
        WHERE (SELECT COUNT(*) FROM company_search_platforms p
            WHERE p.company_id=c.id AND p.status IN ('found', 'empty')) < 3
            OR website_status='retry'
        ORDER BY queue_position
    """)]


def library(db):
    rows = db.execute("""
        SELECT c.id, c.name, c.website, c.website_status, c.website_candidates,
            (SELECT COUNT(*) FROM company_search_jobs j
             WHERE j.company_id=c.id AND j.removed=0 AND j.record IS NOT NULL) AS job_count
        FROM company_search_companies c ORDER BY c.id
    """)
    companies = {row["id"]: {**dict(row), "platforms": {}} for row in rows}
    for row in db.execute("SELECT * FROM company_search_platforms"):
        companies[row["company_id"]]["platforms"][row["platform"]] = dict(row)
    for company in companies.values():
        company["platform_job_counts"] = {}
    for row in db.execute("""
        SELECT company_id, json_extract(record,'$.source_platform') AS source_platform, COUNT(*) AS total
        FROM company_search_jobs WHERE removed=0 AND record IS NOT NULL GROUP BY company_id,source_platform
    """):
        if row["company_id"] in companies:
            companies[row["company_id"]]["platform_job_counts"][row["source_platform"]] = row["total"]
    review_counts = dict(db.execute("SELECT company_id, COUNT(*) FROM company_search_review WHERE removed=0 GROUP BY company_id"))
    for row in companies.values():
        row["website_candidates"] = json.loads(row["website_candidates"])
        row["review_count"] = review_counts.get(row["id"], 0)
    return list(companies.values())


def public_url(value):
    try:
        parsed = urlsplit(value)
        if parsed.scheme in {"http", "https"} and parsed.hostname and not parsed.username and not parsed.password:
            return parsed
    except ValueError:
        pass
    return None


def official_site_search(company):
    """Return search evidence, only auto-file explicitly identified official pages."""
    from os import environ

    # Use the user's system proxy, or the existing configured local proxy.
    http_options = ai_http_options() if environ.get("BOSSHUNTER_AI_PROXY") else {}
    response = httpx.get("https://www.bing.com/search", params={
        "q": f"{company} 官网 招聘",
        "format": "rss", "cc": "cn", "setlang": "zh-CN", "mkt": "zh-CN",
    }, headers={"Accept-Language": "zh-CN,zh;q=0.9"}, timeout=12, **http_options)
    response.raise_for_status()
    root = ElementTree.fromstring(response.content)
    if root.tag != "rss":
        raise ValueError("搜索引擎未返回结果列表")
    candidates = {}
    company_name = company_key(company)
    brand = re.sub(r"(?:股份有限公司|有限责任公司|有限公司|集团)$", "", company)
    brand = re.sub(r"(?:技术|科技|信息|实业|集团)$", "", brand)
    brand = company_key(brand)
    directories = ("bing.com", "baidu.com", "qcc.com", "tianyancha.com", "aiqicha.com",
                   "zhipin.com", "zhaopin.com", "51job.com", "liepin.com", "baike.com",
                   "zhihu.com", "sogou.com", "qq.com", "sina.com.cn")
    for item in root.findall("./channel/item"):
        title, url = item.findtext("title", ""), item.findtext("link", "")
        description = item.findtext("description", "")
        parsed = public_url(url)
        if not parsed or any(parsed.hostname == domain or parsed.hostname.endswith("." + domain) for domain in directories):
            continue
        evidence = company_key(title + " " + description)
        full_match = company_name in evidence
        if not full_match and not (len(brand) >= 2 and brand in evidence):
            continue
        official = full_match and bool(re.search(r"官网|官方网站|官方招聘", title))
        careers = bool(re.search(r"招聘|career|recruit|jobs", title + parsed.hostname + parsed.path, re.I))
        candidates[url] = {"title": title, "url": url, "official": official, "careers": careers}
    ranked = sorted(candidates.values(), key=lambda item: (item["official"], item["careers"]), reverse=True)
    website = next((item["url"] for item in ranked if item["official"]), "")
    return website, ranked[:5]


def _valid_job_link(url, platform):
    if not isinstance(url, str) or platform not in DOMAINS:
        return False
    if platform == "boss" and re.fullmatch(r"/job_detail/[^/?#]+\.html(?:\?[^#]*)?", url):
        return True
    parsed = public_url(url)
    domain = DOMAINS[platform]
    return bool(parsed and (parsed.hostname == domain or parsed.hostname.endswith("." + domain)))


def _link_job(db, company_id, record):
    from datetime import datetime, timezone

    job_id = record["id"]
    snapshot = {
        "status": "pending", "score": 0,
        "created_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
        **record,
    }
    with db:
        db.execute("""
            INSERT INTO company_search_jobs (company_id,job_id,record,removed)
            VALUES (?,?,?,COALESCE((SELECT removed FROM company_search_review WHERE company_id=? AND job_id=?),0))
            ON CONFLICT(company_id,job_id) DO UPDATE SET record=COALESCE(company_search_jobs.record,excluded.record)
        """, (company_id, job_id, json.dumps(snapshot, ensure_ascii=False), company_id, job_id))
        db.execute("DELETE FROM company_search_review WHERE company_id=? AND job_id=?", (company_id, job_id))
    return job_id


def company_jobs(db, company_id):
    rows = db.execute("""
        SELECT record FROM company_search_jobs WHERE company_id=? AND removed=0 AND record IS NOT NULL
        ORDER BY CASE json_extract(record,'$.source_platform') WHEN 'boss' THEN 0 WHEN 'zhilian' THEN 1 ELSE 2 END,
                 json_extract(record,'$.created_at'), job_id
    """, (company_id,))
    return [json.loads(row["record"]) for row in rows]


def update_company_job(db, company_id, job_id, *, removed=None, status=None, recruitment_type=None):
    if type(removed) is bool:
        with db:
            for table in ("company_search_jobs", "company_search_review"):
                if db.execute(f"UPDATE {table} SET removed=? WHERE company_id=? AND job_id=?",
                              (removed, company_id, job_id)).rowcount:
                    return True
        return False
    if isinstance(status, str) and status in MANUAL_STATUS_TARGETS and recruitment_type is None:
        field, value = "status", status
    elif isinstance(recruitment_type, str) and recruitment_type in {"campus", "experienced"} and status is None:
        field, value = "recruitment_type", recruitment_type
    else:
        raise ValueError("岗位操作参数无效")
    with db:
        return bool(db.execute("""
            UPDATE company_search_jobs SET record=json_set(record,?,?)
            WHERE company_id=? AND job_id=? AND removed=0 AND record IS NOT NULL
        """, (f"$.{field}", value, company_id, job_id)).rowcount)


def confirm_review_job(db, company_id, job_id):
    row = db.execute("""
        SELECT record FROM company_search_review WHERE company_id=? AND job_id=? AND removed=0
    """, (company_id, job_id)).fetchone()
    if not row:
        raise ValueError("该岗位已处理或不存在")
    record = json.loads(row["record"])
    if not record["jd"] or not _valid_job_link(record["url"], record["source_platform"]):
        raise ValueError("岗位 JD 尚未核实，请先在平台核对并续搜")
    return _link_job(db, company_id, record)


def _platform_search(db, task, company, platform, collector, options):
    matched = set()
    problems = []
    name_key = company["name_key"]
    short_keys = {name_key, company_key(re.sub(r"[（(][^）)]+[）)]", "", company["name"]))}

    def inspect(candidate):
        name = company_key(candidate.company)
        return not name or name == name_key or (
            len(name) >= 2 and any(key.startswith(name) or (len(name) >= 4 and name in key) for key in short_keys)
        )

    def save(candidate):
        verified_company = company_key(candidate.company) == name_key
        if not verified_company and not inspect(candidate):
            return True
        record = replace(candidate, education=candidate.education.strip() or "未注明").as_job_record()
        if not candidate.title.strip() or not _valid_job_link(record["url"], platform):
            problems.append("部分岗位缺少可核实的名称、JD 或原链接")
            return True
        if not verified_company or not record["jd"]:
            reason = "平台显示的企业名与导入全称未核对一致" if record["jd"] else "平台详情未读取到完整 JD"
            problems.append(reason)
            with db:
                db.execute("""
                    INSERT INTO company_search_review (company_id,job_id,record,reason)
                    SELECT ?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM company_search_jobs WHERE company_id=? AND job_id=?)
                    ON CONFLICT(company_id,job_id) DO UPDATE SET record=excluded.record,reason=excluded.reason
                    WHERE json_extract(excluded.record, '$.jd')<>'' OR json_extract(company_search_review.record, '$.jd')=''
                """, (company["id"], record["id"], json.dumps(record, ensure_ascii=False), reason,
                      company["id"], record["id"]))
            return True
        matched.add(_link_job(db, company["id"], record))
        return True

    settings = options[platform]
    request = PlatformCollectionRequest(platform, [company["name"]], settings["cities"],
                                        settings["city_codes"], settings["max_pages"], company_search=True)
    hooks = CollectorHooks(task.stop_requested, inspect, save, problems.append, lambda **_: None)
    try:
        result = collector.collect(request, hooks)
    except CollectionError as exc:
        return "retry", f"本轮已核实 {len(matched)} 个岗位。{exc.message}", exc.code
    if task.stop_requested.is_set():
        return "retry", "任务已停止，稍后可续搜", "user_stopped"
    if result.status != "completed" or result.reason_code not in {"search_exhausted", "no_results"}:
        return "retry", f"本轮已核实 {len(matched)} 个岗位。{result.message or '平台搜索未完成'}", result.reason_code
    if problems:
        return "review", f"{len(matched)} 个已核实岗位。{problems[0]}", ""
    if db.execute("""
        SELECT 1 FROM company_search_review WHERE company_id=? AND removed=0 AND json_extract(record,'$.source_platform')=? LIMIT 1
    """, (company["id"], platform)).fetchone():
        return "review", f"{len(matched)} 个已核实岗位。仍有上轮待核实岗位", ""
    return ("found" if matched else "empty"), f"{len(matched)} 个已核实岗位", ""


def run(task, config, db_path):
    with closing(get_db(db_path)) as db:
        init_store(db)
        ids = config["_company_ids"]
        collector_config = {**config, "profile": {"allow_internship": True}}
        collectors = {p: COLLECTORS[p](config=collector_config, safety_conn=db) for p in PLATFORMS}
        deferred = {}
        for position, company_id in enumerate(ids, start=1):
            if task.stop_requested.is_set():
                break
            company = db.execute("SELECT * FROM company_search_companies WHERE id=?", (company_id,)).fetchone()
            options = json.loads(company["options"])
            for platform in PLATFORMS:
                if task.stop_requested.is_set():
                    return
                task.progress = {"current": position, "total": len(ids), "company": company["name"], "platform": platform}
                state = db.execute(
                    "SELECT status FROM company_search_platforms WHERE company_id=? AND platform=?",
                    (company_id, platform),
                ).fetchone()
                if state and state["status"] in {"found", "empty"}:
                    continue
                if platform in deferred:
                    status, message, code = "retry", deferred[platform], ""
                else:
                    status, message, code = _platform_search(db, task, company, platform, collectors[platform], options)
                if code in {"outside_window", "day_off", "captcha", "blocked", "rate_limit", "login_required",
                            "persistent_risk_lock", "daily_search_page_limit", "daily_detail_page_limit",
                            "browser_disconnected", "api_limited", "hard_risk"}:
                    deferred[platform] = message.partition("。")[2] or message
                with db:
                    db.execute("INSERT OR REPLACE INTO company_search_platforms VALUES (?,?,?,?)",
                               (company_id, platform, status, message))
            if task.stop_requested.is_set():
                return
            statuses = db.execute("SELECT status FROM company_search_platforms WHERE company_id=?", (company_id,)).fetchall()
            if len(statuses) != 3 or any(row["status"] != "empty" for row in statuses) or company["website"]:
                continue
            task.progress = {**task.progress, "platform": "website"}
            try:
                website, candidates = official_site_search(company["name"])
                status = "found" if website else "review" if candidates else "empty"
            except (httpx.HTTPError, ElementTree.ParseError, ValueError):
                website, candidates, status = "", [], "retry"
            with db:
                db.execute("""
                    UPDATE company_search_companies SET website=?, website_status=?, website_candidates=? WHERE id=?
                """, (website, status, json.dumps(candidates, ensure_ascii=False), company_id))
