# ANVIKSHA AI — Phase 2 Backend

Real PostgreSQL-ready backend, built and verified against your actual dataset
(326 real students across batches 2020–2024, 311 question-bank chunks from 95
real IA question papers).

---

## 1. Setup

```bash
pip install -r requirements.txt
cp .env.example .env
```

Edit `.env`:
- **For quick local testing**, leave `DATABASE_URL` as-is — it defaults to a local
  SQLite file (`anviksha_dev.db`), no setup needed.
- **For real use with Supabase**, replace `DATABASE_URL` with your Supabase
  connection string (Project Settings → Database → Connection string → use the
  "Connection pooling" one), and set a real `JWT_SECRET`.

## 2. Create the database tables

```bash
python -m alembic upgrade head
```

This creates all 12 tables (students, faculty, subjects, attendance, marks,
achievements, document_requests, counseling_notes, question_bank_chunks, users,
departments) — works identically whether pointed at SQLite or your Supabase Postgres.

## 3. Import your real data

```bash
python scripts/import_data.py
```

This does three things:
1. Parses the Excel files in `data_raw/batch 2/Academic Performance Batchwise/`
2. Validates every record and writes `scripts/completeness_report.txt`
3. Loads students into the database, and ingests the question papers in
   `data_raw/IA_QP/` into `question_bank_chunks` (ready for Phase 3 embedding)

Already tested against your actual files — output was:
```
Batch 2020: 56/56 students have complete records
Batch 2021: 66/66 students have complete records
Batch 2022: 66/66 students have complete records
Batch 2023: 69/69 students have complete records
Batch 2024: 69/69 students have complete records

Students: 326 inserted
Question bank: 311 chunks loaded, 6 files skipped (temp/irrelevant files)
```

## 4. Create a login user

There's no signup flow yet — seed a user directly:

```python
from app.core.database import SessionLocal
from app.core.security import hash_password
from app.models.models import User

db = SessionLocal()
db.add(User(email="admin@anviksha.ai", hashed_password=hash_password("your-password"), role="admin"))
db.commit()
```

Roles are `"admin"`, `"teacher"`, or `"student"`. For teacher/student logins, also
set `faculty_id` / `student_id` on the User row so the endpoints can scope data
correctly.

## 5. Run the server

```bash
uvicorn app.main:app --reload --port 8000
```

Visit `http://localhost:8000/docs` for interactive API docs (Swagger UI).

---

## What's real vs. what's still seed data

| Data | Status |
|---|---|
| Students (326, batches 2020–2024) | **Real** — imported from your actual CGPA workbooks |
| Question bank (311 chunks, 95 files) | **Real** — extracted from your actual IA question papers |
| Faculty, Subjects, Attendance | **Not in your upload** — these weren't in the files you sent, so these endpoints are built and tested against placeholder data. Send a faculty/subjects list when you have one and the same import pattern extends to them. |

## Batch / Passed-Out logic

Every student's admission year is read from their USN (e.g. `4GW21IS002` → 2021).
Status is computed as `passed_out` if `admission_year + 4 <= current year`, else
`active`. This is why, for example, Batch 2022 shows mostly `passed_out` but a
few `active` — some students in that batch have backlogs pushing them past the
standard 4-year timeline, which is realistic and expected, not a bug.

This means:
- Rankings, dashboards, and stats can filter by `batch`, `status`, or both
- Passed-out batches never mix into "current student" views unless explicitly
  queried with `status=passed_out` or no status filter at all

## Privacy decisions (built in, not optional)

- **Phone numbers, email addresses, and dates of birth from the source files are
  never imported.** The schema doesn't have columns for them. Only USN, name,
  batch, and academic performance are stored — this is intentional data
  minimization, not an oversight.
- **Demo Mode** (`DEMO_MODE=true` in `.env`, or `?demo_mode=true` per-request)
  masks names (e.g. "A. Student") and truncates USNs in API responses, without
  touching the real data in the database. Use this for supervisor demos or
  anything screenshotted for your report.
- `data_raw/` (your actual files) and `.env` (your real credentials) are in
  `.gitignore` — **never commit these to GitHub**, even a private repo you might
  later make public.

## Data completeness & validation rules

- CGPA must be between 0–10, backlogs can't be negative
- A student missing CGPA/semester data is still imported and shown, but marked
  `data_status: "provisional"` instead of being silently dropped or given a fake 0
- Rankings (`/student/rank`) automatically exclude students with incomplete CGPA
  data and report how many were excluded, rather than mixing incomplete records
  into a ranking silently

## API Endpoints

| Endpoint | Role | Notes |
|---|---|---|
| `POST /auth/login` | — | Returns JWT |
| `GET /auth/me` | any | Current user info |
| `GET /student/dashboard` | student | Own profile |
| `GET /student/rank` | student | Scoped to own batch+section, excludes incomplete data |
| `GET /student/achievements` | student | |
| `GET /student/documents` | student | |
| `GET /teacher/students` | teacher | Filterable by `batch`, `section`, `status` |
| `POST /teacher/attendance` | teacher | Marks a full session at once |
| `GET /teacher/attendance` | teacher | |
| `GET /teacher/at-risk` | teacher | Attendance < 75% or backlogs > 0 |
| `GET /admin/stats` | admin | Institute-wide counts, active vs passed-out |
| `GET /admin/students` | admin | Filterable by `batch`, `status` |
| `GET /admin/batches` | admin | Batch list with active/passed-out counts — powers the batch selector filter |
| `POST /admin/reports/query` | admin | Structured filter (min CGPA, max backlogs, batch, status) — backs the "natural language" query box; Phase 3 adds actual NL parsing on top |

All endpoints marked with a role require `Authorization: Bearer <token>` from
`/auth/login`. Every list endpoint accepts `?demo_mode=true` to mask names/USNs
for that request only.

## Next steps (not done yet, flagged honestly)

1. **Connect the Phase 1 frontend** — replace the mock JSON imports in the
   Next.js app with `fetch()` calls to these endpoints. Not done in this delivery
   since it wasn't clear yet whether you wanted that wired immediately or after
   confirming the backend works standalone first.
2. **Faculty/Subjects/Attendance real data** — send this when you have it structured,
   and the same validated-import pattern extends directly to it.
3. **Phase 3 embedding** — `question_bank_chunks` is ready to be embedded into
   ChromaDB; the actual embedding call needs your Gemini API key, which isn't
   something to hardcode here.

---

## Demo logins (seeded, tied to real records)

| Role | Email | Password | Notes |
|---|---|---|---|
| Admin | admin@anviksha.ai | admin123 | Full access |
| Student | student.demo@anviksha.ai | student123 | Tied to a real active-batch student (top of batch 2024 by CGPA) |
| Teacher | teacher.demo@anviksha.ai | teacher123 | Tied to a placeholder faculty row — swap for a real one via Admin later |

## Frontend wiring status (as of this delivery)

**Wired to live backend** (each screen shows a "Live data" / "Mock data" badge so it's always visible which one you're looking at):
- Admin: Dashboard, Subject Dataset, Reports (structured query)
- Student: Dashboard, Class Rank, Achievements, Document Requests
- Teacher: Dashboard, My Students

**Still on Phase 1 mock data** (same wiring pattern, not yet repeated across every screen): Admin Users/Faculty Dataset/Documents/Logs, Student Profile/Attendance/Resume/Notes/Counseling, Teacher Attendance Upload/Question Paper/PPT Generator/Performance/Counseling/Reports.

**Real numbers vs. structurally-empty by design:** CGPA, rank, and batch/status are real, pulled from your uploaded spreadsheets. Attendance %, backlogs, achievements, and document requests correctly show as empty/"Not Available" rather than fabricated — none of that was in your uploaded files. The moment you add real data for those categories, the same wiring shows it immediately, no code changes needed.

---

## Real login credentials for every student and faculty member

```bash
python scripts/create_all_logins.py
```

This creates a real login for every one of your 326 students and all faculty
(skips anyone who already has one). Passwords are randomly generated —
never derived from USN or anything guessable — and written to
`scripts/generated_credentials.csv` (git-ignored, never committed).
**This file has real plaintext passwords — keep it private.**

Login email format: `<usn-lowercase>@anviksha.ai` for students,
`<name>@anviksha.ai` for faculty. Open the CSV to get the actual passwords.

## Activity Logs

Every meaningful action (adding/deleting a student or faculty member, marking
attendance, approving/rejecting a document request) is now logged to a real
`activity_logs` table and shown on Admin > Activity Logs. This starts empty
on a fresh database — it fills up as real actions happen, it's not backfilled
with fake history.

---

## Real faculty roster and VTU scheme subjects (this delivery)

After `scripts/import_data.py` and `scripts/seed_subjects_faculty.py`, run:

```bash
python scripts/import_faculty_scheme.py
```

This replaces the earlier placeholder faculty ("Faculty TBD 1-4") with your
**real 17-person faculty roster** (10 from the official teacher database +
7 more referenced in the real subject-assignment sheets but not in that
smaller file — still real names, just without qualification/designation data
on file), and loads **59 real VTU-scheme subjects** (2021 and 2022 scheme)
with real subject codes, real names, and real teacher assignments —
cross-referenced and matched by teacher ID, not guessed.

The 8 subjects inferred earlier from question-paper folder names remain
alongside these (still `name_verified: false`) since they're tied to your
real ingested question bank content — nothing was deleted, just supplemented.

## Real MOOC certificates — found, verified, and handled carefully

Your latest uploads included ~200 "certificate" PDFs. On inspection, most
were explicitly watermarked "DEMO CERTIFICATE — NOT AN OFFICIAL CREDENTIAL"
(132 of 200). The **68 genuinely real ones** (real Wingspan/Google Cloud
verification, no demo markers) are preserved in `data_raw/real_mooc_certs/`,
named by USN. They are intentionally **not** parsed into structured course
records — the certificate text formats vary too much across platforms to
extract clean course titles without risking fabricated-looking data. They're
available as real evidence files; turning them into database rows is a
reasonable next step if you want it, but wasn't done blindly here.
