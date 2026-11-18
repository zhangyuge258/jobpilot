"""Parser engine for extracting job listings from Images, URLs, and Raw Text."""

import json
import re
import uuid
from typing import List, Dict, Any, Optional
import urllib.request
from bosshunter.direct_select.models import JobItem
from bosshunter.direct_select.ai_client import call_ai, call_ai_vision, clean_json_text

PARSER_SYSTEM_PROMPT = """你是一个专业的央国企与名企招聘岗位结构化提取专家。
请仔细分析输入的内容（招聘公告、岗位表格、推文文本或长图），将其中的所有在招岗位提取为严谨的 JSON 数组。

每个岗位对象必须包含以下字段：
1. "job_title": 岗位名称（如 "数字化应用研发岗"、"综合管理专员"）
2. "department": 所属部门或分公司/二级单位（未提及可填公司名或 "总部"）
3. "degree_req": 学历硬性要求原文（如 "硕士研究生及以上"、"本科及以上"、"大专"、"不限"）
4. "degree_level": 学历等级数字（0: 不限, 1: 大专, 2: 本科, 3: 硕士, 4: 博士）。若原文写硕士及以上填3，本科及以上填2
5. "major_req": 专业要求原文（如 "计算机科学与技术、软件工程、电气工程"，如不限制请明确填 "专业不限"）
6. "major_restricted": 布尔值。若严格限定了某些具体专业填 true；若写专业不限或文理兼收填 false
7. "headcount": 招聘人数（如 "1人"、"15人"、"若干"）
8. "employment_type": 用工形式（识别是否为 "正式编制/国企直签" 或 "劳务派遣/业务外包预警"）
9. "location": 工作地点（如 "北京"、"上海"、"全国/服从调配"）
10. "raw_jd": 职责与主要要求简述（100字以内提炼核心业务与技术栈）

请严格只输出标准 JSON 数组（`[...]`），不要附带任何解释。若未发现有效岗位，输出 `[]`。
"""


def _parse_degree_level(degree_str: str) -> int:
    """根据学历字符串推断学历等级."""
    if not degree_str:
        return 0
    s = degree_str.lower()
    if "博" in s:
        return 4
    if "硕" in s or "研" in s:
        return 3
    if "本" in s:
        return 2
    if "专" in s:
        return 1
    return 0


def _parse_json_to_jobs(campaign_id: str, json_text: str) -> List[JobItem]:
    """将大模型返回的 JSON 解析为 JobItem 列表."""
    cleaned = clean_json_text(json_text)
    if not cleaned:
        return []
    try:
        data = json.loads(cleaned)
        if not isinstance(data, list):
            if isinstance(data, dict) and "jobs" in data:
                data = data["jobs"]
            else:
                data = [data]
        
        jobs: List[JobItem] = []
        for item in data:
            if not isinstance(item, dict) or not item.get("job_title"):
                continue
            deg_req = str(item.get("degree_req", "本科及以上"))
            deg_lvl = item.get("degree_level")
            if deg_lvl is None or not isinstance(deg_lvl, int):
                deg_lvl = _parse_degree_level(deg_req)
            
            major_req = str(item.get("major_req", "不限"))
            major_rest = item.get("major_restricted")
            if major_rest is None:
                major_rest = ("不限" not in major_req and "无限制" not in major_req and len(major_req) > 1)
            
            job = JobItem(
                id=str(uuid.uuid4())[:12],
                campaign_id=campaign_id,
                job_title=str(item.get("job_title", "未命名岗位")).strip(),
                department=str(item.get("department", "")).strip(),
                degree_req=deg_req,
                degree_level=deg_lvl,
                major_req=major_req,
                major_restricted=bool(major_rest),
                headcount=str(item.get("headcount", "若干")),
                employment_type=str(item.get("employment_type", "正式编制/直签")),
                location=str(item.get("location", "待定")),
                raw_jd=str(item.get("raw_jd", "")),
                url=str(item.get("url", ""))
            )
            jobs.append(job)
        return jobs
    except Exception as e:
        print(f"[DirectSelect] JSON parsing failed: {e}")
        return []


def parse_from_text(campaign_id: str, text_content: str) -> List[JobItem]:
    """从纯文本/JD大段复制中解析岗位."""
    prompt = f"{PARSER_SYSTEM_PROMPT}\n\n以下是待提取的招聘公告文本内容：\n{text_content[:8000]}"
    res = call_ai(prompt, max_tokens=4096)
    if res:
        jobs = _parse_json_to_jobs(campaign_id, res)
        if jobs:
            return jobs
    
    # 兜底规则启发式切分（以防 AI 接口未配置或网络故障）
    return _heuristic_fallback_parse(campaign_id, text_content)


def parse_from_image(campaign_id: str, image_base64: str, media_type: str = "image/png") -> List[JobItem]:
    """从剪贴板截图或图片中通过多模态 Vision 提取岗位."""
    prompt = f"{PARSER_SYSTEM_PROMPT}\n\n请识别这张图片中的招聘公告、岗位需求表格或长图海报，提取全部在招岗位："
    res = call_ai_vision(image_base64, media_type, prompt, max_tokens=4096)
    if res:
        jobs = _parse_json_to_jobs(campaign_id, res)
        if jobs:
            return jobs
    return []


def parse_from_url(campaign_id: str, url: str) -> List[JobItem]:
    """从网页招聘链接拉取文本并解析."""
    try:
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            }
        )
        with urllib.request.urlopen(req, timeout=15) as response:
            html = response.read().decode("utf-8", errors="ignore")
            # 过滤 script 和 style
            clean_text = re.sub(r"<(script|style)[^>]*>[\s\S]*?</\1>", "", html, flags=re.I)
            clean_text = re.sub(r"<[^>]+>", " ", clean_text)
            clean_text = re.sub(r"\s+", " ", clean_text).strip()
            
            jobs = parse_from_text(campaign_id, clean_text[:8000])
            for j in jobs:
                if not j.url:
                    j.url = url
            return jobs
    except Exception as e:
        print(f"[DirectSelect] URL fetch error: {e}")
        return []


def _heuristic_fallback_parse(campaign_id: str, text: str) -> List[JobItem]:
    """启发式正则提取兜底（当 AI 未接入时保证基本展示与测试）."""
    lines = [line.strip() for line in text.split("\n") if line.strip()]
    jobs: List[JobItem] = []
    
    # 查找可能的岗位行
    for line in lines:
        if any(keyword in line for keyword in ["岗", "专员", "工程师", "经理", "助理", "主管", "生", "管培"]):
            deg = "本科及以上"
            lvl = 2
            if "硕" in line:
                deg = "硕士及以上"
                lvl = 3
            elif "博" in line:
                deg = "博士"
                lvl = 4
            elif "大专" in line:
                deg = "大专及以上"
                lvl = 1
            
            jobs.append(JobItem(
                id=str(uuid.uuid4())[:12],
                campaign_id=campaign_id,
                job_title=line[:30],
                department="分公司/部门",
                degree_req=deg,
                degree_level=lvl,
                major_req="相关专业",
                major_restricted=False,
                headcount="若干",
                employment_type="正式编制/直签",
                location="多地",
                raw_jd=line
            ))
            if len(jobs) >= 20:
                break
    return jobs
