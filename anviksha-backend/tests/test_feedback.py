"""Anonymous feedback: who may rate whom, that answers carry no student, and
who may see what."""
from app.models import models as m
from tests.conftest import auth_headers
from tests.test_missing_endpoints import campus  # noqa: F401  (shared fixture)

GOOD = {"clarity": 5, "knowledge": 4, "pace": 4, "support": 3, "overall": 4}


def _post(client, headers, campus_, ratings=GOOD, comment=None, subject=None, faculty=None):  # noqa: ANN001
    return client.post("/student/feedback", headers=headers, json={
        "subject_id": (subject or campus_["sub1"]).id, "faculty_id": (faculty or campus_["t1"]).id,
        "ratings": ratings, "comment": comment,
    })


def test_student_sees_only_their_courses_and_can_rate_once(client, campus):  # noqa: F811
    h = campus["h"]
    listing = client.get("/student/feedback", headers=h["s1"]).json()
    assert [(c["code"], c["faculty_name"], c["submitted"]) for c in listing["courses"]] == [("TST701", "Teacher One", False)]
    assert [q["key"] for q in listing["questions"]] == ["clarity", "knowledge", "pace", "support", "overall"]

    assert _post(client, h["s1"], campus, comment="  Clear lectures  ").status_code == 200
    assert client.get("/student/feedback", headers=h["s1"]).json()["courses"][0]["submitted"] is True
    assert _post(client, h["s1"], campus).status_code == 409                     # once only
    assert _post(client, h["s3"], campus).status_code == 403                     # not taught this subject
    assert _post(client, h["s2"], campus, faculty=campus["t2"]).status_code == 403   # not taught by this teacher
    assert _post(client, h["t1"], campus).status_code == 403                     # teachers can't submit


def test_ratings_are_validated(client, campus):  # noqa: F811
    h = campus["h"]
    assert _post(client, h["s1"], campus, ratings={**GOOD, "overall": 6}).status_code == 400
    assert _post(client, h["s1"], campus, ratings={k: v for k, v in GOOD.items() if k != "pace"}).status_code == 400
    assert _post(client, h["s1"], campus, ratings={**GOOD, "extra": 3}).status_code == 400
    assert _post(client, h["s1"], campus, comment="x" * 1001).status_code == 400
    assert campus["db"].query(m.Feedback).count() == 0


def test_answers_are_stored_without_the_student(client, campus):  # noqa: F811
    db, h = campus["db"], campus["h"]
    _post(client, h["s1"], campus, comment="Good")
    row = db.query(m.Feedback).one()
    assert not any("student" in column for column in m.Feedback.__table__.columns.keys())
    assert (row.batch, row.semester, row.overall, row.comment) == ("2023", 7, 4, "Good")
    tick = db.query(m.FeedbackSubmission).one()
    assert tick.student_id == campus["s1"].id
    # the tick holds no answers and no time that could be matched to the answer row
    assert set(m.FeedbackSubmission.__table__.columns.keys()) == {"id", "student_id", "subject_id", "faculty_id", "semester"}


def test_teacher_sees_only_own_totals_and_small_groups_stay_hidden(client, campus):  # noqa: F811
    db, h = campus["db"], campus["h"]
    _post(client, h["s1"], campus, comment="Could go slower")
    _post(client, h["s2"], campus, ratings={**GOOD, "overall": 2})
    mine = client.get("/teacher/feedback", headers=h["t1"]).json()
    assert (mine["responses"], mine["hidden"], mine["average"], mine["subjects"][0]["comments"]) == (2, True, None, [])

    # a third response reaches the threshold
    db.add(m.Feedback(subject_id=campus["sub1"].id, faculty_id=campus["t1"].id, batch="2023", semester=7,
                      clarity=5, knowledge=5, pace=5, support=5, overall=5, comment=None))
    db.commit()
    mine = client.get("/teacher/feedback", headers=h["t1"]).json()
    assert (mine["responses"], mine["hidden"], mine["average"]) == (3, False, 3.67)
    subject = mine["subjects"][0]
    assert subject["code"] == "TST701" and [c["text"] for c in subject["comments"]] == ["Could go slower"]
    assert {d["rating"]: d["count"] for d in subject["distribution"]} == {5: 1, 4: 1, 3: 0, 2: 1, 1: 0}
    assert "student" not in str(mine).lower()                                   # nothing identifies who answered

    other = client.get("/teacher/feedback", headers=h["t2"]).json()
    assert other["responses"] == 0 and other["subjects"] == []
    assert client.get("/teacher/feedback", headers=h["s1"]).status_code == 403
    assert client.get("/hod/feedback", headers=h["t1"]).status_code == 403


def test_hod_sees_department_and_nobody_elses(client, campus):  # noqa: F811
    h = campus["h"]
    _post(client, h["s1"], campus, comment="Helpful")
    dept = client.get("/hod/feedback", headers=h["hod"]).json()
    assert (dept["responses"], dept["average"], dept["batches"]) == (1, 4.0, ["2023"])
    rows = {f["name"]: (f["responses"], f["average"], f["subjects"]) for f in dept["faculty"]}
    assert rows == {"Teacher One": (1, 4.0, ["TST701"]), "Teacher Two": (0, None, [])}

    detail = client.get(f"/hod/feedback/{campus['t1'].id}", headers=h["hod"]).json()
    assert detail["hidden"] is False and detail["subjects"][0]["comments"][0]["text"] == "Helpful"   # HOD sees even one response
    assert client.get("/hod/feedback?batch=2024", headers=h["hod"]).json()["responses"] == 0

    assert client.get("/hod/feedback", headers=h["hod_cse"]).json()["responses"] == 0
    assert client.get(f"/hod/feedback/{campus['t1'].id}", headers=h["hod_cse"]).status_code == 404


def test_teacher_is_notified_without_learning_who(client, campus):  # noqa: F811
    db, h = campus["db"], campus["h"]
    _post(client, h["s1"], campus)
    teacher_login = db.query(m.User).filter(m.User.email == "t1@test.local").one()
    messages = [n.message for n in db.query(m.Notification).filter(m.Notification.user_id == teacher_login.id)]
    assert messages == ["New anonymous feedback received for TST701."]
