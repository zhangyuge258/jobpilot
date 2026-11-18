import json
from urllib.parse import urlencode

import pytest

from bosshunter.db import get_db, insert_job
from bosshunter.job_export import _filtered_rows
from bosshunter.job_filters import parse_monthly_salary_k
from bosshunter.web import server
from tests import test_web_api_routes as routes


@pytest.fixture
def column_db(tmp_path):
    original = server.BASE_DIR
    server.set_base_dir(tmp_path)
    conn = get_db(tmp_path / 'data' / 'bosshunter.db')
    # Matching records span more than one displayed page, with alternatives per column.
    for index in range(24):
        insert_job(conn, {
            'id': f'job-{index:02d}', 'company': '芯片%_Tech',
            'title': '嵌入式硬件工程师', 'city': '天津·西青区' if index % 2 else '北京',
            'salary': '10-20K', 'education': '本科' if index % 2 else '硕士',
            'recruitment_type': 'campus', 'hr_active': '今日活跃',
        })
    conn.execute("UPDATE jobs SET score=75,status='ready'")
    for index, (column, value) in enumerate([
        ('company', '别家公司'), ('title', '销售'), ('city', '上海'),
        ('education', '大专'), ('recruitment_type', 'experienced'),
        ('hr_active', '半年前活跃'), ('score', 95), ('status', 'rejected'),
    ]):
        conn.execute(f'UPDATE jobs SET {column}=? WHERE id=?', (value, f'job-{index:02d}'))
    conn.commit()
    try:
        yield conn
    finally:
        conn.close()
        server.set_base_dir(original)


def search(filters):
    status, _, body = routes.WebApiRouteTests._request(None, '/api/jobs/search?' + urlencode(filters, doseq=True))
    return status, json.loads(body)


def test_columns_combine_before_paging_and_match_export(column_db):
    filters = {
        'company': '%_tECH', 'title': '嵌入式', 'city': ['天津', '北京'],
        'education': ['本科', '硕士'], 'recruitment_type': ['campus'],
        'min_score': '70', 'max_score': '80', 'status': ['ready', 'pending'],
        'hr_active': '今日', 'salary_min': '12', 'salary_max': '18',
        'source_platform': ['boss'], 'created_within': 'today',
    }
    fields = 'id,title,company,city,salary,education,recruitment_type,score,status,manual_labelled,filter_library'
    before = [tuple(row) for row in column_db.execute(f'SELECT {fields} FROM jobs ORDER BY id')]
    expected = {f'job-{index:02d}' for index in range(8, 24)}
    first_status, first = search({**filters, 'limit': 10})
    second_status, second = search({**filters, 'limit': 10, 'offset': 10})
    assert first_status.startswith('200') and second_status.startswith('200')
    assert first['total'] == second['total'] == 16
    assert first['all_total'] == 24
    first_ids = {row['id'] for row in first['items']}
    second_ids = {row['id'] for row in second['items']}
    assert len(first_ids) == 10 and len(second_ids) == 6
    assert not first_ids & second_ids
    assert first_ids | second_ids == expected
    assert {row['id'] for row in _filtered_rows(column_db, filters)} == expected
    assert before == [tuple(row) for row in column_db.execute(f'SELECT {fields} FROM jobs ORDER BY id')]


def test_unknown_activity_zero_score_and_library_membership(column_db):
    column_db.execute("UPDATE jobs SET hr_active='',score=0,status='filtered',filter_library=1 WHERE id='job-00'")
    column_db.commit()
    filters = {'hr_active': '未知', 'max_score': '0'}
    assert search(filters)[1]['total'] == 0
    assert search({**filters, 'library': 'filtered'})[1]['items'][0]['id'] == 'job-00'
    column_db.execute("UPDATE jobs SET status='sent' WHERE id='job-00'")
    column_db.commit()
    assert search({**filters, 'library': 'sent'})[1]['items'][0]['id'] == 'job-00'
    assert search(filters)[1]['total'] == 0


@pytest.mark.parametrize('filters', [
    {'max_score': '101'}, {'max_score': '-1'}, {'max_score': 'nan'},
    {'max_score': 'oops'}, {'min_score': '80', 'max_score': '70'},
])
def test_invalid_score_range_rejected_by_search_and_export(column_db, filters):
    status, payload = search(filters)
    assert status.startswith('400') and payload['error']
    with pytest.raises(ValueError):
        _filtered_rows(column_db, filters)


@pytest.mark.parametrize(('label', 'expected'), [
    ('10-20K·13薪', (10, 20)), ('4,000-7,000元/月', (4, 7)),
    ('1-1.5万/月', (10, 15)), ('8千-1.2万', (8, 12)), ('5000元', (5, 5)),
    ('200-300元/天', None), ('20万元/年', None), ('面议', None),
])
def test_monthly_salary_column_accepts_all_platform_units(label, expected):
    assert parse_monthly_salary_k(label) == expected


def test_exact_title_multiselect_combines_with_columns_and_export(column_db):
    column_db.execute("UPDATE jobs SET title='其他岗位'")
    for job_id, title in [('job-00', '嵌入式软件'), ('job-01', '嵌入式软件'),
                          ('job-02', '高级嵌入式软件'), ('job-03', '嵌入式硬件'),
                          ('job-04', '嵌入式硬件'), ('job-05', '嵌入式%_工程师')]:
        column_db.execute('UPDATE jobs SET title=? WHERE id=?', (title, job_id))
    column_db.commit()
    filters = {'titles': ['嵌入式软件', '嵌入式硬件'], 'city': ['天津'], 'recruitment_type': ['campus']}
    first_status, first = search({**filters, 'limit': 1})
    _, second = search({**filters, 'limit': 1, 'offset': 1})
    assert first_status.startswith('200') and first['total'] == second['total'] == 2
    assert {row['id'] for row in first['items'] + second['items']} == {'job-01', 'job-03'}
    assert {row['id'] for row in _filtered_rows(column_db, filters)} == {'job-01', 'job-03'}
    # Selected titles, other column filters and pagination must not hide available choices.
    assert set(first['title_options']) == {'其他岗位', '嵌入式软件', '嵌入式硬件', '高级嵌入式软件', '嵌入式%_工程师'}
    assert search({'titles': ['嵌入式%_工程师']})[1]['total'] == 1
    insert_job(column_db, {'id': 'new-title', 'title': '新采集职位', 'recruitment_type': 'campus'})
    assert '新采集职位' in search(filters)[1]['title_options']


def test_title_options_respect_libraries_recycle_bin_and_blocked_companies(column_db):
    for job_id, title, company in [
        ('library-normal', '库中职位', '正常公司'), ('library-filtered', '仅过滤职位', '正常公司'),
        ('library-sent', '过滤后已投职位', '正常公司'), ('library-trash', '回收站职位', '正常公司'),
        ('library-blocked', '屏蔽公司职位', '隐藏公司'), ('library-empty', '   ', '正常公司'),
    ]:
        insert_job(column_db, {'id': job_id, 'title': title, 'company': company})
    column_db.execute("UPDATE jobs SET status='filtered',filter_library=1 WHERE id='library-filtered'")
    column_db.execute("UPDATE jobs SET status='sent',filter_library=1 WHERE id='library-sent'")
    column_db.execute("UPDATE jobs SET deleted_at=CURRENT_TIMESTAMP WHERE id='library-trash'")
    column_db.commit()
    (server.BASE_DIR / 'config.yaml').write_text('profile:\n  blocked_companies: [隐藏公司]\n', encoding='utf-8')
    options = search({'limit': 1})[1]['title_options']
    assert '库中职位' in options
    assert not {'仅过滤职位', '过滤后已投职位', '回收站职位', '屏蔽公司职位', ''} & set(options)
    assert set(search({'library': 'filtered'})[1]['title_options']) == {'仅过滤职位', '过滤后已投职位'}
    assert search({'library': 'sent'})[1]['title_options'] == ['过滤后已投职位']


def test_title_selection_is_validated_on_export(column_db):
    with pytest.raises(ValueError, match='职位筛选'):
        _filtered_rows(column_db, {'titles': [123]})
