"""
Parses the newly uploaded student_dataset.xlsx to extract ONLY safe, academic
fields and update existing student records (matched by USN).

HARD EXCLUSION LIST — these columns exist in the source file and are NEVER
read, stored, or passed anywhere in this codebase, under any circumstance:
DOB, Gender, BloodGroup, mobile, email, Adhaar, DL, Passport, Nationality,
Domicile, MotherTongue, Religion, Caste, CountryofBirth, StateofBirth,
CandidateId, FatherName/Occupation/Mobile/EmailId/Income, MotherName/
Occupation/Mobile/EmailId/Income, PermanentAddress, City, State, Country,
Hostel, EntranceName, 10th/12th/Diploma institution+board+percentage,
BacklogHistory (free-text narrative — only the numeric backlog COUNT is used).

This is a firm boundary, not a preference: several of these fields
(government ID numbers, caste, religion, family income) carry real
discrimination or identity-theft risk if they ever ended up in a student
dashboard, a GitHub repo, or a screenshot. They add zero value to an academic
platform and are excluded entirely rather than filtered "for now."

What IS extracted: usn, backlogs (numeric count only), linkedin, resume link,
current semester, and CGPA/SGPA (used only as a cross-check against the
already-imported academic performance files, not as a silent overwrite).

Note: the "Section" column in this file is not meaningfully populated (every
row that has a value just has "." as a placeholder), so it is intentionally
NOT used to fill the still-missing section data.
"""

import re

SAFE_COLUMNS = ["usn", "backlogs", "LinkedInlink", "RESUME", "CurrentSemester", "CGPA"]


def parse_safe_student_updates(path, sheet_name="Sheet1"):
    import openpyxl
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb[sheet_name]

    headers = [ws.cell(row=1, column=c).value for c in range(1, ws.max_column + 1)]
    idx = {h: i + 1 for i, h in enumerate(headers) if h in SAFE_COLUMNS}

    records = []
    for r in range(2, ws.max_row + 1):
        usn = ws.cell(row=r, column=idx.get("usn", 0)).value if "usn" in idx else None
        if not usn:
            continue
        usn = str(usn).strip().upper()

        backlogs = ws.cell(row=r, column=idx["backlogs"]).value if "backlogs" in idx else None
        linkedin = ws.cell(row=r, column=idx["LinkedInlink"]).value if "LinkedInlink" in idx else None
        resume = ws.cell(row=r, column=idx["RESUME"]).value if "RESUME" in idx else None
        semester = ws.cell(row=r, column=idx["CurrentSemester"]).value if "CurrentSemester" in idx else None
        cgpa_crosscheck = ws.cell(row=r, column=idx["CGPA"]).value if "CGPA" in idx else None

        records.append({
            "usn": usn,
            "backlogs": int(backlogs) if isinstance(backlogs, (int, float)) and backlogs >= 0 else None,
            "linkedin": str(linkedin).strip() if linkedin and str(linkedin).startswith("http") else None,
            "resume_link": str(resume).strip() if resume and str(resume).startswith("http") else None,
            "current_semester": int(semester) if isinstance(semester, (int, float)) else None,
            "cgpa_crosscheck": round(float(cgpa_crosscheck), 2) if isinstance(cgpa_crosscheck, (int, float)) else None,
        })

    return records
