"""
Main Phase 2 data import script.

Usage:
    python scripts/import_data.py

Reads the real Academic Performance workbooks, validates every record, writes a
completeness report, and loads valid + provisional records into the database
(SQLite for local dev by default, or whatever DATABASE_URL points at — e.g. your
Supabase Postgres connection string).

Also ingests the question paper folder into question_bank_chunks (ready for
Phase 3 embedding).
"""

import sys
import os
import json
from collections import Counter, defaultdict

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from parse_academic_performance import parse_cgpa_sheet, parse_master_sheet, validate_student
from parse_placement_and_courses import parse_placement_data, parse_mooc_courses
from parse_safe_student_updates import parse_safe_student_updates
from ingest_question_papers import ingest as ingest_qp

from app.core.database import SessionLocal, engine, Base
from app.models.models import Department, Student, QuestionBankChunk, Placement, CourseCompletion

DATA_ROOT = os.path.join(os.path.dirname(__file__), "..", "data_raw")
ACADEMIC_DIR = os.path.join(DATA_ROOT, "batch 2", "Academic_Performance")
QP_DIR = os.path.join(DATA_ROOT, "IA_QP")

DEPARTMENT_NAME = "Information Science & Engineering"


def load_all_students():
    students = []
    students += parse_cgpa_sheet(os.path.join(ACADEMIC_DIR, "Batch-2021-CGPA-Calc_Final.xlsx"), "CGPA", "2021")
    students += parse_cgpa_sheet(os.path.join(ACADEMIC_DIR, "Batch-2022-CGPA-Calc_Final.xlsx"), "CGPA", "2022")
    students += parse_cgpa_sheet(os.path.join(ACADEMIC_DIR, "Batch-2023-CGPA_Calc.xlsx"), "CGPA", "2023")
    students += parse_cgpa_sheet(os.path.join(ACADEMIC_DIR, "Batch-2024-CGPA-Calc.xlsx"), "CGPA", "2024")
    students += parse_master_sheet(os.path.join(ACADEMIC_DIR, "2020-21 Batch.xlsx"), "MASTER", "2020")
    return students


def write_completeness_report(students):
    by_batch = defaultdict(lambda: {"total": 0, "complete": 0, "issues": Counter()})
    for s in students:
        ok, issues = validate_student(s)
        by_batch[s["batch"]]["total"] += 1
        if ok:
            by_batch[s["batch"]]["complete"] += 1
        for i in issues:
            by_batch[s["batch"]]["issues"][i.split(":")[0]] += 1

    lines = ["ANVIKSHA AI — Phase 2 Data Completeness Report", "=" * 50, ""]
    for batch in sorted(by_batch.keys()):
        stats = by_batch[batch]
        lines.append(f"Batch {batch}: {stats['complete']}/{stats['total']} students have complete records")
        if stats["issues"]:
            for issue, count in stats["issues"].items():
                lines.append(f"    - {issue}: {count}")
        lines.append("")

    report_text = "\n".join(lines)
    report_path = os.path.join(os.path.dirname(__file__), "completeness_report.txt")
    with open(report_path, "w") as f:
        f.write(report_text)
    return report_text, report_path


def main():
    print("Creating tables (if not already present)...")
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()

    dept = db.query(Department).filter(Department.name == DEPARTMENT_NAME).first()
    if not dept:
        dept = Department(name=DEPARTMENT_NAME)
        db.add(dept)
        db.commit()
        db.refresh(dept)

    print("Parsing academic performance workbooks...")
    students = load_all_students()

    report_text, report_path = write_completeness_report(students)
    print("\n" + report_text)
    print(f"(Full report saved to {report_path})\n")

    print("Loading students into the database...")
    inserted, updated = 0, 0
    for rec in students:
        ok, issues = validate_student(rec)
        existing = db.query(Student).filter(Student.usn == rec["usn"]).first()

        values = dict(
            usn=rec["usn"],
            name=rec["name"],
            department_id=dept.id,
            batch=rec["batch"],
            admission_year=rec["admission_year"],
            status=rec["status"],
            semester=rec["current_semester"],
            cgpa=rec["cgpa"],
            semester_sgpa=rec["semester_sgpa"],
            data_status="complete" if ok else "provisional",
        )

        if existing:
            for k, v in values.items():
                setattr(existing, k, v)
            updated += 1
        else:
            db.add(Student(**values))
            inserted += 1

    db.commit()
    print(f"Students: {inserted} inserted, {updated} updated.\n")

    print("Ingesting question papers for RAG/question bank...")
    manifest, skipped = ingest_qp(QP_DIR)
    db.query(QuestionBankChunk).delete()
    for chunk in manifest:
        db.add(QuestionBankChunk(**chunk))
    db.commit()
    print(f"Question bank: {len(manifest)} chunks loaded, {len(skipped)} files skipped.\n")

    print("Loading placement data (2020 batch only — only fully passed-out batch)...")
    placement_file = os.path.join(ACADEMIC_DIR, "2020-21 Batch.xlsx")
    placements = parse_placement_data(placement_file)
    placed_count = 0
    for p in placements:
        student = db.query(Student).filter(Student.usn == p["usn"]).first()
        if not student:
            continue
        existing = db.query(Placement).filter(Placement.student_id == student.id).first()
        if existing:
            existing.placed = p["placed"]
            existing.placement_type = p["placement_type"]
            existing.resume_link = p["resume_link"]
        else:
            db.add(Placement(student_id=student.id, placed=p["placed"],
                              placement_type=p["placement_type"], resume_link=p["resume_link"]))
        if p["placed"]:
            placed_count += 1
    db.commit()
    print(f"Placements: {len(placements)} records loaded ({placed_count} placed).\n")

    print("Loading MOOC course completion data...")
    mooc_dir = os.path.join(DATA_ROOT, "IA_QP", "MOOC_Courses_details")
    mooc_files = []
    for root, _, files in os.walk(mooc_dir):
        for f in files:
            if f.lower().endswith(".docx") and not f.startswith("~$") and "consolidated" not in f.lower():
                mooc_files.append(os.path.join(root, f))
    courses = parse_mooc_courses(mooc_files)
    db.query(CourseCompletion).delete()
    course_loaded = 0
    for c in courses:
        student = db.query(Student).filter(Student.usn == c["usn"]).first()
        if not student:
            continue
        db.add(CourseCompletion(student_id=student.id, course_name=c["course_name"],
                                 duration=c["duration"], platform=c["platform"], remarks=c["remarks"]))
        course_loaded += 1
    db.commit()
    print(f"Course completions: {course_loaded} of {len(courses)} records matched to a student and loaded.\n")

    print("Loading safe fields from student_dataset.xlsx (backlogs, LinkedIn, resume link)...")
    student_dataset_path = os.path.join(DATA_ROOT, "student_dataset.xlsx")
    if os.path.exists(student_dataset_path):
        safe_updates = parse_safe_student_updates(student_dataset_path)
        updated_count = 0
        for r in safe_updates:
            student = db.query(Student).filter(Student.usn == r["usn"]).first()
            if not student:
                continue
            # Deliberately NOT touching cgpa/semester here — this file is an
            # older snapshot (confirmed during review: its semester numbers trail
            # the already-imported CGPA files), so it must never overwrite the
            # more current academic data. Only backlogs/links are safe to apply.
            if r["backlogs"] is not None:
                student.backlogs = r["backlogs"]
            if r["linkedin"]:
                student.linkedin = r["linkedin"]
            if r["resume_link"]:
                student.resume_link = r["resume_link"]
            updated_count += 1
        db.commit()
        print(f"Student updates: {updated_count} of {len(safe_updates)} records matched and applied (backlogs/LinkedIn/resume link only).\n")
    else:
        print("student_dataset.xlsx not found — skipping this step.\n")

    total_students = db.query(Student).count()
    total_chunks = db.query(QuestionBankChunk).count()
    total_placements = db.query(Placement).count()
    total_courses = db.query(CourseCompletion).count()
    print("=" * 50)
    print(f"DONE. Database now has {total_students} students, {total_chunks} question bank chunks, "
          f"{total_placements} placement records, {total_courses} course completions.")

    db.close()


if __name__ == "__main__":
    main()
