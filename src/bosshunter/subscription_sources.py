"""Adapters for the public recruitment pages used by the subscription worker."""
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from io import BytesIO
import json
import re
from urllib.parse import urlencode, urljoin, urlsplit

from bs4 import BeautifulSoup
import httpx
from openpyxl import load_workbook

SOURCES = {
    "phytium": {"name": "飞腾 · 校园招聘", "url": "https://www.phytium.com.cn/recruitment/campus_recruit",
                "category": "state", "minutes": 60, "scope": "当前官网校招职位，按页读取"},
    "dji": {"name": "大疆 · 校招热招职位", "url": "https://careers.dji.com/zh-CN/campus/hot-jobs?source=campus_hotjobs",
            "category": "major", "minutes": 120, "scope": "官网热招专题，覆盖专题所列职位"},
    "xiaomi": {"name": "小米 · 校招职位", "url": "https://xiaomi.jobs.f.mioffice.cn/campus/position/list",
               "category": "major", "minutes": 180, "scope": "官网搜索嵌入式与硬件，每词最多 15 页"},
    "xiaopeng": {"name": "小鹏 · 校招职位", "url": "https://xiaopeng.jobs.feishu.cn/campus/position/list",
                 "category": "major", "minutes": 180, "scope": "官网搜索嵌入式与硬件，每词最多 15 页"},
    "spic": {"name": "国家电投 · 招聘公告", "url": "https://www.spic.com.cn/spicm/jrwm/",
             "category": "state", "minutes": 120, "scope": "官网展示的招聘公告及岗位表"},
    "ncss_state": {"name": "国家大学生就业服务平台 · 国企招聘专题",
                   "url": "https://gzeic.ncss.cn/ncss/zt/gqzp2026.shtml",
                   "category": "state", "minutes": 180, "scope": "专题公布的央国企及子公司校招公告，保留原入口"},
    "tute": {"name": "天津职业技术师范大学 · 正式工作人员", "url": "https://rsc.tute.edu.cn/rczp/zpxx/zsgzryzp.htm",
             "category": "public", "minutes": 60, "scope": "正式工作人员公告，回溯最近 90 天"},
    "tjhrss": {"name": "天津人社 · 事业单位公告线索", "url": "https://hrss.tj.gov.cn/ztzl/ztzl1/sydwgkzp/",
               "category": "public", "minutes": 60, "scope": "拆分首页招聘汇总中的实际单位和公告入口"},
    "tjhealth": {"name": "天津卫生人才网 · 事业单位招聘", "url": "https://www.tjwsrc.com/tzgg/index.shtml",
                 "category": "public", "minutes": 120, "scope": "公告首页的事业单位招聘及岗位计划表"},
    "tjut": {"name": "天津理工大学 · 公开招聘", "url": "https://rsc.tjut.edu.cn/gkzp.htm",
             "category": "public", "minutes": 120, "scope": "公开招聘首页、报名与重启通知"},
}

DATE = r"(?P<year>20\d{2})\s*[-./年]\s*(?P<month>\d{1,2})\s*[-./月]\s*(?P<day>\d{1,2})(?:\s*[日号])?"
TIME = r"(?:\s*(?:上午|下午|晚上)?\s*(?P<hour>\d{1,2})\s*[时:：](?P<minute>\d{1,2})?\s*分?)?"


def parse_dates(text):
    for match in re.finditer(DATE + TIME, text):
        try:
            values = match.groupdict()
            day = datetime(int(values["year"]), int(values["month"]), int(values["day"]))
            if values["hour"] is None:
                yield day.date().isoformat()
            else:
                hour = int(values["hour"])
                if ("下午" in match[0] or "晚上" in match[0]) and hour < 12:
                    hour += 12
                if hour == 24:
                    day += timedelta(days=1)
                    hour = 0
                yield day.replace(hour=hour, minute=int(values["minute"] or 0)).isoformat() + "+08:00"
        except ValueError:
            continue


def window(text):
    # Avoid treating publication, interviews, payment and exam dates as
    # application deadlines. Source paragraphs are processed independently.
    for line in text.splitlines():
        if not re.search(r"报名时间|报名[自从]|报名截止|网申时间|网申截止|报名期限", line):
            continue
        dates = list(parse_dates(line))
        if len(dates) >= 2 and re.search(r"至|—|–|~|到|截止", line):
            opens = dates[0] if len(dates[0]) > 10 else dates[0] + "T00:00:00+08:00"
            return opens, dates[1]
        if dates and re.search(r"截至|截止[：:\s]|发布之日起\s*至", line):
            return "", dates[0]
    return "", ""


def degree(text):
    match = re.search(r"(?:学历(?:要求)?[：:\s（(及以上）)]*|(?:学历学位)[：:\s]*)([^\n。；]{2,28})", text)
    grades = re.findall(r"博士|硕士|本科|大专|专科", match[1] if match else text)
    values = list(dict.fromkeys(grades))
    return " / ".join(values) if values else ""


def fetch(client, url, *, params=None):
    response = client.get(url, params=params)
    response.raise_for_status()
    if len(response.content) > 12_000_000:
        raise ValueError("来源文件超过 12 MB")
    return response


def page(client, url, encoding=None):
    return BeautifulSoup(fetch(client, url).content, "html.parser", from_encoding=encoding)


def paragraph_text(node):
    if node is None:
        return ""
    paras = node.select("p")
    return "\n".join(p.get_text("", strip=True) for p in paras if p.get_text(strip=True)) if paras else node.get_text("\n", strip=True)


def make(source, key, kind, company, title, url, **fields):
    return {"key": key, "kind": kind, "category": SOURCES[source]["category"],
            "company": company, "title": title, "url": url, **fields}


def phytium(client):
    base = "https://www.phytium.com.cn"
    records, errors, number, total = [], 0, 1, None
    seen = set()
    while True:
        response = fetch(client, base + "/recruitment/campus_recruit_list/", params={
            "pageSize": 50, "pageNumber": number, "data": '{"positionCategoryArray":[],"workLocationObj":{}}',
        }).json()
        rows = response["rows"]
        if total is None:
            total = int(response["total"])
        if int(response["total"]) != total or (not rows and len(seen) < total):
            raise ValueError("职位列表翻页期间发生变化，等待补查")
        for row in rows:
            # Signed detail keys rotate. Their first segment is the stable
            # publisher ID, while the complete original link is retained.
            stable_id = str(row["id"]).split(".", 1)[0]
            if stable_id in seen:
                raise ValueError("职位列表返回了重复分页")
            seen.add(stable_id)
            url = base + "/recruitment/resume/delivery/?" + urlencode(
                {"id": row["id"], "recruit_type": "校园招聘", "recommend_type": row["recommend_type"]}
            )
            try:
                soup = page(client, url)
                text = "\n".join(section.get_text("\n", strip=True)
                                 for section in soup.select(".description-detail-content"))
                if not text or not re.search("岗位职责|任职条件|任职要求", text):
                    raise ValueError("未读到岗位详情")
                applying = soup.select_one("button.delivery_resume") is not None
                records.append(make("phytium", stable_id, "job", "飞腾信息技术有限公司", row["name"], url,
                                    jd=text, city=row["work_place_name"], published=row["publish_date"],
                                    education=degree(text), recruitment_type="campus",
                                    availability="open" if applying else "unknown"))
            except (httpx.HTTPError, ValueError):
                errors += 1
        if len(seen) >= total:
            break
        number += 1
        if number > 25:
            raise ValueError("职位列表超过 25 页，等待补查")
    return records, not errors, f"核实 {len(records)}/{total} 个校招岗位，{number} 页" + (f"；{errors} 个详情待查" if errors else "")


def dji(client):
    url = SOURCES["dji"]["url"]
    soup = page(client, url)
    headline = soup.select_one("header p")
    banner = (headline.get_text(strip=True) if headline else "") + " " + soup.get_text(" ", strip=True)[:650]
    is_open = "网申进行中" in banner
    seen = set()
    records = []
    for link in soup.select('h4 a[href*="keyword="]'):
        address = str(link["href"])
        if urlsplit(address).hostname != "apply.careers.dji.com":
            continue
        title = link.get_text(strip=True)
        if not title or title in seen:
            continue
        seen.add(title)
        card = link.parent.parent
        description = card.select_one('p, [class*="_desc"]')
        jd = description.get_text("\n", strip=True) if description else ""
        city = "、".join(tag.get_text(strip=True) for tag in card.select('[class*="_tag__"]'))
        if jd:
            records.append(make("dji", title, "job", "大疆创新", title, address,
                                original=url, jd=jd, city=city, education=degree(jd), recruitment_type="campus",
                                availability="open" if is_open else "unknown"))
    if not records:
        raise ValueError("未读到大疆热招职位，无法确认列表状态")
    return records, len(records) == len(seen), f"热招专题核实 {len(records)}/{len(seen)} 个岗位"


def ats_job(source, company, row):
    job_id = str(row.get("id") or "")
    title = str(row.get("title") or "").strip()
    jd = "\n\n".join(str(row.get(field) or "").strip() for field in ("description", "requirement")).strip()
    recruit = row.get("recruit_type") or {}
    if "实习" in str(recruit.get("name")) or not job_id.isdigit() or not title or not jd:
        return None
    cities = row.get("city_list") or [row.get("city_info") or {}]
    city = "、".join(dict.fromkeys(item["name"] for item in cities if item.get("name")))
    published = row.get("publish_time")
    timestamp = (datetime.fromtimestamp(published / 1000, timezone(timedelta(hours=8))).isoformat()
                 if isinstance(published, (int, float)) and 1_000_000_000_000 < published < 4_000_000_000_000 else "")
    url = SOURCES[source]["url"].rsplit("/position/list", 1)[0] + f"/position/{job_id}/detail"
    return make(source, job_id, "job", company, title, url, jd=jd, city=city, published=timestamp,
                education=degree(str(row.get("requirement") or "")), recruitment_type="campus", availability="open")


def official_ats(source, company):
    """Read the portal's published list while operating its search and pagination UI."""
    from patchright.sync_api import Error as BrowserError, sync_playwright

    pos = urlsplit(SOURCES[source]["url"])
    records, failed, coverage = {}, 0, []

    def matches(response, keyword, offset):
        target = urlsplit(response.url)
        if target.hostname != pos.hostname or target.path != "/api/v1/search/job/posts" or response.status != 200:
            return False
        body = response.request.post_data_json
        return isinstance(body, dict) and body.get("keyword") == keyword and body.get("offset") == offset

    def decode(response):
        payload = response.json()
        if payload.get("code") != 0 or not isinstance(payload.get("data"), dict):
            raise ValueError("官网未返回有效职位列表")
        rows = payload["data"].get("job_post_list")
        count = payload["data"].get("count")
        if not isinstance(rows, list) or type(count) is not int or (count and not rows):
            raise ValueError("官网职位列表不完整")
        return rows, count

    with sync_playwright() as playwright, playwright.chromium.launch(
        channel="chrome", headless=True, args=["--no-proxy-server"]
    ) as browser:
        tab = browser.new_page()
        tab.goto(SOURCES[source]["url"], wait_until="commit", timeout=18000)
        for keyword in ("嵌入式", "硬件"):
            seen = 0
            try:
                search = tab.locator('[data-test="searchBlockInput"]')
                search.wait_for(state="visible", timeout=15000)
                with tab.expect_response(lambda r: matches(r, keyword, 0), timeout=15000) as response:
                    search.fill(keyword)
                    search.press("Enter")
                rows, total = decode(response.value)
                job_ids = set()
                for number in range(1, 16):
                    page_ids = {row.get("id") for row in rows}
                    if len(page_ids) != len(rows) or page_ids & job_ids:
                        raise ValueError("官网职位列表翻页重复")
                    job_ids.update(page_ids)
                    seen += len(rows)
                    for row in rows:
                        item = ats_job(source, company, row)
                        if item:
                            records[item["key"]] = item
                    if seen >= total or number == 15:
                        break
                    with tab.expect_response(lambda r: matches(r, keyword, seen), timeout=12000) as response:
                        tab.locator(f'li.atsx-pagination-item[title="{number+1}"]').click(timeout=6000)
                    rows, reported = decode(response.value)
                    if total != reported:
                        raise ValueError("官网翻页期间职位数发生变动")
                coverage.append(f"{keyword} {seen}/{total}")
                if seen < total:
                    failed += 1
            except (ValueError, BrowserError):
                coverage.append(f"{keyword} 部分待补查")
                failed += 1
    if not coverage or (not records and failed):
        raise ValueError("未能确认官网技术岗位列表，等待补查")
    return list(records.values()), not failed, "、".join(coverage) + f"；收录 {len(records)} 个正式校招岗位"


def attachment_rows(client, url):
    host = urlsplit(url).hostname
    if host not in {"www.spic.com.cn", "rsc.tute.edu.cn", "www.tjwsrc.com"}:
        return []
    response = fetch(client, url)
    book = load_workbook(BytesIO(response.content), read_only=True, data_only=True)
    records = []
    try:
        for sheet in book:
            header = None
            company = ""
            for row in sheet.iter_rows(max_row=500, max_col=35, values_only=True):
                cells = [str(value or "").strip() for value in row]
                if header is None:
                    if any(v in {"招聘岗位", "岗位名称", "岗位"} for v in cells):
                        header = [re.sub(r"\s+", "", label) for label in cells]
                    continue
                values = dict(zip(header, cells))
                title = values.get("招聘岗位") or values.get("岗位名称") or values.get("岗位")
                company = values.get("招聘单位") or company
                values["招聘单位"] = company
                jd = "\n".join(f"{label}：{values[label]}" for label in (
                    "岗位职责", "岗位简介", "任职要求", "专业要求", "专业", "其他条件", "其它条件"
                ) if values.get(label))
                if host == "www.spic.com.cn":
                    jd = "\n".join(values.get(label, "") for label in ("岗位职责", "任职要求", "专业要求", "其他条件")).strip()
                if not title or not jd:
                    continue
                records.append((title, jd, values))
    finally:
        book.close()
    return records


def spic(client):
    url = SOURCES["spic"]["url"]
    listing = page(client, url, "gb18030")
    links = [(a.get_text(strip=True), urljoin(url, a["href"]), next(parse_dates(a.find_parent("li").get_text(" ", strip=True)), ""))
             for a in listing.select("li h2 a[href]") if "招聘" in a.get_text(strip=True)]
    if not links:
        raise ValueError("未读到国家电投招聘公告列表")
    result, pending = [], 0
    for title, address, published in links:
        try:
            soup = page(client, address, "gb18030")
            text = "\n".join(paragraph_text(n) for n in soup.select(".TRS_Editor"))
            if not text:
                raise ValueError("无法读取公告正文")
            opens, closes = window(text)
            company = title.removesuffix("招聘公告").removesuffix("公开选聘公告")
            fields = {"opens": opens, "closes": closes, "published": published,
                      "recruitment_type": "campus" if "校园招聘" in title else "unknown"}
            result.append(make("spic", address, "notice", company, title, address, jd=text[:1800], **fields))
            if closes and closes[:10] < datetime.now(timezone(timedelta(hours=8))).date().isoformat():
                continue
            jobs = 0
            for link in soup.select('.TRS_Editor a[href$=".xlsx"]'):
                if not re.search("岗位|职位|任职", link.get_text(strip=True)):
                    continue
                attachment = urljoin(address, link["href"])
                for job_title, jd, value in attachment_rows(client, attachment):
                    key = address + "#" + (value.get("岗位代码") or value.get("序号") or job_title)
                    result.append(make("spic", key, "job", company, job_title, address,
                                       attachment=attachment, jd=jd, city=value.get("办公地点") or value.get("工作地点"),
                                       education=value.get("学历要求") or degree(jd), **fields))
                    jobs += 1
            if not jobs:
                pending += 1
        except Exception:
            pending += 1
    return result, not pending, f"公告 {len(links)} 条，{pending} 条需补查岗位或附件"


def tute(client):
    url = SOURCES["tute"]["url"]
    found, pages, cutoff = {}, set(), (datetime.now(timezone(timedelta(hours=8))).date() - timedelta(days=90)).isoformat()
    while url and url not in pages and len(pages) < 8:
        pages.add(url)
        soup = page(client, url)
        dates = []
        for link in soup.select('a[href*="/info/"]'):
            title = link.get_text(strip=True)
            if "招聘" not in title or not re.search("报名|招聘方案|招聘公告|资格审查", title) or re.search("公示|面试|成绩", title):
                continue
            line = link.find_parent("tr") or link.parent
            date = next(parse_dates(line.get_text(" ", strip=True)), "")
            if date:
                dates.append(date)
            if len(pages) == 1 or not date or date >= cutoff:
                found[urljoin(url, link["href"])] = (title, date)
        next_page = next((a["href"] for a in soup.select("a[href]") if a.get_text(strip=True) == "下页"), None)
        url = urljoin(url, next_page) if next_page and (not dates or max(dates) >= cutoff) else None
    if not found:
        raise ValueError("未读到正式工作人员招聘公告")
    records, pending = [], 0
    closures = []
    reopened = []
    for link, (title, published) in found.items():
        try:
            detail = page(client, link)
            jd = paragraph_text(detail.select_one(".v_news_content"))
            if not jd:
                raise ValueError("未读到公告正文")
            opens, closes = window(jd)
            fields = {"opens": opens, "closes": closes, "published": published, "city": "天津"}
            if "资格审查" in title or ("报名截止" in title and "重启" not in title):
                closures.append((published, title, jd))
                continue
            records.append(make("tute", link, "notice", "天津职业技术师范大学", title, link, jd=jd[:1800], **fields))
            match = re.search(r"现重启\s*([^，。\n]{2,36}?)\s*报名工作", jd)
            if match:
                reopened.append((link, title, match[1], jd, fields))
            else:
                pending += 1
        except (httpx.HTTPError, ValueError):
            pending += 1
    for link, notice, title, jd, fields in reopened:
        normal = lambda value: re.sub(r"[\s－\-]", "", value)
        same_batch = re.search(r"20\d{2}年第[一二三四五六七八九十]+批", notice)
        if any((not date or date >= fields["published"]) and same_batch and same_batch[0] in other
               and normal(title) in normal(text) for date, other, text in closures):
            availability = "closed"
        else:
            # The school's scheme explicitly reopens these jobs until it
            # publishes a subsequent closure or qualifying shortlist.
            availability = "open" if fields["published"] else "unknown"
        records.append(make("tute", link + "#post", "job", "天津职业技术师范大学", title, link,
                            jd=jd, education=degree(jd), availability=availability, **fields))
    return records, not pending and url is None, f"扫描 {len(pages)} 页、{len(found)} 则公告，{pending} 则岗位表待核实"


def tjhrss(client):
    url = SOURCES["tjhrss"]["url"]
    soup = page(client, url)
    notices = {}
    for a in soup.select("a[href]"):
        title = a.get_text(" ", strip=True)
        if "部分事业单位公开招聘信息" in title and re.search(r"/20\d{4}/", a["href"]):
            link = urljoin(url, a["href"])
            notices[link] = next(parse_dates(title), "")
    if not notices:
        raise ValueError("未读到天津人社汇总列表")
    records, failed = [], 0
    for link, published in notices.items():
        try:
            detail = page(client, link)
            units = {}
            for row in detail.select(".trs_word_table tr"):
                cells = [cell.get_text(" ", strip=True) for cell in row.find_all("td", recursive=False)]
                if len(cells) < 5 or not cells[0].isdigit():
                    continue
                name = cells[1]
                if not name or not re.search("医院|学院|大学|中心|学校|研究|单位|事业|馆|局|所|队|园|站|院", name):
                    continue
                urls = re.findall(r"https?://[^\s；;，、<>]+", " ".join(cells[4:]))
                origin = next((url for url in urls if urlsplit(url).hostname and not urlsplit(url).username), "")
                units.setdefault(name, origin)
            if not units:
                raise ValueError("汇总表未读取到单位列")
            for name, address in units.items():
                records.append(make("tjhrss", link + "#" + name, "notice", name,
                                    name + " · 公开招聘线索", address or link, original=link,
                                    published=published, city="天津",
                                    jd="来自天津人社局招聘汇总，报名状态及岗位条件请核对招聘单位原公告。"))
        except (ValueError, httpx.HTTPError):
            failed += 1
    if not records:
        raise ValueError("未读到可识别的天津事业单位招聘汇总")
    return records, False, f"解析 {len(notices)-failed}/{len(notices)} 张汇总表，覆盖 {len({item['company'] for item in records})} 家单位；具体报名以原公告为准"


def ncss_state(client):
    source = "ncss_state"
    url = SOURCES[source]["url"]
    rows = None
    for script in page(client, url).select("script:not([src])"):
        text = script.get_text()
        match = re.search(r"\bvar\s+comsList\s*=\s*", text)
        if match:
            rows = json.JSONDecoder().raw_decode(text[match.end():])[0]
            break
    if not isinstance(rows, list) or not rows:
        raise ValueError("未读到国企招聘专题数据")
    records = {}
    skipped = 0
    for row in rows:
        name = str(row.get("company") or "").strip()
        title = str(row.get("title") or "").strip()
        address = str(row.get("link") or "").strip()
        parsed = urlsplit(address)
        if not name or not title or parsed.scheme not in {"http","https"} or not parsed.hostname or parsed.username or parsed.password:
            skipped += 1
            continue
        start = next(parse_dates(str(row.get("startDate") or "")), "")
        opening = start + "T00:00:00+08:00" if len(start) == 10 else start
        closing = next(parse_dates(str(row.get("endDate") or "")), "")
        key = sha256(("\0".join((name, title, address))).encode()).hexdigest()
        estimate = str(row.get("yjtggws") or "未注明").strip()
        records[key] = make(source, key, "notice", name, title, address, original=url,
                            opens=opening, closes=closing, recruitment_type="campus",
                            jd=f"专题预计提供岗位数：{estimate}。具体岗位、所在地和投递资格以用人单位原页为准。")
    if not records:
        raise ValueError("国企专题没有可识别的公告链接")
    companies = len({item["company"] for item in records.values()})
    return list(records.values()), not skipped, f"收录 {len(records)} 条公告，覆盖 {companies} 家招聘单位" + (f"；{skipped} 条链接待核实" if skipped else "")


def tjhealth(client):
    source = "tjhealth"
    url = SOURCES[source]["url"]
    links = {}
    for link in page(client, url).select('a[href*="/system/"]'):
        title = link.get_text(strip=True)
        if ("招聘" in title and re.search("事业编|事业单位", title)
                and not re.search("公示|派遣|名单|成绩|面试|体检|考察|资格复审", title)):
            links[urljoin(url, link["href"])] = title
    if not links:
        raise ValueError("未读到天津卫生人才网事业单位招聘公告")
    records, pending = [], 0
    for address, title in links.items():
        try:
            body = max(page(client, address).select("td.xiahua"),
                       key=lambda node: len(node.get_text()), default=None)
            text = paragraph_text(body)
            if not text:
                raise ValueError("未读到公告正文")
            opens, closes = window(text)
            published = re.search(r"/(20\d{2})/(\d{2})/(\d{2})/", address)
            fields = {"city": "天津", "opens": opens, "closes": closes,
                      "published": "-".join(published.groups()) if published else ""}
            summary = title.split("2026年", 1)[0] if "2026年" in title else "天津卫生事业单位"
            records.append(make(source, address, "notice", summary, title, address, jd=text[:1800], **fields))
            today = datetime.now(timezone(timedelta(hours=8))).date().isoformat()
            if closes and closes[:10] < today:
                continue
            jobs = 0
            for link in body.select('a[href$=".xlsx"]'):
                if not re.search("岗位|计划", link.get_text(strip=True)):
                    continue
                attachment = urljoin(address, link["href"])
                for job_title, jd, values in attachment_rows(client, attachment):
                    unit = re.split(r"[（(]", values.get("招聘单位", ""), 1)[0].strip() or summary
                    department = values.get("招聘部门", "")
                    label = f"{department} · {job_title}" if department else job_title
                    code = values.get("岗位代码") or values.get("序号") or unit + label
                    records.append(make(source, address+"#"+code, "job", unit, label, address,
                                        attachment=attachment, jd=jd, education=values.get("学历") or degree(jd), **fields))
                    jobs += 1
            if not jobs:
                pending += 1
        except (ValueError, OSError, httpx.HTTPError):
            pending += 1
    return records, not pending, f"读取 {len(links)} 条事业单位公告；{pending} 条原文或岗位表待核实"


def tjut(client):
    source = "tjut"
    url = SOURCES[source]["url"]
    links = {}
    for a in page(client, url).select('a[href*="info/1020/"]'):
        title = a.get_text(strip=True)
        if "招聘" in title and re.search("招聘方案|重启报名|截止报名|延期|补充|更正", title) and not re.search("拟聘|面试|公示", title):
            address = urljoin(url, a["href"])
            if urlsplit(address).hostname == "rsc.tjut.edu.cn":
                links[address] = title
    if not links:
        raise ValueError("未读到天津理工大学公开招聘列表")
    items, failed = [], 0
    for address, title in links.items():
        try:
            soup = page(client, address)
            text = paragraph_text(soup.select_one(".v_news_content"))
            if not text:
                raise ValueError("未找到招聘正文")
            opens, closes = window(text)
            if "截止报名" in title and "重启报名" not in title:
                closes = ""
            items.append(make(source, address, "notice", "天津理工大学", title, address, city="天津",
                              opens=opens, closes=closes, jd=text[:1800]))
        except (ValueError, httpx.HTTPError):
            failed += 1
    if not items:
        raise ValueError("未能核实天津理工大学招聘公告")
    return items, False, f"读取 {len(items)} 条原公告，具体岗位表待核实" + (f"；{failed} 条原文待补查" if failed else "")


READERS = {"phytium": phytium, "dji": dji, "spic": spic, "tute": tute, "tjhrss": tjhrss,
           "tjhealth": tjhealth, "tjut": tjut, "ncss_state": ncss_state}


def read_source(source):
    if source == "xiaomi":
        return official_ats(source, "小米集团")
    if source == "xiaopeng":
        return official_ats(source, "小鹏集团")
    with httpx.Client(timeout=10, follow_redirects=True, trust_env=False,
                      headers={"User-Agent": "Mozilla/5.0 (compatible; BossHunter Recruitment Reader)"}) as client:
        return READERS[source](client)
