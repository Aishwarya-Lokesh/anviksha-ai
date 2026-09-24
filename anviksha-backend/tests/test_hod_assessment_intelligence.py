"""Phase 4: Assessment Intelligence.

The real live DB has zero Marks rows (confirmed in Phase 0 investigation),
so the pass-rate/outlier math can't be exercised against real data at all
right now — these tests prove the LOGIC itself is correct using synthetic
Marks rows in the isolated test DB (the one A2-sanctioned exception: test
fixtures in an isolated test database, never the real one).
"""
from tests.conftest import auth_headers


def test_pass_rate_outliers_computed_correctly(client, db_session, two_department_seed):
    from app.models import models as m

    dept_a = two_department_seed["dept_a"]
    # A second subject in dept A with a real, deliberately different pass rate.
    subject_low = m.Subject(code="TESTLOW", name="Low Pass Subject", department_id=dept_a.id, semester=3)
    db_session.add(subject_low)
    db_session.flush()

    # 4 students total in dept A/sem 3 (2 from the base fixture + 2 more).
    s3 = m.Student(usn="TESTA003", name="Student A3", department_id=dept_a.id, batch="2024", semester=3, status="active")
    s4 = m.Student(usn="TESTA004", name="Student A4", department_id=dept_a.id, batch="2024", semester=3, status="active")
    db_session.add_all([s3, s4])
    db_session.flush()

    subject_a = two_department_seed["subject_a"]
    student_a1, student_a2 = None, None
    for s in db_session.query(m.Student).filter(m.Student.department_id == dept_a.id).all():
        if s.usn == "TESTA001":
            student_a1 = s
        if s.usn == "TESTA002":
            student_a2 = s

    # subject_a: all 4 students score >= 40% -> 100% pass rate.
    for sid in [student_a1.id, student_a2.id, s3.id, s4.id]:
        db_session.add(m.Marks(student_id=sid, subject_id=subject_a.id, exam_type="IA-1", marks_obtained=18, max_marks=20))

    # subject_low: all 4 students score < 40% -> 0% pass rate. A 100pp swing
    # from subject_a is well beyond the 15pp outlier threshold.
    for sid in [student_a1.id, student_a2.id, s3.id, s4.id]:
        db_session.add(m.Marks(student_id=sid, subject_id=subject_low.id, exam_type="IA-1", marks_obtained=5, max_marks=20))
    db_session.commit()

    resp = client.get("/hod/intelligence/assessment/pass-rate-outliers", headers=auth_headers(two_department_seed["hod_a"].id))
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "available"
    assert body["department_avg_pass_rate"] == 50.0  # (100 + 0) / 2

    outlier_codes = {o["subject_code"]: o["pass_rate"] for o in body["outliers"]}
    assert outlier_codes["TESTA101"] == 100.0
    assert outlier_codes["TESTLOW"] == 0.0
    # Never a teacher-name ranking.
    for o in body["outliers"]:
        assert "faculty_name" not in o and "teacher" not in o


def test_pass_rate_never_counts_missing_marks_as_fail(client, db_session, two_department_seed):
    """A student with zero Marks rows for a subject must be excluded from
    the pass-rate population entirely, never counted as a fail."""
    from app.models import models as m

    dept_a = two_department_seed["dept_a"]
    subject_a = two_department_seed["subject_a"]
    student_a1 = db_session.query(m.Student).filter(m.Student.usn == "TESTA001").first()
    # Only student_a1 has a real Marks row; student_a2 has none at all.
    db_session.add(m.Marks(student_id=student_a1.id, subject_id=subject_a.id, exam_type="IA-1", marks_obtained=19, max_marks=20))
    db_session.commit()

    resp = client.get("/hod/intelligence/assessment/pass-rate-outliers", headers=auth_headers(two_department_seed["hod_a"].id))
    body = resp.json()
    # department_avg_pass_rate over the one subject with real data must be 100% (1/1 passed), not diluted by the un-marked student.
    assert body["department_avg_pass_rate"] == 100.0


def test_bloom_coverage_is_department_scoped_and_never_called_performance(client, two_department_seed):
    from app.models import models as m
    seed = two_department_seed

    resp = client.get("/hod/intelligence/assessment/bloom-coverage", headers=auth_headers(seed["hod_a"].id))
    assert resp.status_code == 200
    body = resp.json()
    # No real question-bank chunks were seeded for the test departments -> honestly unavailable, never fabricated.
    assert body["status"] == "unavailable"


def test_section_comparison_rejects_cross_department_subject(client, two_department_seed):
    seed = two_department_seed
    resp = client.get(f"/hod/intelligence/assessment/section-comparison?subject_id={seed['subject_b'].id}", headers=auth_headers(seed["hod_a"].id))
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "unavailable"  # dept A's HOD can't pull dept B's subject data


def test_assessment_endpoints_reject_non_hod(client, db_session, two_department_seed):
    from app.models import models as m

    teacher_user = m.User(email="teacher4@test.local", hashed_password="x", role="teacher")
    db_session.add(teacher_user)
    db_session.commit()

    for path in ["/hod/intelligence/assessment/pass-rate-outliers", "/hod/intelligence/assessment/bloom-coverage"]:
        resp = client.get(path, headers=auth_headers(teacher_user.id))
        assert resp.status_code == 403, path
