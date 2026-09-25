"""Phase 6: briefing endpoints — department isolation, cross-dept 404, and
role guard. The isolated test DB has no GROQ_API_KEY configured, so these
exercise the deterministic-fallback path — itself a real code path that
runs whenever the AI isn't connected."""
from tests.conftest import auth_headers


def test_department_briefing_is_grounded_and_department_scoped(client, two_department_seed):
    seed = two_department_seed
    resp = client.get("/hod/intelligence/briefing", headers=auth_headers(seed["hod_a"].id))
    assert resp.status_code == 200
    body = resp.json()
    assert body["source"] in ("ai", "deterministic")
    assert "briefing" in body and body["briefing"]
    assert body["department"] == "Information Science & Engineering (TEST)"


def test_faculty_briefing_404s_across_department_boundary(client, two_department_seed):
    seed = two_department_seed
    resp = client.get(f"/hod/intelligence/faculty/{seed['faculty_b'].id}/briefing", headers=auth_headers(seed["hod_a"].id))
    assert resp.status_code == 404


def test_briefing_endpoints_reject_non_hod(client, db_session, two_department_seed):
    from app.models import models as m

    student_user = m.User(email="student4@test.local", hashed_password="x", role="student")
    db_session.add(student_user)
    db_session.commit()

    resp = client.get("/hod/intelligence/briefing", headers=auth_headers(student_user.id))
    assert resp.status_code == 403
