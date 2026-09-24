"""
Imports your REAL faculty roster and VTU 2021/2022 scheme subject-teacher
assignments — replaces the earlier placeholder "Faculty TBD 1-4" and
inferred subject names entirely.

Run this AFTER scripts/import_data.py. Safe to re-run — matches faculty by
vtu_teacher_id and subjects by code, updates rather than duplicating.

Usage:
    python scripts/import_faculty_scheme.py
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from parse_faculty_scheme import parse_faculty, parse_subjects_2021, parse_subjects_2022
from app.core.database import SessionLocal, engine, Base
from app.models.models import Department, Faculty, Subject

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data_raw", "faculty_scheme")
DEPARTMENT_NAME = "Information Science & Engineering"


def main():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    dept = db.query(Department).filter(Department.name == DEPARTMENT_NAME).first()
    if not dept:
        dept = Department(name=DEPARTMENT_NAME)
        db.add(dept)
        db.commit()
        db.refresh(dept)

    # ---- Faculty ----
    official_faculty = parse_faculty(os.path.join(DATA_DIR, "ISE_Teachers_Dataset.xlsx"))
    subj21 = parse_subjects_2021(os.path.join(DATA_DIR, "VTU_2021_Scheme_Subjects_With_Teachers.xlsx"))
    subj22 = parse_subjects_2022(os.path.join(DATA_DIR, "VTU_2022_Scheme_Subject_Database.xlsx"))

    # Merge: official roster + any teacher referenced in subject sheets but not in the roster.
    # Dedup by NORMALIZED name too — the source data has a few real people entered
    # twice under different teacher IDs with different name casing (e.g. "Dr. Chaya P"
    # vs "Dr. CHAYA P" — T605481 vs T605482). Without this, those become two separate
    # Faculty rows for the same real person, and later collide when generating logins.
    import re as _re

    def _normalize_name(n):
        return _re.sub(r"[^a-z0-9]", "", (n or "").lower())

    known_ids = {f["teacher_id"] for f in official_faculty}
    known_names = {_normalize_name(f["name"]) for f in official_faculty}
    all_faculty = list(official_faculty)
    seen_extra_ids = set()
    seen_extra_names = set()
    for s in subj21 + subj22:
        norm_name = _normalize_name(s["teacher_name"])
        if not s["teacher_id"] or s["teacher_id"] in known_ids or s["teacher_id"] in seen_extra_ids:
            continue
        if norm_name in known_names or norm_name in seen_extra_names:
            # same real person as an existing entry, just a different teacher ID/casing —
            # skip creating a duplicate Faculty row for them
            continue
        all_faculty.append({
            "teacher_id": s["teacher_id"], "name": s["teacher_name"],
            "qualifications": None, "designation": "Not specified in roster", "dept": "ISE",
        })
        seen_extra_ids.add(s["teacher_id"])
        seen_extra_names.add(norm_name)

    faculty_id_map = {}  # vtu_teacher_id -> Faculty.id
    name_to_faculty_id = {}  # normalized name -> Faculty.id, catches deduped alt teacher_ids too
    inserted_f, updated_f = 0, 0
    for f in all_faculty:
        existing = db.query(Faculty).filter(Faculty.vtu_teacher_id == f["teacher_id"]).first()
        if existing:
            existing.name = f["name"]
            existing.designation = f["designation"]
            existing.qualifications = f["qualifications"]
            faculty_id_map[f["teacher_id"]] = existing.id
            updated_f += 1
        else:
            new_f = Faculty(
                name=f["name"], department_id=dept.id, designation=f["designation"],
                qualifications=f["qualifications"], vtu_teacher_id=f["teacher_id"],
            )
            db.add(new_f)
            db.flush()
            faculty_id_map[f["teacher_id"]] = new_f.id
            inserted_f += 1
        name_to_faculty_id[_normalize_name(f["name"])] = faculty_id_map[f["teacher_id"]]
    db.commit()

    # Remove old placeholder faculty ("Faculty TBD n") now that real ones exist
    placeholders = db.query(Faculty).filter(Faculty.name.like("Faculty TBD%")).all()
    removed_placeholders = len(placeholders)
    for p in placeholders:
        # reassign any subjects pointing at a placeholder to unassigned rather than orphaning them
        db.query(Subject).filter(Subject.faculty_id == p.id).update({"faculty_id": None})
        db.delete(p)
    db.commit()

    # ---- Subjects ----
    all_subjects = subj21 + subj22
    inserted_s, updated_s = 0, 0
    for s in all_subjects:
        existing = db.query(Subject).filter(Subject.code == s["code"]).first()
        faculty_id = faculty_id_map.get(s["teacher_id"]) or name_to_faculty_id.get(_normalize_name(s.get("teacher_name")))
        if existing:
            existing.name = s["name"]
            existing.semester = s["semester"]
            existing.scheme = s["scheme"]
            existing.faculty_id = faculty_id
            existing.name_verified = True  # real, from an official scheme document
            updated_s += 1
        else:
            db.add(Subject(
                code=s["code"], name=s["name"], department_id=dept.id,
                semester=s["semester"], faculty_id=faculty_id, scheme=s["scheme"], name_verified=True,
            ))
            inserted_s += 1
    db.commit()

    print(f"Faculty: {inserted_f} inserted, {updated_f} updated ({removed_placeholders} placeholder rows removed)")
    print(f"Subjects: {inserted_s} inserted, {updated_s} updated — all real, name_verified=True")
    print(f"Total real faculty now: {db.query(Faculty).count()}")
    print(f"Total real subjects now: {db.query(Subject).count()}")
    db.close()


if __name__ == "__main__":
    main()
