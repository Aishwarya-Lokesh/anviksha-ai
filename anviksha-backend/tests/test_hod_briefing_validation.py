"""Phase 6: AI Department Briefing — pure unit tests for the post-generation
validation logic (numeric grounding + no-ranking-language), independent of
whether Groq is actually configured in this environment."""
from app.core.hod_metrics import _numbers_in, _validate_generated_numbers, _validate_no_judgmental_language


def test_numbers_in_extracts_from_mixed_types():
    facts = {"count": 3, "pct": 74.1, "explanation": "16 real faculty member(s), 60 subjects"}
    allowed = _numbers_in(*facts.values())
    assert 3 in allowed
    assert 74.1 in allowed
    assert 16 in allowed
    assert 60 in allowed


def test_validate_generated_numbers_accepts_real_numbers():
    allowed = _numbers_in(3, 16, 60, "1 pending alert")
    text = "The department has 16 faculty teaching 60 subjects, with 1 pending alert and 3 at-risk students."
    assert _validate_generated_numbers(text, allowed) is True


def test_validate_generated_numbers_rejects_fabricated_number():
    allowed = _numbers_in(3, 16, 60)
    text = "The department has 16 faculty teaching 60 subjects, with 42 at-risk students."  # 42 is fabricated
    assert _validate_generated_numbers(text, allowed) is False


def test_validate_no_judgmental_language_rejects_ranking_words():
    assert _validate_no_judgmental_language("This is the best faculty member in the department.") is False
    assert _validate_no_judgmental_language("Dr. Smith outperformed everyone else this term.") is False
    assert _validate_no_judgmental_language("Dr. Smith has recorded 2 real sessions and 1 open alert.") is True
