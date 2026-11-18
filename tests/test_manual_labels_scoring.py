import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from rich.console import Console

from bosshunter.ai import scorer
from bosshunter.db import get_db, get_score_trace, insert_job, update_jobs_manual_status, update_jobs_recruitment_type
from bosshunter.scoring_selection import select_scoring_jobs


def assessment(high=True):
    points = (34, 21, 12, 7, 8) if high else (10, 5, 4, 2, 3)
    keys = ('core_duties', 'transferable_evidence', 'hard_requirements', 'tools_industry', 'practical_fit')
    payload = {'role_summary': '工程研发', 'caps': [], 'hard_gaps': [], 'reason': '基于简历证据评分', 'missing': ''}
    payload.update({key: {'score': value, 'evidence': '已核对的具体项目证据'} for key, value in zip(keys, points)})
    result = scorer._validated_score_result(json.dumps(payload, ensure_ascii=False))
    assert result is not None and result.structured
    return result


class ManualLabelsScoringTests(unittest.TestCase):
    def run_score(self, db_path, result, during_request=None, prefilter=(100, '通过')):
        def request(*args):
            if during_request:
                during_request()
            return scorer.ScoreOutcome(result=result)

        with patch.object(scorer, 'get_db', side_effect=lambda: get_db(db_path)), \
             patch.object(scorer, '_load_resume', return_value='真实项目经历'), \
             patch.object(scorer, 'quick_score', return_value=prefilter), \
             patch.object(scorer, '_score_job_with_ai', side_effect=request), \
             patch.object(scorer, 'console', Console(file=io.StringIO())):
            scorer.score_jobs({'ai': {'scoring_concurrency': 1}, 'scoring': {'threshold': 60}})

    def test_every_manual_status_gets_a_score_and_trace_without_being_overwritten(self):
        for status in ('sent', 'ready', 'filtered', 'skipped', 'rejected'):
            for high in (True, False):
                with self.subTest(status=status, high=high), tempfile.TemporaryDirectory() as tmp:
                    db_path = Path(tmp) / 'jobs.db'
                    db = get_db(db_path)
                    insert_job(db, {'id': 'job', 'title': '工程师', 'company': '测试公司'})
                    update_jobs_manual_status(db, ['job'], status)
                    self.assertEqual([j['id'] for j in select_scoring_jobs(db)], ['job'])
                    db.close()
                    result = assessment(high)
                    self.run_score(db_path, result)
                    db = get_db(db_path)
                    try:
                        row = db.execute("SELECT status,score,manual_labelled FROM jobs WHERE id='job'").fetchone()
                        self.assertEqual(tuple(row), (status, result.score, 1))
                        self.assertEqual(get_score_trace(db, 'job')[1]['final_score'], result.score)
                        self.assertEqual(select_scoring_jobs(db), [])
                    finally:
                        db.close()

    def test_label_changed_while_ai_request_is_in_flight_wins(self):
        for label in ('sent', 'filtered', 'campus'):
            with self.subTest(label=label), tempfile.TemporaryDirectory() as tmp:
                db_path = Path(tmp) / 'jobs.db'
                db = get_db(db_path)
                insert_job(db, {'id': 'job', 'title': '工程师', 'company': '测试公司'})
                db.close()
                edit_calls = []

                def edit():
                    edit_calls.append(label)
                    other_connection = get_db(db_path)
                    try:
                        if label == 'campus':
                            update_jobs_recruitment_type(other_connection, ['job'], label)
                        else:
                            update_jobs_manual_status(other_connection, ['job'], label)
                    finally:
                        other_connection.close()

                self.run_score(db_path, assessment(), edit)
                db = get_db(db_path)
                try:
                    row = db.execute("SELECT status,score,recruitment_type FROM jobs WHERE id='job'").fetchone()
                    self.assertEqual(row['status'], 'pending' if label == 'campus' else label)
                    self.assertEqual(row['score'], 82)
                    if label == 'campus':
                        self.assertEqual(row['recruitment_type'], 'campus')
                    self.assertEqual(select_scoring_jobs(db), [])
                finally:
                    db.close()
                self.run_score(db_path, assessment(), edit)
                self.assertEqual(edit_calls, [label])

    def test_prefilter_only_updates_the_assessment_of_a_manually_labelled_job(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'jobs.db'
            db = get_db(path)
            insert_job(db, {'id': 'job', 'title': '工程师', 'company': '测试公司'})
            update_jobs_manual_status(db, ['job'], 'sent')
            db.close()
            self.run_score(path, assessment(), prefilter=(0, '硬性条件不符'))
            db = get_db(path)
            try:
                row = db.execute("SELECT status,score,score_reason FROM jobs WHERE id='job'").fetchone()
                self.assertEqual(row['status'], 'sent')
                self.assertEqual(row['score'], 0)
                self.assertIn('硬性条件不符', row['score_reason'])
                self.assertEqual(select_scoring_jobs(db), [])
            finally:
                db.close()

    def test_existing_manual_history_is_migrated_without_losing_labels(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'jobs.db'
            db = get_db(path)
            insert_job(db, {'id': 'old', 'title': '工程师', 'company': '测试公司'})
            update_jobs_manual_status(db, ['old'], 'rejected')
            db.execute('ALTER TABLE jobs DROP COLUMN manual_labelled')
            db.commit()
            db.close()
            db = get_db(path)
            try:
                self.assertEqual(tuple(db.execute("SELECT status,manual_labelled FROM jobs WHERE id='old'").fetchone()), ('rejected', 1))
            finally:
                db.close()


if __name__ == '__main__':
    unittest.main()
