"""A small service that does one thing: turns a .docx or .pptx into a PDF
with LibreOffice, so the PDF matches the Word/PowerPoint file page for page.

It is separate from the main backend so that installing and running
LibreOffice cannot affect it. Only the backend talks to this service, using
a shared secret (CONVERTER_TOKEN). Files are converted in a temporary folder
that is deleted straight afterwards; nothing is kept."""
import hmac
import os
import subprocess
import tempfile
import threading

from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.responses import Response

app = FastAPI(title="Anviksha PDF converter")
TOKEN = os.environ.get("CONVERTER_TOKEN", "")
MAX_BYTES = 40 * 1024 * 1024
TIMEOUT = 200
ALLOWED = {".docx", ".pptx"}
# LibreOffice is heavy for a small server: one conversion at a time.
_one_at_a_time = threading.Lock()


@app.get("/health")
def health():
    return {"status": "healthy", "configured": bool(TOKEN)}


@app.post("/convert")
def convert(file: UploadFile = File(...), x_converter_token: str = Header(default="")):
    if not TOKEN or not hmac.compare_digest(x_converter_token, TOKEN):
        raise HTTPException(status_code=401, detail="Not authorised")
    extension = os.path.splitext(file.filename or "")[1].lower()
    if extension not in ALLOWED:
        raise HTTPException(status_code=400, detail="Only .docx and .pptx can be converted")
    data = file.file.read(MAX_BYTES + 1)
    if not data or len(data) > MAX_BYTES:
        raise HTTPException(status_code=400, detail="The file is empty or larger than 40 MB")
    if not data.startswith(b"PK"):
        raise HTTPException(status_code=400, detail="That is not a Word or PowerPoint file")
    with _one_at_a_time, tempfile.TemporaryDirectory() as work:
        source = os.path.join(work, f"in{extension}")
        with open(source, "wb") as f:
            f.write(data)
        try:
            subprocess.run(["soffice", f"-env:UserInstallation=file://{work}/profile", "--headless", "--norestore", "--convert-to", "pdf", "--outdir", work, source],
                           check=True, timeout=TIMEOUT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except subprocess.TimeoutExpired:
            raise HTTPException(status_code=504, detail="The conversion took too long")
        except (subprocess.CalledProcessError, OSError):
            raise HTTPException(status_code=500, detail="The conversion failed")
        target = os.path.join(work, "in.pdf")
        if not os.path.exists(target):
            raise HTTPException(status_code=500, detail="The conversion produced no file")
        with open(target, "rb") as f:
            return Response(f.read(), media_type="application/pdf")
