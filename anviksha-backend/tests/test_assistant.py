"""The assistant: lookups are limited by role and by owner, the conversation
loop runs them and streams the reply, and conversations are private. The
language model is replaced by a scripted stand-in, so these tests check the
plumbing and the access rules, not the model's wording."""
import json

import pytest

from app.core import assistant, assistant_tools
from app.models import models as m
from tests.conftest import auth_headers
from tests.test_missing_endpoints import campus, placed  # noqa: F401  (shared fixtures)


def _user(db, email):
    return db.query(m.User).filter(m.User.email == email).one()


def _run(db, user, name, **args):
    result, _ = assistant_tools.run_tool(db, user, name, json.dumps(args))
    return json.loads(result)


# ---------- lookups: scope ----------

def test_each_role_only_has_its_own_lookups(placed):  # noqa: F811
    db = placed["db"]
    student, teacher = _user(db, "s1@test.local"), _user(db, "t1@test.local")
    names = lambda role: {t["spec"]["function"]["name"] for t in assistant_tools.tools_for(role)}  # noqa: E731
    assert "d_placed_students" in names("hod") and "d_placed_students" not in names("student") | names("teacher")
    assert "a_platform" in names("admin") and "a_platform" not in names("hod")
    # asking for a lookup outside the role is refused, whatever the model sends
    assert "not available" in _run(db, student, "d_placed_students")["error"]
    assert "not available" in _run(db, teacher, "d_faculty_feedback", faculty_name="Teacher Two")["error"]
    assert "not available" in _run(db, student, "t_students")["error"]


def test_student_lookups_return_only_their_own_records(placed):  # noqa: F811
    db = placed["db"]
    s1, s3 = _user(db, "s1@test.local"), _user(db, "s3@test.local")
    mine = _run(db, s1, "s_placements")
    assert sorted(o["company"] for o in mine["placements"]) == ["Acme", "Globex"] and mine["internships"][0]["stipend_per_month"] == 75000
    assert _run(db, s3, "s_placements") == {"placements": [], "internships": []}
    academics = _run(db, s1, "s_academics")
    assert (academics["usn"], academics["cgpa"], academics["rank_in_batch"], academics["profile_score"]) == ("T23IS001", 8.5, 1, 800)
    batch = _run(db, s1, "s_batch_placements")
    assert batch["stats"]["placed"] == 1 and "Bina" not in json.dumps(batch) and "T23IS002" not in json.dumps(batch)   # totals only, no classmates
    # an argument cannot redirect a lookup at somebody else
    assert _run(db, s3, "s_academics", usn="T23IS001", student_id=placed["s1"].id)["usn"] == "T24IS001"


def test_teacher_and_hod_lookups_stay_in_their_scope(placed):  # noqa: F811
    db = placed["db"]
    t1, t2 = _user(db, "t1@test.local"), _user(db, "t2@test.local")
    assert sorted(s["usn"] for s in _run(db, t1, "t_students")["students"]) == ["T23IS001", "T23IS002"]
    assert [s["usn"] for s in _run(db, t2, "t_students")["students"]] == ["T24IS001"]
    assert _run(db, t1, "t_students", which="top", limit=1)["students"][0]["usn"] == "T23IS001"
    assert [o["company"] for o in _run(db, t2, "t_placements")["offers"]] == []

    hod, hod_cse = _user(db, "hod@test.local"), _user(db, "hod.cse@test.local")
    offers = _run(db, hod, "d_placed_students", batch="2023")
    assert [(o["usn"], o["company"], o["package_lpa"]) for o in offers["offers"]] == [("T23IS001", "Globex", 22.0), ("T23IS001", "Acme", 5.2)]   # declined offer excluded
    assert [o["usn"] for o in _run(db, hod_cse, "d_placed_students")["offers"]] == ["T23CS001"]
    assert _run(db, hod, "d_find_student", query="Esha")["matching"] == 0            # other department's student
    assert [c["company"] for c in _run(db, hod, "d_company_stats", company="glob")["companies"]] == ["Globex"]
    stats = {b["batch"]: b for b in _run(db, hod, "d_batch_placements")["batches"]}
    assert (stats["2023"]["placed"], stats["2023"]["highest_ctc_lpa"], stats["2023"]["ppo_count"]) == (1, 22.0, 1)

    admin = m.User(email="admin@test.local", hashed_password="x", role="admin")
    db.add(admin)
    db.commit()
    assert sorted(o["usn"] for o in _run(db, admin, "d_placed_students", min_package_lpa=20)["offers"]) == ["T23CS001", "T23IS001"]
    assert _run(db, admin, "a_platform")["students"] == 5


def test_a_failing_lookup_is_reported_not_raised(placed, monkeypatch):  # noqa: F811
    def boom(db, user, **_):
        raise RuntimeError("database fell over")
    tool = next(t for t in assistant_tools.TOOLS["student"] if t["spec"]["function"]["name"] == "s_attendance")
    monkeypatch.setitem(tool, "fn", boom)
    assert "unavailable" in _run(placed["db"], _user(placed["db"], "s1@test.local"), "s_attendance")["error"]


# ---------- the conversation loop ----------

@pytest.fixture()
def scripted(monkeypatch):
    """Stand-in for the model: first asks for a lookup, then answers using it."""
    seen = {"rounds": []}

    def fake_stream(messages, tools):
        seen["rounds"].append({"messages": messages, "tool_names": [t["function"]["name"] for t in tools]})
        tool_results = [msg for msg in messages if msg["role"] == "tool"]
        if not tool_results:
            yield "tool_calls", [{"id": "call_1", "name": seen.get("ask", "s_placements"), "arguments": json.dumps(seen.get("args", {}))}]
            return
        data = json.loads(tool_results[-1]["content"])
        reply = "You have an offer from **" + data["placements"][0]["company"] + "**." if data.get("placements") else "I don't have that data."
        for piece in (reply[:10], reply[10:]):
            yield "text", piece

    monkeypatch.setattr(assistant, "is_configured", lambda: True)
    monkeypatch.setattr(assistant, "stream_model", fake_stream)
    return seen


def _events(response):
    out = []
    for block in response.text.strip().split("\n\n"):
        lines = dict(line.split(": ", 1) for line in block.split("\n"))
        out.append((lines["event"], json.loads(lines["data"])))
    return out


def test_chat_runs_the_lookup_as_the_user_and_streams_the_answer(client, placed, scripted):  # noqa: F811
    h = placed["h"]
    r = client.post("/assistant/chat", headers=h["s1"], json={"message": "What is my placement status?"})
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
    events = _events(r)
    assert [e[0] for e in events] == ["start", "status", "text", "text", "done"]
    assert "".join(e[1]["text"] for e in events if e[0] == "text") in ("You have an offer from **Acme**.", "You have an offer from **Globex**.")
    assert events[1][1]["text"] == "Checking your placement record…"

    first = scripted["rounds"][0]
    system = first["messages"][0]["content"]
    assert "Asha Rao" in system and "T23IS001" in system and "role: student" in system
    assert "s_placements" in first["tool_names"] and "d_placed_students" not in first["tool_names"]   # only the student's lookups were offered

    # the same question from a student with no offers is answered from *their* data
    events = _events(client.post("/assistant/chat", headers=h["s3"], json={"message": "What is my placement status?"}))
    assert "".join(e[1]["text"] for e in events if e[0] == "text") == "I don't have that data."


def test_conversations_are_saved_and_private(client, placed, scripted):  # noqa: F811
    h = placed["h"]
    start = _events(client.post("/assistant/chat", headers=h["s1"], json={"message": "What is my placement status?"}))[0][1]
    cid = start["conversation_id"]
    client.post("/assistant/chat", headers=h["s1"], json={"message": "And the package?", "conversation_id": cid})

    listing = client.get("/assistant/conversations", headers=h["s1"]).json()
    assert [(c["id"], c["title"]) for c in listing] == [(cid, "What is my placement status?")]
    saved = client.get(f"/assistant/conversations/{cid}", headers=h["s1"]).json()["messages"]
    assert [x["role"] for x in saved] == ["user", "assistant", "user", "assistant"] and saved[1]["content"].startswith("You have an offer")
    # the follow-up was sent with the earlier turns for context
    assert [x["role"] for x in scripted["rounds"][-1]["messages"]][:4] == ["system", "user", "assistant", "user"]

    assert client.get("/assistant/conversations", headers=h["s2"]).json() == []
    assert client.get(f"/assistant/conversations/{cid}", headers=h["s2"]).status_code == 404
    assert client.post("/assistant/chat", headers=h["s2"], json={"message": "hi", "conversation_id": cid}).status_code == 404
    assert client.delete(f"/assistant/conversations/{cid}", headers=h["s2"]).status_code == 404
    assert client.delete(f"/assistant/conversations/{cid}", headers=h["s1"]).status_code == 200
    assert client.get("/assistant/conversations", headers=h["s1"]).json() == []
    assert placed["db"].query(m.AssistantMessage).count() == 0


def test_chart_requests_and_runaway_lookups(client, placed, monkeypatch):  # noqa: F811
    monkeypatch.setattr(assistant, "is_configured", lambda: True)
    calls = {"n": 0}

    def chart_then_loop(messages, tools):
        calls["n"] += 1
        if calls["n"] == 1:
            yield "tool_calls", [{"id": "c1", "name": "show_chart", "arguments": json.dumps({"title": "Placed by batch", "labels": ["2021", "2023"], "values": [1, 1]})}]
        elif tools:                       # keeps asking for lookups for as long as it is allowed to
            yield "tool_calls", [{"id": f"c{calls['n']}", "name": "d_overview", "arguments": "{}"}]
        else:
            yield "text", "Here is the chart."

    monkeypatch.setattr(assistant, "stream_model", chart_then_loop)
    events = _events(client.post("/assistant/chat", headers=placed["h"]["hod"], json={"message": "Chart placements by batch"}))
    charts = [e[1]["chart"] for e in events if e[0] == "chart"]
    assert charts == [{"type": "bar", "title": "Placed by batch", "data": [{"name": "2021", "value": 1.0}, {"name": "2023", "value": 1.0}]}]
    assert calls["n"] == assistant.MAX_ROUNDS and events[-2] == ("text", {"text": "Here is the chart."})   # forced to answer in the end
    cid = events[0][1]["conversation_id"]
    assert client.get(f"/assistant/conversations/{cid}", headers=placed["h"]["hod"]).json()["messages"][1]["charts"] == charts


def test_unavailable_model_and_bad_input(client, placed, monkeypatch):  # noqa: F811
    h = placed["h"]
    monkeypatch.setattr(assistant, "is_configured", lambda: False)
    events = _events(client.post("/assistant/chat", headers=h["t1"], json={"message": "hello"}))
    assert events[1] == ("text", {"text": assistant.UNAVAILABLE}) and events[-1][1]["available"] is False
    assert client.get("/assistant/starters", headers=h["t1"]).json()["available"] is False
    assert len(client.get("/assistant/starters", headers=h["hod"]).json()["starters"]) >= 4
    assert client.post("/assistant/chat", headers=h["t1"], json={"message": "   "}).status_code == 400
    assert client.post("/assistant/chat", headers=h["t1"], json={"message": "x" * 4001}).status_code == 400
    assert client.post("/assistant/chat", json={"message": "hello"}).status_code == 401


def test_reply_still_streams_after_the_request_session_is_closed(placed, scripted):  # noqa: F811
    """On the live server the session that served the request is closed before
    the reply is streamed. The first live run of the assistant returned an
    empty reply for exactly this reason; this reproduces that order of events."""
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session as OrmSession

    from app.core.database import get_db
    from app.main import app

    bind = placed["db"].get_bind()

    def closing_session():
        session = OrmSession(bind=bind)
        try:
            yield session
        finally:
            session.close()          # as the real dependency does

    app.dependency_overrides[get_db] = closing_session
    try:
        with TestClient(app) as live_like:
            r = live_like.post("/assistant/chat", headers=placed["h"]["s1"], json={"message": "What is my placement status?"})
            events = _events(r)
            assert [e[0] for e in events][0] == "start" and events[-1][0] == "done"
            assert "You have an offer from" in "".join(e[1]["text"] for e in events if e[0] == "text")
            cid = events[0][1]["conversation_id"]
            saved = live_like.get(f"/assistant/conversations/{cid}", headers=placed["h"]["s1"]).json()["messages"]
            assert [x["role"] for x in saved] == ["user", "assistant"]
    finally:
        app.dependency_overrides.clear()


def test_a_batch_can_be_named_by_graduation_year(placed):  # noqa: F811
    db = placed["db"]
    hod = _user(db, "hod@test.local")
    by_entry = _run(db, hod, "d_batch_placements", batch="2023")["batches"]
    by_graduation = _run(db, hod, "d_batch_placements", batch="2027")["batches"]          # "the 2027 batch"
    assert len(by_entry) == 1 and by_graduation == by_entry and by_entry[0]["graduates_in"] == 2027
    assert [o["usn"] for o in _run(db, hod, "d_placed_students", batch="2027")["offers"]] == ["T23IS001", "T23IS001"]
    assert _run(db, hod, "d_students", batch="2025")["matching"] == 1                      # 2021 entry graduates in 2025
    assert _run(db, hod, "d_batch_placements", batch="2024")["batches"][0]["batch"] == "2024"   # a real entry year is taken as one
    assert _run(db, hod, "d_batch_placements", batch="1999")["batches"] == []


def test_a_throttled_or_failing_model_gives_a_clear_message(client, placed, monkeypatch):  # noqa: F811
    monkeypatch.setattr(assistant, "is_configured", lambda: True)

    class RateLimitError(Exception):
        status_code = 429

    def throttled(messages, tools):
        raise RateLimitError("Rate limit reached for model")
        yield  # pragma: no cover

    monkeypatch.setattr(assistant, "stream_model", throttled)
    events = _events(client.post("/assistant/chat", headers=placed["h"]["s1"], json={"message": "hello"}))
    assert ("text", {"text": assistant.BUSY}) in events and events[-1][0] == "done"

    def broken(messages, tools):
        raise RuntimeError("connection reset")
        yield  # pragma: no cover

    monkeypatch.setattr(assistant, "stream_model", broken)
    events = _events(client.post("/assistant/chat", headers=placed["h"]["s1"], json={"message": "hello"}))
    assert ("text", {"text": assistant.FAILED}) in events and events[-1][0] == "done"
    # the failed turn is still recorded, so the chat does not silently lose it
    cid = events[0][1]["conversation_id"]
    assert [x["role"] for x in client.get(f"/assistant/conversations/{cid}", headers=placed["h"]["s1"]).json()["messages"]] == ["user", "assistant"]
