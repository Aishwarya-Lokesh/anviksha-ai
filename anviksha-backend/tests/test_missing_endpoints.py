"""The endpoints the app's screens were already calling but the backend never
had: notes & deadlines, dashboard score fields, bulk IA marks, attendance
delete, counseling replies, extra work, HOD batch views, placement figures,
resume file and education. Each test also checks the access boundary."""
import pytest

from app.models import models as m
from tests.conftest import auth_headers


@pytest.fixture()
def campus(db_session, monkeypatch):
    """One department with two teachers and two classes, plus a second
    department, so 'own data only' can be checked from every side."""
    db = db_session
    stored = {}
    for module in ("app.routers.notes", "app.routers.student_extras"):
        monkeypatch.setattr(f"{module}.upload_file", lambda path, content, content_type=None: stored.__setitem__(path, content))
        monkeypatch.setattr(f"{module}.delete_file", lambda path: stored.pop(path, None))

    ise = m.Department(name="ISE (TEST)")
    cse = m.Department(name="CSE (TEST)")
    db.add_all([ise, cse])
    db.flush()

    t1 = m.Faculty(name="Teacher One", department_id=ise.id, designation="Assistant Professor")
    t2 = m.Faculty(name="Teacher Two", department_id=ise.id, designation="Professor")
    t3 = m.Faculty(name="Other Dept Teacher", department_id=cse.id)
    db.add_all([t1, t2, t3])
    db.flush()

    sub1 = m.Subject(code="TST701", name="Subject One", department_id=ise.id, semester=7, faculty_id=t1.id)
    sub2 = m.Subject(code="TST501", name="Subject Two", department_id=ise.id, semester=5, faculty_id=t2.id)
    db.add_all([sub1, sub2])
    db.flush()

    s1 = m.Student(usn="T23IS001", name="Asha Rao", department_id=ise.id, batch="2023", semester=7, status="active", cgpa=8.5)
    s2 = m.Student(usn="T23IS002", name="Bina Kumar", department_id=ise.id, batch="2023", semester=7, status="active", cgpa=7.2)
    s3 = m.Student(usn="T24IS001", name="Chitra N", department_id=ise.id, batch="2024", semester=5, status="active", cgpa=9.3)
    s4 = m.Student(usn="T21IS001", name="Deepa S", department_id=ise.id, batch="2021", semester=8, status="passed_out", cgpa=8.0)
    s5 = m.Student(usn="T23CS001", name="Esha M", department_id=cse.id, batch="2023", semester=7, status="active", cgpa=8.8)
    db.add_all([s1, s2, s3, s4, s5])
    db.flush()

    a1 = m.TeachingAssignment(faculty_id=t1.id, batch="2023", semester=7, department_id=ise.id, subject_id=sub1.id)
    a2 = m.TeachingAssignment(faculty_id=t2.id, batch="2024", semester=5, department_id=ise.id, subject_id=sub2.id)
    db.add_all([a1, a2])

    users = {
        "t1": m.User(email="t1@test.local", hashed_password="x", role="teacher", faculty_id=t1.id),
        "t2": m.User(email="t2@test.local", hashed_password="x", role="teacher", faculty_id=t2.id),
        "s1": m.User(email="s1@test.local", hashed_password="x", role="student", student_id=s1.id),
        "s2": m.User(email="s2@test.local", hashed_password="x", role="student", student_id=s2.id),
        "s3": m.User(email="s3@test.local", hashed_password="x", role="student", student_id=s3.id),
        "hod": m.User(email="hod@test.local", hashed_password="x", role="hod", department_id=ise.id),
        "hod_cse": m.User(email="hod.cse@test.local", hashed_password="x", role="hod", department_id=cse.id),
    }
    db.add_all(users.values())
    db.commit()

    h = {name: auth_headers(u.id) for name, u in users.items()}
    return {"db": db, "h": h, "ise": ise, "cse": cse, "t1": t1, "t2": t2, "t3": t3, "sub1": sub1, "sub2": sub2,
            "s1": s1, "s2": s2, "s3": s3, "s4": s4, "s5": s5, "a1": a1, "a2": a2, "stored": stored}


# ---------- notes & deadlines ----------

def test_teacher_posts_and_only_that_class_sees_it(client, campus):
    h, a1 = campus["h"], campus["a1"]
    r = client.post("/teacher/notes", headers=h["t1"], data={"teaching_assignment_id": a1.id, "kind": "note", "title": "Module 1"},
                    files={"file": ("mod 1.pdf", b"%PDF-1.4 test", "application/pdf")})
    assert r.status_code == 200, r.text
    assert r.json()["file_url"].startswith("/note-files/note_")
    r = client.post("/teacher/notes", headers=h["t1"], data={"teaching_assignment_id": a1.id, "kind": "deadline", "title": "Assignment 1", "due_date": "2030-01-15"})
    assert r.status_code == 200, r.text

    mine = client.get("/teacher/notes", headers=h["t1"]).json()
    assert [n["kind"] for n in mine] == ["deadline", "note"] and mine[0]["subject_code"] == "TST701" and mine[0]["batch"] == "2023"

    seen = client.get("/student/notes", headers=h["s1"]).json()
    assert [n["title"] for n in seen["notes"]] == ["Module 1"] and seen["notes"][0]["teacher_name"] == "Teacher One"
    assert seen["deadlines"][0]["due_date"] == "2030-01-15" and "TST701" in seen["deadlines"][0]["subject"]

    other_class = client.get("/student/notes", headers=h["s3"]).json()
    assert other_class == {"notes": [], "deadlines": []}
    assert client.get("/teacher/notes", headers=h["t2"]).json() == []


def test_note_rules(client, campus):
    h, a1, a2 = campus["h"], campus["a1"], campus["a2"]
    assert client.post("/teacher/notes", headers=h["t1"], data={"teaching_assignment_id": a2.id, "kind": "note", "title": "x"}).status_code == 404
    assert client.post("/teacher/notes", headers=h["t1"], data={"teaching_assignment_id": a1.id, "kind": "deadline", "title": "x", "due_date": "soon"}).status_code == 400
    assert client.post("/teacher/notes", headers=h["t1"], data={"teaching_assignment_id": a1.id, "kind": "note", "title": "x"},
                       files={"file": ("virus.exe", b"MZ", "application/octet-stream")}).status_code == 400
    assert client.post("/teacher/notes", headers=h["s1"], data={"teaching_assignment_id": a1.id, "kind": "note", "title": "x"}).status_code == 403

    note_id = client.post("/teacher/notes", headers=h["t1"], data={"teaching_assignment_id": a1.id, "kind": "note", "title": "Keep"}).json()["id"]
    assert client.delete(f"/teacher/notes/{note_id}", headers=h["t2"]).status_code == 404
    assert client.delete(f"/teacher/notes/{note_id}", headers=h["t1"]).status_code == 200
    assert client.get("/student/notes", headers=h["s1"]).json()["notes"] == []


# ---------- dashboard: profile score and achievements ----------

def test_dashboard_carries_score_and_achievements(client, campus):
    db, h, s1 = campus["db"], campus["h"], campus["s1"]
    empty = client.get("/student/dashboard", headers=h["s1"]).json()
    assert empty["profile_score"] == 800 and empty["achievements_count"] == 0 and empty["achievement_items"] == []

    db.add_all([
        m.Achievement(student_id=s1.id, title="Cloud Cert", type="Certificate", year=2025),
        m.Achievement(student_id=s1.id, title="Hack Night", type="Hackathon", won=True),
        m.Achievement(student_id=s1.id, title="Attendance App", type="Project"),
        m.Achievement(student_id=campus["s2"].id, title="Someone else's", type="Project"),
    ])
    db.commit()
    d = client.get("/student/dashboard", headers=h["s1"]).json()
    assert d["achievements_count"] == 3
    assert d["achievements_breakdown"] == {"certificates": 1, "projects": 1, "hackathons": 1, "activities": 0}
    assert sorted(i["points"] for i in d["achievement_items"]) == [50, 100, 150]
    # same total as the Excellence Score page
    assert d["profile_score"] == client.get("/student/excellence-score", headers=h["s1"]).json()["total_score"] == 800 + 300
    assert all(i["title"] != "Someone else's" for i in d["achievement_items"])


# ---------- IA marks ----------

def test_bulk_marks_save_and_scope(client, campus):
    h, s1, s2, s3, sub1, sub2 = campus["h"], campus["s1"], campus["s2"], campus["s3"], campus["sub1"], campus["sub2"]
    rows = [{"student_id": s1.id, "subject_id": sub1.id, "exam_type": "IA-1", "marks_obtained": 41, "max_marks": 50},
            {"student_id": s2.id, "subject_id": sub1.id, "exam_type": "IA-1", "marks_obtained": 33.5, "max_marks": 50}]
    r = client.post("/teacher/marks/bulk", headers=h["t1"], json=rows)
    assert r.status_code == 200 and r.json() == {"count": 2}
    rows[0]["marks_obtained"] = 45
    assert client.post("/teacher/marks/bulk", headers=h["t1"], json=rows[:1]).json() == {"count": 1}
    got = {g["usn"]: g["ia1"] for g in client.get(f"/teacher/marks?subject_id={sub1.id}&semester=7&batch=2023", headers=h["t1"]).json()}
    assert got == {"T23IS001": {"marks": 45, "max": 50}, "T23IS002": {"marks": 33.5, "max": 50}}
    assert campus["db"].query(m.Marks).count() == 2

    bad = lambda **kw: client.post("/teacher/marks/bulk", headers=h["t1"], json=[{**rows[0], **kw}]).status_code
    assert bad(marks_obtained=51) == 400
    assert bad(exam_type="Final") == 400
    assert bad(student_id=s3.id) == 403       # not this teacher's student
    assert bad(subject_id=sub2.id) == 403     # not this teacher's subject
    # one bad row saves nothing
    assert client.post("/teacher/marks/bulk", headers=h["t1"], json=[{**rows[0], "exam_type": "IA-2"}, {**rows[1], "marks_obtained": 99}]).status_code == 400
    assert campus["db"].query(m.Marks).count() == 2


# ---------- attendance ----------

def test_delete_own_attendance_session_only(client, campus):
    from datetime import date
    db, h = campus["db"], campus["h"]
    session = m.AttendanceSession(subject_id=campus["sub1"].id, date=date.today(), marked_by_faculty_id=campus["t1"].id)
    db.add(session)
    db.flush()
    db.add(m.AttendanceRecord(session_id=session.id, student_id=campus["s1"].id, present=True))
    db.commit()
    assert client.delete(f"/teacher/attendance/{session.id}", headers=h["t2"]).status_code == 403
    assert client.delete(f"/teacher/attendance/{session.id}", headers=h["t1"]).status_code == 200
    assert db.query(m.AttendanceSession).count() == 0 and db.query(m.AttendanceRecord).count() == 0
    assert client.delete(f"/teacher/attendance/{session.id}", headers=h["t1"]).status_code == 404


# ---------- counseling replies ----------

def test_counseling_reply_round_trip(client, campus):
    db, h, s1 = campus["db"], campus["h"], campus["s1"]
    note = m.CounselingNote(student_id=s1.id, faculty_id=campus["t1"].id, note="Please revise module 2")
    db.add(note)
    db.commit()

    seen = client.get("/student/counseling", headers=h["s1"]).json()["notes"][0]
    assert seen["id"] == note.id and seen["teacher_name"] == "Teacher One" and seen["reply_status"] is None

    assert client.patch(f"/student/counseling/{note.id}/reply", headers=h["s2"], json={"status": "Done"}).status_code == 404
    assert client.patch(f"/student/counseling/{note.id}/reply", headers=h["s1"], json={"status": "Whatever"}).status_code == 400
    r = client.patch(f"/student/counseling/{note.id}/reply", headers=h["s1"], json={"status": "Following", "description": "Started revising"})
    assert r.status_code == 200 and r.json()["reply_status"] == "Following"

    teacher_view = client.get(f"/teacher/counseling/{s1.id}", headers=h["t1"]).json()[0]
    assert teacher_view["reply_status"] == "Following" and teacher_view["reply_description"] == "Started revising"
    assert client.get("/teacher/counseling-history", headers=h["t1"]).json()[0]["reply_status"] == "Following"

    assert client.patch(f"/teacher/counseling/{note.id}/reply", headers=h["t2"], json={"reply": "x"}).status_code == 404
    assert client.patch(f"/teacher/counseling/{note.id}/reply", headers=h["t1"], json={"reply": "Good, keep going"}).status_code == 200
    assert client.get("/student/counseling", headers=h["s1"]).json()["notes"][0]["teacher_reply"] == "Good, keep going"

    assert client.delete(f"/student/counseling/{note.id}/reply", headers=h["s1"]).status_code == 200
    assert client.get("/student/counseling", headers=h["s1"]).json()["notes"][0]["reply_status"] is None


# ---------- extra work ----------

def test_extra_work_lifecycle(client, campus):
    h, t1 = campus["h"], campus["t1"]
    assert client.get("/teacher/extra-work", headers=h["t1"]).json() == {"extra_work": None, "status": None}
    assert client.patch("/teacher/extra-work/status", headers=h["t1"], json={"status": "completed"}).status_code == 404

    assert client.patch(f"/hod/faculty/{t1.id}/extra-work", headers=h["hod_cse"], json={"extra_work": "x"}).status_code == 404
    assert client.patch(f"/hod/faculty/{t1.id}/extra-work", headers=h["hod"], json={"extra_work": "Class Coordinator"}).json()["status"] == "pending"
    assert client.get("/teacher/extra-work", headers=h["t1"]).json() == {"extra_work": "Class Coordinator", "status": "pending"}
    assert client.get("/teacher/extra-work", headers=h["t2"]).json()["extra_work"] is None

    assert client.patch("/teacher/extra-work/status", headers=h["t1"], json={"status": "done-ish"}).status_code == 400
    assert client.patch("/teacher/extra-work/status", headers=h["t1"], json={"status": "completed"}).json()["status"] == "completed"
    # assigning something new starts it as pending again
    assert client.patch(f"/hod/faculty/{t1.id}/extra-work", headers=h["hod"], json={"extra_work": "Placement Coordinator"}).json()["status"] == "pending"
    assert client.delete("/teacher/extra-work", headers=h["t1"]).json() == {"extra_work": None, "status": None}


# ---------- HOD batch views ----------

def test_hod_batch_breakdown_and_faculty_classes_are_department_scoped(client, campus):
    h = campus["h"]
    rows = client.get("/hod/students-by-batch", headers=h["hod"]).json()
    assert [(r["batch"], r["active"], r["passed_out"], r["total"]) for r in rows] == [("2024", 1, 0, 1), ("2023", 2, 0, 2), ("2021", 0, 1, 1)]
    assert [(r["batch"], r["total"]) for r in client.get("/hod/students-by-batch", headers=h["hod_cse"]).json()] == [("2023", 1)]

    subjects = client.get(f"/hod/faculty/{campus['t1'].id}/subjects", headers=h["hod"]).json()["subjects"]
    assert subjects == [{"code": "TST701", "name": "Subject One", "batch": "2023", "semester": 7, "section": None, "passed_out": False}]
    assert client.get(f"/hod/faculty/{campus['t1'].id}/subjects", headers=h["hod_cse"]).status_code == 404
    assert client.get("/hod/students-by-batch", headers=h["t1"]).status_code == 403


# ---------- placements ----------

@pytest.fixture()
def placed(campus):
    db = campus["db"]
    acme, globex = m.Company(name="Acme", name_key="acme"), m.Company(name="Globex", name_key="globex")
    db.add_all([acme, globex])
    db.flush()
    s1, s2, s4, s5 = campus["s1"], campus["s2"], campus["s4"], campus["s5"]
    db.add_all([
        m.Placement(student_id=s1.id, placed=True, company_id=acme.id, package_lpa=5.2, offer_type="full-time", status="offered", verified=True),
        m.Placement(student_id=s1.id, placed=True, company_id=globex.id, package_lpa=22, offer_type="PPO", status="offered", verified=True),
        m.Placement(student_id=s2.id, placed=True, company_id=acme.id, package_lpa=12, offer_type="full-time", status="declined"),
        m.Placement(student_id=s4.id, placed=True, company_id=acme.id, package_lpa=4, offer_type="full-time"),
        m.Placement(student_id=s5.id, placed=True, company_id=acme.id, package_lpa=30, offer_type="full-time"),   # other department
        m.Internship(student_id=s1.id, company="Globex", company_id=globex.id, stipend_per_month=75000, status="completed", verified=True),
    ])
    db.commit()
    return campus


def test_hod_placement_figures(client, placed):
    h = placed["h"]
    d = client.get("/hod/placements?batch=2023", headers=h["hod"]).json()
    # 2 students in the batch; one holds two offers, the other declined theirs
    assert (d["tracked_total"], d["placed"], d["not_placed"], d["placement_pct"], d["offers"]) == (2, 1, 1, 50.0, 2)
    assert (d["highest_ctc_lpa"], d["avg_ctc_lpa"], d["dream_offers"], d["regular_offers"]) == (22.0, 22.0, 1, 1)
    assert d["highest_package_company"] == {"company": "Globex", "ctc": "22 LPA", "students_placed": 1}
    assert d["batch_label"] == "2023–27" and d["companies_hired_count"] == 2
    assert [(s["usn"], s["placed"], s["company"], s["ctc"]) for s in d["students"]] == [("T23IS001", True, "Globex", "22 LPA"), ("T23IS002", False, None, None)]
    assert d["students_placed_for_highest_package"] == [{"usn": "T23IS001", "name": "Asha Rao", "company": "Globex", "ctc": "22 LPA"}]

    everything = client.get("/hod/placements", headers=h["hod"]).json()
    assert (everything["tracked_total"], everything["placed"], everything["highest_ctc_lpa"]) == (3, 2, 22.0)   # 2024 batch has no offers, so it is not counted
    assert all(s["usn"] != "T23CS001" for s in everything["students"])

    assert client.get("/hod/placement-batches", headers=h["hod"]).json() == [{"batch": "2021", "label": "2021–25"}, {"batch": "2023", "label": "2023–27"}]
    cmp_rows = client.get("/hod/placement-comparison?batches=2021,2023", headers=h["hod"]).json()
    assert [(r["batch"], r["placement_pct"], r["avg_ctc_lpa"], r["median_ctc_lpa"]) for r in cmp_rows] == [("2021", 100.0, 4.0, 4.0), ("2023", 50.0, 22.0, 22.0)]
    assert cmp_rows[1]["ppo_count"] == 1 and cmp_rows[1]["students_with_internship"] == 1

    other = client.get("/hod/placements?batch=2023", headers=h["hod_cse"]).json()
    assert (other["placed"], other["highest_ctc_lpa"]) == (1, 30.0)


def test_student_sees_only_own_placement_and_internship(client, placed):
    h = placed["h"]
    mine = client.get("/student/placement", headers=h["s1"]).json()
    assert mine["placed"] is True and mine["company"] == "Globex" and mine["ctc"] == "22 LPA" and mine["offer_type"] == "PPO"
    assert sorted(o["company"] for o in mine["placements"]) == ["Acme", "Globex"]
    interns = client.get("/student/internships", headers=h["s1"]).json()
    assert [(i["company"], i["stipend"], i["status"]) for i in interns] == [("Globex", "₹75,000 / month", "completed")]

    none = client.get("/student/placement", headers=h["s3"]).json()
    assert none["available"] is False and none["placements"] == []
    assert client.get("/student/internships", headers=h["s3"]).json() == []
    assert client.get("/hod/placements", headers=h["s1"]).status_code == 403


# ---------- resume file and education ----------

def test_resume_upload_replace_delete(client, campus):
    h, stored = campus["h"], campus["stored"]
    assert client.post("/student/profile/resume", headers=h["s1"], files={"file": ("cv.txt", b"hello", "text/plain")}).status_code == 400
    url = client.post("/student/profile/resume", headers=h["s1"], files={"file": ("My CV.pdf", b"%PDF-1.4", "application/pdf")}).json()["resume_file_url"]
    assert url.startswith("/resume-files/T23IS001_resume_") and url.endswith(".pdf") and len(stored) == 1
    assert client.get("/student/dashboard", headers=h["s1"]).json()["resume_file_url"] == url
    assert client.get("/student/dashboard", headers=h["s2"]).json()["resume_file_url"] is None
    assert client.delete("/student/profile/resume", headers=h["s1"]).json() == {"resume_file_url": None}
    assert stored == {} and client.get("/student/dashboard", headers=h["s1"]).json()["resume_file_url"] is None


def test_education_saved_and_validated(client, campus):
    h = campus["h"]
    rows = [{"level": "Bachelor's Degree", "institution": "Test College", "city": "Mysuru", "score_type": "cgpa", "score": 8.5, "year": 2027},
            {"level": "12th Class / PUC", "institution": "Test PU", "city": "", "score_type": "percentage", "score": 91, "year": None}]
    assert client.patch("/student/education", headers=h["s1"], json={"education": rows}).status_code == 200
    assert client.get("/student/dashboard", headers=h["s1"]).json()["education"] == rows
    assert client.get("/student/dashboard", headers=h["s2"]).json()["education"] == []
    assert client.patch("/student/education", headers=h["s1"], json={"education": [{**rows[0], "score": 85}]}).status_code == 400   # cgpa out of 10
    assert client.patch("/student/education", headers=h["s1"], json={"education": [{**rows[0], "year": 1200}]}).status_code == 400
    assert client.patch("/student/education", headers=h["t1"], json={"education": rows}).status_code == 403
