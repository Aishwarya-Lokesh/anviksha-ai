from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional
from pydantic import BaseModel

from app.core.database import get_db
from app.core.security import require_role
from app.core.demo_mode import apply_demo_mask
from app.models.models import Student, Faculty, Subject, DocumentRequest, Department, User, Placement, CourseCompletion
from app.models.schemas import NLQueryRequest

router = APIRouter(prefix="/hod", tags=["hod"])


class AskAIRequest(BaseModel):
    question: str


@router.post("/ask-ai")
def ask_ai(payload: AskAIRequest, db: Session = Depends(get_db), user: User = Depends(require_role("hod"))):
    """Real department-scoped assistant for HODs — mirrors the teacher/admin
    ask-ai pattern: gather real, current data about THIS HOD's own
    department only (never another department's), then let the LLM answer
    freely against that grounded context."""
    from app.core.llm_client import ask

    if not payload.question or not payload.question.strip():
        return {"answer": "Please type a question so I can help — for example, ask about department average CGPA, at-risk students, or faculty workload.", "connected": True}

    dept = _department_or_403(user, db)
    students = db.query(Student).filter(Student.department_id == dept.id).all()
    active_students = [s for s in students if s.status == "active"]

    from app.core.data_export import is_export_request, build_teacher_export, write_xlsx
    if is_export_request(payload.question):
        rows, sheet_name, title = build_teacher_export(db, active_students, payload.question)
        stored_name, _ = write_xlsx(rows, sheet_name, f"hod_{title}")
        return {
            "answer": f"Here's your real department {title} — {len(rows)} row(s), ready to download.",
            "connected": True, "download_url": f"/exports/{stored_name}", "download_filename": f"{title.replace(' ', '_')}.xlsx",
        }

    from app.core.chat_charts import is_chart_request, build_teacher_chart
    if is_chart_request(payload.question):
        chart = build_teacher_chart(active_students, payload.question)
        return {"answer": chart["title"] + ".", "connected": True, "chart": chart}

    faculty = db.query(Faculty).filter(Faculty.department_id == dept.id).all()
    subjects = db.query(Subject).filter(Subject.department_id == dept.id).all()

    ranked = sorted([s for s in active_students if s.cgpa is not None], key=lambda s: s.cgpa, reverse=True)
    at_risk = [s for s in active_students if (s.backlogs or 0) > 0 or (s.attendance_pct is not None and s.attendance_pct < 75)]
    avg_cgpa = round(sum(s.cgpa for s in active_students if s.cgpa is not None) / len([s for s in active_students if s.cgpa is not None]), 2) if any(s.cgpa is not None for s in active_students) else None

    context = (
        f"Department: {dept.name}\n"
        f"Real total students: {len(students)} ({len(active_students)} active, {len(students) - len(active_students)} passed out)\n"
        f"Real faculty count: {len(faculty)}\n"
        f"Real subject count: {len(subjects)}\n"
        f"Department average CGPA (active students): {avg_cgpa if avg_cgpa is not None else 'not available'}\n"
        f"Students at risk (backlogs or attendance below 75%): {len(at_risk)} — {', '.join(s.name for s in at_risk[:10])}\n"
    )

    if ranked:
        context += f"\nTop performers (real CGPA, active students):\n"
        for s in ranked[:10]:
            context += f"  - {s.name}, {s.usn}, CGPA {s.cgpa}, semester {s.semester}\n"

    if faculty:
        context += f"\nReal faculty workload (subjects handled):\n"
        for f in faculty:
            count = sum(1 for s in subjects if s.faculty_id == f.id)
            context += f"  - {f.name} ({f.designation or 'faculty'}): {count} subject(s)\n"

    lower_q = payload.question.lower()
    if any(w in lower_q for w in ["question", "exam", "syllabus", "topic", "paper"]):
        from app.core.rag_retrieval import retrieve
        chunks = retrieve(db, payload.question, top_k=2)
        if chunks:
            context += "\nRelevant real question-bank excerpts:\n" + "\n---\n".join(c["text"][:400] for c in chunks)

    result = ask(payload.question, context, role="hod")
    return {"answer": result["answer"], "connected": result["connected"]}


@router.get("/insight")
def dashboard_insight(db: Session = Depends(get_db), user: User = Depends(require_role("hod"))):
    """A short, real, grounded AI summary of this HOD's own department —
    Understand -> Diagnose -> Recommend — built only from real, already
    computed department numbers, never invented."""
    from app.core.llm_client import generate_dashboard_insight

    dept = _department_or_403(user, db)
    students = db.query(Student).filter(Student.department_id == dept.id).all()
    active_students = [s for s in students if s.status == "active"]
    at_risk = [s for s in active_students if (s.backlogs or 0) > 0 or (s.attendance_pct is not None and s.attendance_pct < 75)]
    ranked = sorted([s for s in active_students if s.cgpa is not None], key=lambda s: s.cgpa, reverse=True)
    avg_cgpa = round(sum(s.cgpa for s in active_students if s.cgpa is not None) / len([s for s in active_students if s.cgpa is not None]), 2) if any(s.cgpa is not None for s in active_students) else None

    context = (
        f"Department: {dept.name}\n"
        f"Real active students: {len(active_students)}\n"
        f"Department average CGPA: {avg_cgpa if avg_cgpa is not None else 'not available'}\n"
        f"Students at risk (backlogs or attendance below 75%): {len(at_risk)}\n"
        f"Top performer: {ranked[0].name if ranked else 'not available'} (CGPA {ranked[0].cgpa if ranked else 'n/a'})\n"
    )

    result = generate_dashboard_insight(context, role="hod")
    return {"insight": result.get("insight"), "connected": result["connected"]}


def _department_or_403(user: User, db: Session) -> Department:
    if not user.department_id:
        raise HTTPException(status_code=403, detail="This HOD account isn't linked to a department yet")
    dept = db.query(Department).filter(Department.id == user.department_id).first()
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")
    return dept


@router.get("/me")
def hod_profile(db: Session = Depends(get_db), user: User = Depends(require_role("hod"))):
    dept = _department_or_403(user, db)
    return {"title": user.hod_title or f"Head of Department, {dept.name}", "department": dept.name, "department_id": dept.id}


@router.get("/stats")
def department_stats(db: Session = Depends(get_db), user: User = Depends(require_role("hod"))):
    """Same shape as admin stats, but scoped to only this HOD's department —
    an HOD never sees another department's numbers, even though this schema
    currently only has one real department (ISE) loaded. Also includes real
    department-level insights: top performers, backlog distribution, and
    average CGPA by semester — genuinely useful HOD-level views, not just
    the raw counts that were here before."""
    dept = _department_or_403(user, db)
    q = db.query(Student).filter(Student.department_id == dept.id)
    total = q.count()
    active = q.filter(Student.status == "active").count()
    passed_out = q.filter(Student.status == "passed_out").count()
    faculty_count = db.query(Faculty).filter(Faculty.department_id == dept.id).count()
    subject_count = db.query(Subject).filter(Subject.department_id == dept.id).count()

    active_students = db.query(Student).filter(Student.department_id == dept.id, Student.status == "active").all()

    # Real top 5 performers in the department by CGPA
    ranked = sorted([s for s in active_students if s.cgpa is not None], key=lambda s: s.cgpa, reverse=True)
    top_performers = [{"name": s.name, "usn": s.usn, "semester": s.semester, "cgpa": s.cgpa} for s in ranked[:5]]

    # Real backlog distribution
    backlog_buckets = {"0": 0, "1-2": 0, "3-5": 0, "6+": 0}
    for s in active_students:
        b = s.backlogs or 0
        key = "0" if b == 0 else "1-2" if b <= 2 else "3-5" if b <= 5 else "6+"
        backlog_buckets[key] += 1

    # Real average CGPA by semester
    by_semester: dict = {}
    for s in active_students:
        if s.cgpa is not None and s.semester:
            by_semester.setdefault(s.semester, []).append(s.cgpa)
    cgpa_by_semester = [
        {"semester": sem, "avg_cgpa": round(sum(cgpas) / len(cgpas), 2), "count": len(cgpas)}
        for sem, cgpas in sorted(by_semester.items())
    ]

    return {
        "department": dept.name,
        "total_students": total,
        "active_students": active,
        "passed_out_students": passed_out,
        "total_faculty": faculty_count,
        "total_subjects": subject_count,
        "top_performers": top_performers,
        "backlog_distribution": [{"name": f"{k} backlogs", "value": v} for k, v in backlog_buckets.items()],
        "cgpa_by_semester": cgpa_by_semester,
    }


@router.get("/students")
def department_students(
    batch: Optional[str] = None,
    semester: Optional[int] = None,
    status: Optional[str] = None,
    search: Optional[str] = None,
    page: int = 1,
    page_size: int = 25,
    demo_mode: Optional[bool] = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(require_role("hod")),
):
    dept = _department_or_403(user, db)
    q = db.query(Student).filter(Student.department_id == dept.id)
    if batch:
        q = q.filter(Student.batch == batch)
    if semester:
        q = q.filter(Student.semester == semester)
    if status:
        q = q.filter(Student.status == status)
    if search:
        like = f"%{search}%"
        q = q.filter((Student.name.ilike(like)) | (Student.usn.ilike(like)))

    total = q.count()
    rows = q.order_by(Student.usn).offset((page - 1) * page_size).limit(page_size).all()
    out = [{
        "id": s.id, "usn": s.usn, "name": s.name, "batch": s.batch, "status": s.status, "semester": s.semester,
        "cgpa": s.cgpa, "backlogs": s.backlogs, "data_status": s.data_status,
    } for s in rows]
    return {
        "students": [apply_demo_mask(r, demo_mode) for r in out],
        "total": total, "page": page, "page_size": page_size, "total_pages": max(1, (total + page_size - 1) // page_size),
        "empty_message": f"No students found for {dept.name} – Semester {semester}." if total == 0 and semester else (f"No students found for {dept.name}." if total == 0 else None),
    }


@router.get("/subjects")
def department_subjects(semester: Optional[int] = None, db: Session = Depends(get_db), user: User = Depends(require_role("hod"))):
    """Real subject list for this department only — powers the Subjects card's
    detail modal. Sortable/filterable by semester on the frontend; semester
    param here lets the frontend also filter server-side if wanted."""
    dept = _department_or_403(user, db)
    q = db.query(Subject).filter(Subject.department_id == dept.id)
    if semester:
        q = q.filter(Subject.semester == semester)
    rows = q.order_by(Subject.semester).all()
    return [{
        "id": s.id, "code": s.code, "name": s.name, "semester": s.semester,
        "faculty_id": s.faculty_id, "faculty_name": s.faculty.name if s.faculty else "Unassigned",
    } for s in rows]


@router.get("/faculty")
def department_faculty(db: Session = Depends(get_db), user: User = Depends(require_role("hod"))):
    dept = _department_or_403(user, db)
    rows = db.query(Faculty).filter(Faculty.department_id == dept.id).all()
    result = []
    for f in rows:
        subject_count = db.query(Subject).filter(Subject.faculty_id == f.id, Subject.department_id == dept.id).count()
        result.append({
            "id": f.id, "name": f.name, "designation": f.designation, "email": f.email,
            "subjects_handled": subject_count, "extra_work": f.extra_work or "NA",
        })
    return result


class ExtraWorkIn(BaseModel):
    extra_work: str


@router.patch("/faculty/{faculty_id}/extra-work")
def update_extra_work(faculty_id: int, payload: ExtraWorkIn, db: Session = Depends(get_db), user: User = Depends(require_role("hod"))):
    """HOD can only edit Extra Work for faculty in their OWN department —
    never another department's faculty, even by guessing an ID."""
    dept = _department_or_403(user, db)
    f = db.query(Faculty).filter(Faculty.id == faculty_id, Faculty.department_id == dept.id).first()
    if not f:
        raise HTTPException(status_code=404, detail="Faculty not found in your department")
    changed = (payload.extra_work or None) != (f.extra_work or None)
    f.extra_work = payload.extra_work or None
    if changed:
        f.extra_work_status = "pending" if f.extra_work else None
    db.commit()
    return {"id": f.id, "extra_work": f.extra_work, "status": f.extra_work_status}


@router.get("/faculty-workload")
def faculty_workload(db: Session = Depends(get_db), user: User = Depends(require_role("hod"))):
    """Real comparison: how many subjects each faculty member in this department
    teaches. Explicitly scoped: HOD -> Department -> Faculty -> Subjects,
    never counting a subject that isn't also in this department."""
    dept = _department_or_403(user, db)
    faculty = db.query(Faculty).filter(Faculty.department_id == dept.id).all()
    result = []
    for f in faculty:
        subject_count = db.query(Subject).filter(Subject.faculty_id == f.id, Subject.department_id == dept.id).count()
        result.append({"name": f.name, "subject_count": subject_count})
    return result


@router.get("/passed-out-years")
def passed_out_years(db: Session = Depends(get_db), user: User = Depends(require_role("hod"))):
    """Real, distinct passed-out years for this department only — computed
    from each student's admission year + 4 (standard B.E. duration), not a
    hardcoded list. Powers the Passed Out Year filter dropdown."""
    dept = _department_or_403(user, db)
    rows = db.query(Student.admission_year).filter(
        Student.department_id == dept.id, Student.status == "passed_out", Student.admission_year.isnot(None)
    ).distinct().all()
    years = sorted({r[0] + 4 for r in rows})
    return years


@router.get("/placements")
def department_placements(
    batch: Optional[str] = None,
    passed_out_year: Optional[int] = None,
    db: Session = Depends(get_db), user: User = Depends(require_role("hod")),
):
    """Placement figures for the HOD's department: one batch, or every batch
    with at least one offer. `passed_out_year` is the same filter expressed as
    the graduating year (entry year + 4)."""
    from app.core import placement_stats

    dept = _department_or_403(user, db)
    if not batch and passed_out_year:
        batch = str(passed_out_year - 4)
    result = placement_stats.overview(db, dept.id, dept.name, batch)
    result["passed_out_year"] = passed_out_year
    return result


@router.post("/reports/query")
def department_query(payload: NLQueryRequest, db: Session = Depends(get_db), user: User = Depends(require_role("hod"))):
    dept = _department_or_403(user, db)
    q = db.query(Student).filter(Student.department_id == dept.id)
    if payload.min_cgpa is not None:
        q = q.filter(Student.cgpa >= payload.min_cgpa)
    if payload.max_backlogs is not None:
        q = q.filter(Student.backlogs <= payload.max_backlogs)
    if payload.batch:
        q = q.filter(Student.batch == payload.batch)
    if payload.status:
        q = q.filter(Student.status == payload.status)
    rows = q.all()
    return {"count": len(rows), "students": [{"usn": s.usn, "name": s.name, "cgpa": s.cgpa, "backlogs": s.backlogs} for s in rows]}
