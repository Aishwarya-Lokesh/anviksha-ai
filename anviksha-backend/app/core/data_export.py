"""Real, dynamically-generated Excel exports triggered from the Teacher/
Admin chat assistants. Detection is honest and narrow: only questions that
actually look export-shaped (contain a real "list/export/excel/report/
download" style word) are treated as export requests; everything else
falls back to the normal text chat answer. The exported rows are always
real, freshly-queried data scoped exactly like the rest of that role's
chat context - never fabricated."""
import os
import re
from datetime import datetime

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill

EXPORT_KEYWORDS = ("list", "export", "excel", "spreadsheet", "download", "report", ".xlsx")
PLACEMENT_KEYWORDS = ("placement", "placed", "company", "ctc")
BATCH_RE = re.compile(r"\b(20\d{2})\b")


def is_export_request(question: str) -> bool:
    lower = question.lower()
    return any(word in lower for word in EXPORT_KEYWORDS)


def _exports_dir() -> str:
    path = os.path.join(os.path.dirname(__file__), "..", "..", "data_raw", "generated_exports")
    os.makedirs(path, exist_ok=True)
    return path


def write_xlsx(rows: list[dict], sheet_name: str, filename_prefix: str) -> tuple[str, str]:
    """Writes real rows to a real .xlsx file. Returns (stored_filename, absolute_path)."""
    wb = Workbook()
    ws = wb.active
    ws.title = sheet_name[:31] or "Report"

    if rows:
        headers = list(rows[0].keys())
        ws.append(headers)
        for cell in ws[1]:
            cell.font = Font(bold=True, color="FFFFFF")
            cell.fill = PatternFill(start_color="5B3FD9", end_color="5B3FD9", fill_type="solid")
        for row in rows:
            ws.append([row.get(h, "") for h in headers])
        for col_cells in ws.columns:
            width = max((len(str(c.value)) for c in col_cells if c.value is not None), default=10)
            ws.column_dimensions[col_cells[0].column_letter].width = min(max(width + 2, 10), 40)
    else:
        ws.append(["No matching real data was found for this request."])

    safe_prefix = re.sub(r"[^A-Za-z0-9_]", "_", filename_prefix)[:40]
    stored_name = f"{safe_prefix}_{int(datetime.utcnow().timestamp() * 1000)}.xlsx"
    path = os.path.join(_exports_dir(), stored_name)
    wb.save(path)
    return stored_name, path


def build_teacher_export(db, students: list, question: str) -> tuple[list[dict], str, str]:
    """Builds real export rows for a teacher's own roster, scoped exactly
    like their chat context. Returns (rows, sheet_name, human_title)."""
    from app.models.models import Placement

    lower = question.lower()
    if any(w in lower for w in PLACEMENT_KEYWORDS):
        student_ids = [s.id for s in students]
        placements = db.query(Placement).filter(Placement.student_id.in_(student_ids)).all() if student_ids else []
        placements_by_student = {p.student_id: p for p in placements}
        rows = []
        for s in students:
            p = placements_by_student.get(s.id)
            rows.append({
                "Name": s.name, "USN": s.usn, "Placed": "Yes" if p and p.placed else "No",
                "Company": (p.company if p else "") or "", "CTC": (p.ctc if p else "") or "",
            })
        return rows, "Placement Report", "placement report"

    rows = [{
        "Name": s.name, "USN": s.usn, "CGPA": s.cgpa, "Attendance %": s.attendance_pct,
        "Backlogs": s.backlogs or 0, "Semester": s.semester,
    } for s in students]
    return rows, "Student Report", "student report"


def build_admin_export(db, question: str) -> tuple[list[dict], str, str]:
    """Builds real institute-wide export rows, optionally filtered to a
    real batch mentioned in the question. Returns (rows, sheet_name, title)."""
    from app.models.models import Student, Placement

    lower = question.lower()
    batch_match = BATCH_RE.search(question)
    batch = batch_match.group(1) if batch_match else None

    if any(w in lower for w in PLACEMENT_KEYWORDS):
        q = db.query(Placement).join(Student)
        if batch:
            q = q.filter(Student.batch == batch)
        rows = [{
            "Name": p.student.name, "USN": p.student.usn, "Batch": p.student.batch,
            "Placed": "Yes" if p.placed else "No", "Company": p.company or "", "CTC": p.ctc or "",
        } for p in q.all()]
        title = f"placement report{f' for {batch} batch' if batch else ''}"
        return rows, "Placement Report", title

    q = db.query(Student)
    if batch:
        q = q.filter(Student.batch == batch)
    rows = [{
        "Name": s.name, "USN": s.usn, "Batch": s.batch, "Department": s.department.name if s.department else "",
        "CGPA": s.cgpa, "Backlogs": s.backlogs or 0, "Status": s.status,
    } for s in q.all()]
    title = f"student report{f' for {batch} batch' if batch else ''}"
    return rows, "Student Report", title
