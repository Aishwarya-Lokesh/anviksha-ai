"""
Enforces a real invariant across the whole system: a student's current
semester = (highest semester they have real SGPA data for) + 1.

This is the SAME rule used by the Teaching Assignment auto-semester
calculation (_next_semester_for_batch in app/routers/teacher.py) — this
script applies it to Student.semester itself, so the two never drift apart.
Previously, individual scripts (like load_sem6_update.py) advanced specific
batches by hand; this replaces that with one general, reusable pass over
every real student.

Only ever advances a semester based on real semester_sgpa data already on
file — never guesses, never uses today's date or an assumed academic
calendar.

Usage:
    python scripts/sync_student_semesters.py
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.core.database import SessionLocal
from app.models.models import Student


def main():
    db = SessionLocal()
    students = db.query(Student).filter(Student.status == "active").all()

    updated = 0
    for s in students:
        if not s.semester_sgpa:
            continue
        highest_completed = max(int(k) for k in s.semester_sgpa.keys())
        correct_semester = highest_completed + 1
        if s.semester != correct_semester:
            s.semester = correct_semester
            updated += 1

    db.commit()
    print(f"Synced {updated} students' current semester to match their real completed-semester data.")
    db.close()


if __name__ == "__main__":
    main()
