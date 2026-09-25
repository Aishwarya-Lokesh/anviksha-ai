import mimetypes

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
import os

from app.core.file_storage import get_file
from app.routers import auth, student, teacher, admin, notifications, search, hod, question_paper, hod_intelligence

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


def _serve_stored_file(subdir: str, filename: str) -> Response:
    """Real bytes for one previously-uploaded/generated file — from
    Supabase Storage in production, or the real local data_raw/ directory
    in local dev (see app.core.file_storage). Replaces the old StaticFiles
    mounts so the exact same relative URLs keep working unchanged for the
    frontend (which always does `${API_BASE}${download_url}`)."""
    try:
        content = get_file(f"{subdir}/{filename}")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="File not found")
    media_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    return Response(content=content, media_type=media_type)


# Serves the real, verified certificate PDFs directly — e.g.
# GET /certificates/4GW23IS001_Aishwarya_S_L.pdf
@app.get("/certificates/{filename}")
def get_certificate(filename: str):
    return _serve_stored_file("real_mooc_certs", filename)


@app.get("/demo-certificates/{filename}")
def get_demo_certificate(filename: str):
    return _serve_stored_file("demo_achievement_files", filename)


@app.get("/achievement-files/{filename}")
def get_achievement_file(filename: str):
    return _serve_stored_file("achievement_uploads", filename)


@app.get("/profile-photos/{filename}")
def get_profile_photo(filename: str):
    return _serve_stored_file("profile_photos", filename)


# Real .xlsx exports generated on demand from the Teacher/Admin chat assistants
@app.get("/exports/{filename}")
def get_export(filename: str):
    return _serve_stored_file("generated_exports", filename)


app.include_router(auth.router)
app.include_router(student.router)
app.include_router(teacher.router)
app.include_router(admin.router)
app.include_router(notifications.router)
app.include_router(search.router)
app.include_router(hod.router)
app.include_router(question_paper.router)
app.include_router(hod_intelligence.router)


@app.get("/")
def root():
    return {"status": "ok", "service": "Anviksha AI Phase 2 Backend"}


@app.get("/health")
def health():
    return {"status": "healthy"}
