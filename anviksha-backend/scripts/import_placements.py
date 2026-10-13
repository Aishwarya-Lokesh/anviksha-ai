"""Import placement and internship records from CSV, matching each row to a
student by USN or name.

    python scripts/import_placements.py                 # dry run: report only, writes nothing
    python scripts/import_placements.py --apply         # import the rows that are safe to import

A row is imported only when it matches exactly one student AND carries no
open question in its needs_confirmation column. Everything else is listed in
the report with its candidates and left alone. Re-running is safe: a row that
is already present is updated in place, never duplicated.

Once you have confirmed a held row, put the student's USN in its usn column
and clear needs_confirmation; the next run imports it.
"""
import argparse
import csv
import os
import sys
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.core.database import SessionLocal  # noqa: E402
from app.core.placement_matching import canonical_company, match_student  # noqa: E402
from app.models.models import Company, Department, Internship, Placement, PlacementDrive, Student  # noqa: E402

REPO_ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
# Student names and packages are personal data: the CSVs live under data_raw/,
# which is git-ignored, and are never committed.
DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data_raw", "placement_2027")
# Stored when the source does not say how the student was hired — never inferred.
DRIVE_NOT_SPECIFIED = "Not specified"
OFFER_TYPES = {"full-time", "PPO", "internship+PPO"}
OFFER_STATUSES = {"offered", "accepted", "joined", "declined"}
DRIVE_TYPES = {"campus", "off-campus", "pool", DRIVE_NOT_SPECIFIED}
INTERNSHIP_STATUSES = {"ongoing", "completed"}


def _clean(value) -> str:
    return (value or "").strip()


def _positive(value: str, label: str, errors: list) -> Decimal | None:
    try:
        number = Decimal(_clean(value))
    except InvalidOperation:
        errors.append(f"{label} '{value}' is not a number")
        return None
    if number <= 0:
        errors.append(f"{label} must be greater than zero")
        return None
    return number


def _date(value: str, label: str, errors: list) -> date | None:
    if not _clean(value):
        return None
    try:
        return datetime.strptime(_clean(value), "%Y-%m-%d").date()
    except ValueError:
        errors.append(f"{label} '{value}' is not a valid YYYY-MM-DD date")
        return None


def _choice(value: str, allowed: set, label: str, errors: list) -> str | None:
    value = _clean(value)
    if not value:
        return None
    if value not in allowed:
        errors.append(f"{label} '{value}' must be one of: {', '.join(sorted(allowed))}")
        return None
    return value


def _read(path: str) -> list[dict]:
    if not os.path.exists(path):
        return []
    with open(path, newline="", encoding="utf-8-sig") as f:
        return [row for row in csv.DictReader(f) if any(_clean(v) for v in row.values())]


def _company(db, raw_name: str, known_keys: set, created: list) -> Company:
    display, key = canonical_company(raw_name)
    company = db.query(Company).filter(Company.name_key == key).first()
    if not company:
        company = Company(name=display, name_key=key)
        db.add(company)
        db.flush()
        if key not in known_keys:
            created.append(display)
    return company


def _evaluate(row: dict, students: list, errors: list) -> dict:
    """Match + decide. Returns the report entry for one CSV row."""
    match = match_student(row.get("name"), row.get("usn"), students)
    open_question = _clean(row.get("needs_confirmation"))
    if errors:
        decision = "invalid"
    elif match.status != "matched":
        decision = match.status          # "ambiguous" | "unmatched"
    elif open_question:
        decision = "held"                # unique match, but the source row itself is unconfirmed
    else:
        decision = "import"
    return {"row": row, "match": match, "errors": errors, "decision": decision, "open_question": open_question}


def run(placements_csv: str, internships_csv: str, department: str | None, apply: bool, db=None) -> dict:
    """`db` lets the admin import screen run this inside its own request;
    from the command line a session is opened and closed here."""
    owns_session = db is None
    if owns_session:
        db = SessionLocal()
    try:
        dept_query = db.query(Department)
        if department:
            dept_query = dept_query.filter(Department.name.ilike(f"%{department}%"))
        dept = dept_query.first()
        if not dept:
            raise SystemExit(f"No department matches '{department}'")

        students_by_batch: dict[str, list] = {}

        def students_for(batch: str) -> list:
            if batch not in students_by_batch:
                students_by_batch[batch] = db.query(Student).filter(
                    Student.batch == batch, Student.department_id == dept.id
                ).all()
            return students_by_batch[batch]

        known_company_keys = {key for (key,) in db.query(Company.name_key).all()}
        new_companies: list[str] = []
        result = {"department": dept.name, "placements": [], "internships": [], "new_companies": new_companies,
                  "applied": apply, "written": {"placements": 0, "internships": 0}}

        for row in _read(placements_csv):
            errors: list[str] = []
            package = _positive(row.get("package_lpa"), "package_lpa", errors)
            offer_type = _choice(row.get("offer_type"), OFFER_TYPES, "offer_type", errors)
            status = _choice(row.get("status"), OFFER_STATUSES, "status", errors) or "offered"
            drive_type = _choice(row.get("drive_type"), DRIVE_TYPES, "drive_type", errors) or DRIVE_NOT_SPECIFIED
            offer_date = _date(row.get("offer_date"), "offer_date", errors)
            drive_date = _date(row.get("drive_date"), "drive_date", errors)
            if not _clean(row.get("company")):
                errors.append("company is required")
            if not _clean(row.get("batch")):
                errors.append("batch is required")
            entry = _evaluate(row, students_for(_clean(row.get("batch"))), errors)
            result["placements"].append(entry)
            if entry["decision"] != "import" or not offer_type:
                if entry["decision"] == "import":
                    entry["decision"], entry["errors"] = "invalid", ["offer_type is required to import"]
                continue
            if not apply:
                continue

            student = entry["match"].student
            company = _company(db, row["company"], known_company_keys, new_companies)
            batch = _clean(row.get("batch"))
            drive = db.query(PlacementDrive).filter(
                PlacementDrive.company_id == company.id, PlacementDrive.batch == batch,
                PlacementDrive.drive_type == drive_type,
                PlacementDrive.drive_date == drive_date if drive_date else PlacementDrive.drive_date.is_(None),
            ).first()
            if not drive:
                drive = PlacementDrive(company_id=company.id, batch=batch, drive_type=drive_type,
                                       drive_date=drive_date, venue=_clean(row.get("venue")) or None,
                                       source_note=_clean(row.get("source_note")) or None)
                db.add(drive)
                db.flush()

            placement = db.query(Placement).filter(
                Placement.student_id == student.student_id, Placement.company_id == company.id,
                Placement.offer_type == offer_type,
            ).first()
            if not placement:
                placement = Placement(student_id=student.student_id, company_id=company.id, offer_type=offer_type)
                db.add(placement)
            placement.usn = student.usn
            placement.drive_id = drive.id
            placement.role = _clean(row.get("role")) or None
            placement.package_lpa = package
            placement.offer_date = offer_date
            placement.status = status
            placement.verified = True
            placement.source_note = _clean(row.get("source_note")) or None
            # The pre-existing columns are still what the older screens read.
            placement.placed = True
            placement.company = company.name
            placement.ctc = f"{package.normalize():f} LPA"
            result["written"]["placements"] += 1

        for row in _read(internships_csv):
            errors = []
            stipend = _positive(row.get("stipend_per_month"), "stipend_per_month", errors)
            status = _choice(row.get("status"), INTERNSHIP_STATUSES, "status", errors)
            start = _date(row.get("start_date"), "start_date", errors)
            end = _date(row.get("end_date"), "end_date", errors)
            if start and end and end < start:
                errors.append("end_date is before start_date")
            if not _clean(row.get("company")):
                errors.append("company is required")
            if not _clean(row.get("batch")):
                errors.append("batch is required")
            entry = _evaluate(row, students_for(_clean(row.get("batch"))), errors)
            result["internships"].append(entry)
            if entry["decision"] != "import" or not apply:
                continue

            student = entry["match"].student
            company = _company(db, row["company"], known_company_keys, new_companies)
            # start_date is often unknown, and a UNIQUE constraint treats NULLs
            # as distinct, so the duplicate check is done here explicitly.
            internship = db.query(Internship).filter(
                Internship.student_id == student.student_id, Internship.company_id == company.id,
                Internship.start_date == start if start else Internship.start_date.is_(None),
            ).first()
            if not internship:
                internship = Internship(student_id=student.student_id, company_id=company.id, start_date=start,
                                        company=company.name)
                db.add(internship)
            internship.usn = student.usn
            internship.company = company.name
            internship.role = _clean(row.get("role")) or None
            internship.stipend_per_month = stipend
            internship.end_date = end
            internship.status = status
            internship.mode = _clean(row.get("mode")) or None
            internship.verified = True
            internship.source_note = _clean(row.get("source_note")) or None
            result["written"]["internships"] += 1

        if apply:
            db.commit()
        return result
    finally:
        if owns_session:
            db.close()


SECTION_TITLES = {
    "import": "Matched — safe to import",
    "held": "Matched to one student, but held because the source record itself is unconfirmed",
    "ambiguous": "Not imported — needs you to pick or confirm the student",
    "unmatched": "Not imported — no matching student",
    "invalid": "Not imported — invalid data",
}


def _amount(kind: str, row: dict) -> str:
    return f"{row.get('package_lpa')} LPA" if kind == "placements" else f"₹{row.get('stipend_per_month')} / month"


def render_report(result: dict) -> str:
    lines = ["# Placement & internship import report", ""]
    lines.append(f"Generated {datetime.now():%Y-%m-%d %H:%M} · Department: {result['department']} · "
                 + ("**Applied** — the rows under \"safe to import\" were written." if result["applied"]
                    else "**Dry run** — nothing was written."))
    lines.append("")
    all_entries = [(k, e) for k in ("placements", "internships") for e in result[k]]
    counts = {d: sum(1 for _, e in all_entries if e["decision"] == d) for d in SECTION_TITLES}
    lines += ["| Outcome | Rows |", "|---|---|"]
    lines += [f"| {title} | {counts[d]} |" for d, title in SECTION_TITLES.items()]
    lines.append("")
    if result["applied"]:
        lines += [f"Rows written this run: {result['written']['placements']} placements, "
                  f"{result['written']['internships']} internships.", ""]

    for decision, title in SECTION_TITLES.items():
        entries = [(k, e) for k, e in all_entries if e["decision"] == decision]
        if not entries:
            continue
        lines += [f"## {title}", ""]
        if decision in ("import", "held"):
            lines += ["| Type | Name in source | Company | Amount | Matched student | USN | How matched | Open question |",
                      "|---|---|---|---|---|---|---|---|"]
            for kind, e in entries:
                m, row = e["match"], e["row"]
                how = {"usn": "USN", "exact_name": "Exact name", "fuzzy": f"Similar name ({m.student.score})"}[m.method]
                lines.append(f"| {kind[:-1].capitalize()} | {row['name']} | {canonical_company(row['company'])[0]} | "
                             f"{_amount(kind, row)} | {m.student.name} | {m.student.usn} | {how} | {e['open_question'] or '—'} |")
            lines.append("")
        else:
            for kind, e in entries:
                m, row = e["match"], e["row"]
                lines.append(f"### {kind[:-1].capitalize()}: {row['name']} — {canonical_company(row['company'])[0]}, {_amount(kind, row)}")
                lines.append("")
                reason = "; ".join(e["errors"]) if e["errors"] else m.reason
                lines.append(f"Reason: {reason}.")
                if e["open_question"]:
                    lines.append(f"Open question from the source: {e['open_question']}.")
                if m.candidates:
                    lines += ["", ("Possible students" if decision == "ambiguous" else "Closest names, below the matching bar") + " (none was chosen):", "", "| USN | Name | Similarity |", "|---|---|---|"]
                    lines += [f"| {c.usn} | {c.name} | {c.score} |" for c in m.candidates]
                lines.append("")

    if result["new_companies"]:
        lines += ["## Companies added", "", ", ".join(sorted(set(result["new_companies"]))), ""]
    lines += ["## To resolve a row", "",
              "Write the correct USN in that row's `usn` column in the CSV, clear its `needs_confirmation` cell, "
              "and run the import again.", ""]
    return "\n".join(lines)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--placements", default=os.path.join(DATA_DIR, "placements_2027_batch.csv"))
    parser.add_argument("--internships", default=os.path.join(DATA_DIR, "internships_2027_batch.csv"))
    parser.add_argument("--department", default=None, help="part of the department name; default is the first department")
    parser.add_argument("--report", default=os.path.join(REPO_ROOT, "IMPORT_REPORT.md"))
    parser.add_argument("--apply", action="store_true", help="write the safe rows; without this nothing is written")
    args = parser.parse_args()

    outcome = run(args.placements, args.internships, args.department, args.apply)
    with open(args.report, "w", encoding="utf-8", newline="\n") as f:
        f.write(render_report(outcome))
    tally = {}
    for kind in ("placements", "internships"):
        for e in outcome[kind]:
            tally[e["decision"]] = tally.get(e["decision"], 0) + 1
    print(("APPLIED" if args.apply else "DRY RUN"), tally, "->", os.path.abspath(args.report))
