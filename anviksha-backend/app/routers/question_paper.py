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


# Words that appear in many subject and folder names and so say nothing
# about which subject a folder belongs to.
_GENERIC_WORDS = {"programming", "introduction", "lab", "laboratory", "and", "of", "in", "the", "to", "using", "with",
                  "for", "ia", "qp", "old", "paper", "papers", "question", "questions", "bank", "engineering", "basics", "principles"}


def _tokens(text: str) -> list[str]:
    return [t for t in re.split(r"[^a-z0-9+#]+", (text or "").lower()) if t]


def match_bank_folder(subject_name: str, subject_code: str, folders: list[str]):
    """Which question-bank folder holds this subject, or None. Strongest
    evidence first, and never on a word as common as "programming" — that
    once put C questions on a Python paper."""
    name, code = (subject_name or "").strip().lower(), (subject_code or "").strip().lower()
    subject_tokens = _tokens(name)
    distinctive = {t for t in subject_tokens if t not in _GENERIC_WORDS}
    acronym = "".join(t[0] for t in subject_tokens if t not in {"and", "of", "in", "the", "to", "for"})

    def core(folder: str) -> list[str]:
        return [t for t in _tokens(folder) if t not in _GENERIC_WORDS]

    # 1. the subject code is the folder (e.g. "BCS501")
    for folder in folders:
        if code and code in _tokens(folder):
            return folder
    # 2. same name
    for folder in folders:
        if folder.strip().lower() == name:
            return folder
    # 3. every distinctive word of the folder appears in the subject name ("Python" in "Python Programming")
    best = None
    for folder in folders:
        folder_core = core(folder)
        if folder_core and all(len(t) > 1 for t in folder_core) and set(folder_core) <= distinctive:
            if best is None or len(folder_core) > len(core(best)):
                best = folder
    if best:
        return best
    # 4. the folder is named by the subject's initials ("ML_IA_QP" for "Machine Learning")
    if len(acronym) >= 2:
        for folder in folders:
            if core(folder) == [acronym]:
                return folder
    return None


def _question_bank_text_for_subject(db: Session, subject_name: str, subject_code: str = "") -> tuple[str, int]:
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

    folders = sorted({c.subject_folder for c in db.query(QuestionBankChunk.subject_folder).distinct() if c.subject_folder})
    folder_match = match_bank_folder(subject_name, subject_code, folders)

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
    bank_text, bank_chunk_count = _question_bank_text_for_subject(db, payload.settings.get("subject_name", ""), payload.settings.get("subject_code", ""))
    important_text = uploaded_important_text + ("\n" + bank_text if bank_text else "")
    if not important_text.strip():
        # No upload and nothing for this subject in the department's bank:
        # there is no source to draw questions from.
        raise HTTPException(
            status_code=400,
            detail="There are no questions to choose from yet. Upload an Important Questions or previous question paper file for this subject.",
        )

    result = generate_paper_sets(payload.settings, notes_text, important_text)
    result["real_question_bank_chunks_used"] = bank_chunk_count
    result["sources"] = {"uploaded_question_files": len(important_docs), "notes_files": len(notes_docs), "question_bank_chunks": bank_chunk_count}
    return result


class ReplaceRequest(BaseModel):
    settings: dict
    note_ids: list[int] = []
    important_question_ids: list[int] = []
    spec: dict                   # the slot being replaced: question_type, marks, co, or_after
    exclude: list[str] = []      # every question currently on the paper (both sets)


@router.post("/replace-question")
def replace_one_question(payload: ReplaceRequest, db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    """A different question for one slot, without regenerating the paper."""
    from app.core.question_paper_gen import parse_candidate_questions, replacement_question

    docs = db.query(QuestionPaperDocument).filter(
        QuestionPaperDocument.id.in_(payload.note_ids + payload.important_question_ids),
        QuestionPaperDocument.faculty_id == user.faculty_id,
    ).all() if (payload.note_ids or payload.important_question_ids) else []
    notes_text = "\n".join(d.extracted_text or "" for d in docs if d.kind == "notes")
    uploaded = "\n".join(d.extracted_text or "" for d in docs if d.kind == "important_questions")
    bank_text, _ = _question_bank_text_for_subject(db, payload.settings.get("subject_name", ""), payload.settings.get("subject_code", ""))
    important_text = uploaded + ("\n" + bank_text if bank_text else "")

    question = replacement_question(payload.spec, parse_candidate_questions(important_text), set(payload.exclude), notes_text, important_text)
    if not question:
        raise HTTPException(status_code=409, detail="No other suitable question is available. Upload more source questions, or edit this one by hand.")
    return question


@router.get("/documents")
def my_documents(db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    """Source files this teacher has uploaded before, so they can be reused
    for another paper without uploading again."""
    rows = db.query(QuestionPaperDocument).filter(QuestionPaperDocument.faculty_id == user.faculty_id).order_by(QuestionPaperDocument.id.desc()).all()
    return [{"id": d.id, "filename": d.filename, "kind": d.kind, "module_hint": d.module_hint,
             "uploaded_at": str(d.uploaded_at)[:10] if d.uploaded_at else None,
             "characters": len(d.extracted_text or "")} for d in rows]


@router.delete("/documents/{document_id}")
def delete_document(document_id: int, db: Session = Depends(get_db), user: User = Depends(require_role("teacher"))):
    d = db.query(QuestionPaperDocument).filter(QuestionPaperDocument.id == document_id, QuestionPaperDocument.faculty_id == user.faculty_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="Document not found")
    from app.core.file_storage import delete_file
    delete_file(f"teacher_uploads/question_paper/{d.stored_filename}")
    db.delete(d)
    db.commit()
    return {"message": "Removed"}


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
    out = []
    for r in rows:
        try:
            settings, parts = _json.loads(r.settings), _json.loads(r.paper)
        except ValueError:
            settings, parts = {}, []
        out.append({
            "id": r.id, "title": r.title, "set_label": r.set_label,
            "created_at": str(r.created_at)[:16] if r.created_at else None,
            "total_marks": settings.get("total_marks"),
            "questions": sum(len(p.get("questions", [])) for p in parts),
            "exam_name": settings.get("exam_name"),
        })
    return out


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
