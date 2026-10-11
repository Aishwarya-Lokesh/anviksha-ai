"""Name -> student matching for placement imports: a row is attached to a
student only when exactly one student fits."""
from types import SimpleNamespace

from app.core.placement_matching import canonical_company, match_student, similarity

STUDENTS = [
    SimpleNamespace(id=1, usn="4XX23IS001", name="ANITA R K"),
    SimpleNamespace(id=2, usn="4XX23IS002", name="MEERA SHANKAR B"),
    SimpleNamespace(id=3, usn="4XX23IS003", name="PRIYA M"),
    SimpleNamespace(id=4, usn="4XX23IS004", name="PRIYA N"),
    SimpleNamespace(id=5, usn="4XX23IS005", name="KAVYASHREE GOWDA"),
    SimpleNamespace(id=6, usn="4XX23IS006", name="DIVYA S"),
    SimpleNamespace(id=7, usn="4XX23IS007", name="TEJASHREE P"),
]


def test_usn_wins_over_name():
    result = match_student("Someone Else", "4xx23is002", STUDENTS)
    assert (result.status, result.method, result.student.student_id) == ("matched", "usn", 2)


def test_unknown_usn_is_never_matched_by_name_instead():
    result = match_student("Anita R K", "4XX23IS999", STUDENTS)
    assert result.status == "unmatched"


def test_initials_match_in_any_form_and_order():
    for spelling in ("Anita R K", "anita r.k.", "Anita RK", "K R Anita", "Anita K R"):
        result = match_student(spelling, None, STUDENTS)
        assert (result.status, result.method, result.student.student_id) == ("matched", "exact_name", 1), spelling


def test_different_initials_do_not_match_exactly():
    assert match_student("Priya K", None, STUDENTS).method != "exact_name"


def test_fuzzy_needs_similarity_and_same_first_name():
    result = match_student("Meera Shankar", None, STUDENTS)
    assert (result.status, result.method, result.student.student_id) == ("matched", "fuzzy", 2)
    assert match_student("Shankar Meera Rao Kulkarni", None, STUDENTS).status == "unmatched"


def test_first_name_only_is_never_imported_even_with_one_candidate():
    result = match_student("Divya", None, STUDENTS)
    assert result.status == "ambiguous" and result.student is None
    assert [c.student_id for c in result.candidates] == [6]


def test_first_name_shared_by_two_students_lists_both():
    result = match_student("Priya", None, STUDENTS)
    assert result.status == "ambiguous"
    assert sorted(c.student_id for c in result.candidates) == [3, 4]


def test_near_miss_spelling_is_a_hint_not_a_match():
    result = match_student("Tejashri", None, STUDENTS)
    assert result.status == "unmatched" and result.student is None
    assert [c.student_id for c in result.candidates] == [7]


def test_no_match_at_all():
    result = match_student("Zoya Fernandes", None, STUDENTS)
    assert result.status == "unmatched" and result.candidates == []


def test_similarity_matches_pg_trgm_reference_values():
    # select similarity('word', 'two words') -> 0.363636 in the pg_trgm docs
    assert round(similarity("word", "two words"), 6) == 0.363636
    assert similarity("anita", "ANITA") == 1.0


def test_company_spellings_collapse_to_one_name():
    assert canonical_company("DELL")[0] == canonical_company("Dell Technologies")[0] == "Dell"
    assert canonical_company("  mindsprint   digital ")[0] == "Mindsprint"
    assert canonical_company("Acme  Systems")[0] == "Acme Systems"
    assert canonical_company("ACME systems")[1] == canonical_company("Acme Systems")[1]
