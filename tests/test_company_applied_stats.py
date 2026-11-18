import sqlite3
import pytest
from bosshunter.db import _init_tables, attach_company_applied_stats


@pytest.fixture
def db_conn():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    _init_tables(conn)
    return conn


def test_attach_company_applied_stats_empty(db_conn):
    assert attach_company_applied_stats(db_conn, []) == []


def test_attach_company_applied_stats_different_hr(db_conn):
    # Company A has 1 sent job (HR1) and 1 pending job (HR2)
    db_conn.execute("""
        INSERT INTO jobs (id, title, company, hr_name, status)
        VALUES ('job-1', '嵌入式固件开发', '智芯科技', '张经理', 'sent')
    """)
    db_conn.execute("""
        INSERT INTO jobs (id, title, company, hr_name, status)
        VALUES ('job-2', 'C++应用开发', '智芯科技', '李总监', 'ready')
    """)
    db_conn.commit()

    jobs = [
        {"id": "job-2", "company": "智芯科技", "title": "C++应用开发", "hr_name": "李总监", "status": "ready"}
    ]
    res = attach_company_applied_stats(db_conn, jobs)

    assert len(res) == 1
    target = res[0]
    # Check that job status and attributes are NOT modified
    assert target["status"] == "ready"
    assert target["company_applied_count"] == 1
    assert target["company_applied_same_hr"] is False
    stats = target["company_applied_stats"]
    assert stats["has_applied"] is True
    assert stats["count"] == 1
    assert stats["same_hr"] is False
    assert len(stats["jobs"]) == 1
    assert stats["jobs"][0]["id"] == "job-1"
    assert stats["jobs"][0]["title"] == "嵌入式固件开发"
    assert stats["jobs"][0]["hr_name"] == "张经理"


def test_attach_company_applied_stats_same_hr(db_conn):
    # Company B has 1 sent job (HR_SAME) and 1 pending job (HR_SAME)
    db_conn.execute("""
        INSERT INTO jobs (id, title, company, hr_name, status)
        VALUES ('job-3', '驱动开发', '蓝天软件', '王HR', 'sent')
    """)
    db_conn.execute("""
        INSERT INTO jobs (id, title, company, hr_name, status)
        VALUES ('job-4', 'Linux内核开发', '蓝天软件', '王HR', 'ready')
    """)
    db_conn.commit()

    jobs = [
        {"id": "job-4", "company": "蓝天软件", "title": "Linux内核开发", "hr_name": "王HR", "status": "ready"}
    ]
    res = attach_company_applied_stats(db_conn, jobs)
    target = res[0]
    assert target["status"] == "ready"
    assert target["company_applied_count"] == 1
    assert target["company_applied_same_hr"] is True
    assert target["company_applied_stats"]["same_hr"] is True


def test_attach_company_applied_stats_excludes_self(db_conn):
    # A sent job itself should not count itself as another applied job
    db_conn.execute("""
        INSERT INTO jobs (id, title, company, hr_name, status)
        VALUES ('job-5', '唯一的已投岗位', '独苗企业', '赵HR', 'sent')
    """)
    db_conn.commit()

    jobs = [
        {"id": "job-5", "company": "独苗企业", "title": "唯一的已投岗位", "hr_name": "赵HR", "status": "sent"}
    ]
    res = attach_company_applied_stats(db_conn, jobs)
    target = res[0]
    assert target["company_applied_count"] == 0
    assert target["company_applied_stats"]["has_applied"] is False


def test_attach_company_applied_stats_ignores_deleted(db_conn):
    # A soft-deleted sent job should not be counted
    db_conn.execute("""
        INSERT INTO jobs (id, title, company, hr_name, status, deleted_at)
        VALUES ('job-6', '已删除的岗位', '回收站公司', '孙HR', 'sent', CURRENT_TIMESTAMP)
    """)
    db_conn.execute("""
        INSERT INTO jobs (id, title, company, hr_name, status)
        VALUES ('job-7', '待投岗位', '回收站公司', '钱HR', 'ready')
    """)
    db_conn.commit()

    jobs = [
        {"id": "job-7", "company": "回收站公司", "title": "待投岗位", "hr_name": "钱HR", "status": "ready"}
    ]
    res = attach_company_applied_stats(db_conn, jobs)
    target = res[0]
    assert target["company_applied_count"] == 0
    assert target["company_applied_stats"]["has_applied"] is False
