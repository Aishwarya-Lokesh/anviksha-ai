# QA report

Tested 2026-10-13 against commit `9ad5e92` on `deploy/production-setup`.

## What "live" means in this report

| Part | State |
|---|---|
| Backend (Render) | Live on the latest commit |
| Database (Supabase) | Six migrations applied; latest revision `b9c0d1e2f3a4` |
| File storage (Supabase) | Private bucket `anviksha-uploads`, reachable, 68 of 69 certificate files present |
| Frontend (Vercel) | **Production is still on an older commit (`3397feb`, 11 Oct).** Vercel builds this branch as Preview, and has not built the most recent pushes |

Because of the last row, results are given in two columns:

- **Live site** — the website at the Vercel address as it is today (older frontend, current backend).
- **Newest build** — the current frontend built on this computer and run against the live backend and live data. This is what the live site will be once Vercel's production is updated.

Test accounts: one existing account per role (admin, HOD, one teacher, one student). All browser testing was read-only except where a row says otherwise; test chats created by the assistant checks were deleted afterwards.

## Summary

| Layer | Result |
|---|---|
| Backend automated tests | 94 of 94 pass |
| Frontend type-check and production build | Pass (49 pages) |
| Live backend, read-only checks as each role | 41 of 41 pass |
| Live backend, every read-only endpoint | 93 called, 0 server errors |
| Live site, every page × 4 roles × 2 widths | 45 pages, 0 issues |
| Newest build, every page × 4 roles × 2 widths | 45 pages, 0 issues |
| Role boundaries | Every cross-role request tried was refused |

"0 issues" for a page means: it rendered with its navigation, no script crash, no failed request, no console error, no sideways scrolling, no broken image, none of the old developer or dummy-data wording, and no error message on screen.

## By feature

Widths: desktop 1440 px, phone 390 px (some suites use 360 px).

| Feature | How it was checked | Live site | Newest build |
|---|---|---|---|
| Sign in, all four roles | Real sign-in on the live backend | ✅ | ✅ |
| Wrong role / signed out | Requests to other roles' endpoints; visiting pages signed out | ✅ refused | ✅ refused |
| Session expiry | Invalid token → returned to sign-in with a notice | ✅ | ✅ |
| Navigation: sidebar, collapse, bottom bar, drawer | Browser, all roles, both widths | ✅ | ✅ |
| 404 page | Unknown address | ✅ | ✅ |
| Search (Ctrl/Cmd + K) | Real search as each role; 25-step suite with stand-in data | ✅ | ✅ |
| Search stays within role | Student searching a classmate's name → nothing | ✅ | ✅ |
| Profile pages, photo, change password | 25-step suite with stand-in data; live profile data read for all roles | ✅ pages load | ✅ |
| Student dashboard, Profile Score | Live: score 850 = Excellence Score (800 CGPA + 50 certificate) | ✅ | ✅ |
| Achievements and certificates | Live: real certificate opens in the viewer, downloads as PDF; bare file address refused | ⚠️ older viewer, opens | ✅ in-app viewer |
| Notes & Deadlines | Live: student sees 1 note, 1 deadline | ✅ | ✅ |
| Student placement and internships | Live: Deutsche Bank, 22 LPA, PPO; internship ₹75,000 / month | ✅ | ✅ |
| Feedback (student, teacher, HOD) | 40-step suite with stand-in data; live: student sees 12 subjects, teacher and HOD see "no feedback yet" | ✅ pages load | ✅ |
| HOD batch filters and comparison | Live: batches 2020–2024 with correct totals; comparison 2021 / 2022 / 2023 | ✅ | ✅ |
| HOD placements | Live: batch 2023 = 6 of 70 placed, highest 22 LPA, Mindsprint 4 offers, highest-package company Deutsche Bank | ✅ | ✅ |
| Admin dashboard, users, datasets, logs | Pages load with live data, no sample data | ✅ | ✅ |
| Admin document requests | Live: was a server error, now returns the 2 requests | ✅ | ✅ |
| Question paper generator | Live generation for three subjects: two fully different sets each, single-question replace; 36-step suite incl. PDF and Word export | ⚠️ older page | ✅ |
| AI assistant | Live with the real AI; see below | ⚠️ older chat page | ✅ |
| Stored files (certificates, resumes, note attachments) | Open only through signed, expiring links | ✅ | ✅ |
| Mobile layout | Every page at phone width | ✅ | ✅ |

⚠️ = works, but the live site still shows the previous version of that screen.

### AI assistant, on the live backend with the real AI

Results of the final run are recorded in the section "Assistant: final live run" at the end of this file.

Answers checked against the database:

| Asked as | Question | Answer |
|---|---|---|
| HOD | Who got placed at Mindsprint? | The four confirmed 2023-batch students at 5.2 LPA (plus two from the 2021 batch) ✅ |
| HOD | Highest package in the 2027 batch? | 22 LPA ✅ |
| HOD | Which students did internships and what stipend? | Lists them with company and stipend ✅ |
| Admin | How many ISE students are placed so far in the 2023 batch? | 6 of 70 ✅ |
| Student | What's my placement status? then "did I do an internship there?" | Deutsche Bank, 22 LPA, PPO; internship ₹75,000 / month ✅ |
| Student | A classmate's CGPA and package | Refused: "I don't have that data" ✅ |
| Student | Names of classmates placed at Mindsprint | Refused ✅ |
| Teacher | Summarise my student feedback | Says none has been recorded yet ✅ |
| HOD | Average IA-1 mark in Computer Networks | "I don't have that data" (no marks exist) ✅ |
| HOD | Bar chart of placement percentage by batch | Chart drawn with the database's figures ✅ |

## Not tested, and why

| Item | Reason |
|---|---|
| The newest frontend at the Vercel address | Vercel has not put it into production |
| Writing actions on the live site through the browser (posting a note, saving marks, submitting feedback, uploading a file, changing a password) | They would create or change real records. Each is covered by automated tests and by browser tests with stand-in data |
| Tablet widths 768 px and 1024 px on the live site | Checked earlier for the navigation with stand-in data; the live sweeps used 1440 px and 390 px |
| PowerPoint generator output | Not changed in this work; image support is still to be built |
| Resume PDF output | Not changed in this work |
| Other browsers | All browser tests used Chromium |
| Screen readers | Not tested |

## Known issues

1. **Vercel production is behind.** Set Settings → Git → Production Branch to `deploy/production-setup`, then promote the newest deployment.
2. **One certificate file was not uploaded**: `4GW23IS042_1786439470_test_cert.pdf` is not a valid PDF.
3. **Assistant reply time varies** with the AI provider: usually 3–8 seconds, sometimes longer. Under a burst of questions the provider throttles; the assistant now says so instead of hanging.
4. **Question bank text is uneven.** Some stored questions carry leftover table columns (marks, CO, level) at the end; most are cleaned, a few are not.
5. **Files uploaded before the storage bucket existed are gone.** They were on the server's temporary disk. Confirmed for the one existing note attachment (it now reports "file not found" cleanly; before this round it produced a server error). The three achievement proofs students uploaded in that period are very likely affected too, but I could not check them without signing in as those students. All need uploading again.
6. **Server sleeps when idle** until an uptime monitor is set up; the first visit after a quiet period takes about 50 seconds.

## Still to configure

| Where | What |
|---|---|
| Vercel | Production Branch = `deploy/production-setup` |
| UptimeRobot (or similar) | Monitor `https://anviksha-backend.onrender.com/health` every 5 minutes |
| Render | `PEXELS_API_KEY`, when PowerPoint images are built |
| Supabase | Change the database password (it was shared in a chat) and update `DATABASE_URL` in Render |
| Each test account | Change the password from the profile page |

## Not built yet

Placement dashboards for student, teacher and admin; admin bulk import, department and batch management, subject allocation, roles, audit log; notifications redesign; dark mode; students' own notes and calendar; resume templates; a switch to open and close feedback; PowerPoint images.

## Assistant: final live run

Fifteen checks against the live backend with the real AI, after the time-limit fix:

- **14 answered correctly**, each in 2.5–8 seconds with no hanging. Two of these were marked as misses by the automatic checker and confirmed correct by reading them: "highest package in the 2027 batch" answered ₹22.0 LPA without naming the company, and the internship stipend was written "₹75 000" with a thin space.
- **1 was throttled.** The chart request was the last of a rapid burst and the AI provider refused it. The assistant replied "The assistant is handling a lot of requests right now. Please try again in a minute." The same request succeeded in the browser test minutes earlier.
- An HOD trying to open a student's chat was refused.

An earlier run of the same fifteen questions, before the fix, hung for ten minutes after the sixth question for the same underlying reason. That is the behaviour the fix removes.

**What this means in use:** the AI provider is on its free tier, which limits how much can be asked per minute. One person asking questions at a normal pace is fine. Several evaluators using the assistant at the same moment could see the "try again in a minute" message. A paid tier on the provider removes that limit.
