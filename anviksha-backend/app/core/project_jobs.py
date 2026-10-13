"""The long-running work of the project builder: writing the chapters and
slides, and building the Word, PowerPoint and PDF files. Each runs as a
background job that records how far it has got, so the browser can show
progress and no web request waits on it."""
import json
import logging
import os
import threading
from typing import Callable, Optional

from sqlalchemy.orm import Session

from app.core import file_storage, project_docx, project_pdf, project_pptx, project_writer as pw
from app.models.models import ProjectImage, ProjectJob, ProjectMaterial, ProjectTemplate, ProjectVersion, StudentProject

log = logging.getLogger(__name__)
RUN_INLINE = False            # tests set this so a job finishes before the request returns
complete_override: Optional[Callable[..., str]] = None       # tests replace the writing model with this


def _model() -> Callable[..., str]:
    return complete_override or pw._default_complete


def loads(text: Optional[str], default):
    try:
        return json.loads(text) if text else default
    except (TypeError, ValueError):
        return default


def start(db: Session, project_id: int, kind: str, payload: Optional[dict] = None) -> ProjectJob:
    """Creates a job and starts it. Only one job runs per project at a time."""
    job = ProjectJob(project_id=project_id, kind=kind, status="queued", step="Waiting to start", percent=0, result=json.dumps(payload or {}))
    db.add(job)
    db.commit()
    db.refresh(job)
    if RUN_INLINE:
        _run(db.get_bind(), job.id)
        db.expire_all()
    else:
        threading.Thread(target=_run, args=(db.get_bind(), job.id), name=f"project-job-{job.id}", daemon=True).start()
    return job


def _progress(db: Session, job: ProjectJob, step: str, percent: int) -> None:
    job.step, job.percent, job.status = step, max(0, min(99, percent)), "running"
    db.commit()


def _run(bind, job_id: int) -> None:
    db = Session(bind=bind)
    try:
        job = db.query(ProjectJob).filter(ProjectJob.id == job_id).first()
        project = db.query(StudentProject).filter(StudentProject.id == job.project_id).first()
        payload = loads(job.result, {})
        try:
            if job.kind == "generate":
                _generate(db, job, project)
                result = _build(db, job, project, start_at=70)
            elif job.kind == "build":
                result = _build(db, job, project, start_at=5)
            elif job.kind == "rewrite":
                result = _rewrite(db, job, project, payload)
            else:
                raise ValueError(f"Unknown job {job.kind}")
            job.status, job.step, job.percent, job.error, job.result = "done", "Finished", 100, None, json.dumps(result)
        except pw.NeedsModel as exc:
            db.rollback()
            job.status, job.error = "failed", str(exc)
        except Exception as exc:  # noqa: BLE001 - whatever went wrong, the student is told the job stopped
            log.exception("project job %s failed", job_id)
            db.rollback()
            job.status, job.error = "failed", f"Something went wrong while {(job.step or 'working').lower()}. Nothing was lost; please try again. ({type(exc).__name__})"
        db.commit()
    finally:
        db.close()


# ------------------------------------------------------------------ gathering what the student supplied

def gather(db: Session, project: StudentProject) -> dict:
    materials = db.query(ProjectMaterial).filter(ProjectMaterial.project_id == project.id).order_by(ProjectMaterial.id).all()
    images = db.query(ProjectImage).filter(ProjectImage.project_id == project.id).order_by(ProjectImage.id).all()
    tables = [t for m in materials for t in loads(m.tables, []) if len(t.get("rows") or []) >= 2]
    report_template = db.query(ProjectTemplate).filter(ProjectTemplate.id == project.report_template_id).first() if project.report_template_id else None
    ppt_template = db.query(ProjectTemplate).filter(ProjectTemplate.id == project.ppt_template_id).first() if project.ppt_template_id else None
    return {
        "details": {**loads(project.details, {}), "title": project.title},
        "answers": loads(project.answers, {}),
        "materials": [{"filename": m.filename, "text": m.text or ""} for m in materials],
        "images": [{"id": i.id, "name": i.name, "caption": i.caption, "source": i.source, "path": i.file_path} for i in images],
        "tables": tables[:12],
        "report_template": report_template, "ppt_template": ppt_template,
        "plan": pw.chapter_plan(loads(report_template.analysis, {}).get("chapter_titles") if report_template else None),
    }


def _generate(db: Session, job: ProjectJob, project: StudentProject) -> None:
    g = gather(db, project)
    complete = _model()
    details, answers = g["details"], g["answers"]
    _progress(db, job, "Reading your material", 3)

    # a block diagram of the modules the student listed, if they asked for one and gave no design picture
    modules = pw.parse_modules(answers.get("modules") or "")
    if details.get("make_diagram", True) and len(modules) >= 2 and not any(i["source"] == "generated" for i in g["images"]):
        png = pw.module_diagram(modules)
        if png:
            path = f"projects/{project.id}/images/module_flow.png"
            file_storage.upload_file(path, png, "image/png")
            row = ProjectImage(project_id=project.id, name="module_flow.png", caption="Module flow of the system (drawn from the listed modules)", source="generated", file_path=path)
            db.add(row)
            db.commit()
            g["images"].append({"id": row.id, "name": row.name, "caption": row.caption, "source": "generated", "path": path})

    corpus = " ".join([json.dumps(details), json.dumps(answers)] + [m["text"] for m in g["materials"]])
    chapters, warnings, used_images = [], [], set()
    for n, chapter in enumerate(g["plan"], start=1):
        _progress(db, job, f"Writing Chapter {n}: {chapter['title']}", 5 + int(50 * (n - 1) / max(len(g['plan']), 1)))
        free = [i for i in g["images"] if i["id"] not in used_images]
        out = pw.write_chapter(chapter, details, answers, g["materials"], free, g["tables"], complete)
        for b in out["blocks"]:
            if b["type"] == "figure":
                used_images.add(b["image_id"])
        chapters.append({"key": chapter["key"], "title": chapter["title"], "blocks": out["blocks"], "missing": out["missing"], "skipped": out["skipped"]})
        for sentence in out["removed"]:
            warnings.append(f"Removed from \"{chapter['title']}\" because it states a figure or citation that is not in your material: {sentence[:160]}")
    _progress(db, job, "Writing the abstract", 58)
    abstract, removed = pw.write_abstract(details, chapters, corpus, complete)
    warnings.extend(f"Removed from the abstract (figure not in your material): {s[:160]}" for s in removed)
    references = pw.clean_references(answers.get("references"))
    _progress(db, job, "Preparing the slides", 63)
    slides, removed = pw.write_slides(chapters, details, references, complete, corpus)
    warnings.extend(f"Removed from a slide (figure not in your material): {s[:160]}" for s in removed)
    project.content = json.dumps({"chapters": chapters, "abstract": abstract, "acknowledgement": pw.acknowledgement(details), "references": references,
                                  "slides": slides, "warnings": warnings})
    db.commit()


def _rewrite(db: Session, job: ProjectJob, project: StudentProject, payload: dict) -> dict:
    g = gather(db, project)
    content = loads(project.content, {})
    complete = _model()
    instruction = str(payload.get("instruction") or "")
    corpus = " ".join([json.dumps(g["details"]), json.dumps(g["answers"])] + [m["text"] for m in g["materials"]])
    if payload.get("target") == "slide":
        slides = content.get("slides") or []
        index = int(payload.get("index", -1))
        if not 0 <= index < len(slides):
            raise ValueError("slide not found")
        slide = slides[index]
        chapter = next((c for c in content.get("chapters") or [] if c["key"] == slide.get("source")), None)
        _progress(db, job, f"Rewriting the slide \"{slide.get('title')}\"", 30)
        source = pw._plain(chapter["blocks"]) if chapter else "\n".join(slide.get("bullets") or [])
        prompt = f"""Rewrite one presentation slide. Use ONLY the SOURCE TEXT. Do not add facts, figures or claims. No citations.
3 to 5 bullets of at most 14 words each, and speaker notes of 2 to 4 sentences.
{('The student asks: ' + instruction[:400]) if instruction.strip() else ''}
Current slide: {json.dumps({'title': slide.get('title'), 'bullets': slide.get('bullets')})}
Return ONLY JSON: {{"title": "...", "bullets": ["..."], "notes": "..."}}

SOURCE TEXT:
{source[:6000]}"""
        data = pw._json(complete(prompt, max_tokens=900))
        known = pw._digits(corpus + " " + source)
        bullets = [t for t, _ in (pw.strip_unsupported(str(b), known) for b in (data.get("bullets") or [])[:6]) if t]
        if not bullets:
            raise pw.NeedsModel("The slide could not be rewritten from your material. Edit it by hand, or add more to the chapter first.")
        slide.update(title=str(data.get("title") or slide.get("title"))[:80], bullets=[pw._short(b, 18) for b in bullets],
                     notes=pw.strip_unsupported(str(data.get("notes") or ""), known)[0][:900])
        project.content = json.dumps(content)
        db.commit()
        return {"target": "slide", "index": index}
    key = str(payload.get("key") or "")
    chapters = content.get("chapters") or []
    chapter = next((c for c in chapters if c["key"] == key), None)
    if chapter is None:
        raise ValueError("chapter not found")
    _progress(db, job, f"Rewriting \"{chapter['title']}\"", 30)
    used_elsewhere = {b["image_id"] for c in chapters if c is not chapter for b in c.get("blocks") or [] if b.get("type") == "figure"}
    out = pw.write_chapter({"key": key, "title": chapter["title"]}, g["details"], g["answers"], g["materials"],
                           [i for i in g["images"] if i["id"] not in used_elsewhere], g["tables"], complete, instruction=instruction, previous=chapter.get("blocks"))
    if out["skipped"] or not out["blocks"]:
        raise pw.NeedsModel(f"There is not enough of your own material to write \"{chapter['title']}\". Answer its questions first: {', '.join(out['missing']) or 'see the section questions'}.")
    chapter.update(blocks=out["blocks"], missing=out["missing"], skipped=False)
    warnings = [w for w in content.get("warnings") or [] if f"\"{chapter['title']}\"" not in w]
    warnings.extend(f"Removed from \"{chapter['title']}\" because it states a figure or citation that is not in your material: {s[:160]}" for s in out["removed"])
    content["warnings"] = warnings
    project.content = json.dumps(content)
    db.commit()
    return {"target": "chapter", "key": key}


def _build(db: Session, job: ProjectJob, project: StudentProject, start_at: int) -> dict:
    g = gather(db, project)
    content = loads(project.content, {})
    if not any(c.get("blocks") for c in content.get("chapters") or []):
        raise pw.NeedsModel("There is nothing to build yet. Generate the content first.")
    span = 99 - start_at
    _progress(db, job, "Collecting pictures", start_at)
    images = {}
    for image in g["images"]:
        try:
            images[image["id"]] = file_storage.get_file(image["path"])
        except FileNotFoundError:
            continue
    number = (db.query(ProjectVersion).filter(ProjectVersion.project_id == project.id).count()) + 1
    base = f"projects/{project.id}/v{number}"
    files, report = {}, {"notes": [], "pdf": project_pdf.status()["available"]}

    if g["report_template"] is not None:
        _progress(db, job, "Building the report in your format", start_at + int(span * 0.1))
        template = file_storage.get_file(g["report_template"].file_path)
        field_map = loads(g["report_template"].field_map, [])
        body = {"abstract": content.get("abstract"), "acknowledgement": content.get("acknowledgement"), "references": content.get("references"),
                "chapters": [{"title": c["title"], "blocks": c["blocks"]} for c in content.get("chapters") or [] if c.get("blocks")]}
        out = project_pdf.finish_report(template, field_map, g["details"], body, images)
        file_storage.upload_file(f"{base}/report.docx", out["docx"], project_pdf.TYPES["docx"])
        files["report_docx"] = f"{base}/report.docx"
        if out["pdf"]:
            file_storage.upload_file(f"{base}/report.pdf", out["pdf"], "application/pdf")
            files["report_pdf"] = f"{base}/report.pdf"
        report["report"] = {"pages": out["page_count"], "figures": len(out["figures"]), "tables": len(out["tables"]), "unfilled": out["unfilled"],
                            "pictures_missing": out["dropped"], "leftover_wording": project_docx.leftovers(out["docx"], field_map)}
        report["notes"].extend(out["notes"])
    else:
        report["notes"].append("No report format is chosen, so no report was built.")

    if g["ppt_template"] is not None and content.get("slides"):
        _progress(db, job, "Building the slides in your format", start_at + int(span * 0.6))
        template = file_storage.get_file(g["ppt_template"].file_path)
        field_map = loads(g["ppt_template"].field_map, [])
        out = project_pptx.build(template, field_map, g["details"], content["slides"], images)
        file_storage.upload_file(f"{base}/slides.pptx", out["pptx"], project_pdf.TYPES["pptx"])
        files["ppt_pptx"] = f"{base}/slides.pptx"
        try:
            _progress(db, job, "Making the PDF of the slides", start_at + int(span * 0.8))
            pdf = project_pdf.convert(out["pptx"], "pptx")
            file_storage.upload_file(f"{base}/slides.pdf", pdf, "application/pdf")
            files["ppt_pdf"] = f"{base}/slides.pdf"
        except project_pdf.ConverterUnavailable as exc:
            if project_pdf.status()["available"]:
                report["notes"].append(f"The PDF of the slides could not be made: {exc}")
        report["slides"] = {"count": out["slide_count"], "continued": out["continued"], "unfilled": out["unfilled"], "pictures_missing": out["dropped"],
                            "text_reduced_on": out["reduced"], "too_much_text_on": out["overflow"]}
    elif g["ppt_template"] is None:
        report["notes"].append("No presentation format is chosen, so no slides were built.")
    if not report["pdf"]:
        report["notes"].append("PDF export is not set up on this server yet. The Word and PowerPoint files are complete.")

    version = ProjectVersion(project_id=project.id, number=number, content=project.content, files=json.dumps(files), report=json.dumps(report))
    db.add(version)
    db.commit()
    return {"version": number, "files": sorted(files)}


def env_summary() -> dict:
    return {"writing_model": bool(os.getenv("GROQ_API_KEY", "").strip()) or complete_override is not None, "pdf": project_pdf.status()}
