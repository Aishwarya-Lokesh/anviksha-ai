"""Feedback switch, student planner and calendar, announcements, notification
links, account deactivation, and the admin management endpoints."""
import io

import pytest

from app.core.security import hash_password
from app.models import models as m
from tests.conftest import auth_headers
from tests.test_missing_endpoints import campus, placed  # noqa: F401  (shared fixtures)

GOOD = {"clarity": 5, "knowledge": 4, "pace": 4, "support": 3, "overall": 4}


@pytest.fixture()
def admin(campus):  # noqa: F811
    db = campus["db"]
    user = m.User(email="admin@test.local", hashed_password=hash_password("AdminPass1"), role="admin")
    db.add(user)
    db.commit()
    return {**campus, "admin": user, "ah": auth_headers(user.id)}


# ---------- feedback is closed until switched on ----------

def test_feedback_is_closed_until_the_teacher_opens_it(client, campus):  # noqa: F811
    h, sub1, t1 = campus["h"], campus["sub1"], campus["t1"]
    body = {"subject_id": sub1.id, "faculty_id": t1.id, "ratings": GOOD}
    assert client.get("/student/feedback", headers=h["s1"]).json()["courses"][0]["open"] is False
    assert client.post("/student/feedback", headers=h["s1"], json=body).status_code == 403

    rows = client.get("/teacher/feedback/windows", headers=h["t1"]).json()
    assert [(r["code"], r["open"], r["responses"]) for r in rows] == [("TST701", False, 0)]
    assert client.put("/teacher/feedback/windows", headers=h["t2"], json={"subject_id": sub1.id, "open": True}).status_code == 404   # not their subject
    assert client.put("/teacher/feedback/windows", headers=h["s1"], json={"subject_id": sub1.id, "open": True}).status_code == 403
    assert client.put("/teacher/feedback/windows", headers=h["t1"], json={"subject_id": sub1.id, "open": True}).json()["open"] is True

    assert client.get("/student/feedback", headers=h["s1"]).json()["courses"][0]["open"] is True
    assert client.post("/student/feedback", headers=h["s1"], json=body).status_code == 200
    notes = [n["message"] for n in client.get("/notifications", headers=h["s2"]).json()["notifications"]]
    assert "Feedback is now open for TST701." in notes                       # classmates are told it opened

    client.put("/teacher/feedback/windows", headers=h["t1"], json={"subject_id": sub1.id, "open": False})
    assert client.post("/student/feedback", headers=h["s2"], json=body).status_code == 403        # closed again
    assert client.get("/teacher/feedback/windows", headers=h["t1"]).json()[0]["responses"] == 1   # answers are kept


def test_hod_can_open_feedback_for_their_own_faculty_only(client, campus):  # noqa: F811
    h, sub1, t1 = campus["h"], campus["sub1"], campus["t1"]
    body = {"faculty_id": t1.id, "subject_id": sub1.id, "open": True}
    assert client.put("/hod/feedback/windows", headers=h["hod_cse"], json=body).status_code == 404
    assert client.put("/hod/feedback/windows", headers=h["hod"], json=body).json()["open"] is True
    assert client.get(f"/hod/feedback/{t1.id}/windows", headers=h["hod"]).json()[0]["open"] is True
    assert client.get(f"/hod/feedback/{t1.id}/windows", headers=h["hod_cse"]).status_code == 404


# ---------- student planner and calendar ----------

def test_planner_notes_and_deadlines_are_private_and_validated(client, campus):  # noqa: F811
    h = campus["h"]
    note = client.post("/student/planner", headers=h["s1"], json={"kind": "note", "title": "Revision plan", "body": "**Unit 1** first", "subject": "CN"}).json()
    due = client.post("/student/planner", headers=h["s1"], json={"kind": "deadline", "title": "Mini project report", "due_at": "2030-03-10T17:00", "priority": "high", "remind": True}).json()
    assert (note["kind"], note["due_at"]) == ("note", None) and (due["due_at"], due["priority"], due["remind"]) == ("2030-03-10T17:00", "high", True)

    mine = client.get("/student/planner", headers=h["s1"]).json()
    assert [n["title"] for n in mine["notes"]] == ["Revision plan"] and [d["title"] for d in mine["deadlines"]] == ["Mini project report"]
    assert client.get("/student/planner", headers=h["s2"]).json() == {"notes": [], "deadlines": []}

    bad = lambda **body: client.post("/student/planner", headers=h["s1"], json=body).status_code  # noqa: E731
    assert bad(kind="deadline", title="No date") == 400
    assert bad(kind="note", title="   ") == 400
    assert bad(kind="event", title="x") == 400
    assert bad(kind="deadline", title="x", due_at="tomorrow") == 400
    assert bad(kind="deadline", title="x", due_at="2030-01-01T10:00", priority="urgent") == 400

    assert client.patch(f"/student/planner/{due['id']}", headers=h["s2"], json={"done": True}).status_code == 404
    assert client.patch(f"/student/planner/{due['id']}", headers=h["s1"], json={"done": True}).json()["done"] is True
    assert client.patch(f"/student/planner/{note['id']}", headers=h["s1"], json={"body": "changed"}).json()["body"] == "changed"
    assert client.delete(f"/student/planner/{note['id']}", headers=h["s2"]).status_code == 404
    assert client.delete(f"/student/planner/{note['id']}", headers=h["s1"]).status_code == 200
    assert client.get("/student/planner", headers=h["t1"]).status_code == 403


def test_calendar_combines_own_and_class_deadlines(client, campus):  # noqa: F811
    from datetime import datetime, timedelta
    h, a1 = campus["h"], campus["a1"]
    soon = (datetime.now() + timedelta(days=2)).strftime("%Y-%m-%d")
    client.post("/student/planner", headers=h["s1"], json={"kind": "deadline", "title": "My own task", "due_at": f"{soon}T09:30", "priority": "medium"})
    client.post("/student/planner", headers=h["s1"], json={"kind": "deadline", "title": "Far away", "due_at": "2035-01-01T10:00"})
    client.post("/teacher/notes", headers=h["t1"], data={"teaching_assignment_id": a1.id, "kind": "deadline", "title": "Assignment 1", "due_date": soon})

    cal = client.get("/student/calendar", headers=h["s1"]).json()
    assert [(e["title"], e["source"]) for e in cal["events"]] == [("My own task", "mine"), ("Assignment 1", "class"), ("Far away", "mine")]
    assert sorted(e["title"] for e in cal["due_soon"]) == ["Assignment 1", "My own task"]
    other = client.get("/student/calendar", headers=h["s3"]).json()
    assert other["events"] == []                                             # another class, nothing of s1's


# ---------- announcements ----------

def test_announcements_reach_only_their_audience(client, admin):
    h, ah = admin["h"], admin["ah"]
    titles = lambda who: [a["title"] for a in client.get("/announcements", headers=who).json()]  # noqa: E731

    assert client.post("/announcements", headers=h["t1"], json={"title": "Class test", "body": "On Friday"}).status_code == 400          # must pick a class
    assert client.post("/announcements", headers=h["t1"], json={"title": "Class test", "body": "On Friday", "batch": "2024", "semester": 5}).status_code == 400   # not their class
    r = client.post("/announcements", headers=h["t1"], json={"title": "Class test", "body": "On Friday", "batch": "2023", "semester": 7, "audience": "everyone"})
    assert r.status_code == 200 and r.json()["audience"] == "students" and r.json()["notified"] == 2       # a teacher only ever reaches students

    client.post("/announcements", headers=h["hod"], json={"title": "Faculty meeting", "body": "Monday 10 am", "audience": "faculty"})
    client.post("/announcements", headers=h["hod"], json={"title": "Dept fest", "body": "All welcome", "audience": "everyone"})
    client.post("/announcements", headers=ah, json={"title": "Holiday", "body": "College closed", "audience": "everyone"})

    assert titles(h["s1"]) == ["Holiday", "Dept fest", "Class test"]
    assert titles(h["s3"]) == ["Holiday", "Dept fest"]                        # other class: no class test
    assert titles(h["t2"]) == ["Holiday", "Dept fest", "Faculty meeting"]     # faculty notices, not another teacher's class notice
    assert "Class test" in titles(h["t1"])                                    # the author sees their own
    assert titles(h["hod_cse"]) == ["Holiday"]                                # other department sees only the institution-wide one
    assert len(titles(ah)) == 4

    assert client.post("/announcements", headers=h["s1"], json={"title": "x", "body": "y"}).status_code == 403
    assert client.post("/announcements", headers=h["hod"], json={"title": "", "body": "y"}).status_code == 400
    class_test = next(a for a in client.get("/announcements", headers=h["t1"]).json() if a["title"] == "Class test")
    assert client.delete(f"/announcements/{class_test['id']}", headers=h["t2"]).status_code == 404
    assert client.delete(f"/announcements/{class_test['id']}", headers=h["t1"]).status_code == 200
    assert "Class test" not in titles(h["s1"])


def test_notifications_carry_a_link_and_are_marked_one_at_a_time(client, admin):
    h = admin["h"]
    client.post("/announcements", headers=h["hod"], json={"title": "Dept fest", "body": "All welcome", "audience": "students"})
    data = client.get("/notifications", headers=h["s1"]).json()
    first = data["notifications"][0]
    assert (data["unread_count"], first["message"], first["link"], first["read"]) == (1, "New announcement: Dept fest", "/student/announcements", False)
    client.patch(f"/notifications/{first['id']}/read", headers=h["s2"])        # someone else cannot mark it
    assert client.get("/notifications", headers=h["s1"]).json()["unread_count"] == 1
    client.patch(f"/notifications/{first['id']}/read", headers=h["s1"])
    assert client.get("/notifications", headers=h["s1"]).json()["unread_count"] == 0

    from app.routers.notifications import link_for
    assert link_for("teacher", "New anonymous feedback received for X.") == "/teacher/performance?view=feedback"
    assert link_for("student", "Feedback is now open for X.") == "/student/feedback"
    assert link_for("student", "New deadline for X: Y") == "/student/notes"
    assert link_for("student", "Your Bonafide request is now: Collectable") == "/student/documents"


# ---------- accounts ----------

def test_admin_manages_logins(client, admin):
    db, h, ah = admin["db"], admin["h"], admin["ah"]
    new_student = m.Student(usn="T23IS099", name="Farah Z", department_id=admin["ise"].id, batch="2023", semester=7, status="active")
    db.add(new_student)
    db.commit()

    r = client.post("/admin/logins", headers=ah, json={"email": "Farah@Test.Local", "role": "student", "student_id": new_student.id})
    assert r.status_code == 200 and r.json()["email"] == "farah@test.local" and len(r.json()["temporary_password"]) == 12
    password, login_id = r.json()["temporary_password"], r.json()["id"]
    assert client.post("/auth/login", json={"email": "farah@test.local", "password": password}).status_code == 200
    assert client.post("/admin/logins", headers=ah, json={"email": "farah2@test.local", "role": "student", "student_id": new_student.id}).status_code == 400   # already has one
    assert client.post("/admin/logins", headers=ah, json={"email": "farah@test.local", "role": "admin"}).status_code == 400
    assert client.post("/admin/logins", headers=ah, json={"email": "nope", "role": "admin"}).status_code == 400
    assert client.post("/admin/logins", headers=ah, json={"email": "h@test.local", "role": "hod"}).status_code == 400          # needs a department

    listing = client.get("/admin/logins?q=farah", headers=ah).json()
    assert [(x["email"], x["name"], x["detail"], x["active"]) for x in listing["logins"]] == [("farah@test.local", "Farah Z", "T23IS099", True)]

    # deactivate: cannot sign in, and an existing session stops working
    token = {"Authorization": "Bearer " + client.post("/auth/login", json={"email": "farah@test.local", "password": password}).json()["access_token"]}
    assert client.patch(f"/admin/logins/{login_id}", headers=ah, json={"active": False}).json()["active"] is False
    assert client.post("/auth/login", json={"email": "farah@test.local", "password": password}).status_code == 403
    assert client.get("/student/dashboard", headers=token).status_code == 401
    client.patch(f"/admin/logins/{login_id}", headers=ah, json={"active": True})

    fresh = client.post(f"/admin/logins/{login_id}/reset-password", headers=ah).json()["temporary_password"]
    assert fresh != password and client.post("/auth/login", json={"email": "farah@test.local", "password": password}).status_code == 401
    assert client.post("/auth/login", json={"email": "farah@test.local", "password": fresh}).status_code == 200

    assert client.patch(f"/admin/logins/{admin['admin'].id}", headers=ah, json={"active": False}).status_code == 400       # not yourself
    teacher_login = db.query(m.User).filter(m.User.email == "t2@test.local").one()
    assert client.patch(f"/admin/logins/{teacher_login.id}", headers=ah, json={"role": "hod"}).json()["role"] == "hod"      # department taken from their faculty record
    assert client.patch(f"/admin/logins/{teacher_login.id}", headers=ah, json={"role": "student"}).status_code == 400
    assert client.get("/admin/logins", headers=h["hod"]).status_code == 403
    actions = [r["action"] for r in client.get("/admin/activity-logs", headers=ah).json()]
    assert any("Created student login farah@test.local" in a for a in actions) and any("deactivated" in a for a in actions) and any("Reset the password" in a for a in actions)


def test_bulk_student_import_checks_first_and_writes_only_valid_rows(client, admin):
    db, ah = admin["db"], admin["ah"]
    csv_text = "USN,Name,Batch,Semester,CGPA\nT25IS001,New One,2025,3,8.1\nT25IS002,New Two,2025,3,\nT23IS001,Asha Again,2023,7,8\nBADUSN,Bad Row,2025,3,7\nT25IS003,,2025,9,11\nT25IS001,Repeat,2025,3,7\n"
    upload = lambda **form: client.post("/admin/import/students", headers=ah, data=form, files={"file": ("students.csv", io.BytesIO(csv_text.encode()), "text/csv")})  # noqa: E731

    preview = upload().json()
    assert (preview["rows"], preview["valid"], preview["invalid"], preview["applied"], preview["created"]) == (6, 2, 4, False, 0)
    problems = {r["row"]: r["problems"] for r in preview["report"] if not r["ok"]}
    assert "already exists" in problems[4][0] and "usual format" in problems[5][0] and "more than once" in problems[7][0]
    assert len(problems[6]) == 3                                              # missing name, bad semester, bad CGPA
    assert db.query(m.Student).filter(m.Student.usn.like("T25%")).count() == 0   # a preview writes nothing

    done = upload(apply="true", create_logins="true").json()
    assert (done["created"], [x["usn"] for x in done["logins"]]) == (2, ["T25IS001", "T25IS002"])
    created = db.query(m.Student).filter(m.Student.usn == "T25IS001").one()
    assert (created.name, created.batch, created.semester, created.cgpa, created.status) == ("New One", "2025", 3, 8.1, "active")
    assert client.post("/auth/login", json={"email": "t25is001@anviksha.ai", "password": done["logins"][0]["temporary_password"]}).status_code == 200
    assert upload(apply="true").json()["created"] == 0                         # running it again adds nothing
    assert client.post("/admin/import/students", headers=ah, files={"file": ("x.pdf", b"%PDF", "application/pdf")}).status_code == 400
    assert client.post("/admin/import/students", headers=admin["h"]["hod"], files={"file": ("s.csv", b"usn,name", "text/csv")}).status_code == 403


def test_departments_subjects_and_allocation(client, admin):
    h, ah = admin["h"], admin["ah"]
    assert client.post("/admin/departments", headers=ah, json={"name": "Mechanical Engineering"}).status_code == 200
    assert client.post("/admin/departments", headers=ah, json={"name": "mechanical engineering"}).status_code == 400
    assert client.post("/admin/departments", headers=h["hod"], json={"name": "Civil Engineering"}).status_code == 403

    structure = {d["name"]: d for d in client.get("/admin/structure", headers=ah).json()}
    ise = structure["ISE (TEST)"]
    assert (ise["faculty"], ise["subjects"], ise["students"], ise["subjects_without_faculty"]) == (2, 2, 4, 0)
    assert [(b["batch"], b["students"], b["active"], b["semesters"]) for b in ise["batches"]] == [("2024", 1, 1, [5]), ("2023", 2, 2, [7]), ("2021", 1, 0, [])]

    made = client.post("/admin/subjects", headers=ah, json={"code": "tst702", "name": "New Subject", "semester": 7, "department_id": admin["ise"].id})
    assert made.status_code == 200 and made.json()["code"] == "TST702" and made.json()["faculty_name"] is None
    assert client.post("/admin/subjects", headers=ah, json={"code": "TST702", "name": "Again"}).status_code == 400
    sid = made.json()["id"]
    assert client.patch(f"/admin/subjects/{sid}", headers=ah, json={"faculty_id": admin["t2"].id}).json()["faculty_name"] == "Teacher Two"
    assert client.patch(f"/admin/subjects/{sid}", headers=ah, json={"faculty_id": 99999}).status_code == 400
    assert client.patch(f"/admin/subjects/{sid}", headers=ah, json={"faculty_id": 0}).json()["faculty_id"] is None       # allocation removed
    assert client.patch(f"/admin/subjects/{sid}", headers=ah, json={"semester": 12}).status_code == 400
    alloc = client.get("/admin/subjects/allocation", headers=ah).json()
    assert len(alloc["subjects"]) == 3 and {f["name"] for f in alloc["faculty"]} == {"Teacher One", "Teacher Two", "Other Dept Teacher"}
    assert any("Subject TST702: allocated to Teacher Two" in r["action"] for r in client.get("/admin/activity-logs", headers=ah).json())


# ---------- placement records ----------

def test_placement_records_crud_scope_and_placement_wall(client, placed):  # noqa: F811
    db, h = placed["db"], placed["h"]
    admin_user = m.User(email="admin@test.local", hashed_password="x", role="admin")
    db.add(admin_user)
    db.commit()
    ah = auth_headers(admin_user.id)

    body = {"usn": "t23is002", "company": "  ACME ", "package_lpa": 6.5, "offer_type": "PPO", "drive_type": "campus"}
    made = client.post("/admin/placement-records/placements", headers=h["hod"], json=body)
    assert made.status_code == 200, made.text
    p = made.json()
    assert (p["usn"], p["company"], p["package_lpa"], p["offer_type"], p["status"], p["verified"]) == ("T23IS002", "Acme", 6.5, "PPO", "offered", True)
    assert client.post("/admin/placement-records/placements", headers=h["hod"], json=body).status_code == 400                 # same offer twice
    assert client.post("/admin/placement-records/placements", headers=h["hod"], json={**body, "usn": "T23CS001"}).status_code == 404   # other department
    assert client.post("/admin/placement-records/placements", headers=h["hod"], json={**body, "usn": "T24IS001", "package_lpa": 0}).status_code == 400
    assert client.post("/admin/placement-records/placements", headers=h["t1"], json=body).status_code == 403

    # the dashboards and the student see it at once: same views
    assert client.get("/hod/placements?batch=2023", headers=h["hod"]).json()["placed"] == 2
    assert client.get("/student/placement", headers=h["s2"]).json()["company"] == "Acme"
    wall = [a for a in client.get("/announcements", headers=h["s3"]).json() if a["kind"] == "placement"]
    assert [a["title"] for a in wall] == ["1 student placed at Acme (6.5 LPA)"] and "Bina Kumar" in wall[0]["body"]

    assert client.patch(f"/admin/placement-records/placements/{p['id']}", headers=h["hod_cse"], json={"status": "joined"}).status_code == 404
    edited = client.patch(f"/admin/placement-records/placements/{p['id']}", headers=ah, json={"status": "joined", "package_lpa": 7})
    assert (edited.json()["status"], edited.json()["package_lpa"]) == ("joined", 7.0)
    assert client.get("/student/placement", headers=h["s2"]).json()["ctc"] == "7 LPA"

    intern = client.post("/admin/placement-records/internships", headers=ah, json={"usn": "T23IS002", "company": "Globex", "stipend_per_month": 30000, "status": "completed", "start_date": "2026-05-01", "end_date": "2026-07-01"})
    assert intern.status_code == 200 and intern.json()["stipend_per_month"] == 30000
    assert client.post("/admin/placement-records/internships", headers=ah, json={"usn": "T23IS002", "company": "Globex", "start_date": "2026-05-01"}).status_code == 400
    assert client.patch(f"/admin/placement-records/internships/{intern.json()['id']}", headers=ah, json={"end_date": "2026-04-01"}).status_code == 400

    records = client.get("/admin/placement-records?batch=2023", headers=h["hod"]).json()
    assert sorted(x["usn"] for x in records["placements"]) == ["T23IS001", "T23IS001", "T23IS002", "T23IS002"] and len(records["internships"]) == 2
    assert all(x["usn"] != "T23CS001" for x in client.get("/admin/placement-records", headers=h["hod"]).json()["placements"])
    assert any(x["usn"] == "T23CS001" for x in client.get("/admin/placement-records", headers=ah).json()["placements"])

    assert client.delete(f"/admin/placement-records/placements/{p['id']}", headers=ah).status_code == 200
    assert client.get("/hod/placements?batch=2023", headers=h["hod"]).json()["placed"] == 1
    actions = " | ".join(r["action"] for r in client.get("/admin/activity-logs", headers=ah).json())
    assert "Added placement: T23IS002 at Acme" in actions and "Edited placement" in actions and "Deleted placement" in actions and "Added internship" in actions


def test_placement_csv_import_previews_then_applies(client, placed):  # noqa: F811
    db, h = placed["db"], placed["h"]
    admin_user = m.User(email="admin@test.local", hashed_password="x", role="admin")
    db.add(admin_user)
    db.commit()
    ah = auth_headers(admin_user.id)
    header = "name,usn,company,package_lpa,role,offer_type,offer_date,status,drive_type,drive_date,venue,batch,source_note,needs_confirmation\n"
    rows = "Bina Kumar,,Initech,5.2,,full-time,,offered,campus,,,2023,test,\nChitra,,Initech,5.2,,full-time,,offered,campus,,,2024,test,\nNobody Here,,Initech,5.2,,full-time,,offered,campus,,,2023,test,\n"
    send = lambda **form: client.post("/admin/placement-records/import", headers=ah, data=form, files={"placements": ("p.csv", io.BytesIO((header + rows).encode()), "text/csv")})  # noqa: E731

    preview = send().json()
    assert preview["applied"] is False and [(r["name"], r["decision"], r["matched_usn"]) for r in preview["placements"]] == [
        ("Bina Kumar", "import", "T23IS002"), ("Chitra", "ambiguous", None), ("Nobody Here", "unmatched", None)]
    assert preview["placements"][1]["candidates"][0]["usn"] == "T24IS001"      # first name only: offered as a candidate, not imported
    assert db.query(m.Company).filter(m.Company.name == "Initech").count() == 0

    applied = send(apply="true").json()
    assert applied["written"] == {"placements": 1, "internships": 0}
    assert send(apply="true").json()["written"]["placements"] == 1 and db.query(m.Placement).join(m.Company, m.Company.id == m.Placement.company_id).filter(m.Company.name == "Initech").count() == 1
    assert [a["title"] for a in client.get("/announcements", headers=h["s1"]).json() if a["kind"] == "placement"] == ["1 student placed at Initech (5.2 LPA)"]
    assert client.post("/admin/placement-records/import", headers=h["hod"], files={"placements": ("p.csv", b"x", "text/csv")}).status_code == 403
    assert client.post("/admin/placement-records/import", headers=ah).status_code == 400


def test_teacher_sees_placements_of_own_students(client, placed):  # noqa: F811
    h = placed["h"]
    mine = client.get("/teacher/placements", headers=h["t1"]).json()
    assert (mine["students"], mine["placed"]) == (2, 2) and sorted({o["usn"] for o in mine["offers"]}) == ["T23IS001", "T23IS002"]
    assert client.get("/teacher/placements", headers=h["t2"]).json()["offers"] == []
    assert client.get("/teacher/placements", headers=h["s1"]).status_code == 403
