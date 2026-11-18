"""Matcher and Scoring Engine for Direct Select."""

import json
import re
from typing import List, Tuple
from bosshunter.direct_select.models import JobItem, ProfileSetting
from bosshunter.direct_select.ai_client import call_ai, clean_json_text


SCORING_PROMPT_TEMPLATE = """你是一个央国企与知名大厂求职评估专家。
候选人画像如下：
- 最高学历：{degree_name} (等级: {degree_level})
- 专业名称：{major_name}
- 毕业届别：{grad_year}
- 核心经历与技能优势：
{resume_summary}

请根据候选人画像，对以下岗位列表进行综合匹配度打分与优劣势诊断。
核心评估原则：
1. 职能与技能契合度（最核心权重）：经历和技能是否真能胜任岗位职责。
2. 专业壁垒加分：如果岗位严格限定了特定专业，且候选人专业精确命中，属于强竞争壁垒，请大幅加分（+20~30分）；若是"专业不限"，提示竞争极其激烈。
3. 地区最不重要：忽略或淡化地区差异，不得因工作地点偏远而恶意扣分。
4. 招聘人数：统招大体量岗（招数十人）上岸率高，适当加分；单人精招竞争高，给与提醒。
5. 用工形式避坑：若发现有劳务派遣、业务外包迹象，请标明预警并适当降分。

待评估岗位列表（JSON格式）：
{jobs_json}

请对每个岗位输出评估结果，严格输出标准 JSON 格式，格式如下：
[
  {{
    "id": "岗位id",
    "score": 88,
    "volunteer_tier": "core", // "sprint"(冲刺), "core"(主力对口), "safety"(稳健保底)
    "major_bonus_tag": "★ 命中专业壁垒 (+25分，竞争小)", // 若未命中或专业不限可填 null
    "fit_reasons": ["契合点1：...", "契合点2：..."],
    "shortcomings": ["面试预警/稍弱点1：..."],
    "suggested_keywords": ["关键词1", "关键词2"]
  }}
]
仅输出 JSON 数组，不要任何多余文字。
"""


def match_and_rank_jobs(jobs: List[JobItem], profile: ProfileSetting) -> Tuple[List[JobItem], int, int]:
    """
    执行岗位匹配过滤与打分排序：
    1. 学历硬筛：超标直接进入排除池（除非人工强制捞回）
    2. 大模型与规则引擎综合评分
    3. 排名并划分 Top 10、剩余候选与排除池
    返回: (全量更新后的jobs, eligible_count, excluded_count)
    """
    eligible_jobs: List[JobItem] = []
    excluded_jobs: List[JobItem] = []

    # 第一关：学历硬筛一票否决
    for job in jobs:
        # 如果已被人工强制捞回，跳过硬门槛
        if job.is_manually_restored:
            job.is_excluded = False
            job.exclude_reason = None
            eligible_jobs.append(job)
            continue

        # 检查学历：岗位要求等级大于用户当前等级则直接排除
        # 0:不限, 1:大专, 2:本科, 3:硕士, 4:博士
        if job.degree_level > profile.degree_level:
            job.is_excluded = True
            job.exclude_reason = f"学历超标：岗位要求【{job.degree_req}】，高于你预设的最高学历【{profile.degree_name}】"
            job.score = 0
            job.rank = 999
            excluded_jobs.append(job)
        else:
            job.is_excluded = False
            job.exclude_reason = None
            eligible_jobs.append(job)

    # 如果有合规岗位，进行多维综合打分
    if eligible_jobs:
        _evaluate_eligible_jobs(eligible_jobs, profile)

    # 排序：按 score 从高到低
    eligible_jobs.sort(key=lambda j: j.score, reverse=True)
    
    # 分配排名 (Rank 1, 2, 3...)
    for idx, j in enumerate(eligible_jobs):
        j.rank = idx + 1
        # 根据排位和分数微调志愿梯队
        if j.rank <= 3:
            j.volunteer_tier = "sprint" if j.score >= 90 else "core"
        elif j.rank <= 7:
            j.volunteer_tier = "core"
        else:
            j.volunteer_tier = "safety"

    total_jobs = eligible_jobs + excluded_jobs
    return total_jobs, len(eligible_jobs), len(excluded_jobs)


def _evaluate_eligible_jobs(jobs: List[JobItem], profile: ProfileSetting):
    """调用大模型为合规岗位批量打分并生成诊断."""
    # 构建简要列表给大模型，节省 token
    jobs_summary = []
    for j in jobs:
        jobs_summary.append({
            "id": j.id,
            "job_title": j.job_title,
            "department": j.department,
            "degree_req": j.degree_req,
            "major_req": j.major_req,
            "major_restricted": j.major_restricted,
            "headcount": j.headcount,
            "employment_type": j.employment_type,
            "location": j.location,
            "raw_jd": j.raw_jd[:300]
        })

    resume_summary = profile.resume_text if profile.resume_text.strip() else "熟练掌握计算机/软件工程技术栈，有独立项目开发与系统维护经历，具备扎实的数据分析与日常文档撰写能力。"

    prompt = SCORING_PROMPT_TEMPLATE.format(
        degree_name=profile.degree_name,
        degree_level=profile.degree_level,
        major_name=profile.major_name,
        grad_year=profile.grad_year,
        resume_summary=resume_summary,
        jobs_json=json.dumps(jobs_summary, ensure_ascii=False)
    )

    ai_res = call_ai(prompt, max_tokens=4096)
    score_map = {}
    if ai_res:
        cleaned = clean_json_text(ai_res)
        try:
            items = json.loads(cleaned)
            if isinstance(items, list):
                for it in items:
                    if isinstance(it, dict) and "id" in it:
                        score_map[it["id"]] = it
        except Exception as e:
            print(f"[DirectSelect] Matcher AI parse error: {e}")

    # 合并评分结果并辅以规则兜底
    for job in jobs:
        ai_data = score_map.get(job.id)
        if ai_data:
            job.score = int(ai_data.get("score", 75))
            job.volunteer_tier = ai_data.get("volunteer_tier", "core")
            job.major_bonus_tag = ai_data.get("major_bonus_tag")
            job.fit_reasons = ai_data.get("fit_reasons", [])
            job.shortcomings = ai_data.get("shortcomings", [])
            job.suggested_keywords = ai_data.get("suggested_keywords", [])
        else:
            # 规则打分兜底
            base_score = 75
            fit_reasons = []
            
            # 专业限制命中加分
            user_major_clean = profile.major_name.lower()
            job_major_clean = job.major_req.lower()
            if job.major_restricted and any(k in job_major_clean for k in [user_major_clean, "计算机", "软件", "信息", "通信", "自动化", "电气"]):
                base_score += 15
                job.major_bonus_tag = "★ 命中专业壁垒 (+15分，竞争相对温和)"
                fit_reasons.append(f"专业完全符合限制要求（{job.major_req}），天然避开海量跨专业竞争")
            elif "不限" in job_major_clean:
                job.major_bonus_tag = "专业不限（预期报考人数较多）"
            
            # 招聘人数加分
            if any(num in job.headcount for num in ["10", "20", "30", "50", "大批量"]):
                base_score += 5
                fit_reasons.append(f"统招体量较大（{job.headcount}），录用概率显著高于单人精招岗位")
            
            # 用工形式识别
            if "派遣" in job.employment_type or "外包" in job.employment_type:
                base_score -= 20
                job.employment_type = "劳务派遣/外包预警"

            fit_reasons.append(f"岗位职责与你的个人优势匹配良好，建议优先投递")
            job.score = max(50, min(98, base_score))
            job.fit_reasons = fit_reasons
            job.shortcomings = ["建议仔细阅读官方公告对英语四六级及证书的补充要求"]
            job.suggested_keywords = [profile.major_name, "项目实践", "沟通协作"]
