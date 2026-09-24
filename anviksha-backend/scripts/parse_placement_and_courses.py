"""
Parses two real, previously-unused datasets from your uploaded files:

1. Placement data — the PLACED / NON PLACED / DREAM / REGULAR sheets inside
   2020-21 Batch.xlsx. Only this batch has placement data because it's the
   only fully passed-out batch in your upload — that's expected, not a bug.

   Honest limitation: these sheets do NOT contain company name or package
   amount for any student — only placement status and placement drive type
   (Dream vs Regular). "Highest package," "average package," and
   "company-wise placement" CANNOT be built from this data — that
   information was never in what you uploaded. Only Placed/Not-Placed counts,
   and Dream-vs-Regular breakdown, are real and buildable.

2. MOOC course completion — real per-student records from the three actual
   per-student MOOC files (4th/5th/6th semester). The two "Consolidated_sheet"
   files are course-level SUMMARIES (counts per course), not per-student rows,
   so they're intentionally not used here — using them would double-count.

Privacy: email, phone, and DOB columns in the placement sheet are read but
never carried into the normalized output, same policy as academic data.
"""

import re
import docx
import openpyxl

USN_RE = re.compile(r"4GW\d{2}IS\d{3}", re.IGNORECASE)


def parse_placement_data(path):
    """Returns list of dicts: usn, name, placed (bool), placement_type, resume_link."""
    wb = openpyxl.load_workbook(path, data_only=True)
    records = {}  # usn -> record, so a student appearing in both PLACED and REGULAR merges

    def read_sheet(sheet_name, placed, placement_type=None):
        if sheet_name not in wb.sheetnames:
            return
        ws = wb[sheet_name]
        headers = [str(ws.cell(row=1, column=c).value or "").strip().upper() for c in range(1, ws.max_column + 1)]

        def col(*names):
            for n in names:
                for i, h in enumerate(headers):
                    if n in h:
                        return i + 1
            return None

        usn_c, name_c, resume_c = col("USN"), col("NAME"), col("RESUME")

        for r in range(2, ws.max_row + 1):
            usn = ws.cell(row=r, column=usn_c).value if usn_c else None
            name = ws.cell(row=r, column=name_c).value if name_c else None
            if not usn or not USN_RE.search(str(usn)):
                continue
            usn = str(usn).strip().upper()
            resume_link = ws.cell(row=r, column=resume_c).value if resume_c else None

            rec = records.setdefault(usn, {
                "usn": usn, "name": str(name).strip() if name else usn,
                "placed": False, "placement_type": None, "resume_link": None,
            })
            if placed:
                rec["placed"] = True
            if placement_type:
                rec["placement_type"] = placement_type
            if resume_link and isinstance(resume_link, str) and resume_link.startswith("http"):
                rec["resume_link"] = resume_link

    read_sheet("PLACED", placed=True)
    read_sheet("NON PLACED", placed=False)
    read_sheet("DREAM", placed=True, placement_type="Dream")
    read_sheet("REGULAR", placed=True, placement_type="Regular")

    return list(records.values())


def parse_mooc_courses(paths):
    """paths: list of real per-student MOOC docx files. Returns deduped list of
    dicts: usn, name, course_name, duration, platform, remarks, semester_hint."""
    seen = set()
    records = []

    for path in paths:
        d = docx.Document(path)
        if not d.tables:
            continue
        table = d.tables[0]
        header = [c.text.strip().upper() for c in table.rows[0].cells]

        def col(*names):
            for n in names:
                for i, h in enumerate(header):
                    if n in h:
                        return i
            return None

        name_i, usn_i, course_i = col("NAME"), col("USN"), col("COURSE")
        dur_i, plat_i, rem_i = col("DURATION"), col("PLATFORM"), col("REMARK")

        for row in table.rows[1:]:
            cells = [c.text.strip() for c in row.cells]
            if usn_i is None or usn_i >= len(cells):
                continue
            usn = cells[usn_i].strip().upper()
            if not USN_RE.search(usn):
                continue
            course_name = cells[course_i].strip() if course_i is not None else ""
            key = (usn, course_name.lower())
            if key in seen or not course_name:
                continue
            seen.add(key)

            records.append({
                "usn": usn,
                "name": cells[name_i].strip() if name_i is not None else usn,
                "course_name": course_name,
                "duration": cells[dur_i].strip() if dur_i is not None else None,
                "platform": cells[plat_i].strip() if plat_i is not None else None,
                "remarks": cells[rem_i].strip() if rem_i is not None else None,
                "source_file": path,
            })

    return records
