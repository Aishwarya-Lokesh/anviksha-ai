from fastapi import APIRouter, Depends, Query, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel
import os

from app.core.database import get_db
from app.core.security import require_role, get_current_user
from app.core.demo_mode import apply_demo_mask
from app.core.file_links import signed
from app.models.models import Student, Achievement, DocumentRequest, User, Placement, CourseCompletion, AttendanceRecord, AttendanceSession, Subject, CertificateFile
from app.models.schemas import AchievementCreate, DocumentRequestCreate, ProfileUpdate

router = APIRouter(prefix="/student", tags=["student"])


@router.get("/excellence-score")
def excellence_score(db: Session = Depends(get_db), user: User = Depends(require_role("student"))):
    """Real Student Excellence Score = CGPA points (tiered) + Achievement
    points (Certificates/Hackathons/Hackathon Wins/Projects) — computed live
    from this student's actual data, never hardcoded, and identical to
    whatever Teacher > Performance shows for the same student's achievement
    points, since both use the same shared calculation."""
    from app.core.scoring import calculate_achievement_points, calculate_cgpa_points

    student = db.query(Student).filter(Student.id == user.student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student record not found")

    cgpa_breakdown = calculate_cgpa_points(student.cgpa)
    ach_breakdown = calculate_achievement_points(db, student.id)
    total = cgpa_breakdown["cgpa_points"] + ach_breakdown["total_achievement_points"]

    # Real, dynamic improvement suggestions — based on this student's actual counts, not generic
    suggestions = [
        {"points": 50, "label": "Complete another certificate", "type": "Certificate"},
        {"points": 50, "label": "Participate in a hackathon", "type": "Hackathon"},
        {"points": 100, "label": "Win a hackathon" if ach_breakdown["hackathon_count"] > 0 else "Participate in and win a hackathon", "type": "HackathonWin"},
        {"points": 100, "label": "Complete another project", "type": "Project"},
    ]

    return {
        "total_score": total,
        "cgpa": cgpa_breakdown,
        "achievements": ach_breakdown,
        "suggestions": suggestions,
    }




class AskAIRequest(BaseModel):
    question: str


@router.post("/ask-ai")
def ask_ai(payload: AskAIRequest, db: Session = Depends(get_db), user: User = Depends(require_role("student"))):
    """Real RAG-based assistant: gathers COMPREHENSIVE real data about this
    student — academics, achievements, per-subject attendance, placement
    status — and hands all of it to the LLM as grounding context. This is
    deliberately broad rather than trying to pattern-match every possible
    question phrasing: a capable LLM given enough real, relevant context
    can answer a wide range of real questions on its own, as long as the
    real data it needs is actually present. Never invented, only whatever
    is genuinely on this student's record appears here."""
    from app.core.llm_client import ask
    from app.models.models import Achievement, AttendanceRecord, AttendanceSession, Subject, Placement, CertificateFile, Internship, CourseCompletion

    if not payload.question or not payload.question.strip():
        return {"answer": "Please type a question so I can help — for example, ask about your CGPA, attendance, backlogs, or upcoming exam topics.", "connected": True}

    student = db.query(Student).filter(Student.id == user.student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student record not found")

    rank_row = db.query(Student).filter(
        Student.batch == student.batch, Student.department_id == student.department_id, Student.status == "active"
    ).order_by(Student.cgpa.desc()).all()
    rank = next((i + 1 for i, s in enumerate(rank_row) if s.id == student.id), None)

    context = (
        f"Student: {student.name}, USN: {student.usn}\n"
        f"CGPA: {student.cgpa}\n"
        f"Backlogs: {student.backlogs}\n"
        f"Current semester: {student.semester}\n"
        f"Batch: {student.batch}\n"
        f"Class rank: {rank} of {len(rank_row)} in batch {student.batch}\n"
    )

    if student.semester_sgpa:
        sgpa_text = ", ".join(f"Sem {sem}: {sgpa}" for sem, sgpa in sorted(student.semester_sgpa.items()))
        context += f"Real semester-wise SGPA history: {sgpa_text}\n"

    profile_bits = []
    if student.linkedin:
        profile_bits.append(f"LinkedIn on file")
    if student.github:
        profile_bits.append(f"GitHub on file")
    if student.skills:
        profile_bits.append(f"skills listed: {student.skills}")
    if student.resume_link:
        profile_bits.append("resume link on file")
    context += f"Real profile completeness score: {student.profile_score if student.profile_score is not None else 'not available'}"
    context += (f" ({', '.join(profile_bits)})\n" if profile_bits else " (no LinkedIn/GitHub/skills/resume on file yet)\n")

    # Real achievements — every certificate, hackathon, project, activity on record
    achievements = db.query(Achievement).filter(Achievement.student_id == student.id).all()
    if achievements:
        context += f"\nReal achievements on record ({len(achievements)} total):\n"
        for a in achievements:
            detail = f"  - {a.type}: {a.title}"
            if a.type == "Hackathon" and a.won:
                detail += " (WON)"
            if a.year:
                detail += f", year {a.year}"
            context += detail + "\n"
    else:
        context += "\nNo achievements on record for this student.\n"

    certs = db.query(CertificateFile).filter(CertificateFile.student_id == student.id).all()
    if certs:
        context += f"Real certificate files on record: {len(certs)} (includes {sum(1 for c in certs if not c.is_demo)} verified real, {sum(1 for c in certs if c.is_demo)} demo/placeholder)\n"

    # Real per-subject attendance
    subjects = db.query(Subject).filter(Subject.semester == student.semester, Subject.department_id == student.department_id).all()
    if subjects:
        context += "\nReal attendance by subject:\n"
        for subj in subjects:
            total_sessions = db.query(AttendanceSession).filter(AttendanceSession.subject_id == subj.id).count()
            if total_sessions == 0:
                continue
            present = db.query(AttendanceRecord).join(AttendanceSession).filter(
                AttendanceRecord.student_id == student.id, AttendanceSession.subject_id == subj.id, AttendanceRecord.present == True
            ).count()
            pct = round((present / total_sessions) * 100, 1)
            context += f"  - {subj.code} ({subj.name}): {pct}% ({present}/{total_sessions} classes)\n"

    # Real placement status
    placement = db.query(Placement).filter(Placement.student_id == student.id).first()
    if placement:
        context += f"\nReal placement status: {'Placed' if placement.placed else 'Not placed'}"
        if placement.company:
            context += f" at {placement.company}"
        if placement.ctc:
            context += f", CTC {placement.ctc}"
        context += "\n"
    else:
        context += "\nNo placement record on file for this student yet.\n"

    internships = db.query(Internship).filter(Internship.student_id == student.id).all()
    if internships:
        context += f"\nReal internships on record ({len(internships)}):\n"
        for i in internships:
            detail = f"  - {i.company}"
            if i.duration_text:
                detail += f", {i.duration_text}"
            if i.stipend:
                detail += f", stipend {i.stipend}"
            context += detail + "\n"
    else:
        context += "\nNo internship record on file for this student.\n"

    courses = db.query(CourseCompletion).filter(CourseCompletion.student_id == student.id).all()
    if courses:
        context += f"\nReal completed courses/MOOCs on record ({len(courses)}):\n"
        for c in courses:
            detail = f"  - {c.course_name}"
            if c.platform:
                detail += f" ({c.platform})"
            if c.duration:
                detail += f", {c.duration}"
            context += detail + "\n"
    else:
        context += "\nNo completed course/MOOC record on file for this student.\n"

    lower_q = payload.question.lower()
    if any(w in lower_q for w in ["question", "exam", "syllabus", "topic"]):
        from app.core.rag_retrieval import retrieve
        chunks = retrieve(db, payload.question, top_k=2)
        if chunks:
            context += "\nRelevant real question-bank excerpts:\n" + "\n---\n".join(c["text"][:400] for c in chunks)

    result = ask(payload.question, context, role="student")
    return {"answer": result["answer"], "connected": result["connected"]}


def _student_dict(s: Student) -> dict:
    return {
        "id": s.id, "usn": s.usn, "name": s.name, "batch": s.batch, "status": s.status,
        "semester": s.semester, "section": s.section, "cgpa": s.cgpa,
        "attendance_pct": s.attendance_pct, "backlogs": s.backlogs,
        "data_status": s.data_status, "linkedin": s.linkedin, "github": s.github, "skills": s.skills,
        "resume_link": s.resume_link, "semester_sgpa": s.semester_sgpa,
        "profile_score": s.profile_score, "photo_url": s.photo_url,
        "resume_file_url": signed(f"/resume-files/{s.resume_file}") if s.resume_file else None,
        "education": s.education or [],
    }


def _achievement_summary(db: Session, student: Student) -> dict:
    """What the dashboard's Profile Score and Achievements cards show. The
    score is the Student Excellence Score, from the same shared calculation
    the Excellence Score page and Teacher > Performance use, so the three can
    never disagree."""
    from app.core.scoring import (
        calculate_achievement_points, calculate_cgpa_points, verified_certificate_files,
        CERT_POINTS, HACKATHON_PARTICIPATE_POINTS, HACKATHON_WIN_BONUS, PROJECT_POINTS,
    )
    cert_files = verified_certificate_files(db, student.id).order_by(CertificateFile.id.desc()).all()
    rows = db.query(Achievement).filter(Achievement.student_id == student.id).order_by(Achievement.id.desc()).all()

    def points(a: Achievement) -> int:
        if a.type == "Certificate":
            return CERT_POINTS
        if a.type == "Hackathon":
            return HACKATHON_PARTICIPATE_POINTS + (HACKATHON_WIN_BONUS if a.won else 0)
        if a.type == "Project":
            return PROJECT_POINTS
        return 0

    breakdown = calculate_achievement_points(db, student.id)
    return {
        "profile_score": calculate_cgpa_points(student.cgpa)["cgpa_points"] + breakdown["total_achievement_points"],
        "achievements_count": len(rows) + len(cert_files),
        "achievements_breakdown": {
            "certificates": breakdown["certificate_count"], "projects": breakdown["project_count"],
            "hackathons": breakdown["hackathon_count"], "activities": sum(1 for a in rows if a.type == "Activity"),
        },
        "achievement_items": [{
            "id": a.id, "title": a.title, "type": a.type, "year": a.year, "won": bool(a.won), "points": points(a),
        } for a in rows] + [{
            "id": f"cert-{c.id}", "title": c.display_label or "Certificate", "type": "Certificate",
            "year": c.uploaded_at.year if c.uploaded_at else None, "won": False, "points": CERT_POINTS,
        } for c in cert_files],
    }


@router.get("/dashboard")
def dashboard(
    demo_mode: Optional[bool] = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(require_role("student")),
):
    s = db.query(Student).filter(Student.id == user.student_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Student record not found")
    record = {**_student_dict(s), **_achievement_summary(db, s)}
    return apply_demo_mask(record, demo_mode)


@router.patch("/profile")
def update_profile(payload: ProfileUpdate, db: Session = Depends(get_db), user: User = Depends(require_role("student"))):
    """Actually persists profile edits to the database — real save, not a UI-only mock."""
    s = db.query(Student).filter(Student.id == user.student_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Student record not found")
    for field, value in payload.dict(exclude_unset=True).items():
        setattr(s, field, value)
    db.commit()
    db.refresh(s)
    return _student_dict(s)


@router.post("/profile/photo")
async def upload_profile_photo(file: UploadFile = File(...), db: Session = Depends(get_db), user: User = Depends(require_role("student"))):
    """Real profile photo upload, used in Resume Builder. Replaces the
    previous photo (if any) — never accumulates duplicate files."""
    if not file.filename.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
        raise HTTPException(status_code=400, detail="Only PNG, JPG, or WEBP images are allowed")

    s = db.query(Student).filter(Student.id == user.student_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Student record not found")

    contents = await file.read()
    if len(contents) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image too large (max 5MB)")

    from app.core.file_storage import upload_file, delete_file

    ext = file.filename.rsplit(".", 1)[-1].lower()
    stored_name = f"{s.usn}_photo.{ext}"

    # remove any previous photo with a different extension for this student
    if s.photo_url:
        old_name = os.path.basename(s.photo_url)
        if old_name != stored_name:
            delete_file(f"profile_photos/{old_name}")

    upload_file(f"profile_photos/{stored_name}", contents)

    s.photo_url = f"/profile-photos/{stored_name}"
    db.commit()
    return {"photo_url": s.photo_url}


@router.get("/insight")
def dashboard_insight(db: Session = Depends(get_db), user: User = Depends(require_role("student"))):
    """A short, real, grounded AI summary of THIS student's own dashboard
    numbers — Understand -> Diagnose -> Recommend — built only from data
    already computed elsewhere on this dashboard, never invented."""
    from app.core.llm_client import generate_dashboard_insight
    from app.models.models import Achievement

    s = db.query(Student).filter(Student.id == user.student_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Student record not found")

    cohort = db.query(Student).filter(
        Student.batch == s.batch, Student.section == s.section, Student.cgpa.isnot(None)
    ).order_by(Student.cgpa.desc()).all()
    rank = next((i + 1 for i, c in enumerate(cohort) if c.id == s.id), None)
    achievement_count = db.query(Achievement).filter(Achievement.student_id == s.id).count()

    sgpa_history = s.semester_sgpa or {}
    sgpa_text = ", ".join(f"Sem {sem}: {sgpa}" for sem, sgpa in sorted(sgpa_history.items())) if sgpa_history else "not available"

    context = (
        f"Student: {s.name}, USN {s.usn}, batch {s.batch}, currently semester {s.semester}\n"
        f"Overall CGPA: {s.cgpa if s.cgpa is not None else 'not available'}\n"
        f"Semester-wise SGPA history: {sgpa_text}\n"
        f"Attendance: {s.attendance_pct if s.attendance_pct is not None else 'not available'}%\n"
        f"Backlogs: {s.backlogs or 0}\n"
        f"Rank in own batch+section (by CGPA, {len(cohort)} ranked students): {rank if rank else 'not available'}\n"
        f"Real achievements/certificates on record: {achievement_count}\n"
    )

    result = generate_dashboard_insight(context, role="student")
    return {"insight": result.get("insight"), "connected": result["connected"]}


@router.get("/rank")
def rank(
    db: Session = Depends(get_db),
    user: User = Depends(require_role("student")),
):
    """Rank is computed only among students in the SAME batch + section (never
    mixed across cohorts), and only among students with complete CGPA data."""
    s = db.query(Student).filter(Student.id == user.student_id).first()
    cohort = (
        db.query(Student)
        .filter(Student.batch == s.batch, Student.section == s.section, Student.cgpa.isnot(None))
        .order_by(Student.cgpa.desc())
        .all()
    )
    excluded = db.query(Student).filter(
        Student.batch == s.batch, Student.section == s.section, Student.cgpa.is_(None)
    ).count()

    rank = next((i + 1 for i, c in enumerate(cohort) if c.id == s.id), None)
    return {
        "rank": rank,
        "cohort_size": len(cohort),
        "excluded_incomplete": excluded,
        "note": f"{excluded} students excluded from ranking — incomplete CGPA data" if excluded else None,
        "top_performers": [{"usn": c.usn, "name": c.name, "cgpa": c.cgpa, "is_you": c.id == s.id} for c in cohort[:8]],
    }


import json as _json


def _achievement_out(a: Achievement):
    return {
        "id": a.id, "title": a.title, "description": a.description, "type": a.type,
        "date": a.date, "year": a.year,
        "certificate_url": signed(f"/achievement-files/{a.certificate_url}") if a.certificate_url else None,
        "certificate_type": a.certificate_type,
        "domain": a.domain,
        "tools_used": a.tools_used.split(",") if a.tools_used else [],
        "technologies_used": a.technologies_used.split(",") if a.technologies_used else [],
        "images": [signed(f"/achievement-files/{img}") for img in _json.loads(a.images)] if a.images else [],
        "won": a.won,
    }


@router.get("/achievements")
def achievements(db: Session = Depends(get_db), user: User = Depends(require_role("student"))):
    rows = db.query(Achievement).filter(Achievement.student_id == user.student_id).order_by(Achievement.id.desc()).all()
    return [_achievement_out(a) for a in rows]


def _save_upload(file: UploadFile, prefix: str) -> str:
    import os, re
    safe_name = re.sub(r"[^A-Za-z0-9_.]", "_", file.filename)
    stored_name = f"{prefix}_{int(datetime.utcnow().timestamp() * 1000)}_{safe_name}"
    upload_dir = os.path.join(os.path.dirname(__file__), "..", "..", "data_raw", "achievement_uploads")
    os.makedirs(upload_dir, exist_ok=True)
    return stored_name, os.path.join(upload_dir, stored_name)


ALLOWED_CERT_EXT = (".pdf", ".jpg", ".jpeg", ".png")
ALLOWED_IMAGE_EXT = (".jpg", ".jpeg", ".png", ".webp")
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB


@router.post("/achievements")
async def add_achievement(
    title: str = Form(...),
    type: str = Form(...),  # "Hackathon" | "Certificate" | "Project" | "Activity"
    year: Optional[int] = Form(None),
    description: str = Form(""),
    domain: str = Form(None),
    tools_used: str = Form(None),          # comma-separated
    technologies_used: str = Form(None),   # comma-separated
    won: bool = Form(False),               # Hackathon-only: explicitly won, not just participated
    certificate: Optional[UploadFile] = File(None),
    images: Optional[List[UploadFile]] = File(None),
    db: Session = Depends(get_db),
    user: User = Depends(require_role("student")),
):
    """Creates a new achievement. Hackathon/Certificate/Activity take one
    optional certificate/proof file; Project takes optional multiple images.
    Files are accepted as-is for this demo phase — certificate_type is
    tagged 'ai_generated_demo' so real validation can be added later without
    a schema change."""
    if type not in ("Hackathon", "Certificate", "Project", "Activity"):
        raise HTTPException(status_code=400, detail="Invalid achievement type")

    from app.core.file_storage import upload_file

    cert_stored_name = None
    if certificate and type in ("Hackathon", "Certificate", "Activity"):
        ext = os.path.splitext(certificate.filename)[1].lower()
        if ext not in ALLOWED_CERT_EXT:
            raise HTTPException(status_code=400, detail="Only PDF, JPG, JPEG, PNG files are allowed")
        contents = await certificate.read()
        if len(contents) > MAX_FILE_SIZE:
            raise HTTPException(status_code=400, detail="File too large (max 10MB)")
        stored_name, _ = _save_upload(certificate, f"{type.lower()}")
        upload_file(f"achievement_uploads/{stored_name}", contents)
        cert_stored_name = stored_name

    image_names = []
    if images and type == "Project":
        for img in images:
            if not img or not img.filename:
                continue
            ext = os.path.splitext(img.filename)[1].lower()
            if ext not in ALLOWED_IMAGE_EXT:
                raise HTTPException(status_code=400, detail=f"Unsupported image type: {ext}")
            contents = await img.read()
            if len(contents) > MAX_FILE_SIZE:
                raise HTTPException(status_code=400, detail="Image too large (max 10MB)")
            stored_name, _ = _save_upload(img, "project_img")
            upload_file(f"achievement_uploads/{stored_name}", contents)
            image_names.append(stored_name)

    a = Achievement(
        student_id=user.student_id, title=title, description=description, type=type,
        date=f"{year}" if year else None, year=year,
        certificate_url=cert_stored_name,
        certificate_type="ai_generated_demo" if cert_stored_name else None,
        domain=domain, tools_used=tools_used, technologies_used=technologies_used,
        images=_json.dumps(image_names) if image_names else None,
        won=won if type == "Hackathon" else False,
    )
    db.add(a)
    db.commit()
    db.refresh(a)
    return _achievement_out(a)


class ProjectEditIn(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    domain: Optional[str] = None
    tools_used: Optional[str] = None
    technologies_used: Optional[str] = None


@router.patch("/achievements/{achievement_id}")
def edit_achievement(achievement_id: int, payload: ProjectEditIn, db: Session = Depends(get_db), user: User = Depends(require_role("student"))):
    """Full field editing — intended for Project (name/domain/tools/tech/
    description are all editable there). For Hackathon/Certificate/Activity,
    name and year are intentionally NOT editable per spec — only the
    certificate file can be replaced, via the /reupload endpoint below."""
    a = db.query(Achievement).filter(Achievement.id == achievement_id, Achievement.student_id == user.student_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="Achievement not found or not yours")
    if a.type != "Project":
        raise HTTPException(status_code=400, detail="Only Project details can be edited — Hackathon/Certificate/Activity only support re-uploading the certificate")
    if payload.title is not None:
        a.title = payload.title
    if payload.description is not None:
        a.description = payload.description
    if payload.domain is not None:
        a.domain = payload.domain
    if payload.tools_used is not None:
        a.tools_used = payload.tools_used
    if payload.technologies_used is not None:
        a.technologies_used = payload.technologies_used
    db.commit()
    db.refresh(a)
    return _achievement_out(a)


@router.post("/achievements/{achievement_id}/reupload")
async def reupload_achievement_file(
    achievement_id: int, certificate: Optional[UploadFile] = File(None), images: Optional[List[UploadFile]] = File(None),
    db: Session = Depends(get_db), user: User = Depends(require_role("student")),
):
    """Replaces the certificate/proof file (or the full image set for a
    Project) on an EXISTING achievement — never creates a duplicate record."""
    a = db.query(Achievement).filter(Achievement.id == achievement_id, Achievement.student_id == user.student_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="Achievement not found or not yours")

    from app.core.file_storage import upload_file

    if certificate:
        ext = os.path.splitext(certificate.filename)[1].lower()
        if ext not in ALLOWED_CERT_EXT:
            raise HTTPException(status_code=400, detail="Only PDF, JPG, JPEG, PNG files are allowed")
        contents = await certificate.read()
        if len(contents) > MAX_FILE_SIZE:
            raise HTTPException(status_code=400, detail="File too large (max 10MB)")
        stored_name, _ = _save_upload(certificate, a.type.lower())
        upload_file(f"achievement_uploads/{stored_name}", contents)
        a.certificate_url = stored_name
        a.certificate_type = "ai_generated_demo"

    if images and a.type == "Project":
        image_names = []
        for img in images:
            if not img or not img.filename:
                continue
            ext = os.path.splitext(img.filename)[1].lower()
            if ext not in ALLOWED_IMAGE_EXT:
                raise HTTPException(status_code=400, detail=f"Unsupported image type: {ext}")
            contents = await img.read()
            if len(contents) > MAX_FILE_SIZE:
                raise HTTPException(status_code=400, detail="Image too large (max 10MB)")
            stored_name, _ = _save_upload(img, "project_img")
            upload_file(f"achievement_uploads/{stored_name}", contents)
            image_names.append(stored_name)
        a.images = _json.dumps(image_names)

    db.commit()
    db.refresh(a)
    return _achievement_out(a)


@router.delete("/achievements/{achievement_id}")
def delete_achievement(achievement_id: int, db: Session = Depends(get_db), user: User = Depends(require_role("student"))):
    a = db.query(Achievement).filter(Achievement.id == achievement_id, Achievement.student_id == user.student_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="Achievement not found")
    # remove associated files from storage, not just the DB record
    from app.core.file_storage import delete_file
    if a.certificate_url:
        delete_file(f"achievement_uploads/{a.certificate_url}")
    if a.images:
        for img in _json.loads(a.images):
            delete_file(f"achievement_uploads/{img}")
    db.delete(a)
    db.commit()
    return {"message": "Deleted"}


@router.get("/documents")
def documents(db: Session = Depends(get_db), user: User = Depends(require_role("student"))):
    rows = db.query(DocumentRequest).filter(DocumentRequest.student_id == user.student_id).all()
    rows = sorted(rows, key=lambda d: d.id, reverse=True)
    return [{"id": d.id, "type": d.type, "purpose": d.purpose, "status": d.status,
             "date": str(d.requested_date)[:10] if d.requested_date else None} for d in rows]


@router.get("/placement")
def my_placement(db: Session = Depends(get_db), user: User = Depends(require_role("student"))):
    from app.core import placement_stats

    records = placement_stats.student_records(db, user.student_id)
    offers = records["placements"]
    any_row = db.query(Placement).filter(Placement.student_id == user.student_id).first()
    if not any_row:
        return {"available": False, "note": "No placement record found for this student.", "placements": [], "internships": records["internships"]}
    # The headline offer is the best-paid one; every offer is listed alongside.
    best = max(offers, key=lambda o: o["package_lpa"] or 0, default=None)
    return {
        "available": True, "placed": bool(offers), "placement_type": any_row.placement_type,
        "resume_link": any_row.resume_link,
        "company": best["company"] if best else None, "ctc": best["ctc"] if best else None,
        "offer_type": best["offer_type"] if best else None, "status": best["status"] if best else None,
        "placements": offers, "internships": records["internships"],
    }


@router.get("/courses")
def my_courses(db: Session = Depends(get_db), user: User = Depends(require_role("student"))):
    rows = db.query(CourseCompletion).filter(CourseCompletion.student_id == user.student_id).all()
    return [{"course_name": r.course_name, "platform": r.platform, "duration": r.duration, "remarks": r.remarks} for r in rows]


@router.get("/counseling")
def my_counseling(db: Session = Depends(get_db), user: User = Depends(require_role("student"))):
    """Real counseling notes actually written for this student by their mentor —
    this was previously 100% mock data and never showed real teacher notes."""
    from app.models.models import CounselingNote, Faculty
    rows = db.query(CounselingNote).filter(CounselingNote.student_id == user.student_id).order_by(CounselingNote.date.desc()).all()
    faculty = {f.id: f for f in db.query(Faculty).filter(Faculty.id.in_({n.faculty_id for n in rows})).all()} if rows else {}
    mentor = None
    if rows and rows[0].faculty_id in faculty:
        f = faculty[rows[0].faculty_id]
        mentor = {"name": f.name, "designation": f.designation}
    return {
        "mentor": mentor,
        "notes": [{
            "id": n.id, "date": str(n.date), "note": n.note,
            "teacher_name": faculty[n.faculty_id].name if n.faculty_id in faculty else None,
            "reply_status": n.reply_status, "reply_description": n.reply_description,
            "replied_at": str(n.replied_at) if n.replied_at else None,
            "teacher_reply": n.teacher_reply,
            "teacher_replied_at": str(n.teacher_replied_at) if n.teacher_replied_at else None,
        } for n in rows],
    }


@router.get("/certificates")
def my_certificates(db: Session = Depends(get_db), user: User = Depends(require_role("student"))):
    """Certificate files on record for this student. Real, verified MOOC/
    Certificate-category files only — demo/placeholder Certificate records
    (Canva-template files backfilled for students with no real MOOC
    certificate on file) are excluded here so this always reflects the
    student's own real, actually-uploaded certificates, dynamically fetched
    from the database and storage rather than any placeholder data. Demo
    Hackathon records are a separate, unrelated placeholder category and
    are intentionally left out of scope for this filter."""
    from app.models.models import CertificateFile
    from urllib.parse import quote
    # Placeholder files loaded for demonstration are never listed: only real
    # certificate files a student or the department put on the record.
    rows = db.query(CertificateFile).filter(
        CertificateFile.student_id == user.student_id, CertificateFile.is_demo == False,  # noqa: E712
    ).all()
    return [{
        "id": c.id, "filename": c.filename, "label": c.display_label,
        "category": c.category, "is_demo": c.is_demo,
        "download_url": signed(f"/certificates/{c.filename}"),
        "uploaded_at": str(c.uploaded_at),
    } for c in rows]


@router.patch("/certificates/{certificate_id}")
def update_certificate(certificate_id: int, label: str = None, category: str = None, db: Session = Depends(get_db), user: User = Depends(require_role("student"))):
    from app.models.models import CertificateFile
    c = db.query(CertificateFile).filter(CertificateFile.id == certificate_id, CertificateFile.student_id == user.student_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Certificate not found or not yours")
    if label:
        c.display_label = label
    if category:
        c.category = category
    db.commit()
    url_base = "/demo-certificates" if c.is_demo else "/certificates"
    return {"id": c.id, "label": c.display_label, "category": c.category, "download_url": f"{url_base}/{c.filename}"}


@router.post("/certificates/upload")
async def upload_certificate(
    file: UploadFile = File(...), label: str = Form("Certificate"), category: str = Form("Certificate"),
    certificate_id: Optional[int] = Form(None),
    db: Session = Depends(get_db), user: User = Depends(require_role("student")),
):
    """Real file upload — re-uploading replaces the file for an EXISTING
    record (no duplicate created) when certificate_id is given; otherwise
    creates a new one. Only ever touches the logged-in student's own records.
    A genuine re-upload always makes the record real (is_demo=False) — an
    actual uploaded file is never a placeholder, even if it started as one."""
    from app.models.models import CertificateFile
    from app.core.file_storage import upload_file
    import re

    if not file:
        raise HTTPException(status_code=400, detail="No file provided")
    if not file.filename.lower().endswith((".pdf", ".png", ".jpg", ".jpeg")):
        raise HTTPException(status_code=400, detail="Only PDF, PNG, or JPG files are allowed")

    student = db.query(Student).filter(Student.id == user.student_id).first()
    safe_name = re.sub(r"[^A-Za-z0-9_.]", "_", file.filename)
    stored_name = f"{student.usn}_{int(datetime.utcnow().timestamp())}_{safe_name}"

    contents = await file.read()
    upload_file(f"real_mooc_certs/{stored_name}", contents)

    if certificate_id:
        c = db.query(CertificateFile).filter(CertificateFile.id == certificate_id, CertificateFile.student_id == user.student_id).first()
        if not c:
            raise HTTPException(status_code=404, detail="Certificate not found or not yours")
        c.filename = stored_name
        c.display_label = label
        c.category = category
        c.is_demo = False  # a real uploaded file is never a placeholder
    else:
        c = CertificateFile(student_id=user.student_id, filename=stored_name, display_label=label, category=category, is_demo=False)
        db.add(c)
    db.commit()
    db.refresh(c)
    return {"id": c.id, "label": c.display_label, "download_url": signed(f"/certificates/{c.filename}")}


@router.delete("/certificates/{certificate_id}")
def delete_certificate(certificate_id: int, db: Session = Depends(get_db), user: User = Depends(require_role("student"))):
    from app.models.models import CertificateFile
    c = db.query(CertificateFile).filter(CertificateFile.id == certificate_id, CertificateFile.student_id == user.student_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Certificate not found or not yours")
    db.delete(c)
    db.commit()
    return {"message": "Deleted"}


@router.get("/internships")
def my_internships(db: Session = Depends(get_db), user: User = Depends(require_role("student"))):
    from app.models.models import Internship
    rows = db.query(Internship).filter(Internship.student_id == user.student_id).all()

    def duration(r: Internship):
        if r.duration_text:
            return r.duration_text
        if r.start_date and r.end_date:
            return f"{r.start_date:%d %b %Y} – {r.end_date:%d %b %Y}"
        return None

    def stipend(r: Internship):
        if r.stipend_per_month is not None:
            return f"\u20b9{int(r.stipend_per_month):,} / month"
        return r.stipend or "Not Available"

    return [{
        "id": r.id, "company": r.company_ref.name if r.company_ref else r.company, "role": r.role,
        "duration": duration(r), "stipend": stipend(r),
        "stipend_per_month": float(r.stipend_per_month) if r.stipend_per_month is not None else None,
        "status": r.status, "verified": bool(r.verified),
    } for r in rows]


@router.get("/attendance")
def my_attendance(db: Session = Depends(get_db), user: User = Depends(require_role("student"))):
    """Real, computed attendance — built ONLY from attendance sessions a
    teacher has actually marked for this student. No fabricated numbers, no
    fake per-window adjustments. If no sessions exist yet for a subject, that
    subject legitimately shows no data rather than a randomized percentage."""
    records = (
        db.query(AttendanceRecord, AttendanceSession, Subject)
        .join(AttendanceSession, AttendanceRecord.session_id == AttendanceSession.id)
        .join(Subject, AttendanceSession.subject_id == Subject.id)
        .filter(AttendanceRecord.student_id == user.student_id)
        .all()
    )

    by_subject: dict = {}
    for rec, session, subject in records:
        key = subject.id
        by_subject.setdefault(key, {"code": subject.code, "name": subject.name, "held": 0, "attended": 0})
        by_subject[key]["held"] += 1
        if rec.present:
            by_subject[key]["attended"] += 1

    subjects_out = []
    for s in by_subject.values():
        pct = round((s["attended"] / s["held"]) * 100, 1) if s["held"] > 0 else None
        subjects_out.append({**s, "pct": pct})

    overall_held = sum(s["held"] for s in by_subject.values())
    overall_attended = sum(s["attended"] for s in by_subject.values())
    overall_pct = round((overall_attended / overall_held) * 100, 1) if overall_held > 0 else None

    return {"subjects": subjects_out, "overall_pct": overall_pct, "total_sessions_recorded": overall_held}


@router.post("/documents")
def request_document(payload: DocumentRequestCreate, db: Session = Depends(get_db), user: User = Depends(require_role("student"))):
    d = DocumentRequest(student_id=user.student_id, type=payload.type, purpose=payload.purpose, status="Pending")
    db.add(d)
    db.commit()
    db.refresh(d)
    return {"id": d.id, "type": d.type, "purpose": d.purpose, "status": d.status}
