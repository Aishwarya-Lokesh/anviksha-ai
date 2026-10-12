"""Question Paper Generator - builds real exam papers from a teacher's own
uploaded Important Questions bank, grounded against their uploaded Subject
Notes, rather than fabricating questions from nothing.

Pipeline: parse candidate questions out of the real uploaded Important
Questions document -> tag each with a real Bloom's level (same classifier
used on the real IA question bank) -> for each question slot the teacher
configured in the paper structure, pick the best real matching candidate
-> only when the teacher's own real material genuinely has no matching
candidate left does an LLM complete that single slot, grounded in the real
uploaded notes, and that fact is recorded (never silently blended in as if
it were extracted).
"""
import re

from app.core.bloom_classify import classify_bloom

_LINE_NUMBERING_RE = re.compile(r"^\s*(?:Q\.?\s*)?\d+\s*[.)]\s*|^\s*[a-hA-H]\s*[.)]\s*")
_INLINE_MARKS_RE = re.compile(r"\(?\b(\d{1,2})\s*(?:marks?|m)\b\)?", re.IGNORECASE)
_INLINE_TAG_RE = re.compile(r"\b(CO\d|Module\s*\d)\b", re.IGNORECASE)
_BRACKETS_RE = re.compile(r"[\[\](){}]")
_WORD_RE = re.compile(r"[a-z]{4,}")

# Real question-paper documents (and the real question bank they're chunked
# from) contain administrative boilerplate alongside real questions -
# department/faculty headers, signatures, exam metadata, course-outcome
# listings. None of these are real questions; letting them through would
# put nonsense like "Faculty signature HOD/ISE" on a real exam paper.
_ADMIN_LINE_RE = re.compile(
    r"department of|faculty name|subject name|semester\s*:|^\s*sem\s*[:.]|time\s*:|date\s*:|total marks|"
    r"instructions to|course outcomes|faculty signature|review committee|"
    r"asst\.?\s*professor|assoc\.?\s*professor|dept\.?\s*of|^\s*hod\b|internal assessment|"
    r"odd sem|even sem|answer any|max(?:imum)? marks",
    re.IGNORECASE,
)
_STOPWORDS = {
    "this", "that", "with", "from", "have", "which", "explain", "describe",
    "discuss", "define", "compare", "write", "about", "their", "there",
    "what", "list", "give", "state", "short", "note", "notes",
}


def parse_candidate_questions(text: str) -> list[dict]:
    """Real candidate exam questions extracted line-by-line from an uploaded
    Important Questions document. Each candidate keeps whatever marks/CO
    hint was actually printed next to it, plus a real Bloom's classification.
    Never invents a question - only ever returns text that was literally in
    the source document."""
    candidates, seen = [], set()
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or len(line) < 12:
            continue
        if _ADMIN_LINE_RE.search(line):
            continue
        stripped = _LINE_NUMBERING_RE.sub("", line).strip()
        if len(stripped) < 12:
            continue
        marks_match = _INLINE_MARKS_RE.search(stripped)
        marks_hint = int(marks_match.group(1)) if marks_match else None
        tag_match = _INLINE_TAG_RE.search(stripped)
        co_hint = re.sub(r"\s+", " ", tag_match.group(1)).upper() if tag_match else None
        clean = _INLINE_MARKS_RE.sub("", stripped)
        clean = _INLINE_TAG_RE.sub("", clean)
        clean = _BRACKETS_RE.sub("", clean).strip(" -:.")
        if len(clean) < 12 or clean.lower() in seen:
            continue
        # Rows lifted out of a marks or mapping table ("similarity  5  1,2,3  Apply")
        # contain an action verb but are not questions: they are mostly numbers
        # and have too few words to be a sentence.
        words = re.findall(r"[A-Za-z]{2,}", clean)
        number_tokens = re.findall(r"(?<![A-Za-z])\d+(?:[.,]\d+)*(?![A-Za-z])", clean)
        if len(words) < 4 or len(number_tokens) > len(words) / 2:
            continue
        bloom_level, tag_source = classify_bloom(clean)
        # Require a real signal that this line is actually a question -
        # either a recognized Bloom's action verb or an explicit "?" -
        # otherwise short administrative fragments (names, dates, signature
        # blocks) that dodge the denylist above still get excluded.
        if bloom_level is None and not clean.rstrip().endswith("?"):
            continue
        seen.add(clean.lower())
        candidates.append({
            "text": clean, "marks_hint": marks_hint, "co_hint": co_hint,
            "bloom_level": bloom_level, "tag_source": tag_source,
        })
    return candidates


# Difficulty follows the Bloom's level a question sits at: recall and
# understanding are the easy end, application and analysis the middle,
# evaluation and creation the hard end.
DIFFICULTY_BY_BLOOM = {
    "Remember": "Easy", "Understand": "Easy",
    "Apply": "Medium", "Analyze": "Medium",
    "Evaluate": "Hard", "Create": "Hard",
}


def difficulty_of(bloom_level) -> str:
    return DIFFICULTY_BY_BLOOM.get(bloom_level or "", "Unclassified")


def replacement_question(spec: dict, pool: list[dict], exclude_texts: set, notes_text: str, important_text: str) -> dict:
    """One fresh question for a single slot of an existing paper: the best
    source question not already on the paper, or — only when none is left —
    one written by the AI from the uploaded notes."""
    from app.core.llm_client import generate_paper_question

    question_type = spec.get("question_type", "Any")
    marks, co = spec.get("marks", 0), spec.get("co", "")
    normalized_exclude = {_normalize(t) for t in exclude_texts}
    remaining = [c for c in pool if _normalize(c["text"]) not in normalized_exclude]
    candidate = next((c for c in remaining if question_type == "Any" or c["bloom_level"] == question_type), None) \
        or next(iter(remaining), None)
    base = {"marks": marks, "co": co, "or_after": bool(spec.get("or_after"))}
    if candidate:
        level = candidate["bloom_level"] or question_type
        return {**base, "question": candidate["text"], "source": "extracted", "grounded": True,
                "bloom_level": level, "tag_source": candidate["tag_source"], "difficulty": difficulty_of(level)}
    result = generate_paper_question(question_type, marks, co, notes_text or important_text)
    if result.get("question") and _normalize(result["question"]) not in normalized_exclude:
        return {**base, "question": result["question"], "source": "ai_generated", "connected": result.get("connected", False),
                "grounded": is_grounded_in_notes(result["question"], notes_text),
                "bloom_level": question_type, "tag_source": "ai_generated", "difficulty": difficulty_of(question_type)}
    return {}


def _keywords(text: str) -> set:
    return {w for w in _WORD_RE.findall(text.lower()) if w not in _STOPWORDS}


def is_grounded_in_notes(question_text: str, notes_text: str) -> bool:
    """A lightweight, honest grounding check: does this question share real
    content words with the teacher's own uploaded notes? Not a guarantee of
    correctness, but a real signal, not merely asserted."""
    if not notes_text:
        return False
    q_words = _keywords(question_text)
    if not q_words:
        return False
    notes_words = _keywords(notes_text)
    overlap = q_words & notes_words
    return len(overlap) / len(q_words) >= 0.3


def _pick_candidate(pool: list[dict], used_this_set: set, avoid_other_set: set, question_type: str):
    """Tiered real-question selection, strongest match first: real + unused
    anywhere + right Bloom's level, then real + unused anywhere (any
    level), then real + already used in the sibling set but right level,
    then real + already used in the sibling set (any level). Never returns
    a question already used earlier in THIS set. Only when every real
    candidate is exhausted does the caller fall back to an AI-completed
    slot - a repeated real question is still more grounded than a
    fabricated one."""
    def matches(c):
        return question_type == "Any" or c["bloom_level"] == question_type

    tiers = [
        lambda c: c["text"] not in used_this_set and c["text"] not in avoid_other_set and matches(c),
        lambda c: c["text"] not in used_this_set and c["text"] not in avoid_other_set,
        lambda c: c["text"] not in used_this_set and matches(c),
        lambda c: c["text"] not in used_this_set,
    ]
    for tier_index, predicate in enumerate(tiers):
        for c in pool:
            if predicate(c):
                return c, tier_index >= 2
    return None, False


def _build_one_set(structure: list[dict], pool: list[dict], notes_text: str, used_this_set: set, avoid_other_set: set, important_text: str):
    from app.core.llm_client import generate_paper_question, paraphrase_question

    parts = []
    for part in structure:
        questions = []
        for spec in part.get("questions", []):
            question_type = spec.get("question_type", "Any")
            marks = spec.get("marks", 0)
            co = spec.get("co", "")
            candidate, reused = _pick_candidate(pool, used_this_set, avoid_other_set, question_type)
            if candidate:
                used_this_set.add(candidate["text"])
                question_text, source = candidate["text"], "extracted"
                if reused:
                    # Same real underlying question already used in the other
                    # set — reword it via the LLM rather than showing
                    # identical text twice; fall back to the verbatim real
                    # question (still honest, still real) if the AI can't.
                    result = paraphrase_question(candidate["text"])
                    if result.get("question"):
                        question_text, source = result["question"], "paraphrased"
                questions.append({
                    "question": question_text, "marks": marks, "co": co,
                    "or_after": bool(spec.get("or_after")),
                    "source": source, "grounded": True, "reused_from_other_set": reused,
                    "bloom_level": candidate["bloom_level"] or question_type, "tag_source": candidate["tag_source"],
                    "difficulty": difficulty_of(candidate["bloom_level"] or question_type),
                })
            else:
                result = generate_paper_question(question_type, marks, co, notes_text or important_text)
                if result.get("question"):
                    questions.append({
                        "question": result["question"], "marks": marks, "co": co,
                        "or_after": bool(spec.get("or_after")),
                        "source": "ai_generated", "connected": result.get("connected", False),
                        "grounded": is_grounded_in_notes(result["question"], notes_text),
                        "bloom_level": question_type, "tag_source": "ai_generated",
                        "difficulty": difficulty_of(question_type),
                    })
                else:
                    questions.append({
                        "question": "",
                        "marks": marks, "co": co, "or_after": bool(spec.get("or_after")),
                        "source": "missing", "grounded": False,
                        "bloom_level": question_type, "tag_source": "missing",
                        "difficulty": difficulty_of(question_type),
                    })
        parts.append({"name": part.get("name", "PART"), "questions": questions})
    return parts


def _normalize(text: str) -> str:
    return re.sub(r"[^a-z0-9 ]", "", text.lower()).strip()


def validate_paper(parts: list[dict], settings: dict) -> dict:
    all_qs = [q for part in parts for q in part["questions"]]
    normalized = [_normalize(q["question"]) for q in all_qs]
    duplicate_count = len(normalized) - len(set(normalized))
    total_marks_generated = sum(q.get("marks", 0) for q in all_qs)
    total_marks_configured = settings.get("total_marks", 0)
    extracted_count = sum(1 for q in all_qs if q["source"] == "extracted")
    paraphrased_count = sum(1 for q in all_qs if q["source"] == "paraphrased")
    reused_count = sum(1 for q in all_qs if q.get("reused_from_other_set"))
    ai_generated_count = sum(1 for q in all_qs if q["source"] == "ai_generated")
    missing_count = sum(1 for q in all_qs if q["source"] == "missing")
    ungrounded_count = sum(1 for q in all_qs if not q.get("grounded"))
    bloom_distribution: dict = {}
    difficulty_mix: dict = {}
    co_marks: dict = {}
    for q in all_qs:
        level = q.get("bloom_level") or "Unknown"
        bloom_distribution[level] = bloom_distribution.get(level, 0) + 1
        difficulty = difficulty_of(q.get("bloom_level"))
        difficulty_mix[difficulty] = difficulty_mix.get(difficulty, 0) + 1
        co = (q.get("co") or "Unmapped").strip() or "Unmapped"
        co_marks[co] = co_marks.get(co, 0) + (q.get("marks") or 0)

    warnings = []
    if duplicate_count:
        warnings.append(f"{duplicate_count} duplicate question(s) detected within this paper.")
    if total_marks_configured and total_marks_generated != total_marks_configured:
        warnings.append(f"Configured question marks ({total_marks_generated}) do not match the paper's stated total marks ({total_marks_configured}).")
    if missing_count:
        warnings.append(f"{missing_count} question(s) could not be filled: the source files do not have enough questions. Type them in, or upload more source questions.")
    if ai_generated_count:
        warnings.append(f"{ai_generated_count} question(s) were written by the AI from your notes because the source files had no matching question. Review them before use.")
    if paraphrased_count:
        warnings.append(f"{paraphrased_count} question(s) were reworded by the AI so the two sets do not repeat the same wording.")
    if reused_count and not paraphrased_count:
        warnings.append(f"{reused_count} question(s) also appear in the other set, because the source files did not have enough different questions.")

    return {
        "total_marks_configured": total_marks_configured,
        "total_marks_generated": total_marks_generated,
        "marks_match": total_marks_generated == total_marks_configured,
        "duplicate_count": duplicate_count,
        "questions_total": len(all_qs),
        "questions_extracted": extracted_count,
        "questions_paraphrased": paraphrased_count,
        "questions_reused_from_other_set": reused_count,
        "questions_ai_generated": ai_generated_count,
        "questions_missing": missing_count,
        "questions_ungrounded": ungrounded_count,
        "bloom_distribution": bloom_distribution,
        "difficulty_mix": difficulty_mix,
        "co_marks": dict(sorted(co_marks.items())),
        "sections": len(parts),
        "warnings": warnings,
    }


def generate_paper_sets(settings: dict, notes_text: str, important_text: str) -> dict:
    """Builds Set A and Set B from the same real Important Questions pool,
    each validated independently. Set B strongly prefers questions Set A
    didn't use; it only reuses a real question (flagged honestly in
    validation) when the uploaded pool is too small to stay fully distinct,
    and only fabricates a question when the real pool has nothing left at
    all for that slot."""
    structure = settings.get("structure", [])
    pool = parse_candidate_questions(important_text)

    used_a: set = set()
    set_a = _build_one_set(structure, pool, notes_text, used_a, set(), important_text)

    used_b: set = set()
    set_b = _build_one_set(structure, pool, notes_text, used_b, used_a, important_text)

    return {
        "set_a": set_a, "set_b": set_b,
        "validation": {
            "set_a": validate_paper(set_a, settings),
            "set_b": validate_paper(set_b, settings),
            "candidate_questions_found": len(pool),
        },
    }
