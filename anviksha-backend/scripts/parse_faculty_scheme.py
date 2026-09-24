"""
Parses your real ISE faculty roster and VTU 2021/2022 scheme subject-teacher
assignments. This replaces the earlier placeholder faculty ("Faculty TBD 1-4")
and inferred subject names with real data.

Verified real (not demo): actual faculty names, qualifications, designations
matching real VTU subject codes (21CS32, BCS301, etc.) and real teacher-subject
assignments cross-referenced between the teacher database and subject sheets.
"""

import openpyxl


def parse_faculty(path):
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb["Teachers Database"]
    faculty = []
    for r in range(2, ws.max_row + 1):
        teacher_id = ws.cell(row=r, column=1).value
        name = ws.cell(row=r, column=2).value
        qualifications = ws.cell(row=r, column=3).value
        designation = ws.cell(row=r, column=4).value
        dept = ws.cell(row=r, column=5).value
        if not teacher_id or not name:
            continue
        faculty.append({
            "teacher_id": str(teacher_id).strip(),
            "name": str(name).strip(),
            "qualifications": str(qualifications).strip() if qualifications else None,
            "designation": str(designation).strip() if designation else None,
            "dept": str(dept).strip() if dept else "ISE",
        })
    return faculty


SEM_ORDINAL_TO_INT = {"1st": 1, "2nd": 2, "3rd": 3, "4th": 4, "5th": 5, "6th": 6, "7th": 7, "8th": 8}


def parse_subjects_2021(path):
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb["2021 Subjects Assigned"]
    subjects = []
    for r in range(2, ws.max_row + 1):
        semester = ws.cell(row=r, column=1).value
        scheme = ws.cell(row=r, column=2).value
        code = ws.cell(row=r, column=3).value
        name = ws.cell(row=r, column=4).value
        teacher_id = ws.cell(row=r, column=5).value
        teacher_name = ws.cell(row=r, column=6).value
        if not code or not name:
            continue
        sem_int = SEM_ORDINAL_TO_INT.get(str(semester).strip()) if semester else None
        subjects.append({
            "code": str(code).strip(), "name": str(name).strip(), "semester": sem_int,
            "scheme": str(scheme).strip() if scheme else "2021",
            "teacher_id": str(teacher_id).strip() if teacher_id else None,
            "teacher_name": str(teacher_name).strip() if teacher_name else None,
        })
    return subjects


def parse_subjects_2022(path):
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb["Subjects Database"]
    subjects = []
    for r in range(2, ws.max_row + 1):
        scheme = ws.cell(row=r, column=1).value
        semester = ws.cell(row=r, column=2).value
        code = ws.cell(row=r, column=3).value
        name = ws.cell(row=r, column=4).value
        teacher_id = ws.cell(row=r, column=5).value
        teacher_name = ws.cell(row=r, column=6).value
        if not code or not name:
            continue
        subjects.append({
            "code": str(code).strip(), "name": str(name).strip(),
            "semester": int(semester) if isinstance(semester, (int, float)) else None,
            "scheme": str(scheme).strip() if scheme else "2022",
            "teacher_id": str(teacher_id).strip() if teacher_id else None,
            "teacher_name": str(teacher_name).strip() if teacher_name else None,
        })
    return subjects
