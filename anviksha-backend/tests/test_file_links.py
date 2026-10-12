"""Stored files open only through the signed link the API hands out."""
import time

import pytest

from app.core import file_links, file_storage
from app.models import models as m
from tests.conftest import auth_headers
from tests.test_missing_endpoints import campus  # noqa: F401  (shared fixture)


@pytest.fixture()
def disk(tmp_path, monkeypatch):
    """Local-disk storage in a throwaway folder."""
    monkeypatch.setattr(file_storage, "SUPABASE_URL", "")
    monkeypatch.setattr(file_storage, "SUPABASE_SERVICE_KEY", "")
    monkeypatch.setattr(file_storage, "_LOCAL_ROOT", str(tmp_path))
    return tmp_path


def test_signature_round_trip_and_tampering():
    link = file_links.signed("/certificates/My File (1).pdf")
    path, query = link.split("?")
    assert path == "/certificates/My%20File%20%281%29.pdf"
    params = dict(p.split("=") for p in query.split("&"))
    assert file_links.is_valid("/certificates/My File (1).pdf", int(params["exp"]), params["sig"])
    assert not file_links.is_valid("/certificates/Other.pdf", int(params["exp"]), params["sig"])       # another file
    assert not file_links.is_valid("/certificates/My File (1).pdf", int(params["exp"]) + 60, params["sig"])  # stretched expiry
    assert not file_links.is_valid("/certificates/My File (1).pdf", None, None)
    expired = file_links.signed("/certificates/x.pdf", lifetime=-5).split("?")[1]
    e = dict(p.split("=") for p in expired.split("&"))
    assert int(e["exp"]) < time.time() and not file_links.is_valid("/certificates/x.pdf", int(e["exp"]), e["sig"])
    assert file_links.signed("/profile-photos/a.png") == "/profile-photos/a.png" and file_links.signed(None) is None


def test_certificate_opens_only_with_the_signed_link(client, campus, disk):  # noqa: F811
    db, h, s1 = campus["db"], campus["h"], campus["s1"]
    file_storage.upload_file("real_mooc_certs/T23IS001 cert.pdf", b"%PDF-1.4 real certificate")
    db.add_all([
        m.CertificateFile(student_id=s1.id, filename="T23IS001 cert.pdf", display_label="MOOC Certificate", category="Certificate", is_demo=False),
        m.CertificateFile(student_id=s1.id, filename="placeholder.pdf", display_label="Demo", category="Hackathon", is_demo=True),
    ])
    db.commit()

    listed = client.get("/student/certificates", headers=h["s1"]).json()
    assert [c["label"] for c in listed] == ["MOOC Certificate"]                 # demo placeholders are not listed
    link = listed[0]["download_url"]
    assert "sig=" in link and "exp=" in link

    opened = client.get(link)                                                    # no login header: the link itself is the pass
    assert opened.status_code == 200 and opened.content == b"%PDF-1.4 real certificate"
    assert opened.headers["content-type"] == "application/pdf" and opened.headers["content-disposition"].startswith("inline")
    assert client.get(link + "&download=true").headers["content-disposition"].startswith("attachment")

    bare = link.split("?")[0]
    assert client.get(bare).status_code == 403                                   # guessing the file name opens nothing
    assert client.get(bare + "?exp=9999999999&sig=" + "0" * 40).status_code == 403
    assert client.get("/student/certificates", headers=h["s2"]).json() == []     # another student is never handed the link


def test_file_routes_reject_path_tricks_and_report_missing_files(client, disk):
    link = file_links.signed("/certificates/not-there.pdf")
    assert client.get(link).status_code == 404
    assert client.get("/certificates/..%2F..%2F.env").status_code in (403, 404)
    assert client.get("/profile-photos/missing.png").status_code == 404           # public route, still no file


def test_notes_and_resume_links_are_signed(client, campus, disk, monkeypatch):  # noqa: F811
    h, a1 = campus["h"], campus["a1"]
    for module in ("app.routers.notes", "app.routers.student_extras"):          # the shared fixture stubs these; use the real disk here
        monkeypatch.setattr(f"{module}.upload_file", file_storage.upload_file)
    client.post("/teacher/notes", headers=h["t1"], data={"teaching_assignment_id": a1.id, "kind": "note", "title": "Unit 1"},
                files={"file": ("unit 1.pdf", b"%PDF-1.4 notes", "application/pdf")})
    note_link = client.get("/student/notes", headers=h["s1"]).json()["notes"][0]["file_url"]
    assert "sig=" in note_link and client.get(note_link).content == b"%PDF-1.4 notes"
    assert client.get(note_link.split("?")[0]).status_code == 403

    resume_link = client.post("/student/profile/resume", headers=h["s1"], files={"file": ("cv.pdf", b"%PDF-1.4 cv", "application/pdf")}).json()["resume_file_url"]
    assert client.get(resume_link).content == b"%PDF-1.4 cv" and client.get(resume_link.split("?")[0]).status_code == 403


def test_admin_storage_status_and_filling_a_missing_certificate(client, campus, disk):  # noqa: F811
    db = campus["db"]
    admin = m.User(email="admin@test.local", hashed_password="x", role="admin")
    db.add_all([admin,
                m.CertificateFile(student_id=campus["s1"].id, filename="here.pdf", category="Certificate", is_demo=False),
                m.CertificateFile(student_id=campus["s2"].id, filename="gone.pdf", category="Certificate", is_demo=False),
                m.CertificateFile(student_id=campus["s2"].id, filename="demo.pdf", category="Certificate", is_demo=True)])
    db.commit()
    file_storage.upload_file("real_mooc_certs/here.pdf", b"%PDF-1.4")
    ah = auth_headers(admin.id)

    status = client.get("/admin/storage/status", headers=ah).json()
    assert status["mode"] == "local" and status["certificates"] == {"expected": 2, "present": 1, "missing": ["gone.pdf"], "error": None}

    put = lambda name, data: client.post("/admin/storage/certificate-file", headers=ah, files={"file": (name, data, "application/pdf")})  # noqa: E731
    assert put("unrelated.pdf", b"%PDF-1.4").status_code == 400      # no record refers to it
    assert put("demo.pdf", b"%PDF-1.4").status_code == 400           # placeholders are not filled in
    assert put("gone.pdf", b"not a pdf").status_code == 400
    assert put("gone.pdf", b"%PDF-1.4 restored").status_code == 200
    assert client.get("/admin/storage/status", headers=ah).json()["certificates"]["missing"] == []
    assert client.get("/admin/storage/status", headers=campus["h"]["hod"]).status_code == 403
    assert client.post("/admin/storage/certificate-file", headers=campus["h"]["s1"], files={"file": ("gone.pdf", b"%PDF", "application/pdf")}).status_code == 403
