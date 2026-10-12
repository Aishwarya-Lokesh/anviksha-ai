"""Admin tools for the file store: see whether it is set up and answering,
which certificate files the records expect but the store does not have, and
put a missing certificate file in place."""
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.core.activity_log import log_activity
from app.core.database import get_db
from app.core.file_storage import list_files, storage_status, upload_file
from app.core.security import require_role
from app.models.models import CertificateFile, User

router = APIRouter(prefix="/admin/storage", tags=["admin-storage"])

CERTIFICATE_DIR = "real_mooc_certs"
MAX_SIZE = 15 * 1024 * 1024


def _expected_certificates(db: Session) -> list[str]:
    return sorted({name for (name,) in db.query(CertificateFile.filename).filter(CertificateFile.is_demo == False).all()})  # noqa: E712


@router.get("/status")
def status(db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    info = storage_status()
    expected = _expected_certificates(db)
    try:
        present = set(list_files(CERTIFICATE_DIR)) if info["reachable"] else set()
        listing_error = None
    except Exception as exc:
        present, listing_error = set(), str(exc)[:200]
    missing = [name for name in expected if name not in present]
    return {
        **info,
        "certificates": {"expected": len(expected), "present": len(expected) - len(missing), "missing": missing, "error": listing_error},
    }


@router.post("/certificate-file")
async def put_certificate_file(file: UploadFile = File(...), db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    """Stores one certificate file under the exact name a certificate record
    already points to. A file no record refers to is refused, so this can
    only ever fill in a missing file — never add an unrelated one."""
    name = file.filename or ""
    if name not in set(_expected_certificates(db)):
        raise HTTPException(status_code=400, detail="No certificate record refers to a file with this name")
    if not name.lower().endswith((".pdf", ".png", ".jpg", ".jpeg")):
        raise HTTPException(status_code=400, detail="Only PDF, PNG or JPG files are allowed")
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="That file is empty")
    if len(contents) > MAX_SIZE:
        raise HTTPException(status_code=400, detail="File too large (max 15MB)")
    if name.lower().endswith(".pdf") and not contents.startswith(b"%PDF"):
        raise HTTPException(status_code=400, detail="That file is not a valid PDF")
    upload_file(f"{CERTIFICATE_DIR}/{name}", contents)
    log_activity(db, user, f"Uploaded certificate file {name}")
    return {"stored": name, "bytes": len(contents)}
