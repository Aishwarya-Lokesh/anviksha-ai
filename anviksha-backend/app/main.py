from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os

from app.routers import auth, student, teacher, admin, notifications, search, hod, question_paper, hod_intelligence

app = FastAPI(title="Anviksha AI — Phase 2 Backend", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serves the real, verified certificate PDFs directly — e.g.
# GET /certificates/4GW23IS001_Aishwarya_S_L.pdf
_cert_dir = os.path.join(os.path.dirname(__file__), "..", "data_raw", "real_mooc_certs")
if os.path.isdir(_cert_dir):
    app.mount("/certificates", StaticFiles(directory=_cert_dir), name="certificates")

_demo_dir = os.path.join(os.path.dirname(__file__), "..", "data_raw", "demo_achievement_files")
os.makedirs(_demo_dir, exist_ok=True)
app.mount("/demo-certificates", StaticFiles(directory=_demo_dir), name="demo_certificates")

_ach_dir = os.path.join(os.path.dirname(__file__), "..", "data_raw", "achievement_uploads")
os.makedirs(_ach_dir, exist_ok=True)
app.mount("/achievement-files", StaticFiles(directory=_ach_dir), name="achievement_files")

_photo_dir = os.path.join(os.path.dirname(__file__), "..", "data_raw", "profile_photos")
os.makedirs(_photo_dir, exist_ok=True)
app.mount("/profile-photos", StaticFiles(directory=_photo_dir), name="profile_photos")

# Real .xlsx exports generated on demand from the Teacher/Admin chat assistants
_exports_dir = os.path.join(os.path.dirname(__file__), "..", "data_raw", "generated_exports")
os.makedirs(_exports_dir, exist_ok=True)
app.mount("/exports", StaticFiles(directory=_exports_dir), name="exports")

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
