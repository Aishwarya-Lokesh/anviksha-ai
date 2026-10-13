import mimetypes

from typing import Optional
from urllib.parse import quote

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
import os

from app.core import file_links
from app.core.file_storage import get_file
from app.routers import auth, student, teacher, admin, notifications, search, hod, question_paper, hod_intelligence
from app.routers import notes, teacher_extras, student_extras, hod_extras, account, feedback, storage_admin, assistant, campus, admin_manage, projects

app = FastAPI(title="Anviksha AI — Phase 2 Backend", version="0.2.0")

# Real allowed origins for CORS. FRONTEND_ORIGIN lets production add the
# real deployed frontend URL without another code change; localhost stays
# allowed so local dev (`npm run dev`) keeps working unchanged.
_allowed_origins = ["http://localhost:3000"]
_frontend_origin = os.environ.get("FRONTEND_ORIGIN")
if _frontend_origin:
    _allowed_origins.append(_frontend_origin)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _serve_stored_file(subdir: str, filename: str, route: str, exp: Optional[int], sig: Optional[str], download: bool = False) -> Response:
    """Real bytes for one previously-uploaded/generated file — from
    Supabase Storage in production, or the real local data_raw/ directory
    in local dev (see app.core.file_storage).

    Every route except profile photos needs the signed link the API handed
    out (see app.core.file_links): a file name alone opens nothing."""
    if "/" in filename or "\\" in filename or filename.startswith("."):
        raise HTTPException(status_code=404, detail="File not found")
    if not file_links.is_valid(f"/{route}/{filename}", exp, sig):
        raise HTTPException(status_code=403, detail="This link has expired or is not valid. Reopen the file from the app.")
    try:
        content = get_file(f"{subdir}/{filename}")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="File not found")
    media_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    disposition = "attachment" if download else "inline"
    return Response(content=content, media_type=media_type, headers={
        "Content-Disposition": f"{disposition}; filename*=UTF-8''{quote(filename)}",
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
    })


# Serves the real, verified certificate PDFs directly — e.g.
# GET /certificates/4GW23IS001_Aishwarya_S_L.pdf
@app.get("/certificates/{filename}")
def get_certificate(filename: str, exp: Optional[int] = None, sig: Optional[str] = None, download: bool = False):
    return _serve_stored_file("real_mooc_certs", filename, "certificates", exp, sig, download)


@app.get("/demo-certificates/{filename}")
def get_demo_certificate(filename: str, exp: Optional[int] = None, sig: Optional[str] = None, download: bool = False):
    return _serve_stored_file("demo_achievement_files", filename, "demo-certificates", exp, sig, download)


@app.get("/achievement-files/{filename}")
def get_achievement_file(filename: str, exp: Optional[int] = None, sig: Optional[str] = None, download: bool = False):
    return _serve_stored_file("achievement_uploads", filename, "achievement-files", exp, sig, download)


@app.get("/profile-photos/{filename}")
def get_profile_photo(filename: str):
    return _serve_stored_file("profile_photos", filename, "profile-photos", None, None)


@app.get("/note-files/{filename}")
def get_note_file(filename: str, exp: Optional[int] = None, sig: Optional[str] = None, download: bool = False):
    return _serve_stored_file("note_files", filename, "note-files", exp, sig, download)


@app.get("/resume-files/{filename}")
def get_resume_file(filename: str, exp: Optional[int] = None, sig: Optional[str] = None, download: bool = False):
    return _serve_stored_file("resume_files", filename, "resume-files", exp, sig, download)


# Real .xlsx exports generated on demand from the Teacher/Admin chat assistants
@app.get("/exports/{filename}")
def get_export(filename: str, exp: Optional[int] = None, sig: Optional[str] = None, download: bool = False):
    return _serve_stored_file("generated_exports", filename, "exports", exp, sig, download)


app.include_router(auth.router)
app.include_router(student.router)
app.include_router(teacher.router)
app.include_router(admin.router)
app.include_router(notifications.router)
app.include_router(search.router)
app.include_router(hod.router)
app.include_router(question_paper.router)
app.include_router(hod_intelligence.router)
app.include_router(notes.router)
app.include_router(teacher_extras.router)
app.include_router(student_extras.router)
app.include_router(hod_extras.router)
app.include_router(account.router)
app.include_router(feedback.router)
app.include_router(storage_admin.router)
app.include_router(assistant.router)
app.include_router(campus.router)
app.include_router(admin_manage.router)
app.include_router(projects.router)


@app.get("/")
def root():
    return {"status": "ok", "service": "Anviksha AI Phase 2 Backend"}


@app.on_event("startup")
def stay_awake():
    from app.core import keep_awake
    keep_awake.start()


@app.get("/health")
def health():
    from app.core import keep_awake
    return {"status": "healthy", "keep_awake": keep_awake._started}
