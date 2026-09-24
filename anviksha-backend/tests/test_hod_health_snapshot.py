"""Phase 3: Department Health Snapshot — department isolation and role guard."""
from tests.conftest import auth_headers


def test_health_snapshot_is_department_scoped(client, two_department_seed):
    seed = two_department_seed
    resp_a = client.get("/hod/intelligence/health-snapshot", headers=auth_headers(seed["hod_a"].id))
    assert resp_a.status_code == 200
    body_a = resp_a.json()
    # Dept A has a real session today (1 present / 2 total from the seed).
    assert body_a["attendance_today"]["status"] == "available"
    assert body_a["attendance_today"]["value"] == 50.0

    resp_b = client.get("/hod/intelligence/health-snapshot", headers=auth_headers(seed["hod_b"].id))
    body_b = resp_b.json()
    # Dept B has zero real sessions today -> pending, never borrowed from dept A.
    assert body_b["attendance_today"]["status"] == "pending"


def test_at_risk_detail_never_leaks_other_department_students(client, two_department_seed):
    seed = two_department_seed
    resp = client.get("/hod/intelligence/at-risk-detail", headers=auth_headers(seed["hod_a"].id))
    assert resp.status_code == 200
    usns = {s["usn"] for s in resp.json()["students"]}
    assert "TESTB001" not in usns


def test_health_snapshot_rejects_non_hod(client, db_session, two_department_seed):
    from app.models import models as m

    student_user = m.User(email="student3@test.local", hashed_password="x", role="student")
    db_session.add(student_user)
    db_session.commit()

    for path in ["/hod/intelligence/health-snapshot", "/hod/intelligence/at-risk-detail", "/hod/intelligence/pending-documents"]:
        resp = client.get(path, headers=auth_headers(student_user.id))
        assert resp.status_code == 403, path
