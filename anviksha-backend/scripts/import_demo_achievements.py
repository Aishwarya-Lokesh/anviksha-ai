"""
Imports the DEMO/placeholder Hackathon and Certificate files you sent —
explicitly confirmed by you as demo content, not real records. Every file
imported here is marked is_demo=True so the UI always shows a "Demo" badge
and never presents it as a genuine student record.

Sorted into the correct category by which real folder each file came from:
    .../Hackathon/<USN>/*.pdf   -> category="Hackathon"
    .../MOOC/<file>.pdf          -> category="Certificate"

Skips any file that would duplicate an already-imported REAL certificate
(the 68 genuine ones from link_real_certificates.py) — this script only adds
demo content, never overwrites or duplicates real records.

Usage:
    python scripts/import_demo_achievements.py /path/to/extracted/zips
"""

import sys
import os
import re
import glob

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.core.database import SessionLocal, engine, Base
from app.models.models import Student, CertificateFile

USN_RE = re.compile(r"(4GW\d{2}IS\d{2,4})", re.IGNORECASE)


def normalize_usn(usn: str) -> str:
    usn = usn.strip().upper()
    m = re.match(r"^(4GW\d{2}IS)(\d+)$", usn)
    if not m:
        return usn
    prefix, digits = m.groups()
    return f"{prefix}{digits.zfill(3)}"


def main(source_root):
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    demo_dest_dir = os.path.join(os.path.dirname(__file__), "..", "data_raw", "demo_achievement_files")
    os.makedirs(demo_dest_dir, exist_ok=True)

    imported, skipped_no_match, skipped_duplicate = 0, [], 0
    seen_student_category = set()  # (student_id, category) — avoids duplicate content across overlapping zips

    # Hackathon files — one folder per USN
    for hackathon_dir in glob.glob(os.path.join(source_root, "**", "Hackathon"), recursive=True):
        for usn_dir in glob.glob(os.path.join(hackathon_dir, "*")):
            if not os.path.isdir(usn_dir):
                continue
            usn = normalize_usn(os.path.basename(usn_dir))
            student = db.query(Student).filter(Student.usn == usn).first()
            if not student:
                skipped_no_match.append(("Hackathon", usn))
                continue
            key = (student.id, "Hackathon")
            if key in seen_student_category:
                skipped_duplicate += 1
                continue
            pdfs = glob.glob(os.path.join(usn_dir, "*.pdf"))
            if not pdfs:
                continue
            pdf = pdfs[0]  # one real achievement per student — the source zips repeat the same content across years
            fname = os.path.basename(pdf)
            dest_name = f"DEMO_{usn}_Hackathon_{fname}"
            existing = db.query(CertificateFile).filter(
                CertificateFile.student_id == student.id, CertificateFile.filename == dest_name
            ).first()
            if existing:
                seen_student_category.add(key)
                skipped_duplicate += 1
                continue
            import shutil
            shutil.copy(pdf, os.path.join(demo_dest_dir, dest_name))
            db.add(CertificateFile(
                student_id=student.id, filename=dest_name,
                display_label="Hackathon Participation (Demo)",
                category="Hackathon", is_demo=True,
            ))
            seen_student_category.add(key)
            imported += 1

    # MOOC/Certificate demo files — flat files named <USN>_<Name>.pdf
    for mooc_dir in glob.glob(os.path.join(source_root, "**", "MOOC"), recursive=True):
        for pdf in glob.glob(os.path.join(mooc_dir, "*.pdf")):
            fname = os.path.basename(pdf)
            m = USN_RE.search(fname)
            if not m:
                skipped_no_match.append(("Certificate", fname))
                continue
            usn = normalize_usn(m.group(1))
            student = db.query(Student).filter(Student.usn == usn).first()
            if not student:
                skipped_no_match.append(("Certificate", usn))
                continue

            # skip if this exact file already exists as a REAL (non-demo) record
            already_real = db.query(CertificateFile).filter(
                CertificateFile.student_id == student.id, CertificateFile.filename == fname, CertificateFile.is_demo == False
            ).first()
            if already_real:
                skipped_duplicate += 1
                continue

            key = (student.id, "Certificate-demo")
            if key in seen_student_category:
                skipped_duplicate += 1
                continue

            dest_name = f"DEMO_{usn}_Certificate_{fname}"
            existing = db.query(CertificateFile).filter(
                CertificateFile.student_id == student.id, CertificateFile.filename == dest_name
            ).first()
            if existing:
                seen_student_category.add(key)
                skipped_duplicate += 1
                continue

            import shutil
            shutil.copy(pdf, os.path.join(demo_dest_dir, dest_name))
            db.add(CertificateFile(
                student_id=student.id, filename=dest_name,
                display_label="MOOC Certificate (Demo)",
                category="Certificate", is_demo=True,
            ))
            seen_student_category.add(key)
            imported += 1

    db.commit()
    print(f"Imported {imported} demo achievement files (clearly marked is_demo=True).")
    if imported == 0:
        print("WARNING: 0 files imported — check that data_raw/demo_source_files/ actually contains the real Hackathon/MOOC folders.")
    print(f"Skipped {skipped_duplicate} already-imported duplicates.")
    if skipped_no_match:
        print(f"{len(skipped_no_match)} files could not be matched to a real student.")
    db.close()


if __name__ == "__main__":
    default_source = os.path.join(os.path.dirname(__file__), "..", "data_raw", "demo_source_files")
    source = sys.argv[1] if len(sys.argv) > 1 else default_source
    if not os.path.isdir(source):
        print(f"ERROR: source directory not found: {source}")
        print("The real demo Hackathon/Certificate PDFs should be bundled at data_raw/demo_source_files/ — if this directory is missing, nothing can be imported.")
        sys.exit(1)
    main(source)
