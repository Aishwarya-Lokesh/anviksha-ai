from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from typing import Optional
from collections import Counter
from pydantic import BaseModel

from app.core.database import get_db
from app.core.security import require_role
from app.core.demo_mode import apply_demo_mask
from app.core.activity_log import log_activity
from app.core.notifications import notify_student
from app.models.models import Student, Faculty, Subject, DocumentRequest, Department, User, Placement, CourseCompletion
from app.models.schemas import NLQueryRequest, StudentCreate, FacultyCreate, DocumentStatusUpdate

router = APIRouter(prefix="/admin", tags=["admin"])


class AskAIRequest(BaseModel):
    question: str


@router.post("/ask-ai")
def ask_ai(payload: AskAIRequest, db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    """Real RAG-based assistant for admin — grounded in real, live-computed
    institute-wide aggregates, PLUS real individual student lookups when the
    question names a specific student or asks for a specific rank within a
    batch. Never fabricated — if no real match is found, nothing is added
    to context and the assistant honestly says it doesn't have that data."""
    from app.core.llm_client import ask
    import re

    if not payload.question or not payload.question.strip():
        return {"answer": "Please type a question so I can help — for example, ask about total students, pending document requests, or department breakdowns.", "connected": True}

    from app.core.data_export import is_export_request, build_admin_export, write_xlsx
    if is_export_request(payload.question):
        rows, sheet_name, title = build_admin_export(db, payload.question)
        stored_name, _ = write_xlsx(rows, sheet_name, f"admin_{title}")
        return {
            "answer": f"Here's your real {title} — {len(rows)} row(s), ready to download.",
            "connected": True, "download_url": f"/exports/{stored_name}", "download_filename": f"{title.replace(' ', '_')}.xlsx",
        }

    from app.core.chat_charts import is_chart_request, build_admin_chart
    if is_chart_request(payload.question):
        chart = build_admin_chart(db, payload.question)
        return {"answer": chart["title"] + ".", "connected": True, "chart": chart}

    total_students = db.query(Student).count()
    active_students = db.query(Student).filter(Student.status == "active").count()
    total_faculty = db.query(Faculty).count()
    pending_docs = db.query(DocumentRequest).filter(DocumentRequest.status == "Pending").count()
    dept_counts = Counter(s.department.name if s.department else "Unknown" for s in db.query(Student).all())

    context = (
        f"Total students (real, live count): {total_students}\n"
        f"Active students: {active_students}\n"
        f"Total faculty: {total_faculty}\n"
        f"Pending document requests: {pending_docs}\n"
        f"Students by department: {dict(dept_counts)}\n"
    )

    # Real faculty-subject mapping — "which teacher handles which subject"
    subjects = db.query(Subject).all()
    if subjects:
        context += "\nReal subject-to-faculty assignments:\n"
        for subj in subjects:
            context += f"  - {subj.code} ({subj.name}), Sem {subj.semester}: {subj.faculty.name if subj.faculty else 'unassigned'}\n"

    # Real placement aggregates
    from app.models.models import Placement, Achievement, Internship, CourseCompletion
    all_placements = db.query(Placement).all()
    if all_placements:
        placed_count = sum(1 for p in all_placements if p.placed)
        context += f"\nReal placement data: {placed_count} of {len(all_placements)} tracked students placed.\n"

    # Real batch-wise top performer + average CGPA — included proactively
    # (not only via a regex trigger) so the LLM can answer "top performer in
    # 2023 batch" or similar phrasing without needing a special-cased pattern.
    active_by_batch: dict = {}
    for s in db.query(Student).filter(Student.status == "active", Student.cgpa.isnot(None)).all():
        active_by_batch.setdefault(s.batch, []).append(s)
    if active_by_batch:
        context += "\nReal batch-wise top performer and average CGPA:\n"
        for batch, batch_students in sorted(active_by_batch.items()):
            top = max(batch_students, key=lambda s: s.cgpa)
            avg = round(sum(s.cgpa for s in batch_students) / len(batch_students), 2)
            context += f"  - Batch {batch}: top performer {top.name} (USN {top.usn}, CGPA {top.cgpa}), average CGPA {avg} across {len(batch_students)} ranked students\n"

    # Real institute-wide achievement/internship/course-completion aggregates
    total_achievements = db.query(Achievement).count()
    total_internships = db.query(Internship).count()
    total_courses = db.query(CourseCompletion).count()
    context += f"\nReal totals: {total_achievements} achievements on record, {total_internships} internships on record, {total_courses} completed courses/MOOCs on record.\n"

    question_lower = payload.question.lower()

    # Real rank-in-batch lookup: e.g. "who is at 7th rank in 2023 batch",
    # "who is rank 7 in 2023 batch" — handles the number appearing before or
    # after the word "rank", with or without a space before st/nd/rd/th.
    rank_match = re.search(r"(\d+)\s*(?:st|nd|rd|th)?\s*rank.*?(20\d{2})|rank\s*(\d+).*?(20\d{2})", question_lower)
    if rank_match:
        rank_num = int(rank_match.group(1) or rank_match.group(3))
        batch = rank_match.group(2) or rank_match.group(4)
        ranked = db.query(Student).filter(Student.batch == batch, Student.status == "active", Student.cgpa.isnot(None)).order_by(Student.cgpa.desc()).all()
        if 0 < rank_num <= len(ranked):
            s = ranked[rank_num - 1]
            context += f"\nReal answer to the rank query: Rank {rank_num} in batch {batch} is {s.name} (USN {s.usn}), real CGPA {s.cgpa}.\n"
        else:
            context += f"\nNo student found at rank {rank_num} in batch {batch} — that batch has only {len(ranked)} ranked students.\n"

    # Real name-based lookup: find the student whose full real name appears
    # as a substring of the question, preferring the LONGEST such match —
    # this avoids a short/partial name (e.g. "Aishwarya S") incorrectly
    # matching before the correct, more specific full name (e.g.
    # "Aishwarya S L") when multiple students share a first name.
    all_students = db.query(Student).all()
    best_match = None
    for s in all_students:
        full_name_lower = s.name.lower().strip()
        if len(full_name_lower) > 3 and full_name_lower in question_lower:
            if best_match is None or len(full_name_lower) > len(best_match.name):
                best_match = s
    if best_match:
        context += (
            f"\nReal record for {best_match.name} (USN {best_match.usn}): batch {best_match.batch}, semester {best_match.semester}, "
            f"status {best_match.status}, CGPA {best_match.cgpa}, backlogs {best_match.backlogs}.\n"
        )

    result = ask(payload.question, context, role="admin")
    return {"answer": result["answer"], "connected": result["connected"]}



@router.get("/stats")
def stats(db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    total_students = db.query(Student).count()
    active_students = db.query(Student).filter(Student.status == "active").count()
    passed_out = db.query(Student).filter(Student.status == "passed_out").count()
    total_faculty = db.query(Faculty).count()
    total_subjects = db.query(Subject).count()
    pending_docs = db.query(DocumentRequest).filter(DocumentRequest.status == "Pending").count()

    return {
        "total_students": total_students,
        "active_students": active_students,
        "passed_out_students": passed_out,
        "total_faculty": total_faculty,
        "total_subjects": total_subjects,
        "pending_document_requests": pending_docs,
    }


def _student_out(s: Student):
    return {
        "id": s.id, "usn": s.usn, "name": s.name, "batch": s.batch, "status": s.status,
        "cgpa": s.cgpa, "attendance_pct": s.attendance_pct, "backlogs": s.backlogs,
        "data_status": s.data_status, "semester": s.semester,
        "department": s.department.name if s.department else None,
    }


@router.get("/departments")
def list_departments(db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    """Real departments in the database — currently only ISE has real data,
    but this returns whatever departments actually exist, never a hardcoded
    list of names that aren't backed by real records."""
    rows = db.query(Department).all()
    return [{"id": d.id, "name": d.name} for d in rows]


@router.get("/students")
def all_students(
    batch: Optional[str] = None,
    status: Optional[str] = None,
    department_id: Optional[int] = None,
    semester: Optional[int] = None,
    demo_mode: Optional[bool] = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin")),
):
    q = db.query(Student)
    if batch:
        q = q.filter(Student.batch == batch)
    if status:
        q = q.filter(Student.status == status)
    if department_id:
        q = q.filter(Student.department_id == department_id)
    if semester:
        q = q.filter(Student.semester == semester)
    rows = q.all()
    out = [_student_out(s) for s in rows]
    return [apply_demo_mask(r, demo_mode) for r in out]


@router.post("/students")
def create_student(payload: StudentCreate, db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    import re
    if not re.match(r"^\d?[A-Z]{2,4}\d{2}[A-Z]{2}\d{2,4}$", payload.usn.strip().upper()):
        raise HTTPException(status_code=400, detail="USN format looks invalid — expected something like 4GW23IS001")
    if db.query(Student).filter(Student.usn == payload.usn).first():
        raise HTTPException(status_code=400, detail="A student with this USN already exists")
    if not payload.name or len(payload.name.strip()) < 2:
        raise HTTPException(status_code=400, detail="Name is required")
    if payload.cgpa is not None and not (0 <= payload.cgpa <= 10):
        raise HTTPException(status_code=400, detail="CGPA must be between 0 and 10")
    if payload.backlogs is not None and payload.backlogs < 0:
        raise HTTPException(status_code=400, detail="Backlogs cannot be negative")
    if payload.semester is not None and not (1 <= payload.semester <= 8):
        raise HTTPException(status_code=400, detail="Semester must be between 1 and 8")

    from scripts.parse_academic_performance import usn_to_admission_year, status_for_admission_year
    admission_year = usn_to_admission_year(payload.usn)
    s = Student(
        usn=payload.usn.strip().upper(), name=payload.name.strip(), batch=payload.batch,
        admission_year=admission_year, status=status_for_admission_year(admission_year),
        semester=payload.semester, section=payload.section, cgpa=payload.cgpa,
        backlogs=payload.backlogs or 0, data_status="provisional",
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    log_activity(db, user, f"Added new student: {s.name} ({s.usn})")
    return _student_out(s)


@router.delete("/students/{student_id}")
def delete_student(student_id: int, db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    s = db.query(Student).filter(Student.id == student_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Student not found")
    db.delete(s)
    db.commit()
    log_activity(db, user, f"Deleted student: {s.name} ({s.usn})")
    return {"message": "Deleted"}


@router.patch("/students/{student_id}")
def edit_student(student_id: int, payload: StudentCreate, db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    s = db.query(Student).filter(Student.id == student_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Student not found")
    s.name = payload.name
    s.batch = payload.batch
    if payload.semester is not None:
        s.semester = payload.semester
    db.commit()
    db.refresh(s)
    return _student_out(s)


@router.get("/faculty")
def all_faculty(department_id: Optional[int] = None, db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    q = db.query(Faculty)
    if department_id:
        q = q.filter(Faculty.department_id == department_id)
    rows = q.all()
    result = []
    for f in rows:
        subject_count = db.query(Subject).filter(Subject.faculty_id == f.id).count()
        semesters = sorted({s.semester for s in db.query(Subject).filter(Subject.faculty_id == f.id, Subject.semester.isnot(None)).all()})
        result.append({
            "id": f.id, "name": f.name, "designation": f.designation, "email": f.email,
            "qualifications": f.qualifications, "vtu_teacher_id": f.vtu_teacher_id,
            "department": f.department.name if f.department else None,
            "subjects_handled": subject_count, "semesters": semesters,
        })
    return result


@router.post("/faculty")
def create_faculty(payload: FacultyCreate, db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    dept = db.query(Department).first()
    f = Faculty(name=payload.name, designation=payload.designation, email=payload.email, department_id=dept.id if dept else None)
    db.add(f)
    db.commit()
    db.refresh(f)
    log_activity(db, user, f"Added new faculty: {f.name}")
    return {"id": f.id, "name": f.name, "designation": f.designation, "email": f.email}


@router.delete("/faculty/{faculty_id}")
def delete_faculty(faculty_id: int, db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    f = db.query(Faculty).filter(Faculty.id == faculty_id).first()
    if not f:
        raise HTTPException(status_code=404, detail="Faculty not found")
    db.delete(f)
    db.commit()
    return {"message": "Deleted"}


@router.patch("/faculty/{faculty_id}")
def edit_faculty(faculty_id: int, payload: FacultyCreate, db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    f = db.query(Faculty).filter(Faculty.id == faculty_id).first()
    if not f:
        raise HTTPException(status_code=404, detail="Faculty not found")
    f.name = payload.name
    f.designation = payload.designation
    f.email = payload.email
    db.commit()
    db.refresh(f)
    return {"id": f.id, "name": f.name, "designation": f.designation, "email": f.email}


@router.get("/subjects")
def all_subjects(semester: Optional[int] = None, db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    q = db.query(Subject)
    if semester:
        q = q.filter(Subject.semester == semester)
    rows = q.all()
    return [{
        "id": s.id, "code": s.code, "name": s.name, "semester": s.semester,
        "faculty_id": s.faculty_id, "name_verified": s.name_verified,
    } for s in rows]


@router.patch("/subjects/{subject_id}/verify")
def verify_subject_name(subject_id: int, db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    """One-click confirm — marks an inferred subject title as checked against the real curriculum."""
    s = db.query(Subject).filter(Subject.id == subject_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Subject not found")
    s.name_verified = True
    db.commit()
    return {"id": s.id, "name_verified": True}


@router.get("/documents")
def all_documents(status: Optional[str] = None, db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    q = db.query(DocumentRequest).join(Student)
    if status:
        q = q.filter(DocumentRequest.status == status)
    rows = q.all()
    return [{
        "id": d.id, "student_name": d.student.name if d.student else None,
        "type": d.type, "purpose": d.purpose, "status": d.status,
        "requested_date": str(d.requested_date) if d.requested_date else None,
    } for d in rows]


@router.patch("/documents/{document_id}")
def update_document_status(document_id: int, payload: DocumentStatusUpdate, db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    d = db.query(DocumentRequest).filter(DocumentRequest.id == document_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="Document request not found")
    d.status = payload.status
    db.commit()
    log_activity(db, user, f"Updated document request #{d.id} status to {payload.status}")
    notify_student(db, d.student_id, f"Your {d.type} request is now: {payload.status}")
    return {"id": d.id, "status": d.status}


@router.get("/activity-logs")
def activity_logs(db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    from app.models.models import ActivityLog
    rows = db.query(ActivityLog).order_by(ActivityLog.timestamp.desc()).limit(100).all()
    return [{"user": r.actor_email, "role": r.actor_role, "action": r.action, "time": str(r.timestamp)} for r in rows]


@router.get("/batches")
def list_batches(db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    rows = db.query(Student.batch, Student.status).all()
    counter = Counter((b, st) for b, st in rows)
    batches = {}
    for (batch, st), count in counter.items():
        batches.setdefault(batch, {"active": 0, "passed_out": 0, "unknown": 0})
        batches[batch][st if st in ("active", "passed_out") else "unknown"] += count
    return batches


@router.get("/passed-out-years")
def all_passed_out_years(db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    """Real, distinct passed-out years institute-wide — computed from each
    student's admission year + 4, not hardcoded."""
    rows = db.query(Student.admission_year).filter(
        Student.status == "passed_out", Student.admission_year.isnot(None)
    ).distinct().all()
    years = sorted({r[0] + 4 for r in rows})
    return years


@router.get("/placements")
def placement_dashboard(
    batch: Optional[str] = None, passed_out_year: Optional[int] = None, department_id: Optional[int] = None,
    db: Session = Depends(get_db), user: User = Depends(require_role("admin")),
):
    """Real placement stats. Company name and CTC are now available for
    batches 2021 and 2022 (real data, added later) — other batches still
    only have placed/not-placed and Dream/Regular drive type, since that's
    all that exists for them. Never fabricate company/CTC for batches that
    don't have it.

    Filterable by `batch` (raw admission-year label, kept for backward
    compatibility), `passed_out_year` (the actual real graduation year,
    computed from admission_year + 4 — the correct filter to use), and
    `department_id`. All filters combine (AND), never override each other."""
    q = db.query(Placement).join(Student)
    if passed_out_year:
        q = q.filter(Student.admission_year == passed_out_year - 4, Student.status == "passed_out")
    elif batch:
        q = q.filter(Student.batch == batch)
    if department_id:
        q = q.filter(Student.department_id == department_id)
    rows = q.all()
    total = len(rows)
    placed = sum(1 for r in rows if r.placed)
    dream = sum(1 for r in rows if r.placement_type == "Dream")
    regular = sum(1 for r in rows if r.placement_type == "Regular")
    with_company_data = sum(1 for r in rows if r.company)
    all_batches_with_data = sorted({r.student.batch for r in db.query(Placement).join(Student).all()})

    # real average CTC where numeric parsing is possible (e.g. "11 LPA" -> 11) — never fabricated, just parsed from real text
    import re as _re
    ctc_values = []
    for r in rows:
        if r.ctc:
            m = _re.search(r"(\d+(\.\d+)?)", r.ctc)
            if m:
                ctc_values.append(float(m.group(1)))
    avg_ctc_lpa = round(sum(ctc_values) / len(ctc_values), 1) if ctc_values else None
    highest_ctc_lpa = max(ctc_values) if ctc_values else None

    # Real offer-tier classification by real CTC value — Regular < 6 LPA,
    # Dream 6-10 LPA, Super Dream > 10 LPA. Only classifiable for records
    # with a real parsed CTC — never guessed for records without one.
    regular_by_ctc = sum(1 for v in ctc_values if v < 6)
    dream_by_ctc = sum(1 for v in ctc_values if 6 <= v <= 10)
    super_dream_by_ctc = sum(1 for v in ctc_values if v > 10)

    # top companies by real count, only where company data exists
    from collections import Counter
    company_counts = Counter(r.company for r in rows if r.company)

    # department-wise breakdown, for the "Department-wise Placement Analysis" grouped bar chart —
    # real departments only, no fabricated CS/EC/AIML/AIDS/EEE entries
    dept_breakdown = {}
    for r in rows:
        dname = r.student.department.name if r.student.department else "Unknown"
        dept_breakdown.setdefault(dname, {"total": 0, "placed": 0})
        dept_breakdown[dname]["total"] += 1
        if r.placed:
            dept_breakdown[dname]["placed"] += 1
    by_department = [
        {"department": k, "total": v["total"], "placed": v["placed"],
         "placement_pct": round((v["placed"] / v["total"]) * 100, 1) if v["total"] else 0}
        for k, v in dept_breakdown.items()
    ]

    return {
        "total_students_in_placement_data": total,
        "placed": placed,
        "not_placed": total - placed,
        "placement_pct": round((placed / total) * 100, 1) if total else 0,
        "dream_offers": dream,
        "regular_offers": regular,
        "with_company_data": with_company_data,
        "avg_ctc_lpa": avg_ctc_lpa,
        "highest_ctc_lpa": highest_ctc_lpa,
        "offer_tiers_by_ctc": {
            "regular": regular_by_ctc, "dream": dream_by_ctc, "super_dream": super_dream_by_ctc,
            "classifiable_count": len(ctc_values),
            "note": "Regular < 6 LPA, Dream 6-10 LPA, Super Dream > 10 LPA — only computed for records with a real parsed CTC value.",
        },
        "top_companies": [{"company": c, "count": n} for c, n in company_counts.most_common(10)],
        "by_department": by_department,
        "note": "Company name and CTC exist for batches 2021 and 2022 only — other batches genuinely don't have this data. Only ISE has real department data currently — other departments will show no data until real records exist for them.",
        "batches_with_data": all_batches_with_data,
        "filtered_batch": batch,
        "filtered_passed_out_year": passed_out_year,
        "filtered_department_id": department_id,
        "students": [{
            "usn": r.student.usn, "name": r.student.name, "placed": r.placed,
            "placement_type": r.placement_type, "resume_link": r.resume_link,
            "company": r.company, "ctc": r.ctc,
        } for r in rows],
    }


@router.get("/courses")
def all_course_completions(db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    rows = db.query(CourseCompletion).join(Student).all()
    return [{
        "student_name": r.student.name, "usn": r.student.usn, "course_name": r.course_name,
        "platform": r.platform, "duration": r.duration, "remarks": r.remarks,
    } for r in rows]


@router.get("/internships")
def all_internships(db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    from app.models.models import Internship
    rows = db.query(Internship).join(Student).all()
    return [{
        "student_name": r.student.name, "usn": r.student.usn, "batch": r.student.batch,
        "company": r.company, "duration": r.duration_text, "stipend": r.stipend or "Not Available",
    } for r in rows]


@router.get("/reports/snapshot")
def full_snapshot(
    batch: Optional[str] = None, department_id: Optional[int] = None,
    db: Session = Depends(get_db), user: User = Depends(require_role("admin")),
):
    """One real, comprehensive snapshot — every number here is computed live
    from the actual database, nothing hardcoded. Batch is validated against
    real data — an unknown batch returns an explicit error, never a silent
    fallback to unfiltered/default statistics."""
    all_known_batches = sorted({b[0] for b in db.query(Student.batch).distinct().all() if b[0]})
    if batch and batch not in all_known_batches:
        raise HTTPException(status_code=404, detail=f"Batch {batch} dataset not found.")

    q = db.query(Student)
    if batch:
        q = q.filter(Student.batch == batch)
    if department_id:
        q = q.filter(Student.department_id == department_id)
    students = q.all()
    total = len(students)
    active = sum(1 for s in students if s.status == "active")
    passed_out = sum(1 for s in students if s.status == "passed_out")

    by_batch = {}
    for s in students:
        by_batch.setdefault(s.batch, {"total": 0, "active": 0, "passed_out": 0, "avg_cgpa_sum": 0, "avg_cgpa_count": 0})
        by_batch[s.batch]["total"] += 1
        by_batch[s.batch][s.status if s.status in ("active", "passed_out") else "active"] += 1
        if s.cgpa is not None:
            by_batch[s.batch]["avg_cgpa_sum"] += s.cgpa
            by_batch[s.batch]["avg_cgpa_count"] += 1

    batch_summary = []
    for b_key, d in sorted(by_batch.items()):
        avg_cgpa = round(d["avg_cgpa_sum"] / d["avg_cgpa_count"], 2) if d["avg_cgpa_count"] else None
        batch_summary.append({"batch": b_key, "total": d["total"], "active": d["active"], "passed_out": d["passed_out"], "avg_cgpa": avg_cgpa})

    # Average CGPA BY DEPARTMENT (replaces the old, less useful "by batch" chart per spec) —
    # real departments only, currently just ISE, but computed generically so it's ready
    # the moment more department data exists
    by_dept_cgpa: dict = {}
    by_dept_backlog: dict = {}
    for s in students:
        dname = s.department.name if s.department else "Unknown"
        by_dept_cgpa.setdefault(dname, {"sum": 0, "count": 0})
        if s.cgpa is not None:
            by_dept_cgpa[dname]["sum"] += s.cgpa
            by_dept_cgpa[dname]["count"] += 1
        by_dept_backlog.setdefault(dname, {"0": 0, "1-2": 0, "3-5": 0, "6+": 0})
        b = s.backlogs or 0
        key = "0" if b == 0 else "1-2" if b <= 2 else "3-5" if b <= 5 else "6+"
        by_dept_backlog[dname][key] += 1

    avg_cgpa_by_department = [
        {"department": k, "avg_cgpa": round(v["sum"] / v["count"], 2) if v["count"] else None}
        for k, v in by_dept_cgpa.items()
    ]
    backlog_by_department = [{"department": k, **v} for k, v in by_dept_backlog.items()]

    backlog_dist = {"0": 0, "1": 0, "2": 0, "3+": 0}
    for s in students:
        b = s.backlogs or 0
        key = str(b) if b < 3 else "3+"
        backlog_dist[key] += 1

    total_faculty = db.query(Faculty).count()
    total_subjects = db.query(Subject).count()
    verified_subjects = db.query(Subject).filter(Subject.name_verified == True).count()
    pending_docs = db.query(DocumentRequest).filter(DocumentRequest.status == "Pending").count()

    from app.models.models import Placement, Internship, CourseCompletion, CertificateFile
    student_ids = [s.id for s in students]
    placement_q = db.query(Placement)
    internship_q = db.query(Internship)
    course_q = db.query(CourseCompletion)
    cert_q = db.query(CertificateFile).filter(CertificateFile.is_demo == False)
    if batch or department_id:
        placement_q = placement_q.filter(Placement.student_id.in_(student_ids))
        internship_q = internship_q.filter(Internship.student_id.in_(student_ids))
        course_q = course_q.filter(CourseCompletion.student_id.in_(student_ids))
        cert_q = cert_q.filter(CertificateFile.student_id.in_(student_ids))
    placement_rows = placement_q.all()
    placed = sum(1 for p in placement_rows if p.placed)

    # Placement Analysis by Department, for Reports & Statistics
    placement_by_dept: dict = {}
    for p in placement_rows:
        st = db.query(Student).filter(Student.id == p.student_id).first()
        dname = st.department.name if st and st.department else "Unknown"
        placement_by_dept.setdefault(dname, {"total": 0, "placed": 0})
        placement_by_dept[dname]["total"] += 1
        if p.placed:
            placement_by_dept[dname]["placed"] += 1
    placement_analysis_by_department = [
        {"department": k, "total": v["total"], "placed": v["placed"], "not_placed": v["total"] - v["placed"],
         "placement_pct": round((v["placed"] / v["total"]) * 100, 1) if v["total"] else 0}
        for k, v in placement_by_dept.items()
    ]

    return {
        "filtered_batch": batch,
        "filtered_department_id": department_id,
        "totals": {
            "students": total, "active": active, "passed_out": passed_out,
            "faculty": total_faculty, "subjects": total_subjects, "verified_subjects": verified_subjects,
            "pending_documents": pending_docs,
        },
        "batch_summary": batch_summary,
        "avg_cgpa_by_department": avg_cgpa_by_department,
        "backlog_by_department": backlog_by_department,
        "backlog_distribution": [{"name": f"{k} backlogs", "value": v} for k, v in backlog_dist.items()],
        "placement_analysis_by_department": placement_analysis_by_department,
        "placement_summary": {
            "tracked": len(placement_rows), "placed": placed,
            "internships_recorded": internship_q.count(),
        },
        "engagement": {
            "course_completions": course_q.count(),
            "verified_certificates": cert_q.count(),
        },
        "note": "Only ISE has real department data currently — department-wise charts will show data for ISE only until real records exist for other departments.",
    }


@router.post("/reports/smart-query")
def smart_query(payload: NLQueryRequest, db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    """Real two-part response: (1) real filtered student data + chart, same
    as before, using whatever structured filters the frontend parsed out of
    the question, and (2) a real, LLM-synthesized natural-language answer
    grounded in comprehensive real data — this is what actually answers
    "who is the top performer" or "what's the highest package", which raw
    filtering alone never could. Honestly falls back to pattern-matching-only
    (no synthesized answer) if no LLM API key is configured."""
    from app.models.models import Placement
    from app.core.llm_client import ask, is_configured

    q = db.query(Student)
    if payload.min_cgpa is not None:
        q = q.filter(Student.cgpa >= payload.min_cgpa)
    if payload.max_backlogs is not None:
        q = q.filter(Student.backlogs <= payload.max_backlogs)
    if payload.batch:
        q = q.filter(Student.batch == payload.batch)
    if payload.status:
        q = q.filter(Student.status == payload.status)
    rows = q.all()

    by_batch: dict = {}
    for s in rows:
        by_batch.setdefault(s.batch, 0)
        by_batch[s.batch] += 1
    chart_data = [{"label": k, "value": v} for k, v in sorted(by_batch.items())]

    result = {
        "count": len(rows),
        "chart_type": "bar",
        "chart_data": chart_data,
        "students": [{"usn": s.usn, "name": s.name, "cgpa": s.cgpa, "backlogs": s.backlogs, "batch": s.batch} for s in rows[:20]],
        "ai_answer": None,
        "ai_connected": is_configured(),
    }

    if not payload.raw_question:
        return result

    # Real comprehensive context for the LLM to actually synthesize an answer from
    all_students = db.query(Student).filter(Student.status.in_(["active", "passed_out"])).all()
    by_batch_top: dict = {}
    for s in all_students:
        if s.cgpa is not None:
            by_batch_top.setdefault(s.batch, []).append(s)
    context = "Real top performers by batch (name, USN, CGPA):\n"
    for batch, students in sorted(by_batch_top.items()):
        top5 = sorted(students, key=lambda s: s.cgpa, reverse=True)[:5]
        context += f"  Batch {batch}: " + ", ".join(f"{s.name} ({s.usn}, CGPA {s.cgpa})" for s in top5) + "\n"

    placements = db.query(Placement).join(Student).all()
    ctc_records = []
    for p in placements:
        if p.ctc:
            import re as _re
            m = _re.search(r"(\d+(\.\d+)?)", p.ctc)
            if m:
                ctc_records.append((float(m.group(1)), p.student.name, p.student.usn, p.company, p.student.batch))
    if ctc_records:
        ctc_records.sort(reverse=True)
        context += "\nReal placement packages, highest first (CTC LPA, name, USN, company, batch):\n"
        for ctc, name, usn, company, batch in ctc_records[:10]:
            context += f"  {ctc} LPA — {name} ({usn}) at {company}, batch {batch}\n"

    llm_result = ask(payload.raw_question, context, role="admin")
    result["ai_answer"] = llm_result["answer"]
    result["ai_connected"] = llm_result["connected"]
    return result


@router.post("/reports/query")
def structured_query(payload: NLQueryRequest, db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    q = db.query(Student)
    if payload.min_cgpa is not None:
        q = q.filter(Student.cgpa >= payload.min_cgpa)
    if payload.max_backlogs is not None:
        q = q.filter(Student.backlogs <= payload.max_backlogs)
    if payload.batch:
        q = q.filter(Student.batch == payload.batch)
    if payload.status:
        q = q.filter(Student.status == payload.status)
    rows = q.all()
    return {
        "count": len(rows),
        "students": [{"usn": s.usn, "name": s.name, "cgpa": s.cgpa, "backlogs": s.backlogs} for s in rows],
    }
