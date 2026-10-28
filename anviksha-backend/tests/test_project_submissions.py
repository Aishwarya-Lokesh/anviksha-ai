"""Direct submission of a ready-made report or presentation to a guide, without
the builder: the student sends files and a note, the chosen guide sees them,
replies, and only that student gets the reply back. Storage is in memory."""
import io

from app.models import models as m
from tests.test_missing_endpoints import campus  # noqa: F401  (shared fixture)
from tests.test_projects_api import _project, lab  # noqa: F401  (shared fixtures)

PDF = b"%PDF-1.4\n% a report\n"
PPTX = b"PK\x03\x04 a presentation"
PPT = b"\xd0\xcf\x11\xe0 an old presentation"


def _files(*items):
    return [("files", (name, io.BytesIO(data), "application/octet-stream")) for name, data in items]


def _submit(client, headers, guide_id, files=None, **form):
    data = {"guide_id": str(guide_id), "note": "Madam, please review the attached report.", **{k: str(v) for k, v in form.items()}}
    if "project_id" not in form and "title" not in form:
        data["title"] = "Crop Disease Detection Using Deep Learning"
    return client.post("/student/project-submissions", headers=headers, data=data,
                       files=files if files is not None else _files(("Final report.pdf", PDF), ("Slides.pptx", PPTX)))


def test_full_flow_student_to_guide_and_back(client, lab):
    h, db, t1 = lab["h"], lab["db"], lab["t1"]
    r = _submit(client, h["s1"], t1.id, client_token="tok-1")
    assert r.status_code == 200, r.text
    sub = r.json()
    assert sub["status"] == "submitted" and sub["number"] == 1 and sub["guide"]["name"] == "Teacher One"
    assert [f["name"] for f in sub["files"]] == ["Final report.pdf", "Slides.pptx"]
    assert [f["kind"] for f in sub["files"]] == ["report", "presentation"]
    assert sub["note"].startswith("Madam")
    pid = sub["project_id"]

    # stored privately, under the project, and the guide is told
    assert any(k.startswith(f"projects/{pid}/submissions/{sub['id']}/") for k in lab["store"])
    guide_login = db.query(m.User).filter(m.User.faculty_id == t1.id).first()
    assert any("for your review" in n.message for n in db.query(m.Notification).filter(m.Notification.user_id == guide_login.id))

    # the guide's existing review list and page show it
    rows = client.get("/teacher/project-reviews", headers=h["t1"]).json()
    row = next(x for x in rows if x["id"] == pid)
    assert row["submissions"] == 1 and row["awaiting_review"] == 1
    page = client.get(f"/teacher/project-reviews/{pid}", headers=h["t1"]).json()
    assert page["submitted_by"]["usn"] == "T23IS001"
    assert page["submissions"][0]["note"].startswith("Madam")
    assert page["submissions"][0]["status"] == "under_review"          # opened
    got = client.get(f"/teacher/project-reviews/{pid}/submissions/{sub['id']}/files/0", headers=h["t1"])
    assert got.status_code == 200 and got.content == PDF and got.headers["content-type"] == "application/pdf"

    # the guide replies through the existing comment mechanism
    reply = client.post(f"/teacher/project-reviews/{pid}/comments", headers=h["t1"],
                        json={"body": "Add the test results to chapter 6.", "submission_id": sub["id"], "status": "changes_requested"})
    assert reply.status_code == 200, reply.text
    assert reply.json()["submission_id"] == sub["id"] and reply.json()["section"] == "Submission 1"

    # the student sees it, linked to that submission, marked unread once
    mine = client.get("/student/project-submissions", headers=h["s1"]).json()
    assert mine[0]["status"] == "changes_requested" and mine[0]["unread"] is True and mine[0]["reviewed"]
    assert mine[0]["replies"][0]["body"] == "Add the test results to chapter 6." and mine[0]["replies"][0]["author"] == "Teacher One"
    assert client.get("/student/project-submissions", headers=h["s1"]).json()[0]["unread"] is True      # a reload does not lose it
    assert client.post("/student/project-submissions/seen", headers=h["s2"]).json()["marked"] == 0          # another student's call changes nothing
    assert client.post("/student/project-submissions/seen", headers=h["s1"]).json()["marked"] == 1
    assert client.get("/student/project-submissions", headers=h["s1"]).json()[0]["unread"] is False
    student_login = db.query(m.User).filter(m.User.student_id == lab["s1"].id).first()
    assert any("asked for corrections" in n.message for n in db.query(m.Notification).filter(m.Notification.user_id == student_login.id))
    # and in the project's own workspace
    assert client.get(f"/student/projects/{pid}", headers=h["s1"]).json()["submissions"][0]["replies"]

    # a revised version goes beside the first; history is kept
    again = _submit(client, h["s1"], t1.id, files=_files(("Final report v2.pdf", PDF)), project_id=pid)
    assert again.status_code == 200 and again.json()["number"] == 2
    assert [x["number"] for x in client.get("/student/project-submissions", headers=h["s1"]).json()] == [2, 1]
    assert client.get(f"/student/project-submissions/{sub['id']}/files/1", headers=h["s1"]).content == PPTX


def test_repeated_click_makes_one_submission(client, lab):
    h, t1 = lab["h"], lab["t1"]
    first = _submit(client, h["s1"], t1.id, client_token="same-click").json()
    second = _submit(client, h["s1"], t1.id, client_token="same-click").json()
    assert first["id"] == second["id"]
    assert len(client.get("/student/project-submissions", headers=h["s1"]).json()) == 1
    assert len(client.get("/student/projects", headers=h["s1"]).json()) == 1


def test_validation(client, lab):
    h, t1, t3 = lab["h"], lab["t1"], lab["t3"]
    bad = lambda r: (r.status_code, r.json().get("detail"))  # noqa: E731
    assert bad(_submit(client, h["s1"], t1.id, files=_files(("notes.txt", b"hello"))))[0] == 400
    assert "does not look like a real" in bad(_submit(client, h["s1"], t1.id, files=_files(("report.pdf", b"not a pdf"))))[1]
    assert "is empty" in bad(_submit(client, h["s1"], t1.id, files=_files(("report.pdf", b""))))[1]
    big = b"%PDF" + b"0" * (20 * 1024 * 1024)
    assert "larger than" in bad(_submit(client, h["s1"], t1.id, files=_files(("big.pdf", big))))[1]
    assert "up to 5" in bad(_submit(client, h["s1"], t1.id, files=_files(*[(f"r{i}.pdf", PDF) for i in range(6)])))[1]
    assert _submit(client, h["s1"], t3.id).status_code == 404              # guide outside the department
    assert _submit(client, h["s1"], 999999).status_code == 404
    assert "title" in bad(_submit(client, h["s1"], t1.id, title="abc"))[1]
    assert "2000" in bad(_submit(client, h["s1"], t1.id, note="x" * 2001))[1]
    assert _submit(client, h["s1"], t1.id, files=_files(("old.ppt", PPT))).status_code == 200
    # nothing half-made by the failures
    assert len(client.get("/student/project-submissions", headers=h["s1"]).json()) == 1


def test_privacy(client, lab):
    h, t1, t2 = lab["h"], lab["t1"], lab["t2"]
    sub = _submit(client, h["s1"], t1.id).json()
    pid, sid = sub["project_id"], sub["id"]
    # other students: not their submission, not their project
    assert client.get("/student/project-submissions", headers=h["s2"]).json() == []
    assert client.get(f"/student/project-submissions/{sid}/files/0", headers=h["s2"]).status_code == 404
    assert _submit(client, h["s2"], t1.id, project_id=pid).status_code == 404
    assert client.post(f"/student/projects/{pid}/comments", headers=h["s2"], json={"body": "hi", "submission_id": sid}).status_code == 404
    # another guide: cannot see, download or reply
    assert all(r["id"] != pid for r in client.get("/teacher/project-reviews", headers=h["t2"]).json())
    assert client.get(f"/teacher/project-reviews/{pid}", headers=h["t2"]).status_code == 404
    assert client.get(f"/teacher/project-reviews/{pid}/submissions/{sid}/files/0", headers=h["t2"]).status_code == 404
    assert client.post(f"/teacher/project-reviews/{pid}/comments", headers=h["t2"], json={"body": "ok", "submission_id": sid}).status_code == 404
    # wrong roles
    assert client.get("/student/project-submissions", headers=h["t1"]).status_code == 403
    assert _submit(client, h["t1"], t1.id).status_code == 403
    assert client.post(f"/teacher/project-reviews/{pid}/comments", headers=h["t1"], json={"body": "ok", "submission_id": sid, "status": "approved!"}).status_code == 400

    # shared with a different guide later: the first guide keeps only what was submitted to them
    client.put(f"/student/projects/{pid}/share", headers=h["s1"], json={"faculty_id": t2.id})
    first = client.get(f"/teacher/project-reviews/{pid}", headers=h["t1"]).json()
    assert first["current_guide"] is False and [x["id"] for x in first["submissions"]] == [sid] and first["versions"] == []
    assert client.post(f"/teacher/project-reviews/{pid}/comments", headers=h["t1"], json={"body": "general"}).status_code == 404
    second = client.get(f"/teacher/project-reviews/{pid}", headers=h["t2"]).json()
    assert second["current_guide"] is True and second["submissions"] == []


def test_builder_projects_still_work_and_delete_cleans_up(client, lab):
    h, t1 = lab["h"], lab["t1"]
    p = _project(client, lab)                                                   # the builder's own flow
    assert p["submissions"] == []
    sub = _submit(client, h["s1"], t1.id, project_id=p["id"]).json()
    assert sub["project_title"] == p["title"]
    assert client.get("/student/projects", headers=h["s1"]).json()[0]["submissions"] == 1
    client.post(f"/teacher/project-reviews/{p['id']}/comments", headers=h["t1"], json={"body": "Looks fine.", "submission_id": sub["id"]})
    assert client.get("/student/project-submissions", headers=h["s1"]).json()[0]["status"] == "reviewed"
    assert client.delete(f"/student/projects/{p['id']}", headers=h["s1"]).status_code == 200
    assert not any(f"/submissions/{sub['id']}/" in k for k in lab["store"])
    assert client.get("/student/project-submissions", headers=h["s1"]).json() == []
