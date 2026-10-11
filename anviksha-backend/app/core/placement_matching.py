"""Name -> student matching and company-name normalization for placement and
internship imports.

Shared by scripts/import_placements.py and (later) the admin import screen so
both classify a row identically. The rule throughout: a record is attached to
a student only when exactly one student fits. Anything else is reported with
its candidates and left for a person to decide — never guessed.
"""
import re
from dataclasses import dataclass, field
from typing import Iterable, Optional

FUZZY_THRESHOLD = 0.6
# Below the match bar but close enough to be worth showing a person as a lead.
HINT_THRESHOLD = 0.3

# Different spellings of the same recruiter that appear in the department's
# own source files. Keys are company_key() of the spelling, values are the one
# display name used everywhere.
COMPANY_ALIASES = {
    "mindsprint": "Mindsprint",
    "mindsprint digital": "Mindsprint",
    "dell": "Dell",
    "dell technologies": "Dell",
    "deutsche bank": "Deutsche Bank",
    "deutsche india": "Deutsche Bank",
    "infosys": "Infosys",
    "boeing": "Boeing",
}


def company_key(name: str) -> str:
    """Case-, punctuation- and spacing-insensitive form of a company name."""
    key = re.sub(r"[^a-z0-9&]+", " ", (name or "").lower())
    return re.sub(r"\s+", " ", key).strip()


def canonical_company(name: str) -> tuple[str, str]:
    """(display name, key) a raw company string should be stored under."""
    key = company_key(name)
    display = COMPANY_ALIASES.get(key)
    if display:
        return display, company_key(display)
    return re.sub(r"\s+", " ", (name or "").strip()), key


def normalize_name(name: str) -> str:
    """Lowercase, dots removed, punctuation and repeated spaces collapsed."""
    cleaned = (name or "").lower().replace(".", " ")
    cleaned = re.sub(r"[^a-z\s]", " ", cleaned)
    return re.sub(r"\s+", " ", cleaned).strip()


def _name_keys(name: str) -> set[tuple[tuple[str, ...], tuple[str, ...]]]:
    """Every (words, initials) reading of a name, order-insensitive.

    "Bhavyashree R K", "Bhavyashree RK" and "K R Bhavyashree" must all compare
    equal, but a two-letter token can be either joined initials ("RK") or a
    real short name ("Om"), so both readings are kept and two names match when
    any reading coincides."""
    tokens = normalize_name(name).split()
    keys = set()
    for initials_max_len in (1, 2):
        words = sorted(t for t in tokens if len(t) > initials_max_len)
        initials = sorted("".join(t for t in tokens if len(t) <= initials_max_len))
        if words:
            keys.add((tuple(words), tuple(initials)))
    return keys


def _words(name: str) -> list[str]:
    return [t for t in normalize_name(name).split() if len(t) > 1]


def _trigrams(text: str) -> set[str]:
    # Same construction as Postgres pg_trgm: each word padded with two leading
    # spaces and one trailing space, then every 3-character window.
    grams = set()
    for word in normalize_name(text).split():
        padded = f"  {word} "
        grams.update(padded[i:i + 3] for i in range(len(padded) - 2))
    return grams


def similarity(a: str, b: str) -> float:
    """Trigram similarity, equivalent to pg_trgm's similarity()."""
    ga, gb = _trigrams(a), _trigrams(b)
    if not ga or not gb:
        return 0.0
    return len(ga & gb) / len(ga | gb)


@dataclass
class Candidate:
    student_id: int
    usn: str
    name: str
    score: float = 1.0


@dataclass
class MatchResult:
    status: str            # "matched" | "ambiguous" | "unmatched"
    method: Optional[str]  # "usn" | "exact_name" | "fuzzy" | "first_name_only" | None
    student: Optional[Candidate] = None
    candidates: list[Candidate] = field(default_factory=list)
    reason: str = ""


def match_student(source_name: str, source_usn: Optional[str], students: Iterable) -> MatchResult:
    """Classify one source row against `students` (objects with id, usn, name),
    already restricted by the caller to the right batch and department."""
    students = list(students)

    usn = (source_usn or "").strip().upper()
    if usn:
        hits = [s for s in students if (s.usn or "").upper() == usn]
        if len(hits) == 1:
            return MatchResult("matched", "usn", Candidate(hits[0].id, hits[0].usn, hits[0].name))
        return MatchResult("unmatched", None, reason=f"USN {usn} is not in this batch")

    source_keys = _name_keys(source_name)
    if not source_keys:
        return MatchResult("unmatched", None, reason="No name given")

    exact = [s for s in students if source_keys & _name_keys(s.name)]
    if len(exact) == 1:
        return MatchResult("matched", "exact_name", Candidate(exact[0].id, exact[0].usn, exact[0].name))
    if len(exact) > 1:
        return MatchResult(
            "ambiguous", "exact_name",
            candidates=[Candidate(s.id, s.usn, s.name) for s in exact],
            reason="More than one student has this exact name",
        )

    source_words = _words(source_name)
    source_tokens = normalize_name(source_name).split()
    if not source_words:
        return MatchResult("unmatched", None, reason="Name has initials only")
    first = source_words[0]

    # Only a first name was given ("Maansi"). That can identify a person only
    # by elimination, which is a guess — so it is never imported automatically,
    # even when a single student carries that first name.
    if len(source_tokens) == 1:
        same_first = []
        for s in students:
            # any word, not just the leading one: rosters sometimes put the surname first
            best = max((similarity(first, w) for w in _words(s.name)), default=0.0)
            if best >= FUZZY_THRESHOLD:
                same_first.append(Candidate(s.id, s.usn, s.name, round(best, 2)))
        same_first.sort(key=lambda c: -c.score)
        if same_first:
            return MatchResult(
                "ambiguous", "first_name_only", candidates=same_first,
                reason="Only a first name was given — full name or USN needed",
            )
        # Spelling variants that fall short of the bar ("Tejashri" / "Tejashree")
        # are shown as hints only.
        near = []
        for s in students:
            best = max((similarity(first, w) for w in _words(s.name)), default=0.0)
            if best >= HINT_THRESHOLD:
                near.append(Candidate(s.id, s.usn, s.name, round(best, 2)))
        near.sort(key=lambda c: -c.score)
        return MatchResult("unmatched", None, candidates=near[:5],
                           reason="Only a first name was given and no student has it")

    fuzzy = []
    for s in students:
        score = similarity(source_name, s.name)
        if score >= FUZZY_THRESHOLD and first in _words(s.name):
            fuzzy.append(Candidate(s.id, s.usn, s.name, round(score, 2)))
    fuzzy.sort(key=lambda c: -c.score)
    if len(fuzzy) == 1:
        return MatchResult("matched", "fuzzy", fuzzy[0])
    if len(fuzzy) > 1:
        return MatchResult("ambiguous", "fuzzy", candidates=fuzzy, reason="More than one similar name")

    # Nothing cleared the bar. Show same-first-name students as a hint for the
    # person resolving it; none of them is imported.
    hints = [Candidate(s.id, s.usn, s.name, round(similarity(source_name, s.name), 2))
             for s in students if first in _words(s.name)]
    hints.sort(key=lambda c: -c.score)
    return MatchResult("unmatched", None, candidates=hints, reason="No student name is close enough")
