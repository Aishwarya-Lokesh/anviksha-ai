"""Question Paper Generator - builds real Set A / Set B exam papers from a
teacher's own uploaded Important Questions bank, grounded against their
uploaded Subject Notes. Every question is either extracted verbatim from
the teacher's own real upload, or - only when no real candidate remains for
a slot - completed by the AI and explicitly flagged as such in the
validation report returned alongside the paper."""
import json as _json
import os
import re
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import require_role
from app.core.content_extraction import extract_document_pages
from app.core.file_storage import upload_file
from app.core.question_paper_gen import generate_paper_sets
from app.models.models import QuestionPaperDocument, QuestionPaper, User

router = APIRouter(prefix="/teacher/question-paper", tags=["question-paper"])

ALLOWED_EXTENSIONS = {"pdf", "docx"}


@router.post("/upload")
async def upload_question_paper_document(
    document_kind: str = Form(...),  # "notes" | "important_questions"
    module_hint: Optional[str] = Form(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db), user: User = Depends(require_role("teacher")),
):
    if document_kind not in ("notes", "important_questions"):
        raise HTTPException(status_code=400, detail="document_kind must be 'notes' or 'important_questions'")
    ext = file.filename.lower().rsplit(".", 1)[-1] if "." in file.filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Only PDF and DOCX files are allowed.")

    safe_name = re.sub(r"[^A-Za-z0-9_.]", "_", file.filename)
    stored_name = f"{document_kind}_{int(datetime.utcnow().timestamp() * 1000)}_{safe_name}"
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="The selected file is empty.")

    # extract_document_pages' .txt branch needs a real path (the other
    # formats accept an in-memory stream) — a short-lived temp file covers
    # every format uniformly without touching content_extraction.py.
    import tempfile
    with tempfile.NamedTemporaryFile(suffix=f".{ext}", delete=False) as tmp:
        tmp.write(contents)
        tmp_path = tmp.name
    try:
        pages = extract_document_pages(tmp_path, file.filename)
        text = "\n".join(p["text"] for p in pages)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read this file's real content: {str(e)}")
    finally:
        os.remove(tmp_path)

    upload_file(f"teacher_uploads/question_paper/{stored_name}", contents)

    doc = QuestionPaperDocument(
        faculty_id=user.faculty_id, kind=document_kind, filename=file.filename,
        stored_filename=stored_name, module_hint=module_hint, extracted_text=text,
        status="processed",
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return {"id": doc.id, "filename": doc.filename, "status": doc.status, "kind": doc.kind, "module_hint": doc.module_hint}


class GenerateRequest(BaseModel):
    settings: dict
    note_ids: list[int] = []
    important_question_ids: list[int] = []


def _question_bank_text_for_subject(db: Session, subject_name: str) -> tuple[str, int]:
    """Real question-bank chunks matching this paper's subject, used as an
    additional real candidate source alongside the teacher's own upload -
    never siloed, never treated as a lesser source. Tries an exact-ish
    subject_folder match first (e.g. "Python Programming" -> folder
    "Python"); if nothing matches, falls back to the existing TF-IDF
    retrieval over the whole real bank so a differently-named subject can
    still surface genuinely relevant real content, bounded to a modest
    top_k so unrelated subjects don't get pulled in."""
    from app.models.models import QuestionBankChunk

    if not subject_name or not subject_name.strip():
        return "", 0

    words = [w for w in subject_name.split() if len(w) > 2]
    folder_match = None
    for folder in {c.subject_folder for c in db.query(QuestionBankChunk.subject_folder).distinct()}:
        if folder and (folder.lower() in subject_name.lower() or any(w.lower() in folder.lower() for w in words)):
            folder_match = folder
            break

    if folder_match:
        chunks = db.query(QuestionBankChunk).filter(QuestionBankChunk.subject_folder == folder_match).all()
        return "\n".join(c.text for c in chunks), len(chunks)

    from app.core.rag_retrieval import retrieve
    retrieved = retrieve(db, subject_name, top_k=15)
    return "\n".join(c["text"] for c in retrieved), len(retrieved)


@router.post("/generate")
def generate_question_paper(payload: GenerateRequest, db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    notes_docs = db.query(QuestionPaperDocument).filter(
        QuestionPaperDocument.id.in_(payload.note_ids), QuestionPaperDocument.faculty_id == user.faculty_id,
    ).all() if payload.note_ids else []
    important_docs = db.query(QuestionPaperDocument).filter(
        QuestionPaperDocument.id.in_(payload.important_question_ids), QuestionPaperDocument.faculty_id == user.faculty_id,
    ).all() if payload.important_question_ids else []

    if not important_docs:
        raise HTTPException(status_code=400, detail="Upload at least one real Important Questions document before generating.")

    notes_text = "\n".join(d.extracted_text or "" for d in notes_docs)
    uploaded_important_text = "\n".join(d.extracted_text or "" for d in important_docs)

    if not payload.settings.get("structure"):
        raise HTTPException(status_code=400, detail="Paper structure (parts and questions) is required.")

    # Real multi-source pool: the teacher's own upload (any number of files -
    # including real previous-year papers, which are parsed identically to
    # an "important questions" upload) PLUS the existing real, already
    # Bloom's-tagged question bank for this subject. Both are merged into
    # one real candidate pool before generation - neither is treated as a
    # lesser source.
    bank_text, bank_chunk_count = _question_bank_text_for_subject(db, payload.settings.get("subject_name", ""))
    important_text = uploaded_important_text + ("\n" + bank_text if bank_text else "")

    result = generate_paper_sets(payload.settings, notes_text, important_text)
    result["real_question_bank_chunks_used"] = bank_chunk_count
    return result


class SaveRequest(BaseModel):
    title: str
    set_label: str
    settings: dict
    paper: list
    validation: Any = None


@router.post("/save")
def save_question_paper(payload: SaveRequest, db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    if payload.set_label not in ("A", "B"):
        raise HTTPException(status_code=400, detail="set_label must be 'A' or 'B'")
    row = QuestionPaper(
        faculty_id=user.faculty_id, title=payload.title, set_label=payload.set_label,
        settings=_json.dumps(payload.settings), paper=_json.dumps(payload.paper),
        validation=_json.dumps(payload.validation) if payload.validation is not None else None,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"id": row.id, "title": row.title, "set_label": row.set_label}


@router.get("")
def list_question_papers(db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    rows = db.query(QuestionPaper).filter(QuestionPaper.faculty_id == user.faculty_id).order_by(QuestionPaper.created_at.desc()).all()
    return [{"id": r.id, "title": r.title, "set_label": r.set_label} for r in rows]


@router.get("/{paper_id}")
def get_question_paper(paper_id: int, db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    r = db.query(QuestionPaper).filter(QuestionPaper.id == paper_id, QuestionPaper.faculty_id == user.faculty_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Question paper not found")
    key = "set_a" if r.set_label == "A" else "set_b"
    return {
        "id": r.id, "title": r.title, "set_label": r.set_label,
        "settings": _json.loads(r.settings), key: _json.loads(r.paper),
        "validation": _json.loads(r.validation) if r.validation else None,
    }


@router.delete("/{paper_id}")
def delete_question_paper(paper_id: int, db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    r = db.query(QuestionPaper).filter(QuestionPaper.id == paper_id, QuestionPaper.faculty_id == user.faculty_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Question paper not found")
    db.delete(r)
    db.commit()
    return {"message": "Deleted"}
