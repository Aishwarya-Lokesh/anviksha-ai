"""
Loads REAL placement data with actual company names and CTC (package) for
the 2021 and 2022 batches — this is genuinely new: earlier placement data
only had placed/not-placed status, no company or package info at all.

Handles a real data quality issue found in the source file: some USNs are
missing zero-padding (e.g. "4GW21IS05" instead of "4GW21IS005"). Matching
strategy, in order:
  1. Try the USN as-is
  2. Try it zero-padded to the standard 3-digit numeric suffix
  3. Fall back to matching by normalized student name within that batch
Anything that still doesn't match is reported explicitly, never silently
dropped and never guessed at.

Usage:
    python scripts/load_real_placement_companies.py
"""

import sys
import os
import re

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.core.database import SessionLocal, engine, Base
from app.models.models import Student, Placement

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data_raw", "placement_real")

FILES = [
    ("2021 batch placement.xlsx", "2021"),
    ("2022 batch placement.xlsx", "2022"),
]


def normalize_usn(usn: str) -> str:
    """Fixes the missing zero-padding issue: '4GW21IS5' -> '4GW21IS005'."""
    usn = str(usn).strip().upper()
    m = re.match(r"^(4GW\d{2}IS)(\d+)$", usn)
    if not m:
        return usn
    prefix, digits = m.groups()
    return f"{prefix}{digits.zfill(3)}"


def normalize_name(name: str) -> str:
    return re.sub(r"[^a-z]", "", (name or "").lower())


def load_one_file(path, batch_label, db):
    import openpyxl
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb["Sheet1"]
    headers = [str(ws.cell(row=1, column=c).value or "").strip().upper() for c in range(1, ws.max_column + 1)]

    def col(*names):
        for n in names:
            for i, h in enumerate(headers):
                if n in h:
                    return i + 1
        return None

    name_c = col("STUDENT NAME", "NAME")
    usn_c = col("USN")
    company_c = col("COMPANY")
    ctc_c = col("CTC")

    # pre-index this batch's real students by USN and by normalized name, for fallback matching
    batch_students = db.query(Student).filter(Student.batch == batch_label).all()
    by_usn = {s.usn: s for s in batch_students}
    by_name = {}
    for s in batch_students:
        by_name.setdefault(normalize_name(s.name), []).append(s)

    matched, unmatched = [], []
    for r in range(2, ws.max_row + 1):
        raw_usn = ws.cell(row=r, column=usn_c).value if usn_c else None
        name = ws.cell(row=r, column=name_c).value if name_c else None
        company = ws.cell(row=r, column=company_c).value if company_c else None
        ctc = ws.cell(row=r, column=ctc_c).value if ctc_c else None
        if not name or not company:
            continue

        student = None
        if raw_usn:
            usn = str(raw_usn).strip().upper()
            student = by_usn.get(usn) or by_usn.get(normalize_usn(usn))

        if not student and name:
            candidates = by_name.get(normalize_name(name))
            if candidates and len(candidates) == 1:
                student = candidates[0]

        if student:
            matched.append((student, str(company).strip(), str(ctc).strip() if ctc else None))
        else:
            unmatched.append((raw_usn, name, company))

    return matched, unmatched


def main():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    total_matched, all_unmatched = 0, []
    for fname, batch in FILES:
        path = os.path.join(DATA_DIR, fname)
        if not os.path.exists(path):
            print(f"Not found, skipping: {path}")
            continue
        matched, unmatched = load_one_file(path, batch, db)
        for student, company, ctc in matched:
            existing = db.query(Placement).filter(Placement.student_id == student.id).first()
            if existing:
                existing.placed = True
                existing.company = company
                existing.ctc = ctc
            else:
                db.add(Placement(student_id=student.id, placed=True, company=company, ctc=ctc))
            total_matched += 1
        all_unmatched.extend([(batch, *u) for u in unmatched])

    db.commit()
    print(f"Matched and loaded {total_matched} real placement records with company + CTC.")
    if all_unmatched:
        print(f"\n{len(all_unmatched)} rows could NOT be matched to a real student — reported, not guessed at:")
        for batch, usn, name, company in all_unmatched:
            print(f"  Batch {batch}: USN='{usn}' Name='{name}' Company='{company}'")
    db.close()


if __name__ == "__main__":
    main()
