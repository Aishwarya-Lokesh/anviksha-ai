"""Turning a finished .docx / .pptx into a PDF, and reading page numbers back
out of that PDF.

The PDF is made by LibreOffice, so it is the same document, page for page.
LibreOffice is not on the main server; it runs either in a small separate
converter service (`PDF_CONVERTER_URL` + `PDF_CONVERTER_TOKEN`) or, on a
developer's computer, from a local install (`SOFFICE_PATH`). When neither is
set, PDF export is reported as not available and nothing else is affected."""
import io
import os
import re
import shutil
import subprocess
import tempfile
from typing import Optional

import httpx

from app.core.project_docx import build, roman

CONVERT_TIMEOUT = 150
TYPES = {"docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
         "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation"}


class ConverterUnavailable(Exception):
    """No PDF converter is configured, or it could not be reached."""


def _soffice() -> Optional[str]:
    path = os.getenv("SOFFICE_PATH", "").strip()
    if path and os.path.exists(path):
        return path
    return shutil.which("soffice") or shutil.which("libreoffice")


def status() -> dict:
    if os.getenv("PDF_CONVERTER_URL", "").strip():
        return {"available": True, "via": "converter service"}
    if _soffice():
        return {"available": True, "via": "local LibreOffice"}
    return {"available": False, "via": None}


def convert_local(data: bytes, extension: str, soffice: str) -> bytes:
    """Runs LibreOffice once, with its own throwaway profile so that two
    conversions never trip over each other."""
    with tempfile.TemporaryDirectory() as work:
        source = os.path.join(work, f"in.{extension}")
        with open(source, "wb") as f:
            f.write(data)
        profile = "file:///" + os.path.join(work, "profile").replace("\\", "/").lstrip("/")
        try:
            subprocess.run([soffice, f"-env:UserInstallation={profile}", "--headless", "--norestore", "--convert-to", "pdf", "--outdir", work, source],
                           check=True, timeout=CONVERT_TIMEOUT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except subprocess.TimeoutExpired as exc:
            raise ConverterUnavailable("The PDF conversion took too long.") from exc
        except (subprocess.CalledProcessError, OSError) as exc:
            raise ConverterUnavailable("The PDF conversion failed.") from exc
        target = os.path.join(work, "in.pdf")
        if not os.path.exists(target):
            raise ConverterUnavailable("The PDF conversion produced no file.")
        with open(target, "rb") as f:
            return f.read()


def convert(data: bytes, extension: str) -> bytes:
    """PDF bytes for a .docx or .pptx. Raises ConverterUnavailable."""
    if extension not in TYPES:
        raise ValueError("Only .docx and .pptx can be converted")
    url = os.getenv("PDF_CONVERTER_URL", "").strip().rstrip("/")
    if url:
        try:
            # The converter sleeps when idle; the first request after a quiet spell waits for it to start.
            r = httpx.post(f"{url}/convert", files={"file": (f"document.{extension}", data, TYPES[extension])},
                           headers={"X-Converter-Token": os.getenv("PDF_CONVERTER_TOKEN", "")}, timeout=httpx.Timeout(240.0, connect=90.0))
        except httpx.HTTPError as exc:
            raise ConverterUnavailable("The PDF converter could not be reached.") from exc
        if r.status_code != 200 or not r.content.startswith(b"%PDF"):
            raise ConverterUnavailable(f"The PDF converter answered {r.status_code}.")
        return r.content
    soffice = _soffice()
    if soffice:
        return convert_local(data, extension, soffice)
    raise ConverterUnavailable("PDF export is not set up on this server yet.")


def page_texts(pdf: bytes) -> list[str]:
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(pdf))
    return [re.sub(r"\s+", "", page.extract_text() or "") for page in reader.pages]


def find_tokens(pdf: bytes, tokens: list[str]) -> dict[str, int]:
    """The (1-based) page each marker token landed on."""
    found: dict[str, int] = {}
    for number, text in enumerate(page_texts(pdf), start=1):
        for token in tokens:
            if token not in found and token in text:
                found[token] = number
    return found


def page_label(physical: int, sections: list[dict], starts: list[int]) -> str:
    """What is printed on a page: each section has its own number format and
    may restart its count; otherwise the count runs on from the section before."""
    index = max((i for i, start in enumerate(starts) if start <= physical), default=0)
    number = None
    for i in range(index + 1):
        begin = starts[i]
        if sections[i]["start"] is not None or number is None:
            first = sections[i]["start"] if sections[i]["start"] is not None else begin
        else:
            first = number + 1
        last_page = (starts[i + 1] - 1) if i < index else physical
        number = first + (last_page - begin)
    fmt = sections[index]["format"]
    if fmt == "lowerRoman":
        return roman(number)
    if fmt == "upperRoman":
        return roman(number, upper=True)
    if fmt == "lowerLetter":
        return chr(96 + max(1, min(number, 26)))
    if fmt == "upperLetter":
        return chr(64 + max(1, min(number, 26)))
    return str(number)


def finish_report(template: bytes, field_map: list[dict], details: dict, content: dict, images: dict) -> dict:
    """The final report. With a converter: built once with invisible markers,
    rendered to find the page of every heading, figure and table, then built
    again with those page numbers in the contents lists, and rendered to PDF.
    Without one: built once, contents lists without page numbers, no PDF."""
    notes: list[str] = []
    if not status()["available"]:
        out = build(template, field_map, details, content, images)
        if out["has_contents"]:
            notes.append("Page numbers in the table of contents need PDF export, which is not set up on this server yet.")
        return {**out, "pdf": None, "pages": {}, "page_count": None, "notes": notes}
    try:
        first = build(template, field_map, details, content, images, markers=True)
        draft_pdf = convert(first["docx"], "docx")
        where = find_tokens(draft_pdf, [a["token"] for a in first["anchors"]] + [m["token"] for m in first["section_marks"]])
        starts = []
        for i in range(len(first["sections"])):
            mark = next((m for m in first["section_marks"] if m["section"] == i), None)
            starts.append(where.get(mark["token"]) if mark else None)
        starts[0] = 1
        for i in range(1, len(starts)):                 # a section with nothing findable starts where the previous one did
            starts[i] = starts[i] if starts[i] is not None and starts[i] >= starts[i - 1] else starts[i - 1]
        pages = {a["key"]: page_label(where[a["token"]], first["sections"], starts) for a in first["anchors"] if a["token"] in where}
        missing = [a["key"] for a in first["anchors"] if a["token"] not in where]
        final = build(template, field_map, details, content, images, pages=pages)
        pdf = convert(final["docx"], "docx")
        count, draft_count = len(page_texts(pdf)), len(page_texts(draft_pdf))
        if count != draft_count:
            notes.append("The page count changed between the two passes; check the contents page numbers.")
        if missing:
            notes.append(f"{len(missing)} contents entr{'y' if len(missing) == 1 else 'ies'} could not be given a page number.")
        return {**final, "pdf": pdf, "pages": pages, "page_count": count, "notes": notes}
    except ConverterUnavailable as exc:
        out = build(template, field_map, details, content, images)
        return {**out, "pdf": None, "pages": {}, "page_count": None, "notes": [f"{exc} The Word file is complete; the contents list has no page numbers."]}
