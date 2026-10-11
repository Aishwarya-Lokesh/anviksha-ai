"""HOD endpoints the app's screens call that were never implemented: the
batch breakdown behind every batch filter, a faculty member's classes, and
batch-wise placement selection and comparison."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core import placement_stats
from app.core.database import get_db
from app.core.security import require_role
from app.models.models import Faculty, Student, Subject, TeachingAssignment, User
from app.routers.hod import _department_or_403

router = APIRouter(prefix="/hod", tags=["hod"])


@router.get("/students-by-batch")
def students_by_batch(db: Session = Depends(get_db), user: User = Depends(require_role("hod"))):
    """Active / passed-out / total students per batch in the HOD's department."""
    dept = _department_or_403(user, db)
    rows = db.query(Student.batch, Student.status, func.count(Student.id)).filter(
        Student.department_id == dept.id, Student.batch.isnot(None)
    ).group_by(Student.batch, Student.status).all()
    batches: dict[str, dict] = {}
    for batch, status, count in rows:
        entry = batches.setdefault(batch, {"batch": batch, "label": placement_stats.batch_label(batch),
                                           "active": 0, "passed_out": 0, "total": 0})
        if status == "active":
            entry["active"] += count
        elif status == "passed_out":
            entry["passed_out"] += count
        entry["total"] += count
    return [batches[b] for b in sorted(batches, reverse=True)]


@router.get("/faculty/{faculty_id}/subjects")
def faculty_subjects(faculty_id: int, db: Session = Depends(get_db), user: User = Depends(require_role("hod"))):
    """The classes a faculty member has set up, and — where they have not set
    any up yet — the subjects allotted to them in the scheme."""
    dept = _department_or_403(user, db)
    faculty = db.query(Faculty).filter(Faculty.id == faculty_id, Faculty.department_id == dept.id).first()
    if not faculty:
        raise HTTPException(status_code=404, detail="Faculty not found in your department")

    assignments = db.query(TeachingAssignment).filter(
        TeachingAssignment.faculty_id == faculty.id, TeachingAssignment.subject_id.isnot(None)
    ).all()
    subjects = [{
        "code": a.subject.code, "name": a.subject.name, "batch": a.batch, "semester": a.semester,
        "section": a.section, "passed_out": bool(a.passed_out),
    } for a in assignments if a.subject]
    allotted = [{"code": s.code, "name": s.name, "semester": s.semester} for s in
                db.query(Subject).filter(Subject.faculty_id == faculty.id, Subject.department_id == dept.id).order_by(Subject.semester, Subject.code).all()]
    return {"faculty": {"id": faculty.id, "name": faculty.name}, "subjects": subjects, "allotted_subjects": allotted}


@router.get("/placement-batches")
def placement_batches(db: Session = Depends(get_db), user: User = Depends(require_role("hod"))):
    dept = _department_or_403(user, db)
    return placement_stats.batches_with_offers(db, dept.id)


@router.get("/placement-comparison")
def placement_comparison(batches: str, db: Session = Depends(get_db), user: User = Depends(require_role("hod"))):
    dept = _department_or_403(user, db)
    wanted = {b.strip() for b in batches.split(",") if b.strip()}
    return [r for r in placement_stats.batch_rows(db, dept.id) if r["batch"] in wanted]
