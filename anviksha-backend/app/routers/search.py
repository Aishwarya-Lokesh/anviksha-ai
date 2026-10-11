"""Global search behind the command palette. One box, but each role only ever
gets rows it is allowed to see: a student their own records, a teacher their
own classes, an HOD their department, an admin everything. Every result
carries the page it opens."""
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.models import (
    Achievement, CertificateFile, Company, DocumentRequest, Faculty, GeneratedPresentation, Note, Placement,
    QuestionPaper, Student, Subject, TeachingAssignment, User,
)

router = APIRouter(prefix="/search", tags=["search"])

LIMIT = 6


def _like(q: str) -> str:
    # % and _ are wildcards in LIKE; a search for "100%" should not match everything.
    escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _match(column, like: str):
    return column.ilike(like, escape="\\")


def _group(key: str, label: str, items: list) -> dict:
    return {"key": key, "label": label, "items": items}


def _students(rows, href) -> list:
    return [{"title": s.name, "subtitle": f"{s.usn} · Batch {s.batch}" if s.batch else s.usn, "href": href(s)} for s in rows]


def _subjects(rows, href) -> list:
    return [{"title": f"{s.code} — {s.name}", "subtitle": f"Semester {s.semester}" if s.semester else None, "href": href} for s in rows]


def _student_results(db: Session, user: User, like: str) -> list:
    student = db.query(Student).filter(Student.id == user.student_id).first()
    if not student:
        return []
    groups = []

    achievements = db.query(Achievement).filter(Achievement.student_id == student.id, _match(Achievement.title, like)).limit(LIMIT).all()
    certificates = db.query(CertificateFile).filter(
        CertificateFile.student_id == student.id, CertificateFile.is_demo == False,  # noqa: E712
        or_(_match(CertificateFile.display_label, like), _match(CertificateFile.filename, like)),
    ).limit(LIMIT).all()
    items = [{"title": a.title, "subtitle": a.type, "href": "/student/achievements"} for a in achievements]
    items += [{"title": c.display_label or "Certificate", "subtitle": "Certificate file", "href": "/student/achievements"} for c in certificates]
    groups.append(_group("achievements", "Achievements & certificates", items[:LIMIT]))

    from app.routers.teacher import _matching_student_ids
    assignments = db.query(TeachingAssignment).filter(
        TeachingAssignment.batch == student.batch, TeachingAssignment.semester == student.semester
    ).all()
    mine = [a.id for a in assignments if student.id in _matching_student_ids(db, [a])]
    notes = db.query(Note).filter(
        Note.teaching_assignment_id.in_(mine), or_(_match(Note.title, like), _match(Note.description, like))
    ).order_by(Note.created_at.desc()).limit(LIMIT).all() if mine else []
    groups.append(_group("notes", "Notes & deadlines", [{
        "title": n.title, "subtitle": f"Deadline · due {n.due_date}" if n.kind == "deadline" else "Study note",
        "href": "/student/notes",
    } for n in notes]))

    subjects = db.query(Subject).filter(
        Subject.department_id == student.department_id, Subject.semester == student.semester,
        or_(_match(Subject.name, like), _match(Subject.code, like)),
    ).limit(LIMIT).all()
    groups.append(_group("subjects", "My subjects", _subjects(subjects, "/student/attendance")))

    documents = db.query(DocumentRequest).filter(
        DocumentRequest.student_id == student.id, or_(_match(DocumentRequest.type, like), _match(DocumentRequest.purpose, like))
    ).limit(LIMIT).all()
    groups.append(_group("documents", "Document requests", [
        {"title": d.type, "subtitle": d.status, "href": "/student/documents"} for d in documents]))

    offers = db.query(Placement).outerjoin(Company, Company.id == Placement.company_id).filter(
        Placement.student_id == student.id, Placement.placed == True,  # noqa: E712
        or_(_match(Company.name, like), _match(Placement.company, like)),
    ).limit(LIMIT).all()
    groups.append(_group("placements", "My placements", [{
        "title": o.company_ref.name if o.company_ref else o.company,
        "subtitle": f"{float(o.package_lpa):g} LPA" if o.package_lpa is not None else o.ctc, "href": "/student/placement",
    } for o in offers]))
    return groups


def _teacher_results(db: Session, user: User, like: str) -> list:
    from app.routers.teacher import _teacher_student_ids

    ids = _teacher_student_ids(db, user.faculty_id)
    students = db.query(Student).filter(
        Student.id.in_(ids), or_(_match(Student.name, like), _match(Student.usn, like))
    ).order_by(Student.usn).limit(LIMIT).all() if ids else []
    assigned = [a.subject_id for a in db.query(TeachingAssignment).filter(TeachingAssignment.faculty_id == user.faculty_id).all() if a.subject_id]
    subjects = db.query(Subject).filter(
        or_(Subject.faculty_id == user.faculty_id, Subject.id.in_(assigned)),
        or_(_match(Subject.name, like), _match(Subject.code, like)),
    ).limit(LIMIT).all()
    notes = db.query(Note).filter(Note.faculty_id == user.faculty_id, _match(Note.title, like)).order_by(Note.created_at.desc()).limit(LIMIT).all()
    papers = db.query(QuestionPaper).filter(QuestionPaper.faculty_id == user.faculty_id, _match(QuestionPaper.title, like)).order_by(QuestionPaper.id.desc()).limit(LIMIT).all()
    decks = db.query(GeneratedPresentation).filter(GeneratedPresentation.faculty_id == user.faculty_id, _match(GeneratedPresentation.title, like)).order_by(GeneratedPresentation.id.desc()).limit(LIMIT).all()
    return [
        _group("students", "My students", _students(students, lambda s: f"/teacher/students?q={quote(s.usn)}")),
        _group("subjects", "My subjects", _subjects(subjects, "/teacher/ia-marks")),
        _group("notes", "Notes & deadlines I posted", [{"title": n.title, "subtitle": "Deadline" if n.kind == "deadline" else "Study note", "href": "/teacher/notes"} for n in notes]),
        _group("papers", "Question papers", [{"title": p.title, "subtitle": f"Set {p.set_label}", "href": "/teacher/question-paper"} for p in papers]),
        _group("presentations", "Presentations", [{"title": d.title, "subtitle": f"{d.slide_count} slides", "href": "/teacher/ppt-generator"} for d in decks]),
    ]


def _department_results(db: Session, like: str, department_id, base: str) -> list:
    """HOD (one department) and admin (department_id None = all)."""
    def scoped(query, column):
        return query.filter(column == department_id) if department_id else query

    students = scoped(db.query(Student), Student.department_id).filter(
        or_(_match(Student.name, like), _match(Student.usn, like))).order_by(Student.usn).limit(LIMIT).all()
    faculty = scoped(db.query(Faculty), Faculty.department_id).filter(
        or_(_match(Faculty.name, like), _match(Faculty.designation, like))).limit(LIMIT).all()
    subjects = scoped(db.query(Subject), Subject.department_id).filter(
        or_(_match(Subject.name, like), _match(Subject.code, like))).limit(LIMIT).all()

    company_q = db.query(Company).filter(_match(Company.name, like))
    if department_id:
        company_q = company_q.filter(Company.id.in_(
            db.query(Placement.company_id).join(Student, Student.id == Placement.student_id).filter(Student.department_id == department_id)))
    companies = company_q.limit(LIMIT).all()

    if base == "/hod":
        student_href = lambda s: f"/hod/students?q={quote(s.usn)}"  # noqa: E731
        faculty_href, subject_href, company_href = "/hod/faculty", "/hod/faculty", "/hod/placements"
    else:
        student_href = lambda s: f"/admin/users?q={quote(s.name)}"  # noqa: E731
        faculty_href, subject_href, company_href = "/admin/datasets/faculty", "/admin/datasets/subjects", "/admin/placements"

    return [
        _group("students", "Students", _students(students, student_href)),
        _group("faculty", "Faculty", [{"title": f.name, "subtitle": f.designation, "href": faculty_href} for f in faculty]),
        _group("subjects", "Subjects", _subjects(subjects, subject_href)),
        _group("companies", "Recruiters", [{"title": c.name, "subtitle": c.sector, "href": company_href} for c in companies]),
    ]


@router.get("")
def global_search(q: str = Query(..., min_length=1, max_length=80), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    like = _like(q.strip())
    if user.role == "student":
        groups = _student_results(db, user, like)
    elif user.role == "teacher":
        groups = _teacher_results(db, user, like)
    elif user.role == "hod":
        groups = _department_results(db, like, user.department_id, "/hod") if user.department_id else []
    elif user.role == "admin":
        groups = _department_results(db, like, None, "/admin")
        documents = db.query(DocumentRequest).filter(_match(DocumentRequest.type, like)).limit(LIMIT).all()
        groups.append(_group("documents", "Document requests", [
            {"title": d.type, "subtitle": d.status, "href": "/admin/documents"} for d in documents]))
        users = db.query(User).filter(_match(User.email, like)).limit(LIMIT).all()
        groups.append(_group("accounts", "Login accounts", [
            {"title": u.email, "subtitle": u.role, "href": "/admin/users"} for u in users]))
    else:
        groups = []
    groups = [g for g in groups if g["items"]]
    return {
        "query": q, "total_results": sum(len(g["items"]) for g in groups), "groups": groups,
        # The shape the previous search box read. Kept so a browser still holding
        # the older page (during a deploy, or from its cache) doesn't break.
        "results": {g["key"]: [{"name": i["title"], "status": i.get("subtitle")} for i in g["items"]] for g in groups},
    }
