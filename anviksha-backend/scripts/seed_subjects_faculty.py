"""
Seeds subjects (derived from your REAL question-paper folder names — these are
your actual subjects, not invented) and placeholder faculty (since no real
faculty roster was uploaded).

IMPORTANT — read before trusting subject names blindly:
Subject codes like BPOPS103 / BCS501 follow VTU's scheme where the digit
pattern indicates semester (e.g. ...103 = Sem 1, ...501 = Sem 5). Folder names
without an official code (CNS, ML, FSD, OOPs/Java, Python, "Programming in C")
are mapped to a semester based on typical VTU ISE placement, but the exact
official title is a best guess, not confirmed. Every seeded subject has
`name_verified=False` — correct these via Admin > Subject Dataset once you
confirm exact titles against your curriculum, rather than trusting this guess
for your final report.

Faculty rows are explicit placeholders (name = "Faculty TBD n") because no real
faculty roster was uploaded. Replace them via Admin > Manage Users once you have
your real faculty list — the moment you do, this becomes real data like the
students already are.
"""

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.core.database import SessionLocal, engine, Base
from app.models.models import Department, Faculty, Subject

DEPARTMENT_NAME = "Information Science & Engineering"

# (folder_name, best-guess display name, best-guess semester, source note)
SUBJECTS_FROM_REAL_FOLDERS = [
    ("BPOPS103", "Problem Solving using C / Bridge Course (BPOPS103)", 1, "Semester inferred from VTU code pattern (...103 = Sem 1)"),
    ("Programming in C", "Programming in C", 1, "No official code found in uploaded files; placed at Sem 1 by convention"),
    ("OOPs_Java_QP", "Object Oriented Programming with Java", 3, "No official code found; OOP-in-Java is typically Sem 3 in VTU ISE"),
    ("Python", "Python Programming", 3, "No official code found; typically Sem 2-3 in VTU ISE — verify"),
    ("CNS_IA_QP", "Computer Networks & Security", 5, "No official code found; CNS is typically Sem 5-6 — verify"),
    ("BCS501", "Core Subject — BCS501", 5, "Semester inferred from VTU code pattern (...501 = Sem 5); exact title not confirmable from question papers alone"),
    ("FSD", "Full Stack Development", 6, "No official code found; commonly a Sem 6-7 elective — verify"),
    ("ML_IA_QP", "Machine Learning", 6, "No official code found; ML is typically Sem 6-7 — verify"),
]

PLACEHOLDER_FACULTY_COUNT = 4


def seed():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    dept = db.query(Department).filter(Department.name == DEPARTMENT_NAME).first()
    if not dept:
        dept = Department(name=DEPARTMENT_NAME)
        db.add(dept)
        db.commit()
        db.refresh(dept)

    # Placeholder faculty — explicitly labeled, not pretending to be real people
    faculty_rows = []
    for i in range(1, PLACEHOLDER_FACULTY_COUNT + 1):
        existing = db.query(Faculty).filter(Faculty.name == f"Faculty TBD {i}").first()
        if not existing:
            f = Faculty(name=f"Faculty TBD {i}", department_id=dept.id, designation="Placeholder — replace via Admin", email=None)
            db.add(f)
            db.flush()
            faculty_rows.append(f)
        else:
            faculty_rows.append(existing)
    db.commit()

    inserted, updated = 0, 0
    for i, (folder, display_name, semester, note) in enumerate(SUBJECTS_FROM_REAL_FOLDERS):
        code = folder.replace(" ", "_").replace("_QP", "").upper()[:15]
        existing = db.query(Subject).filter(Subject.code == code).first()
        assigned_faculty = faculty_rows[i % len(faculty_rows)]
        if existing:
            existing.name = display_name
            existing.semester = semester
            existing.faculty_id = assigned_faculty.id
            updated += 1
        else:
            db.add(Subject(
                code=code, name=display_name, department_id=dept.id,
                semester=semester, faculty_id=assigned_faculty.id,
            ))
            inserted += 1
    db.commit()

    print(f"Faculty: {len(faculty_rows)} placeholder rows ready (replace via Admin > Manage Users)")
    print(f"Subjects: {inserted} inserted, {updated} updated — derived from your real question paper folders")
    print("\nNOTE: subject titles/semesters are best-guess inferences — verify against your official curriculum before presenting.")
    db.close()


if __name__ == "__main__":
    seed()
