# QA report

Tested 2026-10-13 against commit `9ad5e92` on `deploy/production-setup`.

## What "live" means in this report

| Part | State |
|---|---|
| Backend (Render) | Live on the latest commit |
| Database (Supabase) | Seven migrations applied; latest revision `c0d1e2f3a4b5` |
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

## Round 3: the remaining features (13 Oct, later)

Built after the sections above were written: notifications, dark mode, the feedback switch, the student planner and calendar, announcements and the placement wall, placement pages for student and teacher, placement records for HOD and admin, the admin pages (login accounts, bulk import, departments and subject allocation), resume templates, and themes and photos for PowerPoint.

| Layer | Result |
|---|---|
| Backend automated tests | 111 of 111 pass |
| Frontend type-check and production build | Pass (59 pages) |
| Live backend, the new endpoints as each role | 39 of 39 pass |
| Newest build, every page × 4 roles × 2 widths, live data | 62 pages, 0 issues |
| Newest build, new screens used end to end at 1440 px and 360 px (stand-in data) | 148 of 148 pass |
| Resume templates (real student) and PowerPoint preview (stand-in data) | 41 of 41 pass |
| Dark mode, 20 real pages, scan for unreadable text | 0 found |

| Feature | Verified on live URL | Newest build | How it was checked |
|---|---|---|---|
| Notifications: unread count, relative time, a notice opens its page and only that one is marked read, "Mark all as read" | Not yet (Vercel) | Pass | Browser, stand-in data. Backend live: each notice carries its link |
| Dark mode: switch in the top bar, remembered, no white flash | Not yet (Vercel) | Pass | Browser; 20 real pages scanned for low-contrast text |
| Feedback switch: closed until the teacher or HOD opens a subject; students are notified; answers kept when closed | Backend live | Pass | 2 automated tests; browser as teacher, HOD and student. On the live data all 12 of the test student's subjects are closed, as intended |
| Student planner: own notes (with formatting), deadlines with date, time, priority and reminder, calendar, "due soon" on the dashboard | Backend live | Pass | Browser end to end; on the live backend one private item was created, edited, found in the calendar and deleted, leaving the planner as it was |
| Announcements for all four roles, with the placement wall | Backend live (read) | Pass | Automated test of who sees what; browser as each role. Nothing was posted on the live site, because a post notifies real people |
| Student "Placements & Internships": every offer and internship, headline is the best offer not declined | Backend live | Pass | Live data: the test student shows 1 offer and 1 internship |
| Teacher "Student Placements" | Backend live | Pass | Live data: 70 students, 6 placed |
| Placement records for HOD and admin: add, edit, delete, export; CSV import with preview (admin) | Backend live (read, and a preview that wrote nothing) | Pass | Automated tests; browser end to end with stand-in data. Live: an unknown name was refused in the preview and left no trace |
| Admin login accounts: create, change role, deactivate, reset password | Backend live (read) | Pass | Automated test, including that a deactivated account cannot sign in and an open session stops working |
| Admin bulk student import with preview, problem report and login sheet | Backend live (preview only) | Pass | Automated test; live preview flagged an existing USN and a bad row and wrote nothing |
| Departments, batches and subject allocation | Backend live (read) | Pass | Live data: 1 department, 5 batches, 67 subjects of which 7 have no teacher yet |
| Resume: Classic, Minimal and ATS Friendly now differ in layout, in the preview and in the PDF | Not yet (Vercel) | Pass | Real student: three PDFs downloaded at both widths |
| PowerPoint: five colour themes; a photo per slide with credit, or a designed panel when there is none | Backend live (export with a theme) | Pass | 4 automated tests. Photos need `PEXELS_API_KEY`; without it every slide gets the designed panel, never an empty box |

### Found and fixed in this round

- A student whose best-paid offer had been declined saw that declined offer as their headline. The headline is now the best offer they have not turned down.
- The resume showed "Company (null)" for an internship with no dates, and a stray "|" after the USN when no department was recorded.
- The career objective was shown in the resume preview but left out of the downloaded PDF.
- Long resume sections ran off the bottom of the PDF page instead of continuing on the next one.

## Round 4: HOD filters and exports, reminders, device alerts (13 Oct, last)

| Layer | Result |
|---|---|
| Backend automated tests | 112 of 112 pass |
| Frontend type-check and production build | Pass (59 pages) |
| HOD pages on live data, 1440 px and 390 px, plus device alerts | 44 of 44 pass |
| Earlier new-screen checks, run again | 148 of 148 pass |

| Feature | Verified on live URL | Newest build | How it was checked |
|---|---|---|---|
| HOD Department Students: batch, semester, status, search and page are kept in the address; export of every matching student | Not yet (Vercel) | Pass | Live data: batch 2023 active gave 70 students and a 70-row file, though the screen shows 25 a page |
| HOD Placement Analytics: batch kept in the address | Not yet (Vercel) | Pass | Live data: 70 tracked for batch 2023, 258 for all |
| HOD dashboard, Faculty Monitoring, Assessment Analytics: filters, tab and chosen subject kept in the address | Not yet (Vercel) | Pass | Live data, including a reload |
| Export on Faculty Workload, Faculty Monitoring, Faculty Feedback and Pass-Rate Outliers | Not yet (Vercel) | Pass | Live data: each file had the same 16 rows as the table |
| Deadline reminder: a student's own deadline with the reminder on becomes one notification when it is within a day of falling due | Backend live | Pass | Automated test: once only, not for finished or other students' items |
| Device alerts: an opt-in switch in the notification panel shows new notices as system notifications | Not yet (Vercel) | Pass | Browser with a stand-in server: one alert per new notice, none repeated |

Found and fixed: two filters changed in quick succession could undo each other (clearing filters while a search was still being typed brought the old filters back).

## Not tested, and why

| Item | Reason |
|---|---|
| The newest frontend at the Vercel address | Vercel has not put it into production |
| Writing actions on the live site through the browser (posting an announcement, opening feedback, creating a login, importing students, adding a placement) | They would create real records or notify real people. Each is covered by automated tests and by browser tests with stand-in data |
| Real photos in an exported PowerPoint | Needs `PEXELS_API_KEY` in Render. Tested with a stand-in photo service |
| Reading the downloaded resume PDFs page by page | Checked that each downloads as a valid PDF and that the previews differ; the PDFs were not opened and read |
| Tablet widths 768 px and 1024 px | The sweeps used 1440 px and 390 px, and the new screens also 360 px |
| Other browsers | All browser tests used Chromium |
| Screen readers | Not tested. New controls carry labels and roles (switch, checkbox, tab, dialog) |
| Lint | The project has no lint configuration; type-check and build are the gates |

## Known issues

1. **Vercel production is behind.** Set Settings → Git → Production Branch to `deploy/production-setup`, then promote the newest deployment. Until then none of this round's screens are visible at the live address.
2. **Feedback is now closed everywhere until someone opens it.** A teacher opens it under Performance & Feedback → Student feedback; an HOD under Faculty Feedback → a faculty member.
3. **One certificate file was not uploaded**: `4GW23IS042_1786439470_test_cert.pdf` is not a valid PDF.
4. **Assistant reply time varies** with the AI provider: usually 3–8 seconds, sometimes longer. Under a burst of questions the provider throttles; the assistant says so instead of hanging.
5. **Question bank text is uneven.** Some stored questions carry leftover table columns (marks, CO, level) at the end; most are cleaned, a few are not.
6. **Files uploaded before the storage bucket existed are gone** and need uploading again.
7. **Server sleeps when idle** until an uptime monitor is set up; the first visit after a quiet period takes about 50 seconds.
8. **Reminders and announcements are not emailed.** Student records hold no email address (logins are `usn@anviksha.ai`, which is not a real mailbox), so there is nowhere to send to. They arrive as in-app notifications, and as device alerts for anyone who switches those on.
9. **Device alerts work only while the site is open in a browser tab**, and not on iPhone Safari. Alerts with the site fully closed would need a push service set up.
10. **Dark mode recolours charts' surroundings but not the chart colours themselves**, and the resume, question paper and slide previews stay white on purpose, as they are pictures of a printed page.
11. **A login cannot be deleted, only deactivated**, in line with the rule that nothing real is deleted.

## Still to configure

| Where | What |
|---|---|
| Vercel | Production Branch = `deploy/production-setup`, then promote the newest deployment |
| UptimeRobot (or similar) | Monitor `https://anviksha-backend.onrender.com/health` every 5 minutes |
| Render | `PEXELS_API_KEY` for photos in PowerPoint (free key from pexels.com/api) |
| Supabase | Change the database password (it was shared in a chat) and update `DATABASE_URL` in Render |
| Each test account | Change the password from the profile page |

## Not built yet

- Email delivery of reminders and announcements. It needs two decisions from you first: real email addresses for students (none are stored), and an email-sending service with its key.
- Alerts when the site is completely closed (true push).
- Deleting the hidden demo certificates and achievements: waiting for your confirmation.

## Assistant: final live run

Fifteen checks against the live backend with the real AI, after the time-limit fix:

- **14 answered correctly**, each in 2.5–8 seconds with no hanging. Two of these were marked as misses by the automatic checker and confirmed correct by reading them: "highest package in the 2027 batch" answered ₹22.0 LPA without naming the company, and the internship stipend was written "₹75 000" with a thin space.
- **1 was throttled.** The chart request was the last of a rapid burst and the AI provider refused it. The assistant replied "The assistant is handling a lot of requests right now. Please try again in a minute." The same request succeeded in the browser test minutes earlier.
- An HOD trying to open a student's chat was refused.

An earlier run of the same fifteen questions, before the fix, hung for ten minutes after the sixth question for the same underlying reason. That is the behaviour the fix removes.

**What this means in use:** the AI provider is on its free tier, which limits how much can be asked per minute. One person asking questions at a normal pace is fine. Several evaluators using the assistant at the same moment could see the "try again in a minute" message. A paid tier on the provider removes that limit.
