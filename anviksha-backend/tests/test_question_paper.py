"""Question Paper Generator: papers are built from the teacher's own source
questions, one question can be swapped without regenerating, and a teacher
only ever sees their own files and papers. The AI is switched off here, so
every question in these tests comes from the source text."""
import pytest

from app.models import models as m
from tests.test_missing_endpoints import campus  # noqa: F401  (shared fixture)

SOURCE = """
1. Explain the layered architecture of the OSI reference model. (10 marks) CO1
2. Define latency and throughput in a computer network. (5 marks) CO1
3. Compare circuit switching with packet switching. (10 marks) CO2
4. Apply the sliding window protocol to a lossy channel and trace the frames. (10 marks) CO2
5. Analyze the congestion control behaviour of TCP Reno. (10 marks) CO3
6. Evaluate the suitability of UDP for real-time video streaming. (5 marks) CO3
7. Design a subnetting scheme for a campus with four departments. (10 marks) CO4
8. List the fields of an IPv4 header. (5 marks) CO4
Department of Information Science
Faculty signature
"""

STRUCTURE = [
    {"name": "PART A", "questions": [{"question_type": "Understand", "marks": 10, "co": "CO1"}, {"question_type": "Remember", "marks": 5, "co": "CO1", "or_after": True}]},
    {"name": "PART B", "questions": [{"question_type": "Apply", "marks": 10, "co": "CO2"}, {"question_type": "Analyze", "marks": 10, "co": "CO3"}]},
]
SETTINGS = {"subject_name": "Computer Networks", "total_marks": 35, "structure": STRUCTURE}


@pytest.fixture()
def sources(campus, monkeypatch):  # noqa: F811
    monkeypatch.setattr("app.core.llm_client.is_configured", lambda: False)   # no AI: source questions only
    db = campus["db"]
    mine = m.QuestionPaperDocument(faculty_id=campus["t1"].id, kind="important_questions", filename="cn questions.pdf", stored_filename="q1.pdf", extracted_text=SOURCE)
    notes = m.QuestionPaperDocument(faculty_id=campus["t1"].id, kind="notes", filename="cn notes.pdf", stored_filename="n1.pdf", extracted_text="OSI layers, TCP congestion control, sliding window protocol, subnetting.")
    theirs = m.QuestionPaperDocument(faculty_id=campus["t2"].id, kind="important_questions", filename="other.pdf", stored_filename="q2.pdf", extracted_text="1. Explain normalization in databases. (10 marks)")
    db.add_all([mine, notes, theirs])
    db.commit()
    return {**campus, "mine": mine, "notes": notes, "theirs": theirs}


def _generate(client, s, **over):
    body = {"settings": SETTINGS, "note_ids": [s["notes"].id], "important_question_ids": [s["mine"].id], **over}
    return client.post("/teacher/question-paper/generate", headers=s["h"]["t1"], json=body)


def test_generates_two_sets_from_the_source_questions(client, sources):
    r = _generate(client, sources)
    assert r.status_code == 200, r.text
    d = r.json()
    a = [q["question"] for part in d["set_a"] for q in part["questions"]]
    b = [q["question"] for part in d["set_b"] for q in part["questions"]]
    assert len(a) == len(b) == 4 and all(a) and all(b)
    assert not set(a) & set(b)                                             # 8 source questions: enough for two different sets
    assert all(q in SOURCE for q in a + b)                                 # nothing invented
    assert "Faculty signature" not in " ".join(a + b)                      # headers and signatures are never questions
    first = d["set_a"][0]["questions"][0]
    assert (first["bloom_level"], first["difficulty"], first["marks"], first["co"], first["source"]) == ("Understand", "Easy", 10, "CO1", "extracted")
    v = d["validation"]["set_a"]
    assert v["marks_match"] and v["total_marks_generated"] == 35 and v["duplicate_count"] == 0
    assert v["co_marks"] == {"CO1": 15, "CO2": 10, "CO3": 10}
    assert sum(v["difficulty_mix"].values()) == 4 and v["difficulty_mix"]["Easy"] == 2
    assert d["validation"]["candidate_questions_found"] == 8


def test_needs_a_source_and_a_structure(client, sources):
    assert _generate(client, sources, important_question_ids=[]).status_code == 400     # no upload, nothing in the bank
    assert _generate(client, sources, settings={**SETTINGS, "structure": []}).status_code == 400
    # another teacher's file cannot be used as a source
    assert _generate(client, sources, important_question_ids=[sources["theirs"].id]).status_code == 400
    assert client.post("/teacher/question-paper/generate", headers=sources["h"]["s1"], json={"settings": SETTINGS}).status_code == 403


def test_department_question_bank_is_enough_without_an_upload(client, sources):
    db = sources["db"]
    db.add(m.QuestionBankChunk(subject_folder="Computer Networks", source_file="ia1.docx", file_type="docx", chunk_index=0, text=SOURCE))
    db.commit()
    r = _generate(client, sources, important_question_ids=[], note_ids=[])
    assert r.status_code == 200 and r.json()["sources"] == {"uploaded_question_files": 0, "notes_files": 0, "question_bank_chunks": 1}
    assert all(q["question"] for part in r.json()["set_a"] for q in part["questions"])


def test_replace_one_question_without_regenerating(client, sources):
    d = _generate(client, sources).json()
    on_paper = [q["question"] for key in ("set_a", "set_b") for part in d[key] for q in part["questions"]]
    body = {"settings": SETTINGS, "note_ids": [sources["notes"].id], "important_question_ids": [sources["mine"].id],
            "spec": {"question_type": "Any", "marks": 10, "co": "CO2"}, "exclude": on_paper}
    assert client.post("/teacher/question-paper/replace-question", headers=sources["h"]["t1"], json=body).status_code == 409   # all 8 are on the paper

    body["exclude"] = on_paper[:7]
    r = client.post("/teacher/question-paper/replace-question", headers=sources["h"]["t1"], json=body)
    assert r.status_code == 200, r.text
    q = r.json()
    assert q["question"] == on_paper[7] and q["question"] not in body["exclude"]
    assert (q["marks"], q["co"], q["source"]) == (10, "CO2", "extracted") and q["difficulty"] in ("Easy", "Medium", "Hard")

    body["important_question_ids"] = [sources["theirs"].id]           # someone else's file contributes nothing
    body["exclude"] = []
    assert client.post("/teacher/question-paper/replace-question", headers=sources["h"]["t1"], json=body).status_code == 409


def test_source_files_and_saved_papers_are_private_to_the_teacher(client, sources):
    h = sources["h"]
    docs = client.get("/teacher/question-paper/documents", headers=h["t1"]).json()
    assert sorted(d["filename"] for d in docs) == ["cn notes.pdf", "cn questions.pdf"]
    assert [d["filename"] for d in client.get("/teacher/question-paper/documents", headers=h["t2"]).json()] == ["other.pdf"]
    assert client.delete(f"/teacher/question-paper/documents/{sources['theirs'].id}", headers=h["t1"]).status_code == 404

    d = _generate(client, sources).json()
    edited = d["set_a"]
    edited[0]["questions"][0]["question"] = "Explain the OSI model with a neat diagram."          # a teacher's own edit
    saved = client.post("/teacher/question-paper/save", headers=h["t1"], json={"title": "CN IA-1", "set_label": "A", "settings": {**SETTINGS, "exam_name": "Internal Assessment 1"}, "paper": edited, "validation": d["validation"]}).json()
    listing = client.get("/teacher/question-paper", headers=h["t1"]).json()
    assert [(p["title"], p["set_label"], p["total_marks"], p["questions"], p["exam_name"]) for p in listing] == [("CN IA-1", "A", 35, 4, "Internal Assessment 1")]
    assert listing[0]["created_at"]
    reopened = client.get(f"/teacher/question-paper/{saved['id']}", headers=h["t1"]).json()
    assert reopened["set_a"][0]["questions"][0]["question"] == "Explain the OSI model with a neat diagram."   # the edit was kept
    assert client.get("/teacher/question-paper", headers=h["t2"]).json() == []
    assert client.get(f"/teacher/question-paper/{saved['id']}", headers=h["t2"]).status_code == 404
    assert client.delete(f"/teacher/question-paper/{saved['id']}", headers=h["t2"]).status_code == 404
    assert client.delete(f"/teacher/question-paper/documents/{sources['mine'].id}", headers=h["t1"]).status_code == 200


def test_bank_folder_matching_never_relies_on_a_common_word():
    from app.routers.question_paper import match_bank_folder
    folders = ["BCS501", "BPOPS103", "CNS_IA_QP", "FSD", "IA_QP_old", "ML_IA_QP", "OOPs_Java_QP", "Programming in C", "Python"]
    assert match_bank_folder("Python Programming", "", folders) == "Python"            # not "Programming in C"
    assert match_bank_folder("Programming in C", "", folders) == "Programming in C"
    assert match_bank_folder("Machine Learning", "", folders) == "ML_IA_QP"            # folder named by initials
    assert match_bank_folder("Software Engineering", "BCS501", folders) == "BCS501"    # by subject code
    assert match_bank_folder("Full Stack Development", "", folders) == "FSD"
    assert match_bank_folder("Computer Networks", "", folders) is None                 # "CN" is not "CNS"
    assert match_bank_folder("Advanced Programming", "", folders) is None
    assert match_bank_folder("", "", folders) is None


def test_table_rows_and_fragments_are_not_questions():
    from app.core.question_paper_gen import parse_candidate_questions
    text = """
    similarity  5   1,2,3  Apply
    1 a  10  CO2  L3  Analyze
    Explain the working of a decision tree with an example. 10 marks CO2
    Apply the k-means algorithm to the points (2,3), (4,5) and (7,8) with k = 2.
    """
    found = [c["text"] for c in parse_candidate_questions(text)]
    assert found == ["Explain the working of a decision tree with an example", "Apply the k-means algorithm to the points 2,3, 4,5 and 7,8 with k = 2"]
