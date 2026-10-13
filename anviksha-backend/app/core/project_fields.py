"""The fill-in fields of a project format (title, students, guide, ...) and
how they are found in, and written into, a template.

A template marks its fields either with obvious tokens (`<<Project Title>>`,
`[Name of Guide]`) or with sample wording ("TITLE OF THE PROJECT", "NAME OF
THE STUDENT (USN)"). Both are recorded as a *field map*: a list of
`{"match": exact text in the template, "field": which field it stands for}`.
The map is guessed when a template is uploaded and can be corrected by
whoever uploaded it, so an unusual format still fills in correctly."""
import re
from typing import Optional

# key -> (label shown to people, repeats once per student)
FIELDS: dict[str, tuple[str, bool]] = {
    "title": ("Project title", False),
    "student_name": ("Student name (one per student)", True),
    "student_usn": ("Student USN (one per student)", True),
    "student_name_usn": ("Student name with USN (one per student)", True),
    "guide_name": ("Guide's name", False),
    "guide_designation": ("Guide's designation", False),
    "hod_name": ("HOD's name", False),
    "hod_designation": ("HOD's designation", False),
    "principal_name": ("Principal's name", False),
    "department": ("Department", False),
    "college": ("College", False),
    "academic_year": ("Academic year", False),
    "degree": ("Degree", False),
    "project_type": ("Project type", False),
    "date": ("Date", False),
    "place": ("Place", False),
}

_TOKEN = re.compile(r"(<<[^<>]{2,60}>>|\{\{[^{}]{2,60}\}\}|\[[^\[\]]{2,60}\]|<[^<>]{2,60}>|«[^«»]{2,60}»)")
_PHRASES: list[tuple[str, str]] = [
    (r"(title\s+of\s+the\s+project(\s+work)?|project\s+title|title\s+of\s+project)", "title"),
    (r"(name\s+of\s+the\s+(student|candidate)s?\s*\(\s*usn\s*\)|student\s+name\s*\(\s*usn\s*\))", "student_name_usn"),
    (r"(name\s+of\s+the\s+(student|candidate)s?|student\s+name|candidate\s+name)", "student_name"),
    (r"(name\s+of\s+the\s+guide|guide\s+name|name\s+of\s+guide)", "guide_name"),
    (r"(designation\s+of\s+the\s+guide|guide\s+designation)", "guide_designation"),
    (r"(name\s+of\s+the\s+hod|name\s+of\s+hod|hod\s+name)", "hod_name"),
    (r"(name\s+of\s+the\s+principal|principal\s+name)", "principal_name"),
    (r"\b20(\d\d|xx|yy)\s*[-–/]\s*(20)?(\d\d|xx|yy)\b", "academic_year"),
]


def classify(text: str) -> Optional[str]:
    """Which field a token's wording points to, or None."""
    t = re.sub(r"[^a-z ]", " ", text.lower())
    words = set(t.split())
    if "title" in words:
        return "title"
    if "usn" in words and words & {"name", "student", "candidate"}:
        return "student_name_usn"
    if "usn" in words:
        return "student_usn"
    if "guide" in words or "supervisor" in words:
        return "guide_designation" if "designation" in words else "guide_name"
    if "hod" in words or ("head" in words and "department" in words):
        return "hod_designation" if "designation" in words else "hod_name"
    if "principal" in words:
        return "principal_name"
    if words & {"student", "candidate"} or words == {"name"}:
        return "student_name"
    if "year" in words:
        return "academic_year"
    if "department" in words or "dept" in words or "branch" in words:
        return "department"
    if "college" in words or "institute" in words or "institution" in words:
        return "college"
    if "degree" in words:
        return "degree"
    if "date" in words:
        return "date"
    if "place" in words:
        return "place"
    return None


def guess_map(texts: list[str]) -> list[dict]:
    """Field map guessed from the wording of a template's cover, certificate,
    declaration, headers and footers."""
    found: dict[str, str] = {}
    for text in texts:
        for token in _TOKEN.findall(text or ""):
            field = classify(token)
            if field and token not in found:
                found[token] = field
        for pattern, field in _PHRASES:
            for m in re.finditer(pattern, text or "", flags=re.IGNORECASE):
                phrase = m.group(0)
                # a phrase already inside a recognised token is covered by the token
                if not any(phrase in token for token in found) and phrase not in found:
                    found[phrase] = field
    # Longest first, so "NAME OF THE STUDENT (USN)" is replaced before "NAME OF THE STUDENT".
    return [{"match": m, "field": f} for m, f in sorted(found.items(), key=lambda kv: -len(kv[0]))]


def clean_map(raw) -> list[dict]:
    """A field map as sent by a person, reduced to valid, distinct entries."""
    out, seen = [], set()
    for row in raw or []:
        match = str((row or {}).get("match") or "").strip()
        field = str((row or {}).get("field") or "").strip()
        if len(match) < 2 or len(match) > 200 or field not in FIELDS or match in seen:
            continue
        seen.add(match)
        out.append({"match": match, "field": field})
    return sorted(out, key=lambda r: -len(r["match"]))


def _like(sample: str, value: str) -> str:
    """`value` in the letter case of the template's sample wording."""
    letters = [c for c in sample if c.isalpha()]
    if letters and all(c.isupper() for c in letters):
        return value.upper()
    return value


def values(details: dict) -> dict:
    """Everything a template can ask for, from a project's details."""
    students = [s for s in (details.get("students") or []) if (s.get("name") or "").strip()]
    return {
        "title": (details.get("title") or "").strip(),
        "students": [{"name": s["name"].strip(), "usn": (s.get("usn") or "").strip().upper()} for s in students],
        "guide_name": (details.get("guide_name") or "").strip(),
        "guide_designation": (details.get("guide_designation") or "").strip(),
        "hod_name": (details.get("hod_name") or "").strip(),
        "hod_designation": (details.get("hod_designation") or "").strip(),
        "principal_name": (details.get("principal_name") or "").strip(),
        "department": (details.get("department") or "").strip(),
        "college": (details.get("college") or "").strip(),
        "academic_year": (details.get("academic_year") or "").strip(),
        "degree": (details.get("degree") or "").strip(),
        "project_type": (details.get("project_type") or "").strip(),
        "date": (details.get("date") or "").strip(),
        "place": (details.get("place") or "").strip(),
    }


def student_text(field: str, student: dict) -> str:
    if field == "student_usn":
        return student["usn"]
    if field == "student_name_usn":
        return f"{student['name']} ({student['usn']})" if student["usn"] else student["name"]
    return student["name"]


def inline_value(field: str, sample: str, vals: dict) -> Optional[str]:
    """The text that replaces `sample` when it sits inside a sentence. For a
    per-student field that means every student, joined the way a sentence
    lists people. None when the project has no value for the field, in which
    case the template's wording is left alone and reported as unfilled."""
    if FIELDS[field][1]:
        parts = [student_text(field, s) for s in vals["students"]]
        parts = [p for p in parts if p]
        if not parts:
            return None
        parts = [_like(sample, p) for p in parts]          # names follow the template's case; the joining "and" does not
        return parts[0] if len(parts) == 1 else ", ".join(parts[:-1]) + " and " + parts[-1]
    value = vals.get(field) or ""
    return _like(sample, value) if value else None
