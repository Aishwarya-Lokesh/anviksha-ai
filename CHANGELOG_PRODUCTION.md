# Production hardening changelog

Work happens on the local branch `hardening/phase-1`. Nothing here has been pushed, so nothing is live yet.

## Phase 0 — Audit

- Added `AUDIT.md`.
- Restored `anviksha-app/lib/api.ts` to its committed version. The working copy had an uncommitted `[[ … ]]` wrapped around the whole file, which broke type-check and build. A whitespace-insensitive diff showed no other difference.

## Phase 1 — Global fixes (in progress)

### Navigation
- New shared `AppShell` used by all four role layouts (replaces four copies of the same wrapper).
- Sidebar is collapsible on desktop (state remembered per browser). Below 1024 px it is replaced by a bottom navigation bar with the first four destinations and a "Menu" button that opens a slide-out drawer with the full menu.
- Active highlighting now also matches nested routes.
- Sidebar shows the signed-in user's real name: student name + USN, teacher name + designation, HOD title + department, admin email.
- Drawer closes on navigation, on Escape and on backdrop tap; navigation controls have labels and visible focus states; touch targets are at least 44 px.

### Pages
- Added a 404 page that links signed-in users back to their own dashboard.
- Page and top-bar padding is now `16px` on phones and `32px` from tablet up (70 places).
- Notification panel no longer overflows narrow screens.

### Developer-facing text removed
- Login page no longer tells users where the backend must be running; login errors distinguish "wrong credentials" from "server unreachable".
- Network-failure messages no longer print the API address or mention FastAPI.

### Decisions made
- Mobile navigation switches at the `lg` breakpoint (1024 px), so 768 px tablets get the bottom bar and drawer rather than a cramped sidebar.
- The audit was read-only against the production database. The backend was not run locally because the local `.env` points at production.

### Not yet verified
- Visual check in a browser at 360 / 390 / 768 / 1024 / 1440 px. Type-check and production build pass, and routes return the expected status codes, but no browser was available in this session.

## Placement & internship data (Prompt 2, Steps 1–3) — built, not yet applied to production

### Data model (migration `c4d5e6f7a8b9`, additive)
- New tables `companies` and `placement_drives`.
- `placements` and `internships` gain structured columns (USN, company link, role, package in LPA / stipend per month, offer type, dates, status, document path, verified flag, source note). All existing rows and columns are kept.
- `placements` no longer limits a student to one row; the new rule is one row per student + company + offer type. Internships: one per student + company + start date.
- Back-fill: existing free-text company names are linked to `companies`, and package values such as "11 LPA" are parsed into numbers. Two legacy values that describe internship stipends rather than a package are left unparsed.
- Views `v_student_placement_summary`, `v_batch_placement_stats`, `v_company_stats`.
- On Postgres: row level security enabled on the four tables, views set to respect it, and direct access revoked from Supabase's public API roles.

### Import
- `anviksha-backend/scripts/import_placements.py` — dry run by default, `--apply` to write. Writes `IMPORT_REPORT.md`.
- `anviksha-backend/app/core/placement_matching.py` — USN → exact name (initials in any form/order) → similar name + same first name. A row is imported only on a single match with no open question.
- Seed files live in `anviksha-backend/data_raw/placement_2027/`, which is git-ignored: they hold student names and packages and are never committed. They are imported straight into the database.
- 11 new tests for matching and company-name normalization (42 backend tests pass).

### Decisions made
- **Python, not TypeScript / Edge Function**, for the import: the backend is FastAPI and the matching logic has to be reused by the admin import screen.
- **Name similarity is computed in Python** with the same trigram method as Postgres `pg_trgm` (checked against the documented reference value), so it needs no database extension and behaves identically in tests.
- **Median package is computed in the API**, not in the view, because it has no SQL form that works on both databases the project uses.
- **Company spellings merged:** "Mindsprint Digital" → Mindsprint, "DELL" / "Dell Technologies" → Dell, "Deutsche India" / "DEUTSCHE INDIA" → Deutsche Bank. This affects older batches' company stats too.
- **Role scoping stays in the API.** The backend connects as the table owner, which row level security does not restrict; RLS here blocks the other route into the data (Supabase's public REST API).
- Batch "2023–2027" is stored as `batch = '2023'`, matching the existing students table.
- The seed rows' source note says the original announcement email is not on file, rather than citing an email I have not seen.

### Verified
- Migration rehearsed on a throwaway SQLite copy of the four affected production tables (read from production read-only, deleted afterwards): 136 placement and 9 internship rows preserved, every legacy company linked, view totals equal to direct counts.
- Import applied twice on that copy: 3 rows written, no duplicates on the second run; batch 2023 shows 3 placed of 70, Mindsprint 3 offers at 5.2 LPA.

### Not verified
- The migration has **not been run on Postgres**. The table changes are standard, but the RLS / view-security / revoke statements are Postgres-only and could not be exercised locally.
- Nothing has been written to production.

## Login reliability, session expiry, role alias

### Root causes found for "login sometimes fails"
- **Dropped database connections.** The backend kept idle connections open with no health check. The Supabase pooler closes idle connections, so the first request after a quiet period could be handed a dead one and fail with a server error, which the login page reported as a failed login. Fixed with connection pre-ping and recycling (`app/core/database.py`).
- **Server asleep.** Render stops the backend when idle; the first request took 53 s when measured, with nothing on screen to explain the wait. The API client now waits and retries safe requests (reads and sign-in) for up to 90 s, and the login page says the server is starting.
- **Expired sessions.** Tokens last 8 hours with no handling when they run out, so pages silently stopped loading. A rejected token now signs the user out and returns them to the login page with an explanation.
- Login errors now distinguish wrong credentials, server unreachable, and server error (previously all three said the same thing).

### Role alias
- `faculty` is accepted as another spelling of `teacher` at login and on every role check. Migration `d5e6f7a8b9c0` updates the one stored account.

### Placement import
- Seed CSVs removed from git history (they were only ever in unpushed local commits) and moved to the git-ignored `anviksha-backend/data_raw/placement_2027/`. `IMPORT_REPORT.md` is git-ignored.
- Drive type is stored as "Not specified" when the source does not state it.
- All 9 seed records confirmed by the department; rehearsal on a scratch copy imports 6 placements and 3 internships with no duplicates on a second run. Batch 2023: 6 placed of 70, highest 22 LPA, Mindsprint 4 offers at 5.2 LPA.

### Not verified
- The login fix cannot be proven until it is deployed: the failure is intermittent and happens only in production.
