"""Concurrent Task Manager for Direct Select Multi-Company Pipeline."""

import concurrent.futures
import threading
import uuid
import datetime
from typing import List, Dict, Optional, Any

from bosshunter.direct_select.models import CompanyCampaign, JobItem, ProfileSetting
from bosshunter.direct_select.db_store import (
    save_campaign,
    get_campaign,
    list_campaigns,
    delete_campaign,
    get_profile,
    update_job_status
)
from bosshunter.direct_select.parser import parse_from_image, parse_from_url, parse_from_text
from bosshunter.direct_select.matcher import match_and_rank_jobs


class DirectSelectManager:
    """企业网申作战台并发任务管理器."""

    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        with cls._lock:
            if cls._instance is None:
                cls._instance = super().__new__(cls)
                cls._instance._init_manager()
            return cls._instance

    def _init_manager(self):
        # 允许最大 3 个企业并发解析，避免大模型并发限流
        self.executor = concurrent.futures.ThreadPoolExecutor(max_workers=3, thread_name_prefix="direct_select_worker")
        self.active_tasks: Dict[str, CompanyCampaign] = {}

    def create_and_enqueue_campaign(
        self,
        company_name: str,
        source_type: str,
        source_input: str,
        media_type: str = "image/png"
    ) -> CompanyCampaign:
        """创建并入队一个新的企业解析任务."""
        campaign_id = str(uuid.uuid4())[:12]
        now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
        campaign = CompanyCampaign(
            id=campaign_id,
            company_name=company_name.strip() or "未命名企业招聘",
            source_type=source_type,
            source_input=source_input,
            status="queued",
            status_message="已入队排队中...",
            created_at=now,
            updated_at=now,
            total_jobs=0,
            eligible_jobs=0,
            excluded_jobs=0,
            applied_jobs=0,
            jobs=[]
        )
        save_campaign(campaign)
        self.active_tasks[campaign_id] = campaign

        # 提交到后台异步线程池
        self.executor.submit(self._run_campaign_task, campaign_id, source_type, source_input, media_type)
        return campaign

    def batch_create_campaigns(self, items: List[Dict[str, Any]]) -> List[CompanyCampaign]:
        """批量入队企业任务（多链接、多公司、多图片）."""
        campaigns = []
        for it in items:
            name = it.get("company_name", "知名企业招聘")
            stype = it.get("source_type", "text")
            sinput = it.get("source_input", "")
            mtype = it.get("media_type", "image/png")
            c = self.create_and_enqueue_campaign(name, stype, sinput, mtype)
            campaigns.append(c)
        return campaigns

    def _run_campaign_task(self, campaign_id: str, source_type: str, source_input: str, media_type: str):
        """后台异步执行单家公司的岗位提取与精准评估."""
        campaign = get_campaign(campaign_id)
        if not campaign:
            return

        try:
            # 1. 解析阶段
            campaign.status = "parsing"
            campaign.status_message = "正在解析在招岗位信息..."
            save_campaign(campaign)

            raw_jobs: List[JobItem] = []
            if source_type == "image":
                raw_jobs = parse_from_image(campaign_id, source_input, media_type)
            elif source_type == "url":
                raw_jobs = parse_from_url(campaign_id, source_input)
            else:
                raw_jobs = parse_from_text(campaign_id, source_input)

            if not raw_jobs:
                campaign.status = "ready"
                campaign.status_message = "未在提供的信息中发现明确的岗位，请尝试补充文本或重新截图"
                save_campaign(campaign)
                return

            # 2. 评估打分阶段
            campaign.status = "matching"
            campaign.status_message = f"已提取 {len(raw_jobs)} 个岗位，正在进行学历初筛与职能匹配..."
            save_campaign(campaign)

            profile = get_profile()
            ranked_jobs, eligible_count, excluded_count = match_and_rank_jobs(raw_jobs, profile)

            campaign.jobs = ranked_jobs
            campaign.total_jobs = len(ranked_jobs)
            campaign.eligible_jobs = eligible_count
            campaign.excluded_jobs = excluded_count
            campaign.status = "ready"
            campaign.status_message = f"已就绪 · 共 {len(ranked_jobs)} 岗，筛选出 Top 10"
            save_campaign(campaign)

        except Exception as e:
            print(f"[DirectSelect] Task failed for {campaign_id}: {e}")
            campaign.status = "failed"
            campaign.status_message = f"解析失败：{str(e)[:100]}"
            save_campaign(campaign)

    def restore_excluded_job(self, campaign_id: str, job_id: str) -> Optional[CompanyCampaign]:
        """人工强制捞回（复活）被硬门槛排除的岗位，重新打分排名."""
        campaign = get_campaign(campaign_id)
        if not campaign:
            return None

        target_job = None
        for j in campaign.jobs:
            if j.id == job_id:
                target_job = j
                break

        if not target_job:
            return campaign

        target_job.is_manually_restored = True
        target_job.is_excluded = False
        target_job.exclude_reason = None

        profile = get_profile()
        ranked_jobs, eligible_count, excluded_count = match_and_rank_jobs(campaign.jobs, profile)

        campaign.jobs = ranked_jobs
        campaign.eligible_jobs = eligible_count
        campaign.excluded_jobs = excluded_count
        campaign.status_message = f"已人工捞回岗位【{target_job.job_title}】，已重新计算 Top 10"
        save_campaign(campaign)
        return campaign

    def re_evaluate_campaign(self, campaign_id: str) -> Optional[CompanyCampaign]:
        """当用户修改画像设置后，重新对该企业全部岗位打分排名."""
        campaign = get_campaign(campaign_id)
        if not campaign or not campaign.jobs:
            return campaign

        profile = get_profile()
        ranked_jobs, eligible_count, excluded_count = match_and_rank_jobs(campaign.jobs, profile)

        campaign.jobs = ranked_jobs
        campaign.eligible_jobs = eligible_count
        campaign.excluded_jobs = excluded_count
        campaign.status_message = "已按最新画像重新计算排名"
        save_campaign(campaign)
        return campaign


# 全局单例
manager = DirectSelectManager()
