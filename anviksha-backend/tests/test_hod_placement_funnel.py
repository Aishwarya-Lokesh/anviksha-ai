"""Phase 5: Placement Funnel — department isolation, 2-stage-only funnel,
and the reused CTC-tier rule."""
from tests.conftest import auth_headers


def _seed_placements(db_session, seed):
    from app.models import models as m

    student_a1 = db_session.query(m.Student).filter(m.Student.usn == "TESTA001").first()
    student_a2 = db_session.query(m.Student).filter(m.Student.usn == "TESTA002").first()
    student_b1 = db_session.query(m.Student).filter(m.Student.usn == "TESTB001").first()

    db_session.add_all([
        m.Placement(student_id=student_a1.id, placed=True, placement_type="Dream", ctc="12 LPA"),
        m.Placement(student_id=student_a2.id, placed=False),
        m.Placement(student_id=student_b1.id, placed=True, placement_type="Regular", ctc="4 LPA"),
    ])
    db_session.commit()


def test_placement_funnel_is_2_stage_and_department_scoped(client, db_session, two_department_seed):
    _seed_placements(db_session, two_department_seed)
    resp = client.get("/hod/intelligence/placement/funnel", headers=auth_headers(two_department_seed["hod_a"].id))
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "available"
    assert [s["stage"] for s in body["stages"]] == ["Tracked", "Placed"]
    assert body["stages"][0]["count"] == 2  # only dept A's 2 real Placement rows, never dept B's
    assert body["stages"][1]["count"] == 1


def test_placement_tiers_reuses_the_same_ctc_rule_as_admin(client, db_session, two_department_seed):
    _seed_placements(db_session, two_department_seed)
    resp = client.get("/hod/intelligence/placement/tiers", headers=auth_headers(two_department_seed["hod_a"].id))
    body = resp.json()
    assert body["status"] == "available"
    assert body["tiers"]["super_dream"] == 1  # dept A's one placed student at 12 LPA
    assert body["tiers"]["regular"] == 0


def test_cycle_comparison_reports_unavailable_with_fewer_than_2_cycles(client, two_department_seed):
    # No admission_year set on the seeded students -> no real cycle at all.
    resp = client.get("/hod/intelligence/placement/cycle-comparison", headers=auth_headers(two_department_seed["hod_a"].id))
    body = resp.json()
    assert body["status"] == "unavailable"
    assert body["reason_unavailable"] == "Historical cycle comparison will appear when sufficient cycle data is available."


def test_placement_endpoints_reject_non_hod(client, db_session, two_department_seed):
    from app.models import models as m

    teacher_user = m.User(email="teacher5@test.local", hashed_password="x", role="teacher")
    db_session.add(teacher_user)
    db_session.commit()

    for path in ["/hod/intelligence/placement/funnel", "/hod/intelligence/placement/tiers", "/hod/intelligence/placement/cycle-comparison"]:
        resp = client.get(path, headers=auth_headers(teacher_user.id))
        assert resp.status_code == 403, path
