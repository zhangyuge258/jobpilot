"""SQLite Storage for Direct Select (央国企/大厂投递优选)."""

import json
import sqlite3
import datetime
from typing import List, Optional
from bosshunter.db import get_db
from bosshunter.direct_select.models import CompanyCampaign, JobItem, ProfileSetting


def init_direct_select_tables(conn: sqlite3.Connection):
    """初始化优选模块数据库表结构."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS direct_select_campaigns (
            id TEXT PRIMARY KEY,
            company_name TEXT NOT NULL,
            source_type TEXT NOT NULL,
            source_input TEXT,
            status TEXT NOT NULL,
            status_message TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            total_jobs INTEGER DEFAULT 0,
            eligible_jobs INTEGER DEFAULT 0,
            excluded_jobs INTEGER DEFAULT 0,
            applied_jobs INTEGER DEFAULT 0
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS direct_select_jobs (
            id TEXT PRIMARY KEY,
            campaign_id TEXT NOT NULL,
            job_title TEXT NOT NULL,
            department TEXT,
            degree_req TEXT,
            degree_level INTEGER DEFAULT 0,
            major_req TEXT,
            major_restricted INTEGER DEFAULT 0,
            headcount TEXT,
            employment_type TEXT,
            location TEXT,
            raw_jd TEXT,
            url TEXT,
            status TEXT DEFAULT 'unapplied',
            is_excluded INTEGER DEFAULT 0,
            exclude_reason TEXT,
            is_manually_restored INTEGER DEFAULT 0,
            score INTEGER DEFAULT 0,
            rank INTEGER DEFAULT 999,
            volunteer_tier TEXT DEFAULT 'core',
            major_bonus_tag TEXT,
            fit_reasons_json TEXT,
            shortcomings_json TEXT,
            suggested_keywords_json TEXT,
            FOREIGN KEY (campaign_id) REFERENCES direct_select_campaigns(id) ON DELETE CASCADE
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS direct_select_profile (
            id TEXT PRIMARY KEY,
            degree_level INTEGER DEFAULT 2,
            degree_name TEXT DEFAULT '本科',
            major_name TEXT DEFAULT '计算机科学与技术',
            grad_year TEXT DEFAULT '2025届',
            ignore_location INTEGER DEFAULT 1,
            resume_mode TEXT DEFAULT 'default',
            resume_text TEXT DEFAULT ''
        )
    """)
    conn.commit()


def get_profile() -> ProfileSetting:
    """读取用户基准设置与画像."""
    with get_db() as conn:
        init_direct_select_tables(conn)
        row = conn.execute("SELECT * FROM direct_select_profile WHERE id = 'default'").fetchone()
        if not row:
            default_p = ProfileSetting()
            conn.execute("""
                INSERT INTO direct_select_profile (id, degree_level, degree_name, major_name, grad_year, ignore_location, resume_mode, resume_text)
                VALUES ('default', ?, ?, ?, ?, ?, ?, ?)
            """, (default_p.degree_level, default_p.degree_name, default_p.major_name, default_p.grad_year, 1 if default_p.ignore_location else 0, default_p.resume_mode, default_p.resume_text))
            conn.commit()
            return default_p
        return ProfileSetting(
            degree_level=row["degree_level"],
            degree_name=row["degree_name"],
            major_name=row["major_name"],
            grad_year=row["grad_year"],
            ignore_location=bool(row["ignore_location"]),
            resume_mode=row["resume_mode"],
            resume_text=row["resume_text"] or "",
        )


def save_profile(p: ProfileSetting):
    """保存用户基准设置与画像."""
    with get_db() as conn:
        init_direct_select_tables(conn)
        conn.execute("""
            INSERT INTO direct_select_profile (id, degree_level, degree_name, major_name, grad_year, ignore_location, resume_mode, resume_text)
            VALUES ('default', ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                degree_level=excluded.degree_level,
                degree_name=excluded.degree_name,
                major_name=excluded.major_name,
                grad_year=excluded.grad_year,
                ignore_location=excluded.ignore_location,
                resume_mode=excluded.resume_mode,
                resume_text=excluded.resume_text
        """, (p.degree_level, p.degree_name, p.major_name, p.grad_year, 1 if p.ignore_location else 0, p.resume_mode, p.resume_text))
        conn.commit()


def save_campaign(campaign: CompanyCampaign):
    """保存或更新企业战役信息及其岗位."""
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    if not campaign.created_at:
        campaign.created_at = now
    campaign.updated_at = now

    with get_db() as conn:
        init_direct_select_tables(conn)
        conn.execute("""
            INSERT INTO direct_select_campaigns (
                id, company_name, source_type, source_input, status, status_message,
                created_at, updated_at, total_jobs, eligible_jobs, excluded_jobs, applied_jobs
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                company_name=excluded.company_name,
                status=excluded.status,
                status_message=excluded.status_message,
                updated_at=excluded.updated_at,
                total_jobs=excluded.total_jobs,
                eligible_jobs=excluded.eligible_jobs,
                excluded_jobs=excluded.excluded_jobs,
                applied_jobs=excluded.applied_jobs
        """, (
            campaign.id, campaign.company_name, campaign.source_type, campaign.source_input,
            campaign.status, campaign.status_message, campaign.created_at, campaign.updated_at,
            campaign.total_jobs, campaign.eligible_jobs, campaign.excluded_jobs, campaign.applied_jobs
        ))

        # 保存关联 jobs
        for job in campaign.jobs:
            conn.execute("""
                INSERT INTO direct_select_jobs (
                    id, campaign_id, job_title, department, degree_req, degree_level,
                    major_req, major_restricted, headcount, employment_type, location,
                    raw_jd, url, status, is_excluded, exclude_reason, is_manually_restored,
                    score, rank, volunteer_tier, major_bonus_tag, fit_reasons_json,
                    shortcomings_json, suggested_keywords_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    status=excluded.status,
                    is_excluded=excluded.is_excluded,
                    exclude_reason=excluded.exclude_reason,
                    is_manually_restored=excluded.is_manually_restored,
                    score=excluded.score,
                    rank=excluded.rank,
                    volunteer_tier=excluded.volunteer_tier,
                    major_bonus_tag=excluded.major_bonus_tag,
                    fit_reasons_json=excluded.fit_reasons_json,
                    shortcomings_json=excluded.shortcomings_json,
                    suggested_keywords_json=excluded.suggested_keywords_json
            """, (
                job.id, job.campaign_id, job.job_title, job.department, job.degree_req, job.degree_level,
                job.major_req, 1 if job.major_restricted else 0, job.headcount, job.employment_type,
                job.location, job.raw_jd, job.url, job.status, 1 if job.is_excluded else 0,
                job.exclude_reason, 1 if job.is_manually_restored else 0, job.score, job.rank,
                job.volunteer_tier, job.major_bonus_tag,
                json.dumps(job.fit_reasons, ensure_ascii=False),
                json.dumps(job.shortcomings, ensure_ascii=False),
                json.dumps(job.suggested_keywords, ensure_ascii=False)
            ))
        conn.commit()


def list_campaigns() -> List[CompanyCampaign]:
    """获取所有企业战役列表（简要版，不含全量 jobs）."""
    with get_db() as conn:
        init_direct_select_tables(conn)
        rows = conn.execute("""
            SELECT * FROM direct_select_campaigns ORDER BY created_at DESC
        """).fetchall()
        result = []
        for r in rows:
            result.append(CompanyCampaign(
                id=r["id"],
                company_name=r["company_name"],
                source_type=r["source_type"],
                source_input=r["source_input"] or "",
                status=r["status"],
                status_message=r["status_message"] or "",
                created_at=r["created_at"],
                updated_at=r["updated_at"],
                total_jobs=r["total_jobs"] or 0,
                eligible_jobs=r["eligible_jobs"] or 0,
                excluded_jobs=r["excluded_jobs"] or 0,
                applied_jobs=r["applied_jobs"] or 0,
                jobs=[]
            ))
        return result


def get_campaign(campaign_id: str) -> Optional[CompanyCampaign]:
    """获取特定企业战役及包含的全部 jobs."""
    with get_db() as conn:
        init_direct_select_tables(conn)
        r = conn.execute("SELECT * FROM direct_select_campaigns WHERE id = ?", (campaign_id,)).fetchone()
        if not r:
            return None
        
        job_rows = conn.execute("""
            SELECT * FROM direct_select_jobs WHERE campaign_id = ? ORDER BY rank ASC, score DESC
        """, (campaign_id,)).fetchall()
        
        jobs = []
        for jr in job_rows:
            fit_reasons = json.loads(jr["fit_reasons_json"]) if jr["fit_reasons_json"] else []
            shortcomings = json.loads(jr["shortcomings_json"]) if jr["shortcomings_json"] else []
            suggested_keywords = json.loads(jr["suggested_keywords_json"]) if jr["suggested_keywords_json"] else []
            jobs.append(JobItem(
                id=jr["id"],
                campaign_id=jr["campaign_id"],
                job_title=jr["job_title"],
                department=jr["department"] or "",
                degree_req=jr["degree_req"] or "不限",
                degree_level=jr["degree_level"] or 0,
                major_req=jr["major_req"] or "不限",
                major_restricted=bool(jr["major_restricted"]),
                headcount=jr["headcount"] or "若干",
                employment_type=jr["employment_type"] or "正式编制/直签",
                location=jr["location"] or "待定",
                raw_jd=jr["raw_jd"] or "",
                url=jr["url"] or "",
                status=jr["status"] or "unapplied",
                is_excluded=bool(jr["is_excluded"]),
                exclude_reason=jr["exclude_reason"],
                is_manually_restored=bool(jr["is_manually_restored"]),
                score=jr["score"] or 0,
                rank=jr["rank"] or 999,
                volunteer_tier=jr["volunteer_tier"] or "core",
                major_bonus_tag=jr["major_bonus_tag"],
                fit_reasons=fit_reasons,
                shortcomings=shortcomings,
                suggested_keywords=suggested_keywords
            ))

        return CompanyCampaign(
            id=r["id"],
            company_name=r["company_name"],
            source_type=r["source_type"],
            source_input=r["source_input"] or "",
            status=r["status"],
            status_message=r["status_message"] or "",
            created_at=r["created_at"],
            updated_at=r["updated_at"],
            total_jobs=r["total_jobs"] or 0,
            eligible_jobs=r["eligible_jobs"] or 0,
            excluded_jobs=r["excluded_jobs"] or 0,
            applied_jobs=r["applied_jobs"] or 0,
            jobs=jobs
        )


def delete_campaign(campaign_id: str):
    """删除战役及对应岗位."""
    with get_db() as conn:
        init_direct_select_tables(conn)
        conn.execute("DELETE FROM direct_select_jobs WHERE campaign_id = ?", (campaign_id,))
        conn.execute("DELETE FROM direct_select_campaigns WHERE id = ?", (campaign_id,))
        conn.commit()


def update_job_status(job_id: str, status: str):
    """更新岗位状态（如 applied / unapplied）."""
    with get_db() as conn:
        init_direct_select_tables(conn)
        conn.execute("UPDATE direct_select_jobs SET status = ? WHERE id = ?", (status, job_id))
        
        # 刷新对应战役已投递计数
        row = conn.execute("SELECT campaign_id FROM direct_select_jobs WHERE id = ?", (job_id,)).fetchone()
        if row:
            cid = row["campaign_id"]
            applied_count = conn.execute("""
                SELECT COUNT(*) as c FROM direct_select_jobs WHERE campaign_id = ? AND status = 'applied'
            """, (cid,)).fetchone()["c"]
            conn.execute("UPDATE direct_select_campaigns SET applied_jobs = ? WHERE id = ?", (applied_count, cid))
        conn.commit()
