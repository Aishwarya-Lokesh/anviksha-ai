"""
Links the 68 verified-real MOOC certificate PDFs (in data_raw/real_mooc_certs/)
to real students by matching the USN prefix in each filename.

Deliberately does NOT parse a course name from the PDF content — formats vary
too much across issuing platforms (Wingspan, Google Cloud, etc.) to do that
reliably. Each file is linked as-is; students and admin can open/download the
actual PDF to see what it's for.

Usage:
    python scripts/link_real_certificates.py
"""

import sys
import os
import re

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.core.database import SessionLocal, engine, Base
from app.models.models import Student, CertificateFile

CERT_DIR = os.path.join(os.path.dirname(__file__), "..", "data_raw", "real_mooc_certs")
USN_RE = re.compile(r"^(4GW\d{2}IS\d{3})", re.IGNORECASE)


def main():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    if not os.path.isdir(CERT_DIR):
        print(f"No certificate directory found at {CERT_DIR} — nothing to link.")
        return

    linked, unmatched = 0, []
    for fname in os.listdir(CERT_DIR):
        if not fname.lower().endswith(".pdf"):
            continue
        m = USN_RE.match(fname)
        if not m:
            unmatched.append(fname)
            continue
        usn = m.group(1).upper()
        student = db.query(Student).filter(Student.usn == usn).first()
        if not student:
            unmatched.append(fname)
            continue

        existing = db.query(CertificateFile).filter(
            CertificateFile.student_id == student.id, CertificateFile.filename == fname
        ).first()
        if not existing:
            db.add(CertificateFile(student_id=student.id, filename=fname, display_label="MOOC Certificate (verified real)"))
            linked += 1

    db.commit()
    print(f"Linked {linked} real certificates to real students.")
    if unmatched:
        print(f"{len(unmatched)} files could not be matched to a student (no USN in filename or USN not found): {unmatched[:5]}{'...' if len(unmatched) > 5 else ''}")
    db.close()


if __name__ == "__main__":
    main()
