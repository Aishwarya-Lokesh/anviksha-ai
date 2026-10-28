"""Sign-in forgives what phones and chat apps do to an email address, never the password itself."""
from app.core.security import hash_password
from app.models import models as m


def _user(db):
    u = m.User(email="girish.s.c@anviksha.ai", hashed_password=hash_password("Kd7mPq4Rtz"), role="teacher")
    db.add(u)
    db.commit()
    return u


def _login(client, email, password="Kd7mPq4Rtz"):
    return client.post("/auth/login", json={"email": email, "password": password})


def test_email_typed_differently_still_signs_in(client, db_session):
    _user(db_session)
    for email in ("girish.s.c@anviksha.ai", "Girish.s.c@anviksha.ai", "GIRISH.S.C@ANVIKSHA.AI", " girish.s.c@anviksha.ai ",
                  "girish.s.c@anviksha.ai ", "​girish.s.c@anviksha.ai", "girish.s.c@anviksha.ai\n"):
        r = _login(client, email)
        assert r.status_code == 200, (repr(email), r.text)
        assert r.json()["role"] == "teacher"


def test_space_pasted_around_the_password_is_ignored(client, db_session):
    _user(db_session)
    for password in ("Kd7mPq4Rtz ", " Kd7mPq4Rtz", "Kd7mPq4Rtz ", "Kd7mPq4Rtz​"):
        assert _login(client, "girish.s.c@anviksha.ai", password).status_code == 200, repr(password)


def test_wrong_password_or_email_is_still_refused(client, db_session):
    _user(db_session)
    for email, password in (("girish.s.c@anviksha.ai", "kd7mpq4rtz"),      # passwords stay case-sensitive
                            ("girish.s.c@anviksha.ai", "Kd7mPq4Rt"),
                            ("girish.s.c@anviksha.ai", "Kd7m Pq4Rtz"),     # a space inside is a different password
                            ("girish@anviksha.ai", "Kd7mPq4Rtz"),
                            ("", "Kd7mPq4Rtz"),
                            ("girish.s.c@anviksha.ai", "")):
        r = _login(client, email, password)
        assert r.status_code == 401, (email, password)
        assert r.json()["detail"] == "Invalid email or password"
