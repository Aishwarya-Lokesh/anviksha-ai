"""Real, dynamically-generated charts triggered from the Teacher/Admin chat
assistants. Detection is honest and narrow: only questions that actually
look visualization-shaped are treated as chart requests; everything else
falls back to the normal text chat answer. Every chart is built from real,
freshly-queried data scoped exactly like the rest of that role's chat
context - never invented numbers."""
import re

CHART_KEYWORDS = ("chart", "graph", "trend", "visualiz", "plot", "distribution", "dashboard", "breakdown")
BATCH_RE = re.compile(r"\b(20\d{2})\b")


def is_chart_request(question: str) -> bool:
    lower = question.lower()
    return any(word in lower for word in CHART_KEYWORDS)


def _cgpa_buckets(students: list) -> list[dict]:
    buckets = {"9-10 (Excellent)": 0, "8-9 (Good)": 0, "7-8 (Average)": 0, "Below 7": 0}
    for s in students:
        if s.cgpa is None:
            continue
        if s.cgpa >= 9:
            buckets["9-10 (Excellent)"] += 1
        elif s.cgpa >= 8:
            buckets["8-9 (Good)"] += 1
        elif s.cgpa >= 7:
            buckets["7-8 (Average)"] += 1
        else:
            buckets["Below 7"] += 1
    return [{"name": k, "value": v} for k, v in buckets.items()]


def _attendance_buckets(students: list) -> list[dict]:
    buckets = {"Excellent (90%+)": 0, "Good (75-89%)": 0, "Average (60-74%)": 0, "Low (<60%)": 0}
    for s in students:
        if s.attendance_pct is None:
            continue
        if s.attendance_pct >= 90:
            buckets["Excellent (90%+)"] += 1
        elif s.attendance_pct >= 75:
            buckets["Good (75-89%)"] += 1
        elif s.attendance_pct >= 60:
            buckets["Average (60-74%)"] += 1
        else:
            buckets["Low (<60%)"] += 1
    return [{"name": k, "value": v} for k, v in buckets.items()]


def build_teacher_chart(students: list, question: str) -> dict:
    lower = question.lower()
    if "attendance" in lower:
        data = _attendance_buckets(students)
        return {"type": "donut", "title": "Real attendance distribution across your roster", "data": data}
    data = _cgpa_buckets(students)
    return {"type": "bar", "title": "Real CGPA distribution across your roster", "data": data}


def build_admin_chart(db, question: str) -> dict:
    from app.models.models import Student, Placement
    from collections import Counter

    lower = question.lower()
    batch_match = BATCH_RE.search(question)
    batch = batch_match.group(1) if batch_match else None

    if "placement" in lower or "placed" in lower:
        q = db.query(Placement).join(Student)
        if batch:
            q = q.filter(Student.batch == batch)
        placements = q.all()
        placed = sum(1 for p in placements if p.placed)
        not_placed = len(placements) - placed
        title = f"Real placement status{f' for {batch} batch' if batch else ' (institute-wide)'}"
        return {"type": "donut", "title": title, "data": [
            {"name": "Placed", "value": placed}, {"name": "Not placed", "value": not_placed},
        ]}

    if "cgpa" in lower or "performance" in lower:
        q = db.query(Student).filter(Student.cgpa.isnot(None))
        if batch:
            q = q.filter(Student.batch == batch)
        data = _cgpa_buckets(q.all())
        return {"type": "bar", "title": f"Real CGPA distribution{f' — {batch} batch' if batch else ' (institute-wide)'}", "data": data}

    students = db.query(Student).all()
    dept_counts = Counter(s.department.name if s.department else "Unknown" for s in students)
    return {"type": "bar", "title": "Real student count by department", "data": [{"name": k, "value": v} for k, v in dept_counts.items()]}
