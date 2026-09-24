# HOD Department Intelligence — Progress Log

## Session start: 2026-09-24

### Setup
- No git repository existed anywhere in the project. Initialized one at `major project/` root,
  made a baseline commit of the existing working app (161 files; `node_modules`, `venv`, `.next`,
  the real SQLite DB, and `data_raw/` all correctly excluded per existing `.gitignore` files),
  then created `feature/hod-department-intelligence` off that baseline.
- Added `.env.local` (frontend) and `db_backups/` (backend) to their respective `.gitignore`
  files — neither existed as ignore rules before, and both should never be committed
  (local dev config / timestamped real-data DB snapshots).
- Took a timestamped backup of the real SQLite DB before any further work:
  `anviksha-backend/db_backups/anviksha_dev_20260924_201119_pre_hod_intelligence.db`

### Note on the user's "don't stop, notify me once done" instruction
The original spec has explicit ⛔ STOP markers requiring approval after Phase 0 and after
every feature phase. The user's message overrides this: proceed through all phases without
waiting, and notify only at the end (or at a natural major milestone). This log still records
the Phase 0 findings and every decision in full, exactly as the STOP checkpoints would have
required — just without pausing for a reply.

---

## PHASE 0 — INVESTIGATION REPORT

Gathered via 4 parallel read-only investigations of the real codebase (no code changed in this phase).

### A. Models/tables table

| Requirement | Actual model/table | Key fields | Notes |
|---|---|---|---|
| HOD identity/dept | `User` (`models.py:273-284`) | `role`, `department_id`, `hod_title` | HOD is scoped via `User.department_id`, NOT via a `Faculty` row. No guarantee an HOD user has a matching `Faculty` record. |
| Department | `Department` | `id`, `name` | |
| Faculty | `Faculty` (`models.py:45-57`) | `id`, `name`, `department_id`, `designation`, `email`, `qualifications`, `vtu_teacher_id`, `extra_work` | No `status`/active flag. No reverse FK to `User`; lookup is always `User.faculty_id → Faculty.id`. |
| Subject | `Subject` (`models.py:60-72`) | `code` (unique), `name`, `department_id`, `semester`, `faculty_id` (nullable), `scheme` | Single-owner FK; multi-section teaching is via `TeachingAssignment`. |
| Teacher→Dept→Sem→Section→Subject | `TeachingAssignment` (`models.py:177-197`) | `faculty_id`, `batch`, `semester`, `section`, `subject_id`, `passed_out` | The documented single source of truth. `semester`/`subject_id` nullable only for a `passed_out=True` marker row. |
| Student | `Student` (`models.py:19-42`) | `usn`, `batch`, `semester`, `section`, `status`, `cgpa`, `attendance_pct`, `backlogs`, `semester_sgpa` (JSON), `data_status` | `status`: `"active"\|"passed_out"\|"unknown"`. |
| Attendance session | `AttendanceSession` (`models.py:75-82`) | `subject_id`, `date`, `marked_by_faculty_id` | No batch/section/semester field on the session itself. |
| Attendance record | `AttendanceRecord` (`models.py:85-92`) | `session_id`, `student_id`, `present` | |
| Marks | `Marks` (`models.py:95-102`) | `student_id`, `subject_id`, `exam_type` (`"IA-1"\|"IA-2"\|"IA-3"`), `marks_obtained`, `max_marks` | No date column. One row per (student, subject, exam_type); resave overwrites — no history. `"Semester"` exam_type is documented but never actually written anywhere. |
| Bloom's tagging | `QuestionBankChunk` (`models.py:155-174`) | `bloom_level`, `difficulty`, `marks`, `tag_source` | No FK to `Student`/`Marks`/any answer table — coverage-only, never linked to a real score. |
| Syllabus/module | `ModuleMapping` (`models.py:392-408`) | `module_name`, `chapter_titles` | Teacher-authored label for the AI content generator only — no completion %, no date, no student link. Not real syllabus-progress data. |
| Placement | `Placement` (`models.py:200-211`) | `student_id` (**unique**), `placed`, `placement_type` (`"Dream"\|"Regular"`), `company`, `ctc` (free string) | One row per student — no multi-drive/cycle history, no application-stage tracking. |
| Documents | `DocumentRequest` (`models.py:136-143`) | `student_id`, `type`, `purpose`, `status` (default `"Pending"`), `requested_date` | |
| Counseling | `CounselingNote` | `student_id`, `faculty_id`, `note`, `date` | Not otherwise used by this feature. |

### B. Backend routes relevant to this work

**Existing `hod.py`** (prefix `/hod`, all behind `require_role("hod")`):

| Method | Path | File:line | Notes |
|---|---|---|---|
| POST | `/hod/ask-ai` | hod.py:19-83 | |
| GET | `/hod/insight` | hod.py:86-109 | Uses `generate_dashboard_insight`. |
| GET | `/hod/me` | hod.py:121-124 | |
| GET | `/hod/stats` | hod.py:127-176 | **Does not accept** `backlog_batch`/`topperf_batch`/`topperf_limit` query params the frontend sends, and does not return `cgpa_by_batch`/`backlog_active_count` fields the dashboard reads. Pre-existing mismatch, not caused by this feature. |
| GET | `/hod/students` | hod.py:179-213 | |
| GET | `/hod/subjects` | hod.py:216-229 | |
| GET | `/hod/faculty` | hod.py:232-243 | |
| PATCH | `/hod/faculty/{id}/extra-work` | hod.py:250-260 | Dept-checked (404 out-of-dept). |
| GET | `/hod/faculty-workload` | hod.py:263-274 | |
| GET | `/hod/passed-out-years` | hod.py:277-287 | |
| GET | `/hod/placements` | hod.py:290-333 | Closest existing analogue to the new placement feature — same dept-scope pattern to mirror. |
| POST | `/hod/reports/query` | hod.py:336-349 | |

**Pre-existing frontend/backend mismatches found (not introduced by me, noted for the record per A1)**: the frontend calls `hodStudentsByBatch()` → `GET /hod/students-by-batch`, `hodFacultySubjects(id)` → `GET /hod/faculty/{id}/subjects`, `hodPlacementBatches()` → `GET /hod/placement-batches`, `hodPlacementComparison()` → `GET /hod/placement-comparison` — **none of these four endpoints exist in `hod.py`**. All calls are wrapped in silent `.catch()`, so the affected UI (batch dropdowns, per-faculty subjects modal, cycle comparison) currently renders empty rather than erroring. I am not fixing these as part of this feature (out of scope, and A1 says don't touch unless integration requires it) — flagged here for visibility only.

**Department resolution** — the one shared helper, `hod.py:112-118`:
```python
def _department_or_403(user: User, db: Session) -> Department:
    if not user.department_id:
        raise HTTPException(status_code=403, detail="This HOD account isn't linked to a department yet")
    dept = db.query(Department).filter(Department.id == user.department_id).first()
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")
    return dept
```
Every new endpoint in this feature will call this exact function — never re-implement department resolution.

**Role guard** — `app/core/security.py:52-57`, `require_role(*roles)`, used as `Depends(require_role("hod"))`.

### C. Reusable frontend components

- `anviksha-app/components/ui/Skeleton.tsx` — `DashboardSkeleton()`, `InlineSpinner()`.
- `anviksha-app/components/ui/Primitives.tsx` — `Card`, `SectionTitle`, `Button`, `Badge`.
- `anviksha-app/components/ui/Modal.tsx` — `CenterModal`.
- `anviksha-app/components/ui/Tabs.tsx` — `PillNav`.
- `anviksha-app/components/ui/Toaster.tsx` — `useToast`/`push`.
- `anviksha-app/components/ui/AIInsightCard.tsx` — existing AI insight card pattern.
- `anviksha-app/components/charts/Charts.tsx` — `DonutChart`, `SimpleBarChart`, `TrendLineChart`, `StudentRadarChart` (the latter two exist but are **not yet used anywhere on the HOD side** — available to reuse for Phase 1's trend line and Phase 4's Bloom's radar).
- No dedicated shared "EmptyState"/"ErrorState" component exists — every page inlines its own empty-state message. I will follow this same inline convention for new cards rather than inventing a new shared component (A8: no new architecture).

### D. Existing business rules (file:function)

- **At-risk — TWO CONTRADICTORY existing definitions found:**
  - `teacher.py:_real_subject_attendance_pct` (350-362) + `_real_internal_marks` (365-376) + `at_risk_students` (379-433): subject-scoped, `internal_marks < 10 OR attendance < 50%` (using `Marks` + per-subject `AttendanceSession`).
  - `hod.py:52` and `hod.py:96` (inline, not a function): `(s.backlogs or 0) > 0 or (s.attendance_pct is not None and s.attendance_pct < 75)` — department-scoped, uses `Student.backlogs`/`Student.attendance_pct` directly, never touches `Marks`.
  - **Resolution (documented decision, not asked back per user's "don't stop")**: the new HOD-facing At-Risk feature reuses the **HOD's own existing formula** (backlogs>0 OR attendance_pct<75%), not the teacher's. Rationale: this is already what "at-risk" means to an HOD today (surfaced in their existing `/hod/ask-ai` and `/hod/insight`); introducing the teacher's different, subject-scoped formula into a new HOD page would silently redefine what "at-risk count" means for the same role, which is a worse inconsistency than the one already latent between roles. Per A4, I extract this inline logic into one named, reusable function `_department_at_risk_students(db, dept)` in `hod.py` and point the two existing inline call sites at it too — verifying identical output before/after (this is the one "extract into a helper" case A4 explicitly permits).
- **CGPA**: purely a stored field (`Student.cgpa`, `Student.semester_sgpa`), never computed at runtime anywhere in `app/`. Reused as-is (`hod.py` already averages `Student.cgpa` for `avg_cgpa` display, e.g. `hod.py:146-147`) — no new CGPA math is introduced.
- **CTC tiers**: exists only in `admin.py:412-428`, inline, not extracted: Regular `< 6 LPA`, Dream `6-10 LPA`, Super Dream `> 10 LPA`, parsed via regex off the free-text `Placement.ctc` string, only over rows where a number was extractable. `hod.py`'s own `/placements` endpoint does NOT have this tier breakdown at all. Per A4 I extract this into `app/core/placement_rules.py::classify_ctc_tiers(placements)` and re-point `admin.py`'s endpoint at it (verifying identical output), then reuse the same function for the new HOD placement tiers donut.
- **Backlog**: `Student.backlogs` is a pre-set integer imported from source data / admin form — there is no backlog-derivation logic anywhere to reuse or extract; it's just read directly.
- **Pass/fail**: **does not exist anywhere in the codebase.** No threshold, no function, no field. This must be newly defined for Phase 4's pass-rate outliers (see §L/M).
- **Document-request pending count**: exists only in `admin.py` (3 duplicated call sites, e.g. `admin.py:52`), always **global**, never department-scoped. `hod.py` imports `DocumentRequest` but never queries it (dead import). No existing dept-scoped version to reuse — new code needed, following the same `join(Student).filter(Student.department_id == dept.id)` pattern already used in `hod.py`'s `/placements`.
- **Attendance % (subject-specific)**: `teacher.py:_real_subject_attendance_pct` (350-362) — reused as-is, imported directly, never re-implemented.
- **Teacher-assignment scoping**: `teacher.py:_matching_student_ids` (187-213), `_teacher_student_ids` (216-247), `_teacher_student_ids_for_subject` (250-267), `_active_batches` (270-276) — reused as-is via direct import into the new HOD module. This is the exact "section only enforced when real section data exists for that batch+semester" rule (probes for any non-null `Student.section` before applying the filter) — the single source of truth for assignment→roster mapping, and it will be imported, never duplicated.
- **Duplicate-session prevention**: `teacher.py:mark_attendance` (1508-1531) — uniqueness key is **Teacher + Subject + Date** (not batch/section). Read-only reuse for this feature (the new attendance dashboard only ever reads `AttendanceSession`/`AttendanceRecord`, never writes them) — no duplication of this logic needed since I'm not creating new attendance-marking endpoints.

### E. Duplicate-session prevention mechanism

`AttendanceSession` uniqueness = `(subject_id, date, marked_by_faculty_id)`, enforced by `mark_attendance`'s find-or-create query (`teacher.py:1509-1513`), with a full delete-and-replace of that session's `AttendanceRecord` rows on resubmission (not a merge). No batch/section is part of the key. This feature only reads this data; it never needs to enforce this rule itself.

### F. Timezone / "today" convention

**None exists.** Confirmed by exhaustive search: no `pytz`, no `zoneinfo`, no `date.today()` anywhere in `app/`. Every attendance date is a client-supplied `"YYYY-MM-DD"` string parsed with `datetime.strptime(...).date()` — the backend never independently computes "today" for anything academic. The only `datetime.utcnow()` usages are for JWT expiry and generated-file naming (unrelated to academic dates), and are naive (no tzinfo).

**Decision**: since none exists, I define one net-new, minimal convention for this feature only: `_today()` in the new HOD-intelligence module returns `date.today()` (server-local calendar date), documented as a new addition — not a claim of matching any pre-existing convention, because none exists. This is the one clean gap-fill Part A7/B6 anticipates; documented here rather than silently assumed.

### G. Bloom's data availability

**COVERAGE DATA ONLY.** `QuestionBankChunk.bloom_level` tags question-bank text chunks; there is no FK from any `Marks`/answer/score row to a question or its Bloom's level anywhere in the schema. It is impossible to compute "performance per Bloom's level" from real data — only "how many/what % of question-bank chunks are tagged at each level" (coverage). The Phase 4 Bloom's chart must therefore be a **Coverage** chart, never a performance radar, per the spec's own instruction for this exact classification.

### H. Placement stages actually supported

`Eligible (implicit: all students) → Placed`, with `Dream`/`Regular` as a **category of a placed offer**, not a funnel stage. No `Applied`/`Shortlisted`/`Interviewed` stage exists anywhere in the schema (`Placement` has only `placed: bool` + `placement_type: "Dream"|"Regular"|None`). A real multi-stage funnel (Eligible→Applied→Shortlisted→Offered→Selected) is **not supported by the data** — only a 2-stage funnel (Total→Placed) is honest.

### I. Syllabus progress data

**NOT AVAILABLE.** `ModuleMapping` is a teacher-authored chapter↔module label for the AI content generator, with no completion percentage, no date, and no link to actual classroom coverage or any student. No other syllabus/lesson-plan model exists anywhere. The "Syllabus Progress" sub-item under Faculty Monitoring in the target nav map is therefore **not built** (nothing to show that wouldn't be invented).

### J. Expected-activity data (timetable/deadlines)

**NOT AVAILABLE.** No timetable, weekly schedule, day-of-week, period, or "expected session count" concept exists anywhere in the schema. `TeachingAssignment` records *that* a teacher teaches a class, with zero temporal/periodic dimension.

**Alert types that are therefore implementable, and how, given this gap:**
1. **"Attendance record pending for {Subject} ({Sem}-{Sec})"** — IMPLEMENTABLE under a new, explicitly-documented, DB-grounded rule (since no timetable exists to define "expected" directly): a class (subject + batch + semester + section, from a real `TeachingAssignment`) is flagged only if it has **at least one real historical `AttendanceSession`** for that subject (proving it is an actively-tracked class, not inventing a schedule for something never once recorded) **and has no `AttendanceSession` dated today**. A class with zero attendance history ever is never flagged this way (that really would be inventing an expectation). This rule and its rationale are stated explicitly in the UI legend.
2. **"Internal marks entry pending for {Subject}"** — IMPLEMENTABLE, DB-grounded without a timetable: an "assessment" is considered to exist for a (subject, exam_type) the moment **at least one real `Marks` row** exists for that combination (proving that IA has genuinely started being entered) — students in that class still lacking a `Marks` row for that same exam_type are the pending count.
3. **"Delayed Academic Activities" / "Academic activity requires attention"** — **NOT IMPLEMENTABLE.** No due-date/deadline data of any kind exists in the schema to establish that something is "delayed" versus merely "not yet done." Per A7, this alert type and the "Attention Required" status tier (which explicitly requires a *passed* DB-established deadline) are **not built** — every alert in this feature caps out at "Pending", never "Attention Required", and the UI legend states plainly why.

### K. Trend/sparkline feasibility per metric

| Metric | Feasible? | Why |
|---|---|---|
| Attendance (department, day-over-day) | REDUCED — schema supports it (`AttendanceSession.date` is a real per-session date), but depends entirely on how much real attendance has actually been submitted live; there is no bulk-seeded historical seed data for attendance. Verified against the real DB during Phase 1 (see below). |
| At-risk count over time | NOT POSSIBLE | At-risk is computed live from current `Student` fields; no historical snapshot table exists. Shown as a current point value only. |
| CGPA | REDUCED | `Student.semester_sgpa` JSON gives one real point per completed semester (coarse, not daily) — enough for a per-semester sparkline, not a fine-grained trend. |
| Documents (pending count) | FULL | `DocumentRequest.requested_date` is a real per-request timestamp — a real time series is directly buildable. |
| Marks | NOT POSSIBLE | `Marks` has no date column at all, and each exam_type value is a single overwritten snapshot, not a history. |

### L. Feature feasibility matrix

| Feature | Feasibility | Why |
|---|---|---|
| Live Daily Attendance (headline, breakdown, heatmap) | **FULL** | Real `AttendanceSession`/`AttendanceRecord` data, real dept-scoping via `Student.department_id`, real duplicate-session key already governs one row per real session. |
| 7-14 day attendance trend | **REDUCED** | Schema-correct, but shows real gaps as "Pending"/absent-from-chart wherever the real DB genuinely has no submissions that day — verified against real data in Phase 1, not assumed. |
| Faculty Monitoring overview + table | **FULL** | All listed overview metrics are computable from `TeachingAssignment`, `AttendanceSession`, `Marks`, `Student` — no fabrication needed. |
| Faculty "Syllabus Progress" | **NOT POSSIBLE** | No syllabus/coverage data exists anywhere (§I). |
| Faculty Alerts: Missing Attendance | **FULL**, under the new documented history-based rule (§J.1) | |
| Faculty Alerts: Pending Marks | **FULL**, under the new documented rule (§J.2) | |
| Faculty Alerts: Delayed Academic Activities | **NOT POSSIBLE** | No deadline data exists (§J.3). |
| Faculty status (Up to Date / Pending / Attention Required) | **REDUCED** | "Attention Required" tier is never reachable (no deadline data) — legend states this; only "Up to Date"/"Pending" are ever shown. |
| Department Health Snapshot rollup | **FULL** | Pure rollup of already-computed Phase 1/existing values (today's attendance %, at-risk count via the reused HOD formula, avg CGPA, pending documents). |
| Pass-rate outliers | **REDUCED** | Requires a new pass/fail threshold since none exists anywhere (§D) — documented as a new, explicit rule (40% of available IA marks, VTU-convention) rather than reusing something that doesn't exist. |
| Bloom's chart | **REDUCED (Coverage only)** | Per §G — never labeled "performance". |
| Section comparison (same subject/semester) | **FULL** | Real `Marks`/`AttendanceRecord` data, grouped by real `Student.section` where it exists. |
| Repeat-offender subjects (backlog cross-reference) | **FULL**, reusing `Student.backlogs` directly (no computation exists to "reuse" beyond reading the stored field, per §D) | |
| Placement Funnel (multi-stage) | **REDUCED (2-stage: Total → Placed)** | No intermediate stages exist in `Placement` (§H). |
| Offer tiers donut | **FULL**, reusing extracted `classify_ctc_tiers` (§D) | |
| Cycle comparison | **REDUCED/conditional** | Only shown if ≥2 real distinct passed-out cohorts have placement data — checked against the real DB before deciding which branch renders (not assumed either way). |
| "Eligible but not applied" | **NOT POSSIBLE** | No application-stage tracking exists anywhere in `Placement` (§H). |
| AI Department Briefing | **FULL**, reusing existing `llm_client.generate_dashboard_insight` pattern + fallback | Deterministic template fallback built directly from Part D1 `explanation` fields when the AI is unavailable — never a second AI provider. |
| Faculty-level AI insight | **FULL**, same pattern, per-faculty context | |

### M. Risks and conflicts, each with the smallest compatible solution

1. **Two contradictory at-risk definitions** (teacher vs. HOD) — resolved by reusing the HOD's own existing formula for HOD-facing pages (see §D), extracting it into one named function shared by the two existing HOD inline call sites and the new feature, with an explicit before/after output-identity check.
2. **No pass/fail rule exists** — smallest compatible solution: define once, in one new constant/function (`PASS_THRESHOLD_PCT = 40`, VTU-convention 40% internal pass mark), used only by the new pass-rate-outliers feature; clearly labeled as a new rule in the final report, not presented as a pre-existing one.
3. **No timezone/"today" convention exists** — smallest compatible solution: one new `_today()` helper (server-local date), scoped to this feature's new files only; does not touch how `mark_attendance` or any existing endpoint computes/stores dates.
4. **CTC-tier logic duplicated inline in `admin.py`, not reusable as-is** — smallest compatible solution: extract to `app/core/placement_rules.py`, re-point `admin.py` at it (byte-for-byte identical output verified), then reuse for the new HOD tiers chart. This is a minimal, behavior-preserving touch to one existing file, explicitly permitted by A4.
5. **Pre-existing frontend/backend HOD mismatches** (`/hod/students-by-batch`, `/hod/faculty/{id}/subjects`, `/hod/placement-batches`, `/hod/placement-comparison`, and `/hod/stats` param/field mismatch) — **not fixed** as part of this feature; noted for the record only, since fixing them is unrelated to Department Intelligence / Faculty Monitoring and outside this task's scope. Flagged clearly here so they're not mistaken for something this feature broke.
6. **No timetable ⇒ two spec'd items are impossible** (Syllabus Progress, Delayed Academic Activities/Attention-Required status) — smallest compatible solution: omit them from the shipped nav/UI entirely (not stub them with fake data), and state plainly in the UI legend and this doc why.

### N. Proposed file plan

**New backend files** (all under `anviksha-backend/app/`):
- `core/hod_metrics.py` — the D1 traceable-metric contract helpers + `_today()` + shared query helpers (today's attendance rollup, weekly trend, heatmap, faculty overview/table/detail, alerts, pass-rate, Bloom's coverage, section comparison, repeat-offenders, placement funnel/tiers/cycle-comparison) — imports (never re-implements) `_matching_student_ids`/`_teacher_student_ids`/`_active_batches` from `routers/teacher.py`, and the new `_department_at_risk_students` / `classify_ctc_tiers` helpers described above.
- `core/placement_rules.py` — extracted `classify_ctc_tiers` / `parse_ctc_lpa`, used by both `admin.py` (refactor, output-verified identical) and the new HOD endpoints.
- `routers/hod_intelligence.py` — new FastAPI router, prefix `/hod/intelligence`, all endpoints behind the existing `require_role("hod")`, calling into `core/hod_metrics.py`. Included in `app/main.py` alongside the existing `hod` router (one-line addition).

**Minimal edits to existing backend files**:
- `app/main.py` — one import + one `app.include_router(...)` line for the new router.
- `app/routers/hod.py` — extract the inline at-risk list-comprehension (2 call sites) into a call to the new shared `_department_at_risk_students` helper; output verified identical before/after. No other change.
- `app/routers/admin.py` — replace the inline CTC-tier block with a call to `classify_ctc_tiers`; output verified identical before/after. No other change.

**New frontend files** (all under `anviksha-app/`):
- `lib/hodIntelligenceApi.ts` — thin client functions for the new endpoints only (kept separate from the main `lib/api.ts` per A9 modularity; `lib/api.ts` gets zero new lines).
- `components/charts/hod-intelligence/` — new chart wrapper components built on existing Recharts usage patterns (heatmap grid, funnel, radar-for-coverage, sparkline), reusing `Charts.tsx`'s existing `TrendLineChart`/`DonutChart`/`SimpleBarChart` where the chart type already exists, adding only the two genuinely new chart types (heatmap, funnel) as new small components.
- `components/ui/MetricExplain.tsx` — the one new shared "How is this calculated?" popover component (D1), used by every new metric card.
- `app/hod/faculty-monitoring/page.tsx` (+ subroutes/tabs as needed) — the new "Faculty Monitoring" page.
- Extend `anviksha-app/app/hod/page.tsx` with the new Department Health Snapshot card, live attendance section, and links into the new pages — additive sections only, nothing existing removed/reordered.
- `anviksha-app/app/hod/layout.tsx` — one new nav item entry ("Faculty Monitoring"), appended (not replacing any existing item).

**Migrations**: none planned for Phase 1-5 (everything is read/aggregate over existing tables). Phase 6 AI caching may use an in-memory TTL cache (no new table) — if a persisted cache table is ever needed, that would require a new approved migration; default plan avoids this entirely.

---

## Phase 0 status: COMPLETE. Proceeding directly into Phase 1 per user's override of the ⛔ STOP marker.
