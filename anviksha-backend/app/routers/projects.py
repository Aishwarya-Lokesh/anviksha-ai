"""Project report and presentation builder.

Formats (templates) are uploaded by an HOD or admin for everyone, or by a
student for themselves. A student creates a project, gives its details and
material, and the builder writes the report and slides into the chosen
format. A project belongs to the student who created it; a guide sees it
only when the student shares it with them."""
import json
import os
import re
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core import file_storage, project_docx, project_extract as px, project_fields as pf, project_jobs as jobs, project_pdf, project_pptx, project_writer as pw
from app.core.activity_log import log_activity
from app.core.database import get_db
from app.core.security import get_current_user, require_role
from app.models.models import (
    Department, Faculty, ProjectComment, ProjectImage, ProjectJob, ProjectMaterial, ProjectTemplate, ProjectVersion, Student, StudentProject, User,
)

router = APIRouter(tags=["projects"])

COLLEGE = os.getenv("COLLEGE_NAME", "GSSS Institute of Engineering and Technology for Women, Mysuru")
MAX_TEMPLATE_BYTES = 25 * 1024 * 1024
MAX_MATERIALS = 25
MAX_PROJECTS = 10
PROJECT_TYPES = ("Final year project", "Mini project", "Internship report", "Seminar", "Other")
DOWNLOADS = {"report_docx": ("report.docx", project_pdf.TYPES["docx"]), "report_pdf": ("report.pdf", "application/pdf"),
             "ppt_pptx": ("slides.pptx", project_pdf.TYPES["pptx"]), "ppt_pdf": ("slides.pdf", "application/pdf")}


def _loads(text, default):
    return jobs.loads(text, default)


def _safe_name(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", os.path.basename(name or "file"))[-90:] or "file"


# ------------------------------------------------------------------ formats

def _template_out(t: ProjectTemplate, user: User, full: bool = False) -> dict:
    out = {"id": t.id, "kind": t.kind, "scope": t.scope, "name": t.name, "project_type": t.project_type, "batch": t.batch, "filename": t.filename,
           "active": bool(t.is_active), "uploaded": str(t.created_at)[:10] if t.created_at else None,
           "can_edit": user.role == "admin" or t.uploaded_by == user.id or (user.role == "hod" and t.scope == "official" and t.department_id == user.department_id)}
    if full:
        out["analysis"] = _loads(t.analysis, {})
        out["field_map"] = _loads(t.field_map, [])
        out["fields"] = [{"key": k, "label": v[0]} for k, v in pf.FIELDS.items()]
        out["preview_available"] = project_pdf.status()["available"]
    else:
        analysis = _loads(t.analysis, {})
        out["warnings"] = len(analysis.get("warnings") or [])
    return out


def _visible_templates(db: Session, user: User):
    q = db.query(ProjectTemplate)
    if user.role == "admin":
        return q.filter(ProjectTemplate.scope == "official")
    if user.role == "hod":
        return q.filter(ProjectTemplate.scope == "official", or_(ProjectTemplate.department_id == user.department_id, ProjectTemplate.department_id.is_(None)))
    if user.role == "student":
        student = db.query(Student).filter(Student.id == user.student_id).first()
        dept = student.department_id if student else None
        return q.filter(or_(
            (ProjectTemplate.scope == "official") & (ProjectTemplate.is_active == True) & or_(ProjectTemplate.department_id == dept, ProjectTemplate.department_id.is_(None)),  # noqa: E712
            (ProjectTemplate.scope == "custom") & (ProjectTemplate.owner_student_id == user.student_id) & (ProjectTemplate.is_active == True)))  # noqa: E712
    return q.filter(ProjectTemplate.id == -1)


def _template_or_404(db: Session, user: User, template_id: int) -> ProjectTemplate:
    t = _visible_templates(db, user).filter(ProjectTemplate.id == template_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Format not found")
    return t


@router.get("/project-formats")
def list_formats(db: Session = Depends(get_db), user: User = Depends(require_role("student", "hod", "admin"))):
    rows = _visible_templates(db, user).order_by(ProjectTemplate.scope.desc(), ProjectTemplate.id.desc()).all()
    return {"formats": [_template_out(t, user) for t in rows], "project_types": PROJECT_TYPES, "pdf": project_pdf.status()["available"]}


@router.post("/project-formats")
async def upload_format(
    file: UploadFile = File(...), kind: str = Form(...), name: str = Form(...), project_type: Optional[str] = Form(None), batch: Optional[str] = Form(None),
    department_id: Optional[int] = Form(None),
    db: Session = Depends(get_db), user: User = Depends(require_role("student", "hod", "admin")),
):
    """Reads the file straight away: a file that cannot be opened is refused
    here, with the reason, rather than failing later when a student uses it."""
    if kind not in ("report", "ppt"):
        raise HTTPException(status_code=400, detail="Choose whether this is a report format or a presentation format")
    filename = file.filename or ""
    wanted = ".docx" if kind == "report" else ".pptx"
    if not filename.lower().endswith(wanted):
        old = ".doc" if kind == "report" else ".ppt"
        hint = f" Open it and use Save As to make a {wanted} file." if filename.lower().endswith(old) else ""
        raise HTTPException(status_code=400, detail=f"A {'report' if kind == 'report' else 'presentation'} format must be a {wanted} file.{hint}")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="That file is empty")
    if len(data) > MAX_TEMPLATE_BYTES:
        raise HTTPException(status_code=400, detail="That file is larger than 25 MB")
    name = name.strip()
    if len(name) < 3 or len(name) > 120:
        raise HTTPException(status_code=400, detail="Give the format a name of 3 to 120 characters")
    try:
        analysis = (project_docx if kind == "report" else project_pptx).analyse(data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    scope = "custom" if user.role == "student" else "official"
    dept = None
    if user.role == "hod":
        dept = user.department_id
    elif user.role == "admin" and department_id:
        if not db.query(Department).filter(Department.id == department_id).first():
            raise HTTPException(status_code=400, detail="Department not found")
        dept = department_id
    t = ProjectTemplate(kind=kind, scope=scope, name=name, project_type=(project_type or "").strip() or None, batch=(batch or "").strip() or None,
                        department_id=dept, owner_student_id=user.student_id if scope == "custom" else None, uploaded_by=user.id,
                        filename=_safe_name(filename), file_path="pending", analysis=json.dumps(analysis), field_map=json.dumps(analysis.get("field_map") or []))
    db.add(t)
    db.flush()
    t.file_path = f"project_formats/{t.id}_{_safe_name(filename)}"
    file_storage.upload_file(t.file_path, data, project_pdf.TYPES["docx" if kind == "report" else "pptx"])
    db.commit()
    db.refresh(t)
    if scope == "official":
        log_activity(db, user, f"Uploaded project {'report' if kind == 'report' else 'presentation'} format: {name}")
    return _template_out(t, user, full=True)


@router.get("/project-formats/{template_id}")
def get_format(template_id: int, db: Session = Depends(get_db), user: User = Depends(require_role("student", "hod", "admin"))):
    return _template_out(_template_or_404(db, user, template_id), user, full=True)


class FormatEdit(BaseModel):
    name: Optional[str] = None
    project_type: Optional[str] = None
    batch: Optional[str] = None
    active: Optional[bool] = None
    field_map: Optional[list] = None


@router.patch("/project-formats/{template_id}")
def edit_format(template_id: int, payload: FormatEdit, db: Session = Depends(get_db), user: User = Depends(require_role("student", "hod", "admin"))):
    t = _template_or_404(db, user, template_id)
    if not _template_out(t, user)["can_edit"]:
        raise HTTPException(status_code=403, detail="Only whoever uploaded this format can change it")
    sent = payload.dict(exclude_unset=True)
    if "name" in sent:
        if len((sent["name"] or "").strip()) < 3:
            raise HTTPException(status_code=400, detail="Give the format a name of 3 to 120 characters")
        t.name = sent["name"].strip()[:120]
    if "project_type" in sent:
        t.project_type = (sent["project_type"] or "").strip() or None
    if "batch" in sent:
        t.batch = (sent["batch"] or "").strip() or None
    if "active" in sent:
        t.is_active = bool(sent["active"])
    if "field_map" in sent:
        t.field_map = json.dumps(pf.clean_map(sent["field_map"]))
    db.commit()
    if t.scope == "official":
        log_activity(db, user, f"Changed project format: {t.name}")
    return _template_out(t, user, full=True)


@router.delete("/project-formats/{template_id}")
def delete_format(template_id: int, db: Session = Depends(get_db), user: User = Depends(require_role("student", "hod", "admin"))):
    """Removes a format nobody is using. One that a project was built from can only be switched off, so that project keeps working."""
    t = _template_or_404(db, user, template_id)
    if not _template_out(t, user)["can_edit"]:
        raise HTTPException(status_code=403, detail="Only whoever uploaded this format can delete it")
    in_use = db.query(StudentProject).filter(or_(StudentProject.report_template_id == t.id, StudentProject.ppt_template_id == t.id)).count()
    if in_use:
        raise HTTPException(status_code=409, detail=f"{in_use} project{'s use' if in_use != 1 else ' uses'} this format. Switch it off instead; it will stop being offered.")
    paths, name, official = [t.file_path, t.preview_path], t.name, t.scope == "official"
    db.delete(t)
    db.commit()
    for path in paths:
        if path:
            project_pdf.forget_pdf(path)
            try:
                file_storage.delete_file(path)
            except Exception:
                pass
    if official:
        log_activity(db, user, f"Deleted project format: {name}")
    return {"message": "Deleted"}


@router.get("/project-formats/{template_id}/file")
def format_file(template_id: int, as_pdf: bool = False, db: Session = Depends(get_db), user: User = Depends(require_role("student", "hod", "admin"))):
    """The format file itself, or its PDF rendering for the preview."""
    t = _template_or_404(db, user, template_id)
    ext = "docx" if t.kind == "report" else "pptx"
    if not as_pdf:
        return Response(file_storage.get_file(t.file_path), media_type=project_pdf.TYPES[ext], headers={"Content-Disposition": f'attachment; filename="{t.filename}"'})
    if t.preview_path:
        try:
            return Response(file_storage.get_file(t.preview_path), media_type="application/pdf")
        except FileNotFoundError:
            pass
    try:
        pdf = project_pdf.convert(file_storage.get_file(t.file_path), ext)
    except project_pdf.ConverterUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    t.preview_path = f"project_formats/{t.id}_preview.pdf"
    file_storage.upload_file(t.preview_path, pdf, "application/pdf")
    db.commit()
    return Response(pdf, media_type="application/pdf")


def _page(path: str, page: int) -> Response:
    try:
        pdf = project_pdf.cached_pdf(path, file_storage.get_file)
        return Response(project_pdf.page_image(pdf, page), media_type="image/png", headers={"Cache-Control": "private, max-age=600"})
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="That file is no longer in storage")
    except IndexError:
        raise HTTPException(status_code=404, detail="There is no such page")


@router.get("/project-formats/{template_id}/pages")
def format_pages(template_id: int, db: Session = Depends(get_db), user: User = Depends(require_role("student", "hod", "admin"))):
    """How many pages the format's preview has. Makes the preview on first use."""
    t = _template_or_404(db, user, template_id)
    if not t.preview_path:
        format_file(template_id, as_pdf=True, db=db, user=user)
        db.refresh(t)
    try:
        return {"pages": project_pdf.page_count(project_pdf.cached_pdf(t.preview_path, file_storage.get_file))}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="The preview is no longer in storage")


@router.get("/project-formats/{template_id}/pages/{page}")
def format_page(template_id: int, page: int, db: Session = Depends(get_db), user: User = Depends(require_role("student", "hod", "admin"))):
    t = _template_or_404(db, user, template_id)
    if not t.preview_path:
        raise HTTPException(status_code=404, detail="No preview yet")
    return _page(t.preview_path, page)


# ------------------------------------------------------------------ projects

def _student(db: Session, user: User) -> Student:
    s = db.query(Student).filter(Student.id == user.student_id).first()
    if not s:
        raise HTTPException(status_code=403, detail="This login isn't linked to a student record")
    return s


def _project(db: Session, user: User, project_id: int) -> StudentProject:
    p = db.query(StudentProject).filter(StudentProject.id == project_id, StudentProject.student_id == user.student_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")
    return p


def _active_job(db: Session, project_id: int) -> Optional[ProjectJob]:
    return db.query(ProjectJob).filter(ProjectJob.project_id == project_id, ProjectJob.status.in_(("queued", "running"))).order_by(ProjectJob.id.desc()).first()


def _job_out(j: Optional[ProjectJob]) -> Optional[dict]:
    if j is None:
        return None
    return {"id": j.id, "kind": j.kind, "status": j.status, "step": j.step, "percent": j.percent, "error": j.error,
            "result": _loads(j.result, {}) if j.status == "done" else None}


def _version_out(v: ProjectVersion) -> dict:
    return {"number": v.number, "created": str(v.created_at)[:16] if v.created_at else None, "files": sorted(_loads(v.files, {})), "report": _loads(v.report, {})}


def _state(db: Session, user: User, p: StudentProject) -> dict:
    g = jobs.gather(db, p)
    materials = db.query(ProjectMaterial).filter(ProjectMaterial.project_id == p.id).order_by(ProjectMaterial.id).all()
    versions = db.query(ProjectVersion).filter(ProjectVersion.project_id == p.id).order_by(ProjectVersion.number.desc()).all()
    last = db.query(ProjectJob).filter(ProjectJob.project_id == p.id).order_by(ProjectJob.id.desc()).first()
    comments = db.query(ProjectComment).filter(ProjectComment.project_id == p.id).order_by(ProjectComment.id).all()
    guide = db.query(Faculty).filter(Faculty.id == p.guide_faculty_id).first() if p.guide_faculty_id else None
    return {
        "id": p.id, "title": p.title, "details": _loads(p.details, {}), "answers": g["answers"], "content": _loads(p.content, {}),
        "report_format_id": p.report_template_id, "ppt_format_id": p.ppt_template_id,
        "materials": [{"id": m.id, "filename": m.filename, "kind": m.kind, "size": m.size, "characters": len(m.text or ""), "tables": len(_loads(m.tables, [])), "note": m.note} for m in materials],
        "images": [{"id": i["id"], "name": i["name"], "caption": i["caption"], "source": i["source"]} for i in g["images"]],
        "plan": g["plan"], "readiness": pw.readiness(g["plan"], g["answers"], g["materials"]),
        "global_questions": [{"id": q[0], "label": q[1], "hint": q[2], "required": q[3]} for q in pw.GLOBAL_QUESTIONS],
        "versions": [_version_out(v) for v in versions], "job": _job_out(last), "environment": jobs.env_summary(),
        "shared_with": {"id": guide.id, "name": guide.name} if guide else None,
        "comments": [_comment_out(c) for c in comments],
        "updated": str(p.updated_at)[:16] if p.updated_at else None,
    }


@router.get("/student/projects")
def my_projects(db: Session = Depends(get_db), user: User = Depends(require_role("student"))):
    rows = db.query(StudentProject).filter(StudentProject.student_id == user.student_id).order_by(StudentProject.id.desc()).all()
    counts = {pid: n for pid, n in ((r.id, db.query(ProjectVersion).filter(ProjectVersion.project_id == r.id).count()) for r in rows)}
    return [{"id": r.id, "title": r.title, "project_type": _loads(r.details, {}).get("project_type"), "versions": counts[r.id], "updated": str(r.updated_at)[:16] if r.updated_at else None} for r in rows]


@router.get("/student/projects/start")
def start_info(db: Session = Depends(get_db), user: User = Depends(require_role("student"))):
    """What the details form can fill in on its own from the college's records."""
    s = _student(db, user)
    dept = db.query(Department).filter(Department.id == s.department_id).first()
    hod = db.query(User).filter(User.role == "hod", User.department_id == s.department_id, User.is_active == True).first()  # noqa: E712
    faculty = db.query(Faculty).filter(Faculty.department_id == s.department_id).order_by(Faculty.name).all()
    year = int(s.batch) + 3 if (s.batch or "").isdigit() else None
    return {
        "me": {"name": s.name, "usn": s.usn}, "department": dept.name if dept else "", "college": COLLEGE,
        "hod_name": (hod.display_name if hod and hod.display_name else ""),
        "academic_year": f"{year}-{year + 1}" if year else "",
        "guides": [{"id": f.id, "name": f.name, "designation": f.designation} for f in faculty],
        "project_types": PROJECT_TYPES,
    }


@router.get("/student/projects/classmates")
def classmates(q: str = "", db: Session = Depends(get_db), user: User = Depends(require_role("student"))):
    """Students of the same department and batch, for picking teammates. Name and USN only."""
    s = _student(db, user)
    needle = q.strip()
    if len(needle) < 2:
        return []
    like = f"%{needle}%"
    rows = db.query(Student).filter(Student.department_id == s.department_id, Student.batch == s.batch, Student.id != s.id,
                                    or_(Student.name.ilike(like), Student.usn.ilike(like))).order_by(Student.usn).limit(10).all()
    return [{"name": r.name, "usn": r.usn} for r in rows]


class ProjectIn(BaseModel):
    title: Optional[str] = None
    details: Optional[dict] = None
    answers: Optional[dict] = None
    report_format_id: Optional[int] = None
    ppt_format_id: Optional[int] = None
    content: Optional[dict] = None


DETAIL_KEYS = ("students", "guide_name", "guide_designation", "hod_name", "hod_designation", "principal_name", "department", "college", "academic_year",
               "degree", "project_type", "domain", "tech_stack", "date", "place", "make_diagram")


def _clean_details(raw: dict) -> dict:
    out = {}
    for key in DETAIL_KEYS:
        if key not in raw:
            continue
        value = raw[key]
        if key == "students":
            people = []
            for s in (value or [])[:8]:
                name, usn = str((s or {}).get("name") or "").strip()[:80], str((s or {}).get("usn") or "").strip().upper()[:20]
                if name:
                    people.append({"name": name, "usn": usn})
            out[key] = people
        elif key == "make_diagram":
            out[key] = bool(value)
        else:
            out[key] = str(value or "").strip()[:300]
    return out


def _clean_content(db: Session, project: StudentProject, raw: dict, current: dict) -> dict:
    """A draft as edited by the student, kept to the shapes the builders understand.
    Pictures must be the project's own; tables keep their rows."""
    own_images = {i.id for i in db.query(ProjectImage).filter(ProjectImage.project_id == project.id).all()}
    text = lambda v, n: str(v or "").strip()[:n]  # noqa: E731
    chapters = []
    for c in (raw.get("chapters") or [])[:20]:
        blocks = []
        for b in (c.get("blocks") or [])[:120]:
            kind = (b or {}).get("type")
            if kind == "heading" and text(b.get("text"), 160):
                blocks.append({"type": "heading", "level": 3 if b.get("level") == 3 else 2, "text": text(b["text"], 160)})
            elif kind == "para" and text(b.get("text"), 6000):
                blocks.append({"type": "para", "text": text(b["text"], 6000)})
            elif kind == "bullets":
                items = [text(i, 600) for i in (b.get("items") or [])[:30] if text(i, 600)]
                if items:
                    blocks.append({"type": "bullets", "items": items})
            elif kind == "figure" and b.get("image_id") in own_images:
                blocks.append({"type": "figure", "image_id": b["image_id"], "caption": text(b.get("caption"), 160)})
            elif kind == "table" and isinstance(b.get("rows"), list) and len(b["rows"]) >= 2:
                blocks.append({"type": "table", "caption": text(b.get("caption"), 160), "rows": [[text(cell, 300) for cell in row[:10]] for row in b["rows"][:40] if isinstance(row, list)]})
        if text(c.get("title"), 120):
            chapters.append({"key": text(c.get("key"), 60) or "other", "title": text(c["title"], 120), "blocks": blocks, "missing": [text(m, 200) for m in (c.get("missing") or [])[:6]], "skipped": not blocks})
    slides = []
    for s in (raw.get("slides") or [])[:80]:
        bullets = [text(i, 300) for i in ((s or {}).get("bullets") or [])[:14] if text(i, 300)]
        if text(s.get("title"), 100):
            slide = {"title": text(s["title"], 100), "bullets": bullets, "notes": text(s.get("notes"), 1500), "source": text(s.get("source"), 60)}
            if s.get("image_id") in own_images:
                slide["image_id"] = s["image_id"]
            slides.append(slide)
    return {"chapters": chapters, "slides": slides,
            "abstract": [text(p, 3000) for p in (raw.get("abstract") or [])[:4] if text(p, 3000)],
            "acknowledgement": [text(p, 2000) for p in (raw.get("acknowledgement") or [])[:8] if text(p, 2000)],
            "references": pw.clean_references(raw.get("references") or []),
            "warnings": current.get("warnings") or []}


def _apply(db: Session, user: User, p: StudentProject, payload: ProjectIn) -> None:
    sent = payload.dict(exclude_unset=True)
    if "title" in sent:
        title = (sent["title"] or "").strip()
        if len(title) < 5 or len(title) > 200:
            raise HTTPException(status_code=400, detail="The project title should be 5 to 200 characters")
        p.title = title
    if "details" in sent:
        p.details = json.dumps({**_loads(p.details, {}), **_clean_details(sent["details"] or {})})
    if "answers" in sent:
        answers = _loads(p.answers, {})
        for key, value in (sent["answers"] or {}).items():
            answers[str(key)[:60]] = str(value or "").strip()[:8000]
        p.answers = json.dumps(answers)
    for field, kind, column in (("report_format_id", "report", "report_template_id"), ("ppt_format_id", "ppt", "ppt_template_id")):
        if field in sent:
            if sent[field] is None:
                setattr(p, column, None)
                continue
            t = _template_or_404(db, user, sent[field])
            if t.kind != kind:
                raise HTTPException(status_code=400, detail="That format is the wrong kind for this choice")
            setattr(p, column, t.id)
    if "content" in sent and sent["content"] is not None:
        p.content = json.dumps(_clean_content(db, p, sent["content"], _loads(p.content, {})))


@router.post("/student/projects")
def create_project(payload: ProjectIn, db: Session = Depends(get_db), user: User = Depends(require_role("student"))):
    s = _student(db, user)
    if db.query(StudentProject).filter(StudentProject.student_id == s.id).count() >= MAX_PROJECTS:
        raise HTTPException(status_code=400, detail=f"You can keep up to {MAX_PROJECTS} projects. Delete one you no longer need.")
    if not (payload.title or "").strip():
        raise HTTPException(status_code=400, detail="The project title should be 5 to 200 characters")
    p = StudentProject(student_id=s.id, title="", details="{}", answers="{}", content="{}")
    _apply(db, user, p, payload)
    details = _loads(p.details, {})
    if not details.get("students"):
        details["students"] = [{"name": s.name, "usn": s.usn}]
        p.details = json.dumps(details)
    db.add(p)
    db.commit()
    db.refresh(p)
    return _state(db, user, p)


@router.get("/student/projects/{project_id}")
def get_project(project_id: int, db: Session = Depends(get_db), user: User = Depends(require_role("student"))):
    return _state(db, user, _project(db, user, project_id))


@router.patch("/student/projects/{project_id}")
def edit_project(project_id: int, payload: ProjectIn, db: Session = Depends(get_db), user: User = Depends(require_role("student"))):
    p = _project(db, user, project_id)
    if payload.content is not None and _active_job(db, p.id):
        raise HTTPException(status_code=409, detail="The project is being written or built right now. Wait for that to finish, then edit.")
    _apply(db, user, p, payload)
    db.commit()
    return _state(db, user, p)


@router.delete("/student/projects/{project_id}")
def delete_project(project_id: int, db: Session = Depends(get_db), user: User = Depends(require_role("student"))):
    p = _project(db, user, project_id)
    if _active_job(db, p.id):
        raise HTTPException(status_code=409, detail="Wait for the current work on this project to finish first")
    paths = [m.file_path for m in db.query(ProjectMaterial).filter(ProjectMaterial.project_id == p.id)] + [i.file_path for i in db.query(ProjectImage).filter(ProjectImage.project_id == p.id)]
    for v in db.query(ProjectVersion).filter(ProjectVersion.project_id == p.id):
        paths.extend(_loads(v.files, {}).values())
    for model in (ProjectComment, ProjectJob, ProjectVersion, ProjectImage, ProjectMaterial):
        db.query(model).filter(model.project_id == p.id).delete()
    db.delete(p)
    db.commit()
    for path in paths:
        try:
            file_storage.delete_file(path)
        except Exception:
            pass
    return {"message": "Deleted"}


# ------------------------------------------------------------------ material and pictures

def _store_image(db: Session, p: StudentProject, name: str, data: bytes, source: str, material_id: Optional[int] = None, caption: Optional[str] = None) -> Optional[ProjectImage]:
    ok, w, h = px._image_ok(data)
    if not ok:
        return None
    data = px.as_png(data)
    row = ProjectImage(project_id=p.id, material_id=material_id, name=_safe_name(name), caption=caption, source=source, file_path="pending", width=w, height=h)
    db.add(row)
    db.flush()
    ext = ".jpg" if data[:3] == b"\xff\xd8\xff" else ".png"
    row.file_path = f"projects/{p.id}/images/{row.id}{ext}"
    file_storage.upload_file(row.file_path, data, "image/jpeg" if ext == ".jpg" else "image/png")
    return row


@router.post("/student/projects/{project_id}/materials")
async def add_material(project_id: int, file: UploadFile = File(...), db: Session = Depends(get_db), user: User = Depends(require_role("student"))):
    p = _project(db, user, project_id)
    if db.query(ProjectMaterial).filter(ProjectMaterial.project_id == p.id).count() >= MAX_MATERIALS:
        raise HTTPException(status_code=400, detail=f"A project can hold up to {MAX_MATERIALS} files. Remove one first.")
    data = await file.read()
    try:
        out = px.extract(file.filename or "file", data)
    except px.Unreadable as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    m = ProjectMaterial(project_id=p.id, filename=_safe_name(file.filename or "file"), kind=out["kind"], file_path="pending", size=len(data),
                        text=out["text"], tables=json.dumps(out["tables"]), note=out["note"])
    db.add(m)
    db.flush()
    m.file_path = f"projects/{p.id}/materials/{m.id}_{m.filename}"
    file_storage.upload_file(m.file_path, data)
    kept = 0
    for name, blob in out["images"]:
        if _store_image(db, p, name, blob, "upload" if out["kind"] == "image" else "extracted", material_id=m.id):
            kept += 1
    db.commit()
    return {"id": m.id, "filename": m.filename, "kind": m.kind, "characters": len(m.text or ""), "pictures": kept, "tables": len(out["tables"]), "note": m.note}


@router.delete("/student/projects/{project_id}/materials/{material_id}")
def remove_material(project_id: int, material_id: int, db: Session = Depends(get_db), user: User = Depends(require_role("student"))):
    p = _project(db, user, project_id)
    m = db.query(ProjectMaterial).filter(ProjectMaterial.id == material_id, ProjectMaterial.project_id == p.id).first()
    if not m:
        raise HTTPException(status_code=404, detail="File not found")
    images = db.query(ProjectImage).filter(ProjectImage.material_id == m.id).all()
    in_use = _images_in_use(_loads(p.content, {}))
    paths = [m.file_path]
    for image in images:
        if image.id in in_use:
            image.material_id = None          # still placed in the draft: keep the picture, forget where it came from
        else:
            paths.append(image.file_path)
            db.delete(image)
    db.delete(m)
    db.commit()
    for path in paths:
        try:
            file_storage.delete_file(path)
        except Exception:
            pass
    return {"message": "Removed"}


def _images_in_use(content: dict) -> set:
    used = {b.get("image_id") for c in content.get("chapters") or [] for b in c.get("blocks") or [] if b.get("type") == "figure"}
    return used | {s.get("image_id") for s in content.get("slides") or [] if s.get("image_id") is not None}


def _image(db: Session, project_id: int, image_id: int) -> ProjectImage:
    i = db.query(ProjectImage).filter(ProjectImage.id == image_id, ProjectImage.project_id == project_id).first()
    if not i:
        raise HTTPException(status_code=404, detail="Picture not found")
    return i


@router.get("/student/projects/{project_id}/images/{image_id}")
def image_file(project_id: int, image_id: int, db: Session = Depends(get_db), user: User = Depends(require_role("student"))):
    i = _image(db, _project(db, user, project_id).id, image_id)
    try:
        return Response(file_storage.get_file(i.file_path), media_type="image/jpeg" if i.file_path.endswith(".jpg") else "image/png", headers={"Cache-Control": "private, max-age=3600"})
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Picture file not found")


class ImageEdit(BaseModel):
    caption: Optional[str] = None


@router.patch("/student/projects/{project_id}/images/{image_id}")
def edit_image(project_id: int, image_id: int, payload: ImageEdit, db: Session = Depends(get_db), user: User = Depends(require_role("student"))):
    i = _image(db, _project(db, user, project_id).id, image_id)
    i.caption = (payload.caption or "").strip()[:160] or None
    db.commit()
    return {"id": i.id, "caption": i.caption}


@router.delete("/student/projects/{project_id}/images/{image_id}")
def delete_image(project_id: int, image_id: int, db: Session = Depends(get_db), user: User = Depends(require_role("student"))):
    """Removes a picture from the project and from wherever the draft uses it."""
    p = _project(db, user, project_id)
    i = _image(db, p.id, image_id)
    content = _loads(p.content, {})
    for c in content.get("chapters") or []:
        c["blocks"] = [b for b in c.get("blocks") or [] if not (b.get("type") == "figure" and b.get("image_id") == i.id)]
    for s in content.get("slides") or []:
        if s.get("image_id") == i.id:
            s.pop("image_id")
    p.content = json.dumps(content)
    path = i.file_path
    db.delete(i)
    db.commit()
    try:
        file_storage.delete_file(path)
    except Exception:
        pass
    return {"message": "Removed"}


# ------------------------------------------------------------------ writing, building, versions

class JobIn(BaseModel):
    kind: str                                 # "generate" | "build" | "rewrite"
    target: Optional[str] = None              # rewrite: "chapter" | "slide"
    key: Optional[str] = None
    index: Optional[int] = None
    instruction: Optional[str] = None
    proceed_with_gaps: bool = False


@router.post("/student/projects/{project_id}/jobs")
def start_job(project_id: int, payload: JobIn, db: Session = Depends(get_db), user: User = Depends(require_role("student"))):
    p = _project(db, user, project_id)
    if payload.kind not in ("generate", "build", "rewrite"):
        raise HTTPException(status_code=400, detail="Unknown request")
    if _active_job(db, p.id):
        raise HTTPException(status_code=409, detail="This project is already being worked on. Wait for that to finish.")
    if not p.report_template_id and not p.ppt_template_id:
        raise HTTPException(status_code=400, detail="Choose a report format or a presentation format first")
    if payload.kind in ("generate", "rewrite") and not jobs.env_summary()["writing_model"]:
        raise HTTPException(status_code=503, detail="The writing model is not configured on this server")
    if payload.kind == "generate":
        g = jobs.gather(db, p)
        state = pw.readiness(g["plan"], g["answers"], g["materials"])
        ready = [c for c in state if c["status"] != "missing"]
        if not ready:
            raise HTTPException(status_code=400, detail="There is no material to write from yet. Upload your files or answer the section questions first.")
        gaps = [c["title"] for c in state if c["status"] == "missing"]
        if gaps and not payload.proceed_with_gaps:
            # The student decides: fill the gaps, or go ahead knowing those chapters will be left out.
            raise HTTPException(status_code=422, detail={"message": "Some chapters have nothing to be written from.", "chapters": gaps})
    job = jobs.start(db, p.id, payload.kind, {"target": payload.target, "key": payload.key, "index": payload.index, "instruction": (payload.instruction or "")[:500]})
    db.refresh(job)
    return _job_out(job)


@router.get("/student/projects/{project_id}/jobs/{job_id}")
def job_status(project_id: int, job_id: int, db: Session = Depends(get_db), user: User = Depends(require_role("student"))):
    p = _project(db, user, project_id)
    j = db.query(ProjectJob).filter(ProjectJob.id == job_id, ProjectJob.project_id == p.id).first()
    if not j:
        raise HTTPException(status_code=404, detail="Not found")
    return _job_out(j)


def _send_version_file(db: Session, project_id: int, number: int, which: str, title: str) -> Response:
    if which not in DOWNLOADS:
        raise HTTPException(status_code=404, detail="Not found")
    v = db.query(ProjectVersion).filter(ProjectVersion.project_id == project_id, ProjectVersion.number == number).first()
    path = _loads(v.files, {}).get(which) if v else None
    if not path:
        raise HTTPException(status_code=404, detail="That file was not built for this version")
    try:
        data = file_storage.get_file(path)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="That file is no longer in storage")
    filename, media = DOWNLOADS[which]
    stem = re.sub(r"[^A-Za-z0-9]+", "_", title).strip("_")[:60] or "project"
    return Response(data, media_type=media, headers={"Content-Disposition": f'attachment; filename="{stem}_v{number}_{filename}"',
                                                     "Access-Control-Expose-Headers": "Content-Disposition"})


@router.get("/student/projects/{project_id}/versions/{number}/{which}")
def download(project_id: int, number: int, which: str, db: Session = Depends(get_db), user: User = Depends(require_role("student"))):
    p = _project(db, user, project_id)
    return _send_version_file(db, p.id, number, which, p.title)


def _version_pdf(db: Session, project_id: int, number: int, which: str) -> str:
    v = db.query(ProjectVersion).filter(ProjectVersion.project_id == project_id, ProjectVersion.number == number).first()
    path = _loads(v.files, {}).get({"report": "report_pdf", "slides": "ppt_pdf"}.get(which, "")) if v else None
    if not path:
        raise HTTPException(status_code=404, detail="No PDF was made for this version")
    return path


@router.get("/student/projects/{project_id}/versions/{number}/pages/{which}")
def version_pages(project_id: int, number: int, which: str, db: Session = Depends(get_db), user: User = Depends(require_role("student"))):
    path = _version_pdf(db, _project(db, user, project_id).id, number, which)
    try:
        return {"pages": project_pdf.page_count(project_pdf.cached_pdf(path, file_storage.get_file))}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="That file is no longer in storage")


@router.get("/student/projects/{project_id}/versions/{number}/pages/{which}/{page}")
def version_page(project_id: int, number: int, which: str, page: int, db: Session = Depends(get_db), user: User = Depends(require_role("student"))):
    return _page(_version_pdf(db, _project(db, user, project_id).id, number, which), page)


@router.post("/student/projects/{project_id}/versions/{number}/restore")
def restore_version(project_id: int, number: int, db: Session = Depends(get_db), user: User = Depends(require_role("student"))):
    """Makes an earlier version's content the current draft again. The files of every version stay as they are."""
    p = _project(db, user, project_id)
    if _active_job(db, p.id):
        raise HTTPException(status_code=409, detail="Wait for the current work on this project to finish first")
    v = db.query(ProjectVersion).filter(ProjectVersion.project_id == p.id, ProjectVersion.number == number).first()
    if not v:
        raise HTTPException(status_code=404, detail="Version not found")
    p.content = v.content
    db.commit()
    return _state(db, user, p)


# ------------------------------------------------------------------ guide review

def _comment_out(c: ProjectComment) -> dict:
    return {"id": c.id, "section": c.section, "author": c.author_name, "role": c.author_role, "body": c.body, "resolved": bool(c.resolved), "when": str(c.created_at)[:16] if c.created_at else None}


class ShareIn(BaseModel):
    faculty_id: Optional[int] = None


@router.put("/student/projects/{project_id}/share")
def share(project_id: int, payload: ShareIn, db: Session = Depends(get_db), user: User = Depends(require_role("student"))):
    p = _project(db, user, project_id)
    if payload.faculty_id is None:
        p.guide_faculty_id = None
        db.commit()
        return _state(db, user, p)
    s = _student(db, user)
    guide = db.query(Faculty).filter(Faculty.id == payload.faculty_id, Faculty.department_id == s.department_id).first()
    if not guide:
        raise HTTPException(status_code=404, detail="Faculty member not found in your department")
    newly = p.guide_faculty_id != guide.id
    p.guide_faculty_id = guide.id
    db.commit()
    if newly:
        from app.core.notifications import notify_user
        login = db.query(User).filter(User.faculty_id == guide.id).first()
        if login:
            notify_user(db, login.id, f"{s.name} shared the project \"{p.title[:60]}\" with you for review.")
    return _state(db, user, p)


class CommentIn(BaseModel):
    section: str
    body: str


def _add_comment(db: Session, p: StudentProject, user: User, name: str, payload: CommentIn) -> ProjectComment:
    body = payload.body.strip()
    if len(body) < 2 or len(body) > 2000:
        raise HTTPException(status_code=400, detail="Write a comment of up to 2000 characters")
    c = ProjectComment(project_id=p.id, section=payload.section.strip()[:80] or "general", author_user_id=user.id, author_name=name, author_role=user.role, body=body)
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


@router.post("/student/projects/{project_id}/comments")
def student_comment(project_id: int, payload: CommentIn, db: Session = Depends(get_db), user: User = Depends(require_role("student"))):
    p = _project(db, user, project_id)
    return _comment_out(_add_comment(db, p, user, _student(db, user).name, payload))


@router.patch("/student/projects/{project_id}/comments/{comment_id}")
def resolve_comment(project_id: int, comment_id: int, db: Session = Depends(get_db), user: User = Depends(require_role("student"))):
    p = _project(db, user, project_id)
    c = db.query(ProjectComment).filter(ProjectComment.id == comment_id, ProjectComment.project_id == p.id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Comment not found")
    c.resolved = not c.resolved
    db.commit()
    return _comment_out(c)


def _shared(db: Session, user: User, project_id: int) -> StudentProject:
    p = db.query(StudentProject).filter(StudentProject.id == project_id, StudentProject.guide_faculty_id == user.faculty_id).first()
    if not p or not user.faculty_id:
        raise HTTPException(status_code=404, detail="Project not found")
    return p


@router.get("/teacher/project-reviews")
def shared_with_me(db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    rows = db.query(StudentProject).filter(StudentProject.guide_faculty_id == user.faculty_id).order_by(StudentProject.updated_at.desc()).all() if user.faculty_id else []
    out = []
    for p in rows:
        details = _loads(p.details, {})
        latest = db.query(ProjectVersion).filter(ProjectVersion.project_id == p.id).order_by(ProjectVersion.number.desc()).first()
        out.append({"id": p.id, "title": p.title, "students": details.get("students") or [], "project_type": details.get("project_type"),
                    "latest_version": latest.number if latest else None, "updated": str(p.updated_at)[:16] if p.updated_at else None,
                    "open_comments": db.query(ProjectComment).filter(ProjectComment.project_id == p.id, ProjectComment.resolved == False).count()})  # noqa: E712
    return out


@router.get("/teacher/project-reviews/{project_id}")
def shared_project(project_id: int, db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    """What the guide sees: the draft and the built files. Not the student's raw uploads."""
    p = _shared(db, user, project_id)
    versions = db.query(ProjectVersion).filter(ProjectVersion.project_id == p.id).order_by(ProjectVersion.number.desc()).all()
    comments = db.query(ProjectComment).filter(ProjectComment.project_id == p.id).order_by(ProjectComment.id).all()
    content = _loads(p.content, {})
    details = _loads(p.details, {})
    return {"id": p.id, "title": p.title, "students": details.get("students") or [], "project_type": details.get("project_type"),
            "content": {"abstract": content.get("abstract") or [], "chapters": [{"key": c["key"], "title": c["title"], "blocks": c.get("blocks") or []} for c in content.get("chapters") or []],
                        "slides": content.get("slides") or [], "references": content.get("references") or []},
            "versions": [_version_out(v) for v in versions], "comments": [_comment_out(c) for c in comments]}


@router.get("/teacher/project-reviews/{project_id}/versions/{number}/{which}")
def guide_download(project_id: int, number: int, which: str, db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    p = _shared(db, user, project_id)
    return _send_version_file(db, p.id, number, which, p.title)


@router.get("/teacher/project-reviews/{project_id}/versions/{number}/pages/{which}")
def guide_pages(project_id: int, number: int, which: str, db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    path = _version_pdf(db, _shared(db, user, project_id).id, number, which)
    try:
        return {"pages": project_pdf.page_count(project_pdf.cached_pdf(path, file_storage.get_file))}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="That file is no longer in storage")


@router.get("/teacher/project-reviews/{project_id}/versions/{number}/pages/{which}/{page}")
def guide_page(project_id: int, number: int, which: str, page: int, db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    return _page(_version_pdf(db, _shared(db, user, project_id).id, number, which), page)


@router.get("/teacher/project-reviews/{project_id}/images/{image_id}")
def guide_image(project_id: int, image_id: int, db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    """A picture placed in the shared draft. Pictures the student uploaded but did not use are not shown."""
    p = _shared(db, user, project_id)
    if image_id not in _images_in_use(_loads(p.content, {})):
        raise HTTPException(status_code=404, detail="Picture not found")
    i = _image(db, p.id, image_id)
    try:
        return Response(file_storage.get_file(i.file_path), media_type="image/jpeg" if i.file_path.endswith(".jpg") else "image/png", headers={"Cache-Control": "private, max-age=3600"})
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Picture file not found")


@router.post("/teacher/project-reviews/{project_id}/comments")
def guide_comment(project_id: int, payload: CommentIn, db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    p = _shared(db, user, project_id)
    guide = db.query(Faculty).filter(Faculty.id == user.faculty_id).first()
    c = _add_comment(db, p, user, guide.name if guide else "Guide", payload)
    from app.core.notifications import notify_user
    owner = db.query(User).filter(User.student_id == p.student_id).first()
    if owner:
        notify_user(db, owner.id, f"Your guide commented on the project \"{p.title[:60]}\".")
    return _comment_out(c)
