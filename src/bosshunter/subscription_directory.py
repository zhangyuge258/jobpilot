"""Organisation coverage is tracked independently of recruitment results."""
from datetime import timedelta
import re
import unicodedata

import httpx

from bosshunter.subscription_sources import page

CENTRAL_URL = "https://wap.sasac.gov.cn/n2588045/n27271785/n27271792/c14159097/content.html"
CENTRAL_DATE = "2026-07-11"
# Official SASAC roster dated 2026-07-11. This snapshot is usable when the
# authority's site cannot be reached from the user's network.
CENTRAL = """中国核工业集团有限公司
中国航天科技集团有限公司
中国航天科工集团有限公司
中国航空工业集团有限公司
中国船舶集团有限公司
中国兵器工业集团有限公司
中国兵器装备集团有限公司
中国电子科技集团有限公司
中国航空发动机集团有限公司
中国融通资产管理集团有限公司
中国石油天然气集团有限公司
中国石油化工集团有限公司
中国海洋石油集团有限公司
国家石油天然气管网集团有限公司
国家电网有限公司
中国南方电网有限责任公司
中国华能集团有限公司
中国大唐集团有限公司
中国华电集团有限公司
国家电力投资集团有限公司
中国长江三峡集团有限公司
中国雅江集团有限公司
国家能源投资集团有限责任公司
中国电信集团有限公司
中国联合网络通信集团有限公司
中国移动通信集团有限公司
中国卫星网络集团有限公司
国家数据集团有限公司
中国电子信息产业集团有限公司
中国第一汽车集团有限公司
东风汽车集团有限公司
中国一重集团有限公司
中国机械工业集团有限公司
哈尔滨电气集团有限公司
中国东方电气集团有限公司
鞍钢集团有限公司
中国宝武钢铁集团有限公司
中国矿产资源集团有限公司
中国铝业集团有限公司
中国远洋海运集团有限公司
中国航空集团有限公司
中国东方航空集团有限公司
中国南方航空集团有限公司
中国中化控股有限责任公司
中粮集团有限公司
中国五矿集团有限公司
中国通用技术（集团）控股有限责任公司
中国建筑集团有限公司
中国储备粮管理集团有限公司
中国南水北调集团有限公司
国家开发投资集团有限公司
招商局集团有限公司
华润（集团）有限公司
中国旅游集团有限公司
中国商用飞机有限责任公司
中国节能环保集团有限公司
中国国际工程咨询有限公司
中国诚通控股集团有限公司
中国中煤能源集团有限公司
中国煤炭科工集团有限公司
中国机械科学研究总院集团有限公司
中国钢研科技集团有限公司
中国化学工程集团有限公司
中国盐业集团有限公司
中国建材集团有限公司
中国有色矿业集团有限公司
中国稀土集团有限公司
中国资源循环集团有限公司
中国有研科技集团有限公司
矿冶科技集团有限公司
中国国际技术智力合作集团有限公司
中国建筑科学研究院有限公司
中国中车集团有限公司
中国长安汽车集团有限公司
中国铁路通信信号集团有限公司
中国铁路工程集团有限公司
中国铁道建筑集团有限公司
中国交通建设集团有限公司
中国信息通信科技集团有限公司
中国农业发展集团有限公司
中国林业集团有限公司
中国医药集团有限公司
中国保利集团有限公司
中国建设科技有限公司
中国冶金地质总局
中国煤炭地质总局
新兴际华集团有限公司
中国民航信息集团有限公司
中国航空器材集团有限公司
中国电力建设集团有限公司
中国能源建设集团有限公司
中国安能建设集团有限公司
中国黄金集团有限公司
中国广核集团有限公司
华侨城集团有限公司
南光（集团）有限公司
中国电气装备集团有限公司
中国物流集团有限公司
中国国新控股有限责任公司
中国检验认证（集团）有限公司""".splitlines()

DIRECTORIES = {
    "sasac": ("国务院国资委央企名录", CENTRAL_URL),
    "mof": ("财政部出资央企名录", "https://zcgls.mof.gov.cn/zhuantilanmu/czblz/202108/t20210817_3745862.htm"),
    "tjcity": ("天津市管国企名录", "https://sasac.tj.gov.cn/GZJG8342/GZFM8996/SGGQML5116/"),
    "tjadmin": ("天津委管企业名录", "https://sasac.tj.gov.cn/GZJG8342/GZFM8996/WGQYML2210/"),
}

# Public campus landing pages. An entry is not an enabled monitor.
MAJOR = {
    "华为": "https://career.huawei.com/cn/campus-recruitment",
    "联想集团": "https://talent.lenovo.com.cn/campus",
    "比亚迪": "https://job.byd.com/portal/mobile/school-home",
    "京东集团": "https://campus.jd.com/",
    "字节跳动": "https://jobs.bytedance.com/campus/",
    "腾讯": "https://join.qq.com/",
    "阿里巴巴": "https://campus-talent.alibaba.com/",
}


def key(name):
    return re.sub(r"[\s()]+", "", unicodedata.normalize("NFKC", name)).casefold()


def init(db):
    db.executescript("""
        CREATE TABLE IF NOT EXISTS subscription_organisation_directory (
            org_key TEXT NOT NULL, name TEXT NOT NULL, category TEXT NOT NULL,
            source TEXT NOT NULL, title TEXT NOT NULL, url TEXT NOT NULL,
            PRIMARY KEY (source, org_key)
        );
        CREATE TABLE IF NOT EXISTS subscription_directory_checks (
            source TEXT PRIMARY KEY, attempted TEXT NOT NULL, checked TEXT, error TEXT
        );
    """)
    with db:
        if not db.execute("SELECT 1 FROM subscription_organisation_directory WHERE source='sasac'").fetchone():
            save(db, "state", "sasac", "国务院国资委名录 · " + CENTRAL_DATE, [(name, CENTRAL_URL) for name in CENTRAL])
        if not db.execute("SELECT 1 FROM subscription_organisation_directory WHERE source='official_campus'").fetchone():
            save(db, "major", "official_campus", "校招官网入口", MAJOR.items())


def save(db, category, source, title, names):
    db.executemany("""
        INSERT OR REPLACE INTO subscription_organisation_directory VALUES (?,?,?,?,?,?)
    """, [(key(name), name, category, source, title, url) for name, url in names])


def refresh(db, now):
    for source, (label, url) in DIRECTORIES.items():
        due = (now - timedelta(days=1)).isoformat()
        with db:
            claimed = db.execute("""
                INSERT INTO subscription_directory_checks(source,attempted) VALUES(?,?)
                ON CONFLICT(source) DO UPDATE SET attempted=excluded.attempted
                WHERE subscription_directory_checks.attempted <= ?
            """, (source, now.isoformat(), due)).rowcount
        if not claimed:
            continue
        try:
            with httpx.Client(timeout=6, trust_env=False, follow_redirects=True) as client:
                soup = page(client, url)
            if source.startswith("tj"):
                names = [item.get_text(strip=True) for item in soup.select(".mainBox .NodeList .tit")]
                if len(set(names)) < 5:
                    raise ValueError("未读到官方名录")
            else:
                names = []
                for row in soup.select("table tr"):
                    cells = [cell.get_text(strip=True) for cell in row.select("td")]
                    for index in (0, 2) if source == "sasac" else (0,):
                        if len(cells) > index + 1 and cells[index].isdigit():
                            names.append(re.sub(r"\[.*\]$", "", cells[index+1]).strip())
                if len(set(names)) < 80:
                    raise ValueError("官方名录未读取完整")
            with db:
                db.execute("DELETE FROM subscription_organisation_directory WHERE source=?", (source,))
                save(db, "state", source, label, [(name, url) for name in dict.fromkeys(names) if name])
                db.execute("UPDATE subscription_directory_checks SET checked=?,error=NULL WHERE source=?",
                           (now.isoformat(), source))
        except (ValueError, httpx.HTTPError) as exc:
            with db:
                db.execute("UPDATE subscription_directory_checks SET error=? WHERE source=?",
                           (str(exc)[:160] or type(exc).__name__, source))


def list_orgs(db, groups, category, query):
    by_key = {}

    def add(name):
        return by_key.setdefault(key(name), {"name": name, "jobs": 0, "open": 0, "notices": 0, "sources": [], "links": []})

    overrides = {key(row["name"]): row["category"] for row in db.execute("SELECT * FROM subscription_org_categories")}
    for row in db.execute("SELECT * FROM subscription_organisation_directory"):
        identity = row["org_key"]
        if overrides.get(identity, row["category"]) != category:
            continue
        item = add(row["name"])
        if row["url"] and row["url"] not in [link["url"] for link in item["links"]]:
            item["links"].append({"title": row["title"], "url": row["url"]})
    for group in groups:
        item = add(group["company"])
        item["jobs"] = len(group["jobs"])
        item["open"] = sum(job["availability"] == "open" for job in group["jobs"])
    classified = {row["org_key"] for row in db.execute("SELECT org_key FROM subscription_organisation_directory WHERE category!='other'")}
    for row in db.execute("""
        SELECT source,json_extract(data,'$.company') AS company,json_extract(data,'$.category') AS category,
               SUM(json_extract(data,'$.kind')='notice') AS notices
        FROM subscription_items WHERE hidden=0 GROUP BY source,company,category
    """):
        if not row["company"]:
            continue
        identity = key(row["company"])
        if row["category"] != "other":
            classified.add(identity)
        if overrides.get(identity, row["category"]) == category:
            item = add(row["company"])
            item["notices"] += row["notices"] or 0
            if row["source"] not in item["sources"]:
                item["sources"].append(row["source"])
    if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='company_search_companies'").fetchone():
        for row in db.execute("SELECT name,website FROM company_search_companies"):
            identity = key(row["name"])
            if identity in by_key or overrides.get(identity) == category or (
                category == "other" and identity not in overrides and identity not in classified
            ):
                item = add(row["name"])
                if row["website"] and row["website"] not in [link["url"] for link in item["links"]]:
                    item["links"].append({"title": "企业检索核实入口", "url": row["website"]})
    needle = key(query)
    return sorted((item for identity,item in by_key.items() if needle in identity),
                  key=lambda item: (not item["jobs"], not item["notices"], item["name"]))
