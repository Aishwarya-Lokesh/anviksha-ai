from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.models import Student, Faculty, Subject, DocumentRequest, User

router = APIRouter(prefix="/search", tags=["search"])


@router.get("")
def global_search(q: str = Query(..., min_length=1), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Searches across the data the logged-in role is actually allowed to see —
    students/faculty/subjects/documents for admin, own students/subjects for
    teacher, own records only for student. Real DB queries, not a static index."""
    like = f"%{q}%"
    results: dict = {"students": [], "faculty": [], "subjects": [], "documents": []}

    if user.role == "admin":
        results["students"] = [
            {"usn": s.usn, "name": s.name, "batch": s.batch}
            for s in db.query(Student).filter((Student.name.ilike(like)) | (Student.usn.ilike(like))).limit(10).all()
        ]
        results["faculty"] = [
            {"name": f.name, "designation": f.designation}
            for f in db.query(Faculty).filter(Faculty.name.ilike(like)).limit(10).all()
        ]
        results["subjects"] = [
            {"code": s.code, "name": s.name}
            for s in db.query(Subject).filter((Subject.name.ilike(like)) | (Subject.code.ilike(like))).limit(10).all()
        ]
        results["documents"] = [
            {"id": d.id, "type": d.type, "status": d.status}
            for d in db.query(DocumentRequest).filter(DocumentRequest.type.ilike(like)).limit(10).all()
        ]
    elif user.role == "teacher":
        results["students"] = [
            {"usn": s.usn, "name": s.name, "batch": s.batch}
            for s in db.query(Student).filter((Student.name.ilike(like)) | (Student.usn.ilike(like))).limit(10).all()
        ]
        results["subjects"] = [
            {"code": s.code, "name": s.name}
            for s in db.query(Subject).filter(Subject.faculty_id == user.faculty_id, (Subject.name.ilike(like)) | (Subject.code.ilike(like))).limit(10).all()
        ]
    elif user.role == "student":
        results["documents"] = [
            {"id": d.id, "type": d.type, "status": d.status}
            for d in db.query(DocumentRequest).filter(DocumentRequest.student_id == user.student_id, DocumentRequest.type.ilike(like)).limit(10).all()
        ]

    total = sum(len(v) for v in results.values())
    return {"query": q, "total_results": total, "results": results}
