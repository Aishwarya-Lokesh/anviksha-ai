# Anviksha AI — Setup Guide

Follow these steps in order, exactly once, after unzipping `Anviksha_AI_Connected_System.zip`.
Two terminal windows are needed: one for the backend, one for the frontend.

---

## Before you start

You need these installed on your machine:
- **Python 3.10+**
- **Node.js 18+** and npm
- (Optional but recommended) A free Google Gemini API key from https://aistudio.google.com — powers the real AI assistant, PPT/Notes generator, and Question Paper features. Everything else works without it.

---

## Part 1 — Backend setup

```bash
# 1. Go into the backend folder
cd anviksha-backend

# 2. Create and activate a virtual environment
python3 -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Create your real environment file
cp .env.example .env
```

Open `.env` in a text editor and fill in:
- `JWT_SECRET` — any long random string (e.g. mash your keyboard for 40 characters)
- `GEMINI_API_KEY` — paste your real key here if you have one; leave blank otherwise (the AI features will honestly say "not connected" instead of breaking)
- Leave `DATABASE_URL` alone unless you specifically want Postgres/Supabase — it defaults to a local SQLite file, no setup needed

```bash
# 5. Create the database tables
python3 -m alembic upgrade head

# 6. Load all real data — run these in EXACT order, each one depends on the last
python3 scripts/import_data.py
python3 scripts/seed_subjects_faculty.py
python3 scripts/import_faculty_scheme.py
python3 scripts/link_real_certificates.py
python3 scripts/import_demo_achievements.py
python3 scripts/load_real_placement_companies.py
python3 scripts/load_real_internships.py
python3 scripts/load_sem6_update.py
python3 scripts/sync_student_semesters.py
python3 scripts/tag_question_bank.py

# 7. Create login accounts for every real student and faculty member
python3 scripts/create_all_logins.py
```

Step 7 creates `scripts/generated_credentials.csv` with real, randomly generated passwords for every account — **this file is private, never commit it or share it publicly.** Open it to find login emails/passwords for testing.

```bash
# 8. Start the backend server
python3 -m uvicorn app.main:app --reload --port 8000
``` 

Leave this terminal running. Visit `http://localhost:8000/docs` to confirm it's up — you should see the API documentation page.

---

## Part 2 — Frontend setup (new terminal window)

```bash
# 1. Go into the frontend folder
cd anviksha-app

# 2. Install dependencies
npm install

# 3. Point it at your backend (optional — it already defaults to localhost:8000)
cp .env.local.example .env.local
```

If your backend runs on a different port or machine, edit `.env.local`:
```
NEXT_PUBLIC_API_BASE=http://localhost:8000
```
Otherwise, skip this — the default already works.

```bash
# 4. Start the frontend
npm run dev
```

Visit `http://localhost:3000` in your browser. You should see the login page.

---

## Part 3 — Logging in

Open `anviksha-backend/scripts/generated_credentials.csv` and pick any row:
- **Admin**: use the admin account created separately (see note below if none exists — you may need to create one manually, see Part 4)
- **HOD**: pdbick a faculty row, then manually set that user's role to `hod` in the database if needed
- **Teacher**: any faculty row's email/password
- **Student**: any student row's email/password

---

## Part 4 — Creating an Admin/HOD account (one-time, manual)

The scripts create Student and Teacher accounts automatically, but Admin and HOD accounts need one manual step since there's no single "the admin" in your data. Run this once:

```bash
cd anviksha-backend
source venv/bin/activate
python3 -c "
from app.core.database import SessionLocal
from app.core.security import hash_password
from app.models.models import User, Department

db = SessionLocal()

# Create an admin account
.add(User(email='admin@anviksha.ai', hashed_password=hash_password('ChangeThisPassword123'), role='admin'))

# Create an HOD account for ISE
dept = db.query(Department).first()
db.add(User(email='hod.ise@anviksha.ai', hashed_password=hash_password('ChangeThisPassword123'), role='hod', department_id=dept.id, hod_title='Head of Department, ISE'))

db.commit()
print('Admin and HOD accounts created.')
db.close()
"
```

Change the password in that command before running it, or change it immediately after logging in.

---

## Common issues

| Problem | Fix |
|---|---|
| `alembic upgrade` fails | Make sure you're in the `anviksha-backend` folder with the venv activated |
| A data-loading script says "0 records" | Run the scripts in the exact order listed in Part 1, Step 6 — several depend on earlier ones |
| Frontend shows "Backend not connected" | Confirm the backend terminal is still running and `.env.local` has the right `NEXT_PUBLIC_API_BASE` |
| AI features say "not connected yet" | This is expected without a real `GEMINI_API_KEY` in `.env` — not a bug |
| Port 8000 or 3000 already in use | Stop whatever else is using that port, or add `--port 8001` (backend) / `-- -p 3001` (frontend) to the start commands |

---

## Re-running from scratch

If you ever want to wipe all data and reload it fresh:

```bash
cd anviksha-backend
rm -f anviksha_dev.db
python3 -m alembic upgrade head
# then repeat Part 1, Step 6 and 7
```

This is completely safe — it only affects the local database file, never your source data files.
