"""What the assistant is allowed to look up, per role.

The model never sees the database. It can only ask for one of the lookups
below, and each lookup takes the signed-in user and reads strictly within
what that user may see: a student their own records, a teacher their own
classes, an HOD their department, an admin everything. Nothing the model
writes can widen that, because the scope comes from `user`, never from an
argument the model supplies.
"""
import json
from typing import Callable, Optional

from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.core import placement_stats
from app.models.models import (
    Achievement, ActivityLog, CertificateFile, CounselingNote, Department, DocumentRequest, Faculty, Feedback,
    GeneratedPresentation, Internship, Note, Placement, QuestionPaper, Student, Subject, TeachingAssignment, User,
)

MAX_ROWS = 40
AT_RISK_CGPA = 6.0


def _student_row(s: Student) -> dict:
    return {"usn": s.usn, "name": s.name, "batch": s.batch, "semester": s.semester, "cgpa": s.cgpa,
            "backlogs": s.backlogs or 0, "attendance_pct": s.attendance_pct, "status": s.status}


def _limit(value, default=15) -> int:
    try:
        return max(1, min(int(value), MAX_ROWS))
    except (TypeError, ValueError):
        return default


def _pick_students(query, which: str, limit: int) -> list[dict]:
    which = (which or "all").lower()
    if which == "at_risk":
        query = query.filter((Student.cgpa < AT_RISK_CGPA) | (Student.backlogs > 0)).order_by(Student.cgpa.asc())
    elif which == "backlogs":
        query = query.filter(Student.backlogs > 0).order_by(Student.backlogs.desc())
    elif which == "top":
        query = query.filter(Student.cgpa.isnot(None)).order_by(Student.cgpa.desc())
    else:
        query = query.order_by(Student.usn)
    total = query.count()
    return {"matching": total, "shown": min(total, limit), "students": [_student_row(s) for s in query.limit(limit).all()],
            "definition": f"at_risk = CGPA below {AT_RISK_CGPA} or at least one backlog" if which == "at_risk" else None}


def _batch(db: Session, value) -> str:
    """The stored batch for what the user said. Batches are stored by entry
    year, but people also name them by graduation year ("the 2027 batch" is
    the 2023 entry). A year that is not an entry year but is four years after
    one is read as that graduation year."""
    wanted = str(value or "").strip()
    if not wanted:
        return ""
    known = {b for (b,) in db.query(Student.batch).distinct() if b}
    if wanted in known:
        return wanted
    try:
        entry = str(int(wanted[:4]) - 4)
    except ValueError:
        return wanted
    return entry if entry in known else wanted


def _search_question_bank(db: Session, user: User, query: str = "", **_) -> dict:
    from app.core.rag_retrieval import retrieve
    hits = retrieve(db, query or "", top_k=5)
    return {"query": query, "excerpts": [{"subject": h["subject_folder"], "text": h["text"][:700]} for h in hits]}


# ------------------------------------------------------------------ student

def _me(db: Session, user: User) -> Student:
    return db.query(Student).filter(Student.id == user.student_id).first()


def s_academics(db: Session, user: User, **_) -> dict:
    from app.routers.student import _achievement_summary
    s = _me(db, user)
    cohort = db.query(Student).filter(Student.batch == s.batch, Student.department_id == s.department_id,
                                      Student.cgpa.isnot(None)).order_by(Student.cgpa.desc()).all()
    rank = next((i + 1 for i, c in enumerate(cohort) if c.id == s.id), None)
    summary = _achievement_summary(db, s)
    return {**_student_row(s), "department": s.department.name if s.department else None,
            "semester_sgpa": s.semester_sgpa or {}, "rank_in_batch": rank, "batch_size_ranked": len(cohort),
            "profile_score": summary["profile_score"], "skills": s.skills, "linkedin_on_file": bool(s.linkedin),
            "github_on_file": bool(s.github), "resume_on_file": bool(s.resume_file or s.resume_link)}


def s_attendance(db: Session, user: User, **_) -> dict:
    from app.routers.student import my_attendance
    return my_attendance(db=db, user=user)


def s_notes_deadlines(db: Session, user: User, **_) -> dict:
    from app.routers.notes import my_notes_and_deadlines
    data = my_notes_and_deadlines(db=db, user=user)
    strip = lambda rows: [{k: v for k, v in r.items() if k != "file_url"} | {"has_file": bool(r.get("file_url"))} for r in rows]  # noqa: E731
    return {"notes": strip(data["notes"]), "deadlines": strip(data["deadlines"])}


def s_achievements(db: Session, user: User, **_) -> dict:
    from app.routers.student import _achievement_summary
    summary = _achievement_summary(db, _me(db, user))
    return {"profile_score": summary["profile_score"], "count": summary["achievements_count"],
            "breakdown": summary["achievements_breakdown"], "items": summary["achievement_items"],
            "points_rule": "Certificate 50, hackathon 50 (+100 if won), project 100; CGPA adds 50-1000 by tier"}


def s_placements(db: Session, user: User, **_) -> dict:
    return placement_stats.student_records(db, user.student_id)


def s_subjects(db: Session, user: User, **_) -> dict:
    from app.routers.feedback import _courses_for
    s = _me(db, user)
    return {"semester": s.semester, "subjects": [{"code": c["code"], "name": c["name"], "teacher": c["faculty_name"],
                                                    "feedback_given": c["submitted"]} for c in _courses_for(db, s)]}


def s_counseling(db: Session, user: User, **_) -> dict:
    rows = db.query(CounselingNote).filter(CounselingNote.student_id == user.student_id).order_by(CounselingNote.date.desc()).limit(10).all()
    return {"notes": [{"date": str(n.date)[:10], "note": n.note, "my_reply": n.reply_status, "mentor_reply": n.teacher_reply} for n in rows]}


def s_batch_placements(db: Session, user: User, **_) -> dict:
    """Totals only — no classmate is named."""
    s = _me(db, user)
    row = next((r for r in placement_stats.batch_rows(db, s.department_id) if r["batch"] == s.batch), None)
    overview = placement_stats.overview(db, s.department_id, "", s.batch)
    return {"batch": s.batch, "stats": row, "top_companies": overview["top_companies"]}


# ------------------------------------------------------------------ teacher

def _my_student_ids(db: Session, user: User) -> list[int]:
    from app.routers.teacher import _teacher_student_ids
    return _teacher_student_ids(db, user.faculty_id)


def t_classes(db: Session, user: User, **_) -> dict:
    rows = db.query(TeachingAssignment).filter(TeachingAssignment.faculty_id == user.faculty_id).all()
    subjects = db.query(Subject).filter(Subject.faculty_id == user.faculty_id).order_by(Subject.semester).all()
    return {
        "classes": [{"batch": a.batch, "semester": a.semester, "section": a.section, "subject": f"{a.subject.code} {a.subject.name}" if a.subject else None,
                     "passed_out": bool(a.passed_out)} for a in rows],
        "subjects_allotted": [{"code": s.code, "name": s.name, "semester": s.semester} for s in subjects],
        "students_in_my_classes": len(_my_student_ids(db, user)),
    }


def t_students(db: Session, user: User, which: str = "all", limit: int = 15, **_) -> dict:
    ids = _my_student_ids(db, user)
    if not ids:
        return {"matching": 0, "shown": 0, "students": [], "note": "No students are linked to your classes yet."}
    return _pick_students(db.query(Student).filter(Student.id.in_(ids)), which, _limit(limit))


def t_placements(db: Session, user: User, **_) -> dict:
    ids = _my_student_ids(db, user)
    if not ids:
        return {"students": 0, "placed": 0, "offers": []}
    offers = db.query(Placement).filter(Placement.student_id.in_(ids), Placement.placed == True).all()  # noqa: E712
    interns = db.query(Internship).filter(Internship.student_id.in_(ids)).all()
    return {
        "students": len(ids), "placed": len({o.student_id for o in offers}),
        "offers": [{"usn": o.student.usn, "name": o.student.name, "company": o.company_ref.name if o.company_ref else o.company,
                    "package_lpa": float(o.package_lpa) if o.package_lpa is not None else None, "offer_type": o.offer_type} for o in offers[:MAX_ROWS]],
        "internships": [{"usn": i.student.usn, "name": i.student.name, "company": i.company_ref.name if i.company_ref else i.company,
                         "stipend_per_month": float(i.stipend_per_month) if i.stipend_per_month is not None else None} for i in interns[:MAX_ROWS]],
    }


def t_feedback(db: Session, user: User, **_) -> dict:
    from app.routers.feedback import my_feedback_results
    data = my_feedback_results(db=db, user=user)
    data.pop("questions", None)
    return data


def t_my_work(db: Session, user: User, **_) -> dict:
    notes = db.query(Note).filter(Note.faculty_id == user.faculty_id).order_by(Note.id.desc()).limit(15).all()
    papers = db.query(QuestionPaper).filter(QuestionPaper.faculty_id == user.faculty_id).order_by(QuestionPaper.id.desc()).limit(15).all()
    decks = db.query(GeneratedPresentation).filter(GeneratedPresentation.faculty_id == user.faculty_id).order_by(GeneratedPresentation.id.desc()).limit(15).all()
    return {
        "notes_and_deadlines": [{"kind": n.kind, "title": n.title, "due_date": n.due_date, "posted": str(n.created_at)[:10]} for n in notes],
        "question_papers": [{"title": p.title, "set": p.set_label, "saved": str(p.created_at)[:10]} for p in papers],
        "presentations": [{"title": d.title, "slides": d.slide_count, "created": str(d.created_at)[:10]} for d in decks],
    }


# ------------------------------------------------------- HOD (one department) and admin (all)

def _graduation_year(batch) -> Optional[int]:
    try:
        return int(batch) + 4
    except (TypeError, ValueError):
        return None


def _dept_id(user: User) -> Optional[int]:
    """The department an HOD is limited to; None for an admin (no limit)."""
    return user.department_id if user.role == "hod" else None


def _scoped(query, column, dept_id):
    return query.filter(column == dept_id) if dept_id else query


def _departments(db: Session, dept_id) -> list[Department]:
    return _scoped(db.query(Department), Department.id, dept_id).all()


def d_overview(db: Session, user: User, **_) -> dict:
    dept_id = _dept_id(user)
    students = _scoped(db.query(Student), Student.department_id, dept_id)
    by_batch = students.with_entities(Student.batch, Student.status, func.count(Student.id), func.avg(Student.cgpa)).group_by(Student.batch, Student.status).all()
    return {
        "departments": [d.name for d in _departments(db, dept_id)],
        "students_total": students.count(),
        "faculty_total": _scoped(db.query(Faculty), Faculty.department_id, dept_id).count(),
        "subjects_total": _scoped(db.query(Subject), Subject.department_id, dept_id).count(),
        "students_with_backlogs": students.filter(Student.backlogs > 0).count(),
        "by_batch": [{"batch": b, "status": st, "students": n, "average_cgpa": round(float(avg), 2) if avg is not None else None}
                     for b, st, n, avg in sorted(by_batch, key=lambda r: (r[0] or "", r[1] or ""))],
    }


def d_students(db: Session, user: User, which: str = "all", batch: str = "", limit: int = 15, **_) -> dict:
    q = _scoped(db.query(Student), Student.department_id, _dept_id(user))
    batch = _batch(db, batch)
    if batch:
        q = q.filter(Student.batch == batch)
    return _pick_students(q, which, _limit(limit))


def d_find_student(db: Session, user: User, query: str = "", **_) -> dict:
    like = f"%{(query or '').strip()}%"
    q = _scoped(db.query(Student), Student.department_id, _dept_id(user)).filter((Student.name.ilike(like)) | (Student.usn.ilike(like)))
    rows = q.limit(5).all()
    out = []
    for s in rows:
        record = placement_stats.student_records(db, s.id)
        out.append({**_student_row(s), "placements": record["placements"], "internships": record["internships"],
                    "achievements": db.query(Achievement).filter(Achievement.student_id == s.id).count()
                    + db.query(CertificateFile).filter(CertificateFile.student_id == s.id, CertificateFile.is_demo == False).count()})  # noqa: E712
    return {"matching": q.count(), "students": out}


def d_faculty(db: Session, user: User, **_) -> dict:
    dept_id = _dept_id(user)
    out = []
    for f in _scoped(db.query(Faculty), Faculty.department_id, dept_id).order_by(Faculty.name).all():
        rows = db.query(Feedback.overall).filter(Feedback.faculty_id == f.id).all()
        out.append({
            "name": f.name, "designation": f.designation,
            "subjects_allotted": db.query(Subject).filter(Subject.faculty_id == f.id).count(),
            "classes_set_up": db.query(TeachingAssignment).filter(TeachingAssignment.faculty_id == f.id).count(),
            "extra_work": f.extra_work, "extra_work_status": f.extra_work_status,
            "feedback_responses": len(rows),
            "feedback_average": round(sum(r[0] for r in rows) / len(rows), 2) if rows else None,
        })
    return {"faculty": out}


def d_faculty_feedback(db: Session, user: User, faculty_name: str = "", **_) -> dict:
    from app.routers.feedback import _subject_map, _summary
    like = f"%{(faculty_name or '').strip()}%"
    matches = _scoped(db.query(Faculty), Faculty.department_id, _dept_id(user)).filter(Faculty.name.ilike(like)).all()
    if len(matches) != 1:
        return {"error": "No single faculty member matches that name", "candidates": [f.name for f in matches][:10]}
    rows = db.query(Feedback).filter(Feedback.faculty_id == matches[0].id).all()
    return {"faculty": matches[0].name, **_summary(rows, _subject_map(db, rows), reveal_all=True)}


def d_batch_placements(db: Session, user: User, batch: str = "", **_) -> dict:
    out = []
    batch = _batch(db, batch)
    for d in _departments(db, _dept_id(user)):
        for row in placement_stats.batch_rows(db, d.id):
            if not batch or row["batch"] == batch:
                out.append({"department": d.name, "graduates_in": _graduation_year(row["batch"]), **row})
    return {"batches": out, "note": "placement_pct = placed students / all students in the batch. 'batch' is the entry year."}


def d_company_stats(db: Session, user: User, company: str = "", batch: str = "", **_) -> dict:
    sql = "SELECT company, batch, offers_count, placed_students, avg_package_lpa, highest_package_lpa, interns_count, avg_stipend_per_month FROM v_company_stats WHERE 1=1"
    params: dict = {}
    dept_id = _dept_id(user)
    batch = _batch(db, batch)
    if dept_id:
        sql += " AND department_id = :d"
        params["d"] = dept_id
    if company:
        sql += " AND lower(company) LIKE :c"
        params["c"] = f"%{company.strip().lower()}%"
    if batch:
        sql += " AND batch = :b"
        params["b"] = str(batch)
    rows = db.execute(text(sql + " ORDER BY offers_count DESC, company"), params).mappings().all()
    num = lambda v: float(v) if v is not None else None  # noqa: E731
    return {"companies": [{"company": r["company"], "batch": r["batch"], "offers": int(r["offers_count"] or 0), "placed_students": int(r["placed_students"] or 0),
                           "average_package_lpa": num(r["avg_package_lpa"]), "highest_package_lpa": num(r["highest_package_lpa"]),
                           "interns": int(r["interns_count"] or 0), "average_stipend_per_month": num(r["avg_stipend_per_month"])} for r in rows[:MAX_ROWS]]}


def d_placed_students(db: Session, user: User, batch: str = "", company: str = "", min_package_lpa: float = 0, **_) -> dict:
    q = db.query(Placement).join(Student, Student.id == Placement.student_id).filter(
        Placement.placed == True, (Placement.status.is_(None)) | (Placement.status != "declined"))  # noqa: E712
    q = _scoped(q, Student.department_id, _dept_id(user))
    batch = _batch(db, batch)
    if batch:
        q = q.filter(Student.batch == batch)
    offers = q.all()
    name_of = lambda o: o.company_ref.name if o.company_ref else o.company  # noqa: E731
    if company:
        offers = [o for o in offers if company.strip().lower() in (name_of(o) or "").lower()]
    try:
        floor = float(min_package_lpa or 0)
    except (TypeError, ValueError):
        floor = 0
    if floor:
        offers = [o for o in offers if o.package_lpa is not None and float(o.package_lpa) >= floor]
    offers.sort(key=lambda o: -(float(o.package_lpa) if o.package_lpa is not None else 0))
    return {"offers_matching": len(offers), "students_matching": len({o.student_id for o in offers}),
            "offers": [{"usn": o.student.usn, "name": o.student.name, "batch": o.student.batch, "company": name_of(o),
                        "package_lpa": float(o.package_lpa) if o.package_lpa is not None else None, "offer_type": o.offer_type} for o in offers[:MAX_ROWS]]}


def d_internships(db: Session, user: User, batch: str = "", **_) -> dict:
    q = _scoped(db.query(Internship).join(Student, Student.id == Internship.student_id), Student.department_id, _dept_id(user))
    batch = _batch(db, batch)
    if batch:
        q = q.filter(Student.batch == batch)
    rows = q.all()
    return {"internships_matching": len(rows), "internships": [{
        "usn": i.student.usn, "name": i.student.name, "batch": i.student.batch, "company": i.company_ref.name if i.company_ref else i.company,
        "stipend_per_month": float(i.stipend_per_month) if i.stipend_per_month is not None else None, "duration": i.duration_text, "status": i.status,
    } for i in rows[:MAX_ROWS]]}


def a_platform(db: Session, user: User, **_) -> dict:
    return {
        "logins_by_role": dict(db.query(User.role, func.count(User.id)).group_by(User.role).all()),
        "departments": db.query(Department).count(), "students": db.query(Student).count(), "faculty": db.query(Faculty).count(),
        "subjects": db.query(Subject).count(),
        "document_requests_by_status": dict(db.query(DocumentRequest.status, func.count(DocumentRequest.id)).group_by(DocumentRequest.status).all()),
        "feedback_responses": db.query(Feedback).count(),
    }


def a_activity(db: Session, user: User, limit: int = 15, **_) -> dict:
    rows = db.query(ActivityLog).order_by(ActivityLog.timestamp.desc()).limit(_limit(limit)).all()
    return {"recent_actions": [{"who": r.actor_email, "role": r.actor_role, "action": r.action, "when": str(r.timestamp)[:16]} for r in rows]}


# ------------------------------------------------------------------ registry

def _tool(fn: Callable, description: str, properties: Optional[dict] = None, status: str = "Looking that up…") -> dict:
    return {"fn": fn, "status": status, "spec": {"type": "function", "function": {
        "name": fn.__name__, "description": description,
        "parameters": {"type": "object", "properties": properties or {}, "required": []},
    }}}


_WHICH = {"type": "string", "enum": ["all", "at_risk", "backlogs", "top"], "description": "Which students: all, at_risk (CGPA below 6 or any backlog), backlogs, or top (highest CGPA)"}
_BATCH = {"type": "string", "description": "The batch as the user named it: an entry year (2023) or a graduation year (2027) both work. Leave empty for all batches."}
_LIMIT = {"type": "integer", "description": "How many rows to return, at most 40"}
_QB = _tool(_search_question_bank, "Search the department's bank of past internal-assessment question papers for a topic. Use for exam-style questions and syllabus topics.",
            {"query": {"type": "string", "description": "Topic or keywords"}}, "Searching past question papers…")

TOOLS: dict[str, list[dict]] = {
    "student": [
        _tool(s_academics, "The student's own academic record: CGPA, semester SGPAs, backlogs, rank in batch, profile score, profile completeness.", status="Reading your academic record…"),
        _tool(s_attendance, "The student's own attendance, overall and per subject.", status="Checking your attendance…"),
        _tool(s_notes_deadlines, "Study notes and deadlines teachers posted to the student's classes.", status="Checking your notes and deadlines…"),
        _tool(s_achievements, "The student's own achievements and certificates, with the points each earns.", status="Reading your achievements…"),
        _tool(s_placements, "The student's own placement offers and internships.", status="Checking your placement record…"),
        _tool(s_subjects, "The student's subjects this semester, who teaches each, and whether feedback was given.", status="Looking up your subjects…"),
        _tool(s_counseling, "Counseling notes the student's mentor wrote for them, with replies.", status="Reading your counseling notes…"),
        _tool(s_batch_placements, "Placement totals for the student's own batch: placed count, percentage, package figures, top recruiters. No individual is named.", status="Reading your batch's placement figures…"),
        _QB,
    ],
    "teacher": [
        _tool(t_classes, "The teacher's own classes and allotted subjects.", status="Looking up your classes…"),
        _tool(t_students, "Students in the teacher's own classes.", {"which": _WHICH, "limit": _LIMIT}, "Looking up your students…"),
        _tool(t_placements, "Placement offers and internships of students in the teacher's own classes.", status="Checking your students' placements…"),
        _tool(t_feedback, "Anonymous student feedback on the teacher's own subjects (hidden until 3 students respond).", status="Reading your feedback…"),
        _tool(t_my_work, "Notes and deadlines the teacher posted, their saved question papers and generated presentations.", status="Looking up your work…"),
        _QB,
    ],
    "hod": [
        _tool(d_overview, "Department overview: student, faculty and subject counts, backlog count, students and average CGPA per batch.", status="Reading department figures…"),
        _tool(d_students, "Students in the department.", {"which": _WHICH, "batch": _BATCH, "limit": _LIMIT}, "Looking up students…"),
        _tool(d_find_student, "Find one student by name or USN, with their placements, internships and achievement count.", {"query": {"type": "string", "description": "Name or USN"}}, "Finding that student…"),
        _tool(d_faculty, "Every faculty member: subjects allotted, classes set up, extra work, feedback average and number of responses. Use to compare faculty.", status="Reading faculty figures…"),
        _tool(d_faculty_feedback, "Detailed feedback for one faculty member: per question, per subject, comments.", {"faculty_name": {"type": "string"}}, "Reading that faculty member's feedback…"),
        _tool(d_batch_placements, "Placement statistics per batch: placed, unplaced, percentage, average / median / highest package, internships, PPOs. Use to compare batches.", {"batch": _BATCH}, "Reading placement figures…"),
        _tool(d_company_stats, "Per-recruiter figures: offers, students placed, packages, interns.", {"company": {"type": "string", "description": "Company name or part of it; empty for all"}, "batch": _BATCH}, "Reading recruiter figures…"),
        _tool(d_placed_students, "List students with placement offers, highest package first.", {"batch": _BATCH, "company": {"type": "string"}, "min_package_lpa": {"type": "number"}}, "Listing placed students…"),
        _tool(d_internships, "List students' internships with company and stipend.", {"batch": _BATCH}, "Listing internships…"),
        _QB,
    ],
}
TOOLS["admin"] = [
    _tool(a_platform, "Platform-wide counts: logins by role, departments, students, faculty, subjects, document requests by status, feedback responses.", status="Reading platform figures…"),
    _tool(a_activity, "The most recent recorded actions on the platform (who did what, when).", {"limit": _LIMIT}, "Reading recent activity…"),
] + [t for t in TOOLS["hod"]]


def tools_for(role: str) -> list[dict]:
    return TOOLS.get(role, [])


def run_tool(db: Session, user: User, name: str, arguments: str) -> tuple[str, str]:
    """Runs one lookup for this user. Returns (JSON result, status line).
    A name outside the user's own role is refused, whatever the model asks."""
    tool = next((t for t in tools_for(user.role) if t["spec"]["function"]["name"] == name), None)
    if not tool:
        return json.dumps({"error": f"'{name}' is not available to you"}), "Looking that up…"
    try:
        args = json.loads(arguments) if arguments and arguments.strip() else {}
        if not isinstance(args, dict):
            args = {}
    except ValueError:
        args = {}
    allowed = set(tool["spec"]["function"]["parameters"]["properties"])
    try:
        result = tool["fn"](db, user, **{k: v for k, v in args.items() if k in allowed})
    except Exception as exc:          # a failed lookup is reported to the model, never raised into the chat
        db.rollback()
        result = {"error": f"This lookup failed ({type(exc).__name__}). Tell the user this information is unavailable right now."}
    return json.dumps(result, default=str, ensure_ascii=False)[:9000], tool["status"]
