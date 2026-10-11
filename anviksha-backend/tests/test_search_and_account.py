"""Global search shows each role only what it may see, and every role can
manage its own account."""
import pytest

from app.core.security import hash_password
from app.models import models as m
from tests.conftest import auth_headers
from tests.test_missing_endpoints import campus  # noqa: F401  (shared fixture)


def _titles(response, key):
    groups = {g["key"]: g["items"] for g in response.json()["groups"]}
    return sorted(i["title"] for i in groups.get(key, []))


def test_teacher_search_is_limited_to_own_classes(client, campus):  # noqa: F811
    h = campus["h"]
    # "a" appears in every student's name; teacher one teaches only the 2023 ISE class
    assert _titles(client.get("/search?q=a", headers=h["t1"]), "students") == ["Asha Rao", "Bina Kumar"]
    assert _titles(client.get("/search?q=a", headers=h["t2"]), "students") == ["Chitra N"]
    assert _titles(client.get("/search?q=TST", headers=h["t1"]), "subjects") == ["TST701 — Subject One"]
    hit = client.get("/search?q=T23IS001", headers=h["t1"]).json()["groups"][0]["items"][0]
    assert hit["href"] == "/teacher/students?q=T23IS001" and "T23IS001" in hit["subtitle"]


def test_student_search_never_returns_other_people(client, campus):  # noqa: F811
    db, h = campus["db"], campus["h"]
    db.add_all([
        m.Achievement(student_id=campus["s1"].id, title="Robotics Hackathon", type="Hackathon"),
        m.Achievement(student_id=campus["s2"].id, title="Robotics Workshop", type="Activity"),
        m.DocumentRequest(student_id=campus["s2"].id, type="Bonafide Certificate", purpose="Robotics visa"),
    ])
    db.commit()
    r = client.get("/search?q=robotics", headers=h["s1"])
    assert _titles(r, "achievements") == ["Robotics Hackathon"]
    assert r.json()["total_results"] == 1                      # nothing of s2's leaks in
    assert client.get("/search?q=Bina", headers=h["s1"]).json()["total_results"] == 0   # students can't look up classmates
    assert _titles(client.get("/search?q=TST", headers=h["s1"]), "subjects") == ["TST701 — Subject One"]


def test_hod_search_stays_in_department_and_admin_sees_all(client, campus):  # noqa: F811
    db, h = campus["db"], campus["h"]
    admin = m.User(email="admin@test.local", hashed_password="x", role="admin")
    db.add(admin)
    db.commit()
    assert _titles(client.get("/search?q=T23", headers=h["hod"]), "students") == ["Asha Rao", "Bina Kumar"]
    assert _titles(client.get("/search?q=T23", headers=h["hod_cse"]), "students") == ["Esha M"]
    assert _titles(client.get("/search?q=Teacher", headers=h["hod"]), "faculty") == ["Teacher One", "Teacher Two"]
    everyone = client.get("/search?q=T23", headers=auth_headers(admin.id))
    assert _titles(everyone, "students") == ["Asha Rao", "Bina Kumar", "Esha M"]
    assert _titles(client.get("/search?q=test.local", headers=auth_headers(admin.id)), "accounts")   # admin can find logins
    assert "accounts" not in {g["key"] for g in client.get("/search?q=test.local", headers=h["hod"]).json()["groups"]}


def test_search_treats_wildcards_as_text_and_needs_login(client, campus):  # noqa: F811
    h = campus["h"]
    assert client.get("/search?q=%25", headers=h["hod"]).json()["total_results"] == 0   # "%" is not "match everything"
    assert client.get("/search?q=_", headers=h["hod"]).json()["total_results"] == 0
    legacy = client.get("/search?q=T23", headers=h["hod"]).json()["results"]      # older pages read this shape
    assert sorted(r["name"] for r in legacy["students"]) == ["Asha Rao", "Bina Kumar"]
    assert client.get("/search?q=a").status_code == 401
    assert client.get("/search?q=", headers=h["hod"]).status_code == 422


# ---------- account ----------

def test_profile_for_each_role(client, campus):  # noqa: F811
    h = campus["h"]
    s = client.get("/auth/profile", headers=h["s1"]).json()
    assert (s["name"], s["subtitle"], s["role"], s["editable"]) == ("Asha Rao", "T23IS001", "student", [])
    t = client.get("/auth/profile", headers=h["t1"]).json()
    assert (t["name"], t["subtitle"], t["editable"]) == ("Teacher One", "Assistant Professor", ["qualifications"])
    hod = client.get("/auth/profile", headers=h["hod"]).json()
    assert hod["details"]["department"] == "ISE (TEST)" and hod["editable"] == ["display_name", "title"]
    assert client.get("/auth/profile").status_code == 401


def test_profile_edit_only_own_allowed_fields(client, campus):  # noqa: F811
    h = campus["h"]
    assert client.patch("/auth/profile", headers=h["t1"], json={"qualifications": "M.Tech, PhD"}).json()["details"]["qualifications"] == "M.Tech, PhD"
    assert client.get("/auth/profile", headers=h["t2"]).json()["details"]["qualifications"] is None
    assert client.patch("/auth/profile", headers=h["t1"], json={"display_name": "Someone Else"}).status_code == 403
    assert client.patch("/auth/profile", headers=h["s1"], json={"title": "HOD"}).status_code == 403
    updated = client.patch("/auth/profile", headers=h["hod"], json={"display_name": "Dr. Test Head", "title": "Professor & Head"}).json()
    assert (updated["name"], updated["subtitle"]) == ("Dr. Test Head", "Professor & Head")
    assert client.patch("/auth/profile", headers=h["hod"], json={"display_name": "x"}).status_code == 400


def test_photo_upload_for_staff_and_student(client, campus, monkeypatch):  # noqa: F811
    stored = {}
    monkeypatch.setattr("app.routers.account.upload_file", lambda path, content, content_type=None: stored.__setitem__(path, content))
    monkeypatch.setattr("app.routers.account.delete_file", lambda path: stored.pop(path, None))
    h = campus["h"]
    assert client.post("/auth/profile/photo", headers=h["t1"], files={"file": ("me.gif", b"GIF89a", "image/gif")}).status_code == 400
    url = client.post("/auth/profile/photo", headers=h["t1"], files={"file": ("me.png", b"\x89PNG", "image/png")}).json()["photo_url"]
    assert url.startswith("/profile-photos/user") and client.get("/auth/profile", headers=h["t1"]).json()["photo_url"] == url
    student_url = client.post("/auth/profile/photo", headers=h["s1"], files={"file": ("me.jpg", b"\xff\xd8", "image/jpeg")}).json()["photo_url"]
    assert student_url.startswith("/profile-photos/T23IS001_photo_")
    assert client.get("/student/dashboard", headers=h["s1"]).json()["photo_url"] == student_url   # same photo the resume builder uses
    assert client.get("/auth/profile", headers=h["t2"]).json()["photo_url"] is None
    assert len(stored) == 2


def test_change_password(client, campus):  # noqa: F811
    db = campus["db"]
    user = m.User(email="pw@test.local", hashed_password=hash_password("OldPass123"), role="teacher", faculty_id=campus["t2"].id)
    db.add(user)
    db.commit()
    h = auth_headers(user.id)
    change = lambda cur, new: client.post("/auth/change-password", headers=h, json={"current_password": cur, "new_password": new})
    assert change("wrong", "NewPass456").status_code == 400
    assert change("OldPass123", "short1").status_code == 400
    assert change("OldPass123", "onlyletters").status_code == 400
    assert change("OldPass123", "OldPass123").status_code == 400
    assert change("OldPass123", "NewPass456").status_code == 200
    assert client.post("/auth/login", json={"email": "pw@test.local", "password": "OldPass123"}).status_code == 401
    assert client.post("/auth/login", json={"email": "pw@test.local", "password": "NewPass456"}).status_code == 200
    assert client.post("/auth/change-password", json={"current_password": "a", "new_password": "b"}).status_code == 401
