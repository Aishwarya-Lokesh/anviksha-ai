"""
Creates a real login account for every student and faculty member currently
in the database (skips any that already have one). Passwords are randomly
generated per-account — never derived from USN, DOB, or anything guessable —
and written ONLY to a local credentials file for the admin to distribute
securely. That file is git-ignored and never printed to console in full.

Handles email collisions safely (e.g. two faculty rows for what looks like
the same person with slightly different name spellings from the source
data, such as "Dr. Chaya P" and "Dr. CHAYA P" under two different teacher
IDs) by appending a numeric suffix rather than crashing.

Usage:
    python scripts/create_all_logins.py
"""

import sys
import os
import secrets
import string
import csv
import re

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.core.database import SessionLocal
from app.core.security import hash_password
from app.models.models import User, Student, Faculty

CREDENTIALS_FILE = os.path.join(os.path.dirname(__file__), "generated_credentials.csv")


def generate_password(length=10):
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


def slugify_name(name: str) -> str:
    base = name.lower().strip()
    base = re.sub(r"^(dr\.?|prof\.?)\s*", "", base)
    base = re.sub(r"[^a-z0-9\s]", "", base)
    base = re.sub(r"\s+", ".", base.strip())
    return base or "faculty"


def main():
    db = SessionLocal()
    rows_out = []

    used_emails = set(e[0] for e in db.query(User.email).all())

    students = db.query(Student).all()
    created_students = 0
    skipped_duplicate_email = []
    for s in students:
        existing = db.query(User).filter(User.student_id == s.id, User.role == "student").first()
        if existing:
            continue
        email = f"{s.usn.lower()}@anviksha.ai"
        if email in used_emails:
            skipped_duplicate_email.append(("student", s.usn, s.name))
            continue
        used_emails.add(email)
        password = generate_password()
        db.add(User(email=email, hashed_password=hash_password(password), role="student", student_id=s.id))
        rows_out.append({"role": "student", "usn": s.usn, "name": s.name, "login_email": email, "password": password})
        created_students += 1

    faculty = db.query(Faculty).all()
    created_faculty = 0
    for f in faculty:
        existing = db.query(User).filter(User.faculty_id == f.id, User.role == "teacher").first()
        if existing:
            continue
        base_email = f"{slugify_name(f.name)}@anviksha.ai"
        email = base_email
        suffix = 2
        while email in used_emails:
            email = base_email.replace("@anviksha.ai", f"{suffix}@anviksha.ai")
            suffix += 1
        used_emails.add(email)
        password = generate_password()
        db.add(User(email=email, hashed_password=hash_password(password), role="teacher", faculty_id=f.id))
        rows_out.append({"role": "teacher", "usn": "", "name": f.name, "login_email": email, "password": password})
        created_faculty += 1

    db.commit()

    if rows_out:
        file_exists = os.path.exists(CREDENTIALS_FILE)
        with open(CREDENTIALS_FILE, "a", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=["role", "usn", "name", "login_email", "password"])
            if not file_exists:
                writer.writeheader()
            writer.writerows(rows_out)

    print(f"Created {created_students} student logins and {created_faculty} faculty logins.")
    if skipped_duplicate_email:
        print(f"Skipped {len(skipped_duplicate_email)} students with a colliding email (rare) — none crashed the run.")
    print(f"Credentials written to: {CREDENTIALS_FILE}")
    print("This file contains real plaintext passwords — keep it private, do not commit it, do not share it publicly.")
    db.close()


if __name__ == "__main__":
    main()
