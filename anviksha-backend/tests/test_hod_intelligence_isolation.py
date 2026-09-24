"""Phase 1, item 8: department isolation test.

Uses an isolated in-memory test database (never the real DB — see
conftest.py) seeded with two departments. Asserts that department A's HOD
sees department A's real attendance data, and that department B's data
never appears in department A's response (and vice versa).
"""
from tests.conftest import auth_headers


def test_hod_sees_only_own_department_attendance_today(client, two_department_seed):
    seed = two_department_seed

    resp_a = client.get("/hod/intelligence/attendance/today", headers=auth_headers(seed["hod_a"].id))
    assert resp_a.status_code == 200
    body_a = resp_a.json()
    assert body_a["department"] == "Information Science & Engineering (TEST)"
    # Dept A's real session (1 present, 1 absent) must be visible and correct.
    assert body_a["headline"]["status"] == "available"
    assert body_a["headline"]["basis"]["numerator"] == 1
    assert body_a["headline"]["basis"]["denominator"] == 2
    # Dept B's subject must never appear in dept A's breakdown.
    codes_a = {row["subject_code"] for row in body_a["breakdown"]}
    assert "TESTA101" in codes_a
    assert "TESTB101" not in codes_a

    resp_b = client.get("/hod/intelligence/attendance/today", headers=auth_headers(seed["hod_b"].id))
    assert resp_b.status_code == 200
    body_b = resp_b.json()
    assert body_b["department"] == "Computer Science & Engineering (TEST)"
    # Dept B has zero real sessions today -> Pending, never a borrowed number from dept A.
    assert body_b["headline"]["status"] == "pending"
    assert body_b["headline"]["value"] is None
    codes_b = {row["subject_code"] for row in body_b["breakdown"]}
    assert "TESTB101" in codes_b
    assert "TESTA101" not in codes_b


def test_hod_sees_only_own_department_trend(client, two_department_seed):
    seed = two_department_seed
    resp_a = client.get("/hod/intelligence/attendance/trend?days=7", headers=auth_headers(seed["hod_a"].id))
    assert resp_a.status_code == 200
    points_a = resp_a.json()["points"]
    today_point = points_a[-1]
    assert today_point["status"] == "available"
    assert today_point["pct"] == 50.0  # 1 present / 2 total

    resp_b = client.get("/hod/intelligence/attendance/trend?days=7", headers=auth_headers(seed["hod_b"].id))
    points_b = resp_b.json()["points"]
    assert points_b[-1]["status"] == "pending"  # dept B has no real session today


def test_teacher_and_student_roles_get_403(client, db_session, two_department_seed):
    from app.models import models as m

    teacher_user = m.User(email="teacher@test.local", hashed_password="x", role="teacher")
    student_user = m.User(email="student@test.local", hashed_password="x", role="student")
    db_session.add_all([teacher_user, student_user])
    db_session.commit()

    resp_teacher = client.get("/hod/intelligence/attendance/today", headers=auth_headers(teacher_user.id))
    assert resp_teacher.status_code == 403

    resp_student = client.get("/hod/intelligence/attendance/today", headers=auth_headers(student_user.id))
    assert resp_student.status_code == 403

    resp_unauth = client.get("/hod/intelligence/attendance/today")
    assert resp_unauth.status_code == 401
