"""Data models for Direct Select (央国企/大厂投递优选)."""

from typing import List, Optional
from pydantic import BaseModel, Field


class ProfileSetting(BaseModel):
    """用户基准画像与硬门槛预设."""
    degree_level: int = Field(default=2, description="最高学历等级：1大专 2本科 3硕士 4博士")
    degree_name: str = Field(default="本科", description="最高学历名称")
    major_name: str = Field(default="计算机科学与技术", description="专业名称")
    grad_year: str = Field(default="2025届", description="毕业届别/身份")
    ignore_location: bool = Field(default=True, description="是否弱化地区影响（最不重要）")
    resume_mode: str = Field(default="default", description="简历模式: default(母版) 或 custom_text(在线录入)")
    resume_text: str = Field(default="", description="在线键入的简历/核心优势文本")


class JobItem(BaseModel):
    """解析与打分后的单个岗位."""
    id: str
    campaign_id: str
    job_title: str
    department: str = ""
    degree_req: str = "不限"
    degree_level: int = 0  # 0:不限, 1:大专, 2:本科, 3:硕士, 4:博士
    major_req: str = "不限"
    major_restricted: bool = False  # 是否为严格限制专业（专业壁垒）
    headcount: str = "若干"  # 招聘人数 (如 '1人', '20人')
    employment_type: str = "正式编制/直签"  # 或 "劳务派遣/外包预警"
    location: str = "待定"
    raw_jd: str = ""
    url: str = ""
    
    # 状态与排名
    status: str = "unapplied"  # unapplied, applied, ignored
    is_excluded: bool = False  # 是否被硬规则排除
    exclude_reason: Optional[str] = None  # 如 "学历超标：要求硕士及以上"
    is_manually_restored: bool = False  # 是否被用户人工强制捞回
    
    score: int = 0  # 0~100 综合得分
    rank: int = 999  # 在合规岗位中的排名 (1~10 为 Top 10)
    volunteer_tier: str = "core"  # sprint(冲刺), core(主力对口), safety(稳健保底)
    major_bonus_tag: Optional[str] = None  # 如 "★ 命中专业壁垒 (+25分)"
    
    fit_reasons: List[str] = Field(default_factory=list)
    shortcomings: List[str] = Field(default_factory=list)
    suggested_keywords: List[str] = Field(default_factory=list)


class CompanyCampaign(BaseModel):
    """企业网申任务/战役."""
    id: str
    company_name: str
    source_type: str = "text"  # "url", "image", "text"
    source_input: str = ""  # 原始输入 (URL / 文本 / 图片标记)
    status: str = "queued"  # queued, parsing, matching, ready, failed
    status_message: str = "排队中"
    created_at: str = ""
    updated_at: str = ""
    
    total_jobs: int = 0
    eligible_jobs: int = 0
    excluded_jobs: int = 0
    applied_jobs: int = 0
    
    jobs: List[JobItem] = Field(default_factory=list)
