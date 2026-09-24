"""
Loads real internship data from the official ISE_Internship document —
9 real students, real companies, real durations. Batch 2022.

Source data (verbatim from the official PDF):
    Lakshmi HJ           4GW22IS028   DELL              May 19th - July 18th
    Prathiksha Damodar A 4GW22IS041   DELL              May 19th - July 18th
    Prathiksha R         4GW22IS043   DELL              May 19th - July 18th
    Rianna Thangamma I G 4GW22IS048   DELL              May 19th - July 18th
    Sowjanya Jagadish    4GW22IS059   DELL              May 19th - July 18th
    Yashaswini S         4GW22IS062   DELL              May 19th - July 18th
    Deepthi R            4GW22IS019   DEUTSCHE INDIA    May 6th - June 30th
    Smrithi R Sharma     4GW22IS058   DEUTSCHE INDIA    May 6th - June 30th
    Sinchana V           4GW22IS057   ACCENTURE         May 19th - July 11th

No stipend figures are in the official document — stipend is left as None
(shown as "Not Available") rather than using any verbally-mentioned figure
that isn't in the source document itself.

Usage:
    python scripts/load_real_internships.py
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.core.database import SessionLocal, engine, Base
from app.models.models import Student, Internship

REAL_INTERNSHIPS = [
    {"usn": "4GW22IS028", "company": "DELL", "duration": "May 19th - July 18th"},
    {"usn": "4GW22IS041", "company": "DELL", "duration": "May 19th - July 18th"},
    {"usn": "4GW22IS043", "company": "DELL", "duration": "May 19th - July 18th"},
    {"usn": "4GW22IS048", "company": "DELL", "duration": "May 19th - July 18th"},
    {"usn": "4GW22IS059", "company": "DELL", "duration": "May 19th - July 18th"},
    {"usn": "4GW22IS062", "company": "DELL", "duration": "May 19th - July 18th"},
    {"usn": "4GW22IS019", "company": "DEUTSCHE INDIA", "duration": "May 6th - June 30th"},
    {"usn": "4GW22IS058", "company": "DEUTSCHE INDIA", "duration": "May 6th - June 30th"},
    {"usn": "4GW22IS057", "company": "ACCENTURE", "duration": "May 19th - July 11th"},
]


def main():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    linked, not_found = 0, []
    for rec in REAL_INTERNSHIPS:
        student = db.query(Student).filter(Student.usn == rec["usn"]).first()
        if not student:
            not_found.append(rec["usn"])
            continue
        existing = db.query(Internship).filter(
            Internship.student_id == student.id, Internship.company == rec["company"]
        ).first()
        if not existing:
            db.add(Internship(student_id=student.id, company=rec["company"], duration_text=rec["duration"]))
            linked += 1

    db.commit()
    print(f"Linked {linked} real internships to real students.")
    if not_found:
        print(f"USNs not found in database: {not_found}")
    db.close()


if __name__ == "__main__":
    main()
