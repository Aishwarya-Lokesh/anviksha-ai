"""Shared Bloom's Taxonomy classification — the standard, well-established
action-verb framework (Anderson & Krathwohl's revised taxonomy), used both by
the offline question-bank tagger (scripts/tag_question_bank.py) and the live
Question Paper Generator, so both consistently return an honest
(bloom_level, tag_source) rather than each drifting from a duplicated copy."""
import re

BLOOM_VERBS = {
    "Remember": ["define", "list", "state", "recall", "name", "identify", "label"],
    "Understand": ["explain", "discuss", "describe", "summarize", "classify", "differences between"],
    "Apply": ["illustrate", "demonstrate", "solve", "apply", "use", "calculate", "implement"],
    "Analyze": ["analyze", "differentiate", "compare", "contrast", "examine", "distinguish"],
    "Evaluate": ["evaluate", "justify", "critique", "assess", "argue", "defend"],
    "Create": ["design", "create", "formulate", "develop", "propose", "construct"],
}

EXPLICIT_BT_RE = re.compile(r"\b(Remember|Understand|Apply|Analyze|Analyse|Evaluate|Create)\b", re.IGNORECASE)
MARKS_RE = re.compile(r"\b(\d{1,2})\s*(?:marks?|m\b)", re.IGNORECASE)


def _is_pure_header(text: str) -> bool:
    has_question_marker = bool(re.search(r"\b(Q\d|Question\s*\d|^\d+[.)]\s|\d+[a-z]\s|\bOR\b)", text, re.IGNORECASE | re.MULTILINE))
    is_boilerplate = bool(re.search(r"Course Outcomes:.*After completion", text, re.IGNORECASE | re.DOTALL))
    only_header_fields = bool(re.match(r"^\s*DEPARTMENT OF.*FACULTY NAME", text, re.IGNORECASE | re.DOTALL)) and not has_question_marker
    return is_boilerplate or only_header_fields


def classify_bloom(text: str):
    """Returns (bloom_level, tag_source) — "extracted" if a real BT Level
    column value is present in the text, "inferred" from real action verbs
    otherwise, or (None, "unknown") if neither applies."""
    if _is_pure_header(text):
        return None, "unknown"

    if re.search(r"BT\s*Level|Bloom", text, re.IGNORECASE):
        m = EXPLICIT_BT_RE.search(text)
        if m:
            level = m.group(1).capitalize().replace("Analyse", "Analyze")
            return level, "extracted"

    verb_hits = {}
    for level, verbs in BLOOM_VERBS.items():
        count = 0
        for v in verbs:
            count += len(re.findall(r"\b" + re.escape(v) + r"\b", text, re.IGNORECASE))
        verb_hits[level] = count
    best_level = max(verb_hits, key=verb_hits.get)
    if verb_hits[best_level] > 0:
        return best_level, "inferred"

    return None, "unknown"


def classify_difficulty(text: str):
    """Real marks value, when present in the text, as an honest difficulty proxy."""
    m = MARKS_RE.search(text)
    if not m:
        return None, None
    marks = int(m.group(1))
    if marks <= 5:
        return "Easy", marks
    elif marks <= 10:
        return "Medium", marks
    return "Hard", marks
