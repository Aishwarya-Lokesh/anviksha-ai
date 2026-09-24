"""
Tags each real question-bank chunk with a Bloom's Taxonomy level, difficulty,
and marks value — replacing the previous cosmetic-only labels on the
Question Paper Generator with something that actually reflects the content.

Two-tier, honest approach — tag_source records which was used:

1. EXTRACTED (highest confidence): some real source PDFs already print the
   Bloom's Taxonomy level explicitly (e.g. a "BT Level" column showing
   "Understand", "Apply", etc. next to each question). Where this literal
   text is present, we extract it directly — no inference involved.

2. INFERRED (documented heuristic, not fabricated): where no explicit level
   is printed, we classify based on the real action verb used in the
   question text, using the standard, well-established Bloom's Taxonomy
   verb classification taught in pedagogy — e.g. "define/list/state" =
   Remember, "illustrate/demonstrate/solve" = Apply, "analyze/differentiate"
   = Analyze. This is real, citable pedagogical framework, not a guess — but
   it IS an inference, and is labeled as such, never presented as extracted.

3. UNKNOWN: chunks with neither a printed level nor a recognizable action
   verb (e.g. pure document headers/metadata) are left untagged rather than
   forced into a guess.

Difficulty is derived from the real marks value when present in the text
(e.g. "5 Marks", "10M") — higher real marks per question = harder, a
reasonable, transparent proxy — never assigned independently of real data.

Usage:
    python scripts/tag_question_bank.py
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.core.database import SessionLocal
from app.models.models import QuestionBankChunk
from app.core.bloom_classify import classify_bloom, classify_difficulty


def main():
    db = SessionLocal()
    chunks = db.query(QuestionBankChunk).all()

    counts = {"extracted": 0, "inferred": 0, "unknown": 0}
    for c in chunks:
        bloom, source = classify_bloom(c.text)
        difficulty, marks = classify_difficulty(c.text)
        c.bloom_level = bloom
        c.tag_source = source
        c.difficulty = difficulty
        c.marks = marks
        counts[source] += 1

    db.commit()
    print(f"Tagged {len(chunks)} real question-bank chunks.")
    print(f"  Extracted (real BT Level found in source PDF): {counts['extracted']}")
    print(f"  Inferred (classified from real action verbs): {counts['inferred']}")
    print(f"  Unknown (neither applied — left untagged): {counts['unknown']}")
    db.close()


if __name__ == "__main__":
    main()
