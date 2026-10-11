"""Shared pytest fixtures for the HOD Department Intelligence tests.

Uses a fully isolated, in-memory SQLite database — created fresh per test
function — created via `Base.metadata.create_all`, NEVER the real
`anviksha_dev.db`. `get_db` is overridden on the real FastAPI `app` for the
duration of each test so requests hit only this isolated database (Part A2:
"these [test fixtures] must never touch the real DB").
"""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from fastapi.testclient import TestClient

from app.core.database import Base, get_db
from app.core.security import create_access_token
from app.main import app
from app.models import models as m


@pytest.fixture()
def db_session():
    # StaticPool keeps every session and thread on the one in-memory database;
    # without it, a request that commits and then queries again is handed a
    # fresh, empty database.
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    # create_all builds tables only; the placement views come from the same
    # module the migration uses.
    from app.core.placement_views import create_views
    with engine.begin() as conn:
        create_views(conn)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


@pytest.fixture()
def client(db_session):
    def _override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = _override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture()
def two_department_seed(db_session):
    """Two real, isolated departments (ISE-like and CSE-like), each with its
    own faculty, subjects, students, and a real AttendanceSession dated
    today for one of them — the minimum needed to prove one HOD never sees
    the other department's data."""
    from datetime import date

    db = db_session

    dept_a = m.Department(name="Information Science & Engineering (TEST)")
    dept_b = m.Department(name="Computer Science & Engineering (TEST)")
    db.add_all([dept_a, dept_b])
    db.flush()

    hod_a = m.User(email="hod.a@test.local", hashed_password="x", role="hod", department_id=dept_a.id)
    hod_b = m.User(email="hod.b@test.local", hashed_password="x", role="hod", department_id=dept_b.id)
    db.add_all([hod_a, hod_b])

    faculty_a = m.Faculty(name="Faculty A", department_id=dept_a.id, designation="Assistant Professor")
    faculty_b = m.Faculty(name="Faculty B", department_id=dept_b.id, designation="Assistant Professor")
    db.add_all([faculty_a, faculty_b])
    db.flush()

    subject_a = m.Subject(code="TESTA101", name="Dept A Subject", department_id=dept_a.id, semester=3, faculty_id=faculty_a.id)
    subject_b = m.Subject(code="TESTB101", name="Dept B Subject", department_id=dept_b.id, semester=3, faculty_id=faculty_b.id)
    db.add_all([subject_a, subject_b])
    db.flush()

    student_a1 = m.Student(usn="TESTA001", name="Student A1", department_id=dept_a.id, batch="2024", semester=3, status="active")
    student_a2 = m.Student(usn="TESTA002", name="Student A2", department_id=dept_a.id, batch="2024", semester=3, status="active")
    student_b1 = m.Student(usn="TESTB001", name="Student B1", department_id=dept_b.id, batch="2024", semester=3, status="active")
    db.add_all([student_a1, student_a2, student_b1])
    db.flush()

    session_a = m.AttendanceSession(subject_id=subject_a.id, date=date.today(), marked_by_faculty_id=faculty_a.id)
    db.add(session_a)
    db.flush()
    db.add_all([
        m.AttendanceRecord(session_id=session_a.id, student_id=student_a1.id, present=True),
        m.AttendanceRecord(session_id=session_a.id, student_id=student_a2.id, present=False),
    ])
    db.commit()

    return {
        "dept_a": dept_a, "dept_b": dept_b, "hod_a": hod_a, "hod_b": hod_b,
        "faculty_a": faculty_a, "faculty_b": faculty_b,
        "subject_a": subject_a, "subject_b": subject_b,
    }


def auth_headers(user_id: int) -> dict:
    token = create_access_token({"sub": str(user_id)})
    return {"Authorization": f"Bearer {token}"}
