"""Placement and internship figures, read from the three v_* views plus the
offer rows behind them. Every dashboard, report and assistant goes through
this module, so a number can never differ between two screens.
"""
from collections import Counter
from statistics import median
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models.models import Internship, Placement, Student

# The department's "dream offer" line as shown on the placement screens.
DREAM_MIN_LPA = 9


def batch_label(batch: Optional[str]) -> str:
    """'2023' -> '2023–27' (entry year to graduating year)."""
    if not batch:
        return "All batches"
    try:
        return f"{batch}–{str(int(batch) + 4)[-2:]}"
    except ValueError:
        return batch


def _num(value) -> Optional[float]:
    return float(value) if value is not None else None


def _pkg_text(offer: Placement) -> Optional[str]:
    if offer.package_lpa is not None:
        return f"{float(offer.package_lpa):g} LPA"
    return offer.ctc


def _company_name(offer) -> Optional[str]:
    return offer.company_ref.name if offer.company_ref else offer.company


def batch_rows(db: Session, department_id: int) -> list[dict]:
    """One row per batch from v_batch_placement_stats, plus the median package."""
    rows = db.execute(text(
        "SELECT * FROM v_batch_placement_stats WHERE department_id = :d ORDER BY batch"
    ), {"d": department_id}).mappings().all()
    packages: dict[str, list[float]] = {}
    for batch, pkg in db.execute(text(
        "SELECT batch, highest_package_lpa FROM v_student_placement_summary "
        "WHERE department_id = :d AND highest_package_lpa IS NOT NULL"
    ), {"d": department_id}).all():
        packages.setdefault(batch, []).append(float(pkg))
    out = []
    for r in rows:
        pk = packages.get(r["batch"], [])
        out.append({
            "batch": r["batch"], "label": batch_label(r["batch"]),
            "total_students": int(r["total_students"]), "placed": int(r["placed_count"] or 0),
            "unplaced": int(r["unplaced_count"] or 0), "placement_pct": _num(r["placement_pct"]),
            "offers": int(r["offers_count"] or 0),
            "avg_ctc_lpa": round(sum(pk) / len(pk), 2) if pk else None,
            "median_ctc_lpa": round(median(pk), 2) if pk else None,
            "highest_ctc_lpa": max(pk) if pk else None,
            "students_with_internship": int(r["students_with_internship"] or 0),
            "internships": int(r["internships_count"] or 0),
            "avg_stipend_per_month": _num(r["avg_stipend_per_month"]),
            "highest_stipend_per_month": _num(r["highest_stipend_per_month"]),
            "ppo_count": int(r["ppo_count"] or 0),
        })
    return out


def batches_with_offers(db: Session, department_id: int) -> list[dict]:
    return [{"batch": r["batch"], "label": r["label"]} for r in batch_rows(db, department_id) if r["offers"] > 0]


def _offers(db: Session, department_id: int, batch: Optional[str]) -> list[Placement]:
    q = db.query(Placement).join(Student, Student.id == Placement.student_id).filter(
        Student.department_id == department_id, Placement.placed == True,  # noqa: E712
        (Placement.status.is_(None)) | (Placement.status != "declined"),
    )
    if batch:
        q = q.filter(Student.batch == batch)
    return q.all()


def overview(db: Session, department_id: int, department_name: str, batch: Optional[str] = None) -> dict:
    """Everything the placement dashboard shows for one batch, or for every
    batch that has at least one offer when `batch` is None."""
    per_batch = batch_rows(db, department_id)
    in_scope = [r for r in per_batch if (r["batch"] == batch if batch else r["offers"] > 0)]
    scope_batches = [r["batch"] for r in in_scope]
    offers = _offers(db, department_id, batch)

    best: dict[int, Placement] = {}
    for o in offers:
        current = best.get(o.student_id)
        if current is None or (o.package_lpa or 0) > (current.package_lpa or 0):
            best[o.student_id] = o

    known = [o for o in offers if o.package_lpa is not None]
    student_packages = [float(o.package_lpa) for o in best.values() if o.package_lpa is not None]
    by_company = Counter(_company_name(o) for o in offers if _company_name(o))

    def company_card(name: Optional[str]) -> Optional[dict]:
        if not name:
            return None
        theirs = [o for o in offers if _company_name(o) == name]
        top = max((o for o in theirs if o.package_lpa is not None), key=lambda o: o.package_lpa, default=None)
        return {"company": name, "ctc": _pkg_text(top) if top else None, "students_placed": len({o.student_id for o in theirs})}

    highest = max(known, key=lambda o: o.package_lpa, default=None)
    roster = db.query(Student).filter(
        Student.department_id == department_id, Student.batch.in_(scope_batches)
    ).order_by(Student.usn).all() if scope_batches else []

    tracked = sum(r["total_students"] for r in in_scope)
    return {
        "department": department_name,
        "batch": batch, "batch_label": batch_label(batch),
        "tracked_total": tracked,
        "placed": len(best),
        "not_placed": max(tracked - len(best), 0),
        "placement_pct": round(100 * len(best) / tracked, 1) if tracked else None,
        "offers": len(offers),
        "dream_offers": sum(1 for o in known if o.package_lpa >= DREAM_MIN_LPA),
        "regular_offers": sum(1 for o in known if o.package_lpa < DREAM_MIN_LPA),
        "avg_ctc_lpa": round(sum(student_packages) / len(student_packages), 1) if student_packages else None,
        "median_ctc_lpa": round(median(student_packages), 1) if student_packages else None,
        "highest_ctc_lpa": max(student_packages) if student_packages else None,
        "companies_hired_count": len(by_company),
        "highest_package_company": company_card(_company_name(highest)) if highest else None,
        "top_hiring_company": company_card(by_company.most_common(1)[0][0]) if by_company else None,
        "top_companies": [{"company": c, "count": n} for c, n in by_company.most_common(10)],
        "students_placed_for_highest_package": [
            {"usn": o.student.usn, "name": o.student.name, "company": _company_name(o), "ctc": _pkg_text(o)}
            for o in sorted((o for o in best.values() if o.package_lpa is not None and o.package_lpa >= DREAM_MIN_LPA),
                            key=lambda o: -o.package_lpa)
        ],
        "students": [{
            "usn": s.usn, "name": s.name, "batch": s.batch, "placed": s.id in best,
            "company": _company_name(best[s.id]) if s.id in best else None,
            "ctc": _pkg_text(best[s.id]) if s.id in best else None,
            "offer_type": best[s.id].offer_type if s.id in best else None,
        } for s in roster],
        # kept for screens written against the earlier response shape
        "total_students_in_placement_data": tracked,
        "with_company_data": sum(1 for o in offers if _company_name(o)),
    }


def student_records(db: Session, student_id: int) -> dict:
    """One student's own offers and internships."""
    offers = db.query(Placement).filter(Placement.student_id == student_id, Placement.placed == True).all()  # noqa: E712
    internships = db.query(Internship).filter(Internship.student_id == student_id).all()
    return {
        "placements": [{
            "id": o.id, "company": _company_name(o), "role": o.role, "package_lpa": _num(o.package_lpa),
            "ctc": _pkg_text(o), "offer_type": o.offer_type, "status": o.status,
            "offer_date": str(o.offer_date) if o.offer_date else None,
            "drive_type": o.drive.drive_type if o.drive else None, "verified": bool(o.verified),
        } for o in offers],
        "internships": [{
            "id": i.id, "company": _company_name(i), "role": i.role,
            "stipend_per_month": _num(i.stipend_per_month),
            "duration": i.duration_text, "start_date": str(i.start_date) if i.start_date else None,
            "end_date": str(i.end_date) if i.end_date else None, "status": i.status, "mode": i.mode,
            "verified": bool(i.verified),
        } for i in internships],
    }
