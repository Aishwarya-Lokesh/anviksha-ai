# Production hardening changelog

Work happens on the local branch `hardening/phase-1`. Nothing here has been pushed, so nothing is live yet.

## Phase 0 — Audit

- Wrote an internal audit of the site (kept out of this public repository).
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

## Missing backend features (the screens existed; the server side did not)

Migration `e6f7a8b9c0d1` (additive): counseling reply columns, resume file and education on students, extra-work status on faculty, and the `notes` table where it does not already exist (production's existing table and its 2 rows are left untouched).

### Now working
- **Notes & Deadlines:** teachers post a note or deadline (with an optional file) to one of their classes; only students of that class see it and are notified. `GET/POST/DELETE /teacher/notes`, `GET /student/notes`.
- **Student dashboard:** Profile Score, achievement count, breakdown and the achievement list are now returned by `/student/dashboard`.
- **IA marks:** `POST /teacher/marks/bulk` saves the whole grid, all-or-nothing, limited to the teacher's own students and subjects.
- **Attendance:** a teacher can delete a session they marked.
- **Counseling:** students can respond to a note, edit or remove the response; teachers can reply back. Both sides see the thread.
- **Extra work:** a teacher sees work the HOD assigned, marks it completed, or clears it.
- **HOD:** batch breakdown (which feeds every batch filter), a faculty member's classes, placement batch selector and batch-vs-batch comparison.
- **Placements:** `/hod/placements`, `/student/placement` and `/student/internships` now read the new placement tables through one shared module (`app/core/placement_stats.py`) and the three views.
- **Resume file** upload/replace/delete and **education** details for the Resume Builder.

### Bug found and fixed along the way
- A teacher's class list matched students by batch and semester only, so in a multi-department setup it would have included other departments' students. It now also matches the department.

### Decisions made
- **Profile Score = Student Excellence Score** (CGPA tier points + achievement points). The dashboard already labels the card "Same as Excellence Score"; the number now comes from the same calculation.
- **"All batches" placement figures count only batches that have at least one offer**, so a batch that has not started placements does not drag the percentage down.
- **Placement percentage is placed students ÷ all students in the batch.** Previously it was placed ÷ students who happened to have a placement row, which showed 100% for batches where only placed students were recorded.
- **Dream offer = 9 LPA or more** on the HOD screen, because that is what the screen's own label says. The admin screen uses different tiers (see open questions).
- New endpoints live in their own files (`notes.py`, `teacher_extras.py`, `student_extras.py`, `hod_extras.py`) rather than growing the existing 1,900-line teacher module.

### Verified
- 12 new tests covering each feature and its access boundary (own class / own students / own department only); 55 backend tests pass.
- All three migrations rehearsed on a scratch copy: upgrade, full downgrade, upgrade again, import twice. Also rehearsed with a pre-existing `notes` table, as in production.

### Not verified
- None of this has run against Postgres or the live site yet.
- Files attached to notes and uploaded resumes need the storage bucket to survive a server restart.

## Dummy data and developer labels removed

- **Status pills gone:** the "● Live data from backend / ○ Mock data (backend not connected)" label is removed from all 25 pages that had it.
- **Sample data deleted:** the six JSON files in `anviksha-app/data/` and every import of them. No page can show invented students, faculty, charts or requests any more.
- **Honest states instead:** pages that used to fall back to sample data now show a loading message, an error with a "Try again" button, or an empty state. New shared components: `components/ui/States.tsx` (`LoadError`, `EmptyState`).
- **No more pretend saves:** adding, editing or deleting a student or faculty member, saving a profile, saving education and submitting a document request used to report success ("saved locally only") when the request had actually failed. They now show an error and leave the screen unchanged.
- **Wording:** no user-facing message mentions "backend", "mock", "demo" or "real data" any more.
- **AI assistant:** the canned-answer code path is removed; the assistant only ever shows what the server returned.
- **Student document requests** now show the date they were raised.

### Removed because they were fake (flagged for your decision)
- **Admin dashboard "Dashboard Overview" trend chart and "Students by Department" donut** were drawn from static numbers. Replaced with two real charts: students per batch, and active vs passed-out.
- **Admin dashboard "System Status: All Systems Operational — last updated just now"** banner was hard-coded text. Removed.
- **"Import Excel" on the Student and Subject dataset pages.** One only added rows to the screen without saving them; the other only showed a message. Both buttons are removed until a real import exists (planned with the admin work).

### Verified
- Type-check and production build pass.
- All 39 signed-in pages for the four roles opened in a browser at 360 px and 1440 px with the server stubbed to fail: no page crashed and none scrolled sideways.

## Search, profile pages and passwords

### Search (command palette)
- Opens from the search box in the top bar, from a search button on phones, and with Ctrl/Cmd + K.
- One box finds pages, quick actions and records. Typing filters pages and actions instantly; records come from the server after a short pause.
- **What each role can find:**
  - Student: own achievements and certificates, notes and deadlines for their classes, own subjects, document requests and placements.
  - Teacher: students in their own classes, their subjects, the notes they posted, their question papers and presentations.
  - HOD: students, faculty, subjects and recruiters in their department.
  - Admin: all of those across departments, plus document requests and login accounts.
- Keyboard navigation (arrows, Enter, Esc), highlighted matches, grouped results, recent searches, and a "no results" state.
- Choosing a student opens the right list already filtered to them. Quick actions such as "Add an achievement" open the form directly.
- `GET /search` rewritten. The old version let a teacher search every student, returned nothing for an HOD, and its results could not be clicked.

### Profile pages
- New profile page for teachers, HODs and admins (`/teacher/profile`, `/hod/profile`, `/admin/profile`), linked from the sidebar and from the avatar in the top bar.
- Shows the person's record, lets them upload a photo, and edit only what is theirs to edit: a teacher's qualifications; an HOD's display name and title; an admin's display name. Names, USNs, designations and departments stay with the admin screens.
- The sidebar and top bar now show the signed-in person's real name and photo from one shared source, so a change appears everywhere at once. The four separate per-layout lookups are gone.
- Migration `f7a8b9c0d1e2` (additive): `display_name` and `photo_url` on login accounts.

### Change password
- Every role can change their own password from their profile page: current password required, at least 8 characters with letters and numbers. Recorded in the activity log.

### Wording
- Removed the repeated assurances that data is "real" from about 60 labels and messages.

### Bug found by browser testing and fixed
- Reopening the search immediately after closing it could keep the previous text in the box.

### Decisions made
- **Students cannot search for other students.** Search only ever returns a student's own records.
- **Search matching is "contains", case-insensitive**, on names, USNs, codes and titles. The brief suggested full-text search or `ilike`; with a few hundred rows per table this is fast and behaves the same on both databases. Wildcard characters typed by a user are treated as plain text.
- **Photo and resume files get a new file name on every upload**, so a browser never keeps showing the old one.

### Verified
- 8 new backend tests for search scoping per role and for the account endpoints (63 pass).
- Browser test, 25 checks, at 1440 px and 360 px: opening by keyboard and by button, filtering, grouped server results, highlight, debounce, Enter to open, pre-filtered landing page, recent searches, no-results state, Esc, quick actions, profile edit, and change-password success and failure. Run repeatedly to confirm it is stable.
- All 42 signed-in pages for the four roles opened at 360 px and 1440 px with the server failing: no crashes, no sideways scrolling.
- All four migrations rehearsed up, down and up again on a scratch copy.

### Not verified
- Against the live site and real accounts. The browser tests used a stand-in server.

## Anonymous feedback

- **Students** get a Feedback page listing the subjects and teachers they are taught this semester. Each can be rated once on five questions (1–5 stars) with an optional comment.
- **Teachers** see their own results under Performance & Feedback → Student feedback: overall average, average per question, a rating-over-time chart, and per subject the spread of ratings and the written comments.
- **HOD** gets a Faculty Feedback page: department average, a faculty comparison chart, every faculty member's rating, and a full breakdown per person. The batch filter and the open faculty member are kept in the address, so the view can be bookmarked and the browser's Back button works.
- Teachers are notified when new feedback arrives, without being told who sent it.
- Migration `a8b9c0d1e2f3` (additive): `feedback` and `feedback_submissions`.
- No feedback has been seeded. Every screen shows an explanatory empty state until students respond.

### How anonymity is kept
- The answers table has **no student column**. A separate table records only that a student has responded for a subject (so they can respond once); it holds no answers and no time, and nothing links the two.
- A teacher sees results only once **at least 3 students** have responded, overall and per subject. Below that, they see "2 of 3 responses needed". The HOD sees results from the first response.

### Decisions made (please confirm)
- **The five questions:** explains concepts clearly; command of the subject; pace and syllabus coverage; helpful with doubts outside class; overall teaching.
- **The 3-response threshold** before a teacher sees anything.
- **One response per subject per semester, not editable afterwards.** Because answers are not linked to the student, there is no way to let them edit later.
- **Feedback is always open.** There is no start or end date an admin controls.
- **Who a student can rate:** teachers who have set up a class for the student's batch and semester, plus the scheme's allotted teacher for any other subject of that semester. This second rule is needed because only one teacher has set up their classes so far.

### Verified
- 6 new backend tests: who may rate whom, validation, that no student is stored with the answers, the 3-response threshold, teacher sees only their own, HOD sees only their department (69 pass).
- Browser test, 40 checks at 1440 px and 360 px: the student form (cannot submit until every question is rated, correct data sent, subject marked submitted), the teacher view in all three states (results, too few responses, none), and the HOD overview, batch filter, drill-down and Back button.
- All five migrations rehearsed up, down and up again on a scratch copy.

## Live deployment (2026-10-11) and what live testing found

- All five migrations applied to the production database in one transaction; every existing row preserved. The 9 confirmed placement and internship records imported (batch 2023: 6 placed of 70, highest 22 LPA).
- Pushed to `deploy/production-setup`. Render deployed it; Vercel built it as a Preview because its Production Branch setting pointed elsewhere, so the deployment was promoted by hand and the setting corrected.
- Live checks as all four roles: 41 read-only API checks passed, and every page was opened in a browser at 1440 px and 390 px.
- **Found on the live site and fixed:** the admin's document-request list returned a server error for every request (a request was never linked to its student in the code). It had been hidden by the old sample-data fallback.
- Search keeps its previous response shape alongside the new one, so a browser still running an older page does not break during a deploy.

## Certificates and stored files

- **Verified certificate files count for points.** A real certificate file on a student's record earns the same 50 points as a certificate they add themselves. Demo files never count.
- **Stored files open only through signed, time-limited links.** Certificates, achievement proofs, resumes, note attachments and exports used to be readable by anyone who guessed the file name. The API now signs each file address it hands out (valid 6 hours); the bare address is refused. Profile photos stay openly readable because they appear in image tags throughout the interface.
- **In-app viewer** for images and PDFs with Download and Open-in-new-tab, used on the Achievements and Profile pages. A missing or expired file shows a clear message instead of a blank frame. On phones, where a PDF cannot be shown inside a page, the two buttons are offered.
- **Demo placeholder files are no longer listed** to students, and the "DEMO" / "AI" badges and "Demo mode" text are gone. Nothing was deleted from the database.
- **Admin storage tools:** `GET /admin/storage/status` reports whether the file store is configured and reachable and which certificate files the records expect but the store lacks; `POST /admin/storage/certificate-file` puts a missing file in place (only under a name an existing record already points to).

### Decisions made
- Links last 6 hours. Long enough for a working session, short enough that a forwarded link stops working the same day.
- The signing key is the existing `JWT_SECRET`, so there is no new setting to configure.

## Question Paper Generator

### What changed for the teacher
- **Source files are kept.** Files uploaded before are listed with tick-boxes and can be reused for the next paper, or removed. Previously every paper needed a fresh upload.
- **Works from the department's question bank alone** when it has the subject; an upload is no longer mandatory. If there is no source at all, the page says so plainly.
- **Subject picker** from the teacher's own subjects, filling in name, code and semester. Faculty and department are filled in from the signed-in teacher.
- **Edit any question in place**, change its marks, or press **Replace** to swap in one different question without regenerating the whole paper.
- **Summary above the paper:** marks on the paper, difficulty mix (easy / medium / hard), marks per course outcome, and the Bloom's level spread, with plain-language warnings.
- **Questions the source could not supply are shown as empty and highlighted**, and the paper cannot be downloaded until they are filled. Questions written by the AI are labelled "review".
- **Export in examination format** (PDF and Word): set label, institution, department, examination and academic year, subject, date, duration, maximum marks, instructions, then a ruled table of Q.No, Question, Marks, CO and RBT level with OR rows and part headings.
- **History** shows each saved paper's date, marks and question count; deleting asks for confirmation in the app's own dialog.
- Fully usable on a phone.

### Fixed
- The old export printed the literal words "COLLEGE NAME" and "DEPARTMENT" when those were not supplied. Removed.
- Generating crashed when the question bank had nothing to search. It now simply finds no matches.
- The question-bank search index was built once and never refreshed, so newly added papers were not searchable until the server restarted. It now rebuilds when the bank changes.
- Very large notes could exceed what the AI accepts when it had to write a question; the text sent is now bounded.
- An unfilled slot used to contain a sentence about the AI assistant not being connected, which would have been printed on the paper.

### Removed
- Four unused export helpers, including an invented sample question paper and a PowerPoint stub that only raised an error.

### Decisions made
- **Difficulty is derived from the Bloom's level**: Remember and Understand are easy, Apply and Analyze medium, Evaluate and Create hard. The teacher sets the mix by choosing the level of each question.
- **The institution line defaults to "GSSS Institute of Engineering and Technology for Women, Mysuru"** and can be edited on the page.
- **RBT levels are printed as L1–L6** (Remember = L1 … Create = L6).

### Verified
- 5 new backend tests (80 pass): two different sets drawn only from the source text, headers and signatures never treated as questions, generation from the question bank alone, replacing one question, and that files and papers are private to the teacher who owns them.
- Browser test, 36 checks at 1440 px and 390 px, including downloading the PDF and Word file. Both files were opened and inspected.

## AI assistant

### How it works now
- **Role-limited lookups instead of one block of text.** The model cannot read the database. It can only request one of a fixed set of lookups for the signed-in role, and each lookup reads strictly within what that person may see: a student their own records, a teacher their own classes, an HOD their department, an admin everything. The scope comes from the signed-in user, never from anything the model writes.
- **Lookups per role:** 9 for students (academics, attendance, notes and deadlines, achievements, own placements and internships, subjects, counseling, own batch's placement totals, past question papers), 6 for teachers, 10 for HODs, 12 for admins. Placement lookups read the same views and figures as the dashboards.
- **Streamed replies** with a line showing what is being looked up, a Stop button, and Markdown formatting including tables. Charts are drawn when asked for.
- **Conversations are saved** per user and can be reopened or deleted. Nobody can open another person's chat.
- **Starter questions** for each role.
- **"I don't have that data"** when the lookups return nothing, instead of an invented answer.
- Migration `b9c0d1e2f3a4` (additive): `assistant_conversations`, `assistant_messages`.

### Departures from the brief
- **Runs in the FastAPI backend, not a Supabase Edge Function**, consistent with the decision to keep one server layer. Keys stay server-side.
- **No pgvector.** Document search uses the existing keyword index over the question bank. Vector search needs an embeddings provider, and none is configured; say if you want it added.
- The older one-shot `/ask-ai` endpoints remain in the backend but the pages no longer use them.

### Found by testing on the live site, and fixed
- **Empty replies.** The first live run returned nothing: the database session that served the request is closed before the reply starts streaming. The stream now uses its own session, and a test reproduces the live order of events (it fails on the old code).
- **"The 2027 batch" found nothing**, because batches are stored by entry year. A batch can now be named by entry or graduation year.
- A reply that is cut off mid-stream keeps what arrived and says it is incomplete.
- A reply can never end in silence: any failure produces a message.

### Verified
- 10 backend tests with a scripted stand-in for the model (93 pass): which lookups each role has, that an argument cannot redirect a lookup at someone else, the lookup-then-answer loop, saved and private conversations, charts, a model that never stops asking for lookups, and an unavailable model.
- **Live, with the real AI and real data, as each role:** "Who got placed at Mindsprint?" (the four confirmed students, 5.2 LPA), "highest package in the 2027 batch" (22 LPA, Deutsche Bank), internships and stipends, "how many placed in 2023" (6 of 70), a student's own placement status and a follow-up question, attendance, feedback (none yet, and it says so), a made-up question about IA marks ("I don't have that data"), general teaching help, and a chart.
- **Privacy, live:** a student asking for a classmate's CGPA, for a classmate's package, and for the names of placed classmates was refused each time.
- Browser test of the screen against the live backend: HOD on desktop and student on a phone, 17 of 18 checks (the one miss was the test checking for starter questions a moment before they loaded).

### Known limits
- Reply time varies with the AI provider: usually 3–8 seconds to the first words, occasionally 20–30.
- One reply in roughly thirty lost its connection mid-stream during testing and could not be reproduced. The page now reports that case and asks the user to try again.

## Round 3: planner, announcements, admin tools, dark mode

### Database
- Migration `c0d1e2f3a4b5` (applied to production 13 Oct): new tables `feedback_windows`, `planner_items`, `announcements`; new column `users.is_active` (default true). Nothing existing was changed or removed.

### Student
- **Notes & Deadlines** is now a planner: own notes with simple formatting, own deadlines with date, time, priority, subject and a reminder, a month calendar that also shows deadlines set by teachers, and the material teachers shared. Own items are private to the student.
- **Placements & Internships** lists every offer and internship, with status and whether it is verified.
- Dashboard: "Due soon" now combines own and class deadlines; new cards for placements and announcements.
- **Feedback** shows "Not open yet" for a subject until the teacher or HOD opens it.
- **Resume**: the three templates now differ in layout in both the preview and the PDF. The PDF continues onto further pages and includes the career objective.

### Teacher
- A **switch per subject** to open and close student feedback (Performance & Feedback → Student feedback). Students of that class are notified when it opens.
- **Student Placements**: offers and internships of the students they teach, with search and export.
- **Announcements** to one of their own classes.
- **PowerPoint**: five colour themes; each slide without a diagram gets a photo (with credit) that can be swapped or removed, or a designed panel when no photo is available.

### HOD
- Can open or close feedback for any faculty member in the department.
- **Placement Records**: add, correct, delete and export offers and internships for the department's students.
- **Announcements** to students, faculty or both, in their own department.

### Admin
- **Login Accounts**: create a login, change its role, deactivate or reactivate it, reset its password. Temporary passwords are shown once.
- **Bulk Import**: students from CSV or Excel, with a check-first preview, a problem report, and an optional login per student.
- **Departments & Subjects**: add or rename departments, see batches and counts, allocate subjects to faculty, add subjects.
- **Placement Records** for every department, plus CSV import with the same strict student matching as the command-line importer.
- **Announcements** to everyone or to one department.
- Every one of these actions is written to the activity log.

### Everyone
- **Notifications** redesigned: unread count, relative time, a notice opens the page it is about and only then is marked read, and "Mark all as read". Opening the panel no longer marks everything read.
- **Dark mode**, switched from the top bar and remembered on that device.
- **Placement wall**: recording an offer posts a congratulation to the announcements feed.

### Security
- A deactivated account cannot sign in, and a session it already had stops working.
- The server only ever downloads slide photos from the photo service's own image host.
- The photo service key is read on the server and never sent to the browser.

### Decisions made
- Feedback is closed by default, as asked. Existing answers are untouched.
- A login can be deactivated but not deleted.
- A teacher's announcement always goes to students of one of their own classes; they cannot write to faculty or other classes.
- Reminders appear on the dashboard and planner; nothing is emailed.

## Round 4: HOD filters and exports, reminders, device alerts

- **HOD pages keep their filters in the address**, so a filtered view can be bookmarked, shared or returned to: Department Students (batch, semester, status, search, page), Placement Analytics (batch), the dashboard's two batch filters, Faculty Monitoring (tab, search) and Assessment Analytics (subject).
- **Department Students** gained a semester filter, a backlog column, "Clear filters", and an export of every student matching the filters.
- **Export buttons** on Faculty Workload, Faculty Monitoring, Faculty Feedback and Pass-Rate Outliers.
- **Deadline reminders are now notifications.** A student's own deadline with the reminder on raises one notification when it is within a day of falling due. No background job: it is checked when the student's notifications are read.
- **Device alerts.** A switch in the notification panel shows new notices as system notifications while the site is open in a tab. Off until switched on; remembered per device.
- Due dates are compared in India time rather than the server's UTC clock.
- Fixed: two filter changes made close together could undo each other.

## Round 5: photos, staying awake

- **Pixabay** is supported as a photo service alongside Pexels; whichever key is set in Render is used (`PIXABAY_API_KEY` or `PEXELS_API_KEY`), and a Pixabay key is recognised by its shape whichever name it was saved under. Photos are read from Pixabay's image network, because its download links refuse requests from the hosting provider. The credit on each slide names the service.
- The slide endpoints now say why a photo could not be found or downloaded, without revealing the key.
- **The backend keeps itself awake** by visiting its own address every 8 minutes (`app/core/keep_awake.py`). It runs only on the host; `KEEP_AWAKE=off` switches it off. `/health` reports whether it is running.
- The home and sign-in pages ask the server to wake as soon as they open.
- The feedback switch card shows its error state instead of breaking on an unexpected answer.
- Removed a GitHub scheduled job added for the same purpose; it never ran.

## Round 6: project report and presentation builder

- **Students** (Project Report & PPT): six steps — details, format, material, sections, write and edit, files. The report and the slides are written from the student's own files and answers into the chosen format, and downloaded as Word, PowerPoint and PDF. Every build is kept as a version.
- **HOD and Admin** (Project Formats): upload the official .docx and .pptx formats, see what was read from each, correct which wording stands for which field, switch a format off or delete an unused one. A student can also upload their own format, visible only to them.
- **Teachers** (Project Reviews): a project a student shares with them can be read page by page, downloaded and commented on.
- **Honesty checks.** A chapter with nothing behind it is not written; references and table rows are only ever the student's; a sentence with a percentage or decimal figure that is not in the student's material, a calculated figure, or a citation, is removed and listed for the student.
- **Formats are the base document**, not re-created: see `docs/project-formats.md`.
- **PDF** is made by LibreOffice in a separate small service (`pdf-converter/`), so the main backend is untouched. Without it, Word and PowerPoint downloads work and the app says PDF is not set up.
- Database: migration `d1e2f3a4b5c6` adds `project_templates`, `student_projects`, `project_materials`, `project_images`, `project_versions`, `project_jobs`, `project_comments`.
- New dependency: `pypdfium2` (turns PDF pages into pictures for the preview).

## Deployment note
- Stored-file links now end with the file's extension, so an older copy of the Achievements page (still served while the frontend deployment was pending) keeps recognising PDFs.
