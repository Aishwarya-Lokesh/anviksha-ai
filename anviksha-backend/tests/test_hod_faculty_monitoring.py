"""Phase 2: Faculty Monitoring & Faculty Alerts — department isolation,
role-guarding, and cross-department 404 on faculty detail."""
from tests.conftest import auth_headers


def test_faculty_overview_is_department_scoped(client, two_department_seed):
    seed = two_department_seed
    resp_a = client.get("/hod/intelligence/faculty/overview", headers=auth_headers(seed["hod_a"].id))
    assert resp_a.status_code == 200
    body_a = resp_a.json()
    assert body_a["total_faculty"] == 1  # only Faculty A, never Faculty B
    assert body_a["subjects_being_taught"] == 1

    resp_b = client.get("/hod/intelligence/faculty/overview", headers=auth_headers(seed["hod_b"].id))
    body_b = resp_b.json()
    assert body_b["total_faculty"] == 1  # only Faculty B


def test_faculty_table_never_leaks_other_department(client, two_department_seed):
    seed = two_department_seed
    resp_a = client.get("/hod/intelligence/faculty", headers=auth_headers(seed["hod_a"].id))
    names_a = {f["name"] for f in resp_a.json()["faculty"]}
    assert "Faculty A" in names_a
    assert "Faculty B" not in names_a

    # No ranking: default order must be by name, and no score field should exist.
    for row in resp_a.json()["faculty"]:
        assert "score" not in row
        assert "rank" not in row


def test_faculty_detail_404s_across_department_boundary(client, two_department_seed):
    seed = two_department_seed
    # HOD A must see their own faculty member's detail...
    resp_own = client.get(f"/hod/intelligence/faculty/{seed['faculty_a'].id}", headers=auth_headers(seed["hod_a"].id))
    assert resp_own.status_code == 200
    assert resp_own.json()["name"] == "Faculty A"

    # ...but never department B's faculty member, even with a valid ID.
    resp_cross = client.get(f"/hod/intelligence/faculty/{seed['faculty_b'].id}", headers=auth_headers(seed["hod_a"].id))
    assert resp_cross.status_code == 404


def test_alerts_never_include_attention_required_or_ranking(client, two_department_seed):
    seed = two_department_seed
    resp = client.get("/hod/intelligence/alerts", headers=auth_headers(seed["hod_a"].id))
    assert resp.status_code == 200
    for alert in resp.json()["alerts"]:
        assert alert["type"] in ("missing_attendance", "pending_marks")
        assert "basis" in alert and "explanation" in alert


def test_faculty_endpoints_reject_non_hod_roles(client, db_session, two_department_seed):
    from app.models import models as m

    teacher_user = m.User(email="teacher2@test.local", hashed_password="x", role="teacher")
    db_session.add(teacher_user)
    db_session.commit()

    for path in ["/hod/intelligence/faculty/overview", "/hod/intelligence/faculty", "/hod/intelligence/alerts"]:
        resp = client.get(path, headers=auth_headers(teacher_user.id))
        assert resp.status_code == 403, path
