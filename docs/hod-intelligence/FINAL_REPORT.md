# HOD Department Intelligence & Faculty Monitoring — Final Report

Branch: `feature/hod-department-intelligence` (7 commits over the baseline). Full phase-by-phase
decision log: `docs/hod-intelligence/PROGRESS.md`. This report is the Part H summary.

## 1. Features delivered

| Feature | Status | Reason |
|---|---|---|
| Live Daily Attendance (headline, breakdown table, heatmap) | **FULL** | Real `AttendanceSession`/`AttendanceRecord` data, verified against the real DB. |
| 7-14 day attendance trend | **FULL** (code) / sparse in practice | Schema fully supports it; the real DB currently has only 2 historical sessions (Aug 2026), both outside the trailing 14-day window, so the trend correctly renders as all-"Pending" today rather than fabricating history. |
| Faculty Monitoring overview + table | **FULL** | |
| Faculty "Syllabus Progress" | **NOT POSSIBLE** | No syllabus/lesson-plan/coverage data exists anywhere in the schema. |
| Faculty Alerts: Missing Attendance | **FULL**, under a new documented rule | No timetable exists to define "expected"; rule instead requires real prior history for that exact subject+faculty, so nothing is ever invented. |
| Faculty Alerts: Pending Marks | **FULL**, under a new documented rule | Fires only once a real `Marks` row proves an assessment has genuinely started. |
| Faculty Alerts: Delayed Academic Activities | **NOT POSSIBLE** | No deadline/due-date data exists anywhere. |
| Faculty status (Up to Date / Pending / Attention Required) | **REDUCED** | "Attention Required" is never produced — it needs a passed DB-established deadline, which doesn't exist. UI legend states this. |
| Department Health Snapshot rollup | **FULL** | |
| Pass-rate outliers | **REDUCED** (code correct, real data insufficient) | The real `Marks` table has 0 rows department-wide, so this honestly reports "Marks data unavailable" against the real DB today. Logic verified correct via a synthetic isolated-test-DB case. |
| Bloom's Taxonomy chart | **REDUCED — Coverage only** | No data links any real score to a question's Bloom's level; never called "performance." Real and demonstrable today (106 real chunks, 69 tagged). |
| Section comparison | **NOT AVAILABLE in current real data** (code correct) | No student in the real DB has a section value at all; correctly reports "unavailable" rather than a fabricated comparison. |
| Repeat-offender subjects | **NOT POSSIBLE** (corrected from Phase 0's initial "FULL") | `Student.backlogs` is a single stored total with zero subject-level attribution anywhere in the schema — there's no real way to know which subject a backlog came from. |
| Placement Funnel | **REDUCED — 2-stage only (Tracked → Placed)** | `Placement` has only `placed` + `placement_type`, no Applied/Shortlisted/Interviewed stage anywhere. |
| Offer tiers donut | **FULL** | Reuses the exact rule `admin.py` already used. |
| Cycle comparison | **FULL** | Real DB has 4 real passed-out cohorts (2022/2024/2025/2026) with genuine placement history. |
| "Eligible but not applied" | **NOT POSSIBLE** | No application-stage tracking exists anywhere in `Placement`. |
| AI Department Briefing | **FULL** | Real Groq connection, real grounding, real post-generation numeric/language validation, real deterministic fallback. |
| Faculty-level AI insight | **FULL** | Same pattern, scoped to one real faculty member. |

## 2. Files created and modified

### New backend files
- `app/core/hod_metrics.py` — all new department-analytics query logic (D1 contract, severity, attendance, faculty monitoring/alerts, health snapshot, assessment intelligence, placement funnel, AI briefing + validation). The single place this feature's new logic lives.
- `app/core/placement_rules.py` — CTC-tier classification, extracted from `admin.py` so both routers share one rule.
- `app/routers/hod_intelligence.py` — new router, prefix `/hod/intelligence`, every endpoint behind the existing `require_role("hod")`.
- `tests/__init__.py`, `tests/conftest.py`, `tests/test_hod_*.py` (7 files, 27 tests) — this project had zero tests before this feature; a full pytest scaffold (isolated in-memory SQLite DB, JWT-minting helper, two-department fixture) was built as part of it.

### New frontend files
- `lib/hodIntelligenceApi.ts` — thin client for every new endpoint, kept out of the existing `lib/api.ts`.
- `hooks/useLiveRefresh.ts` — the one shared 45s-poll/focus-refetch/hidden-pause refresh strategy.
- `components/ui/MetricExplain.tsx` — the shared "How is this calculated?" popover.
- `components/charts/hod-intelligence/severity.ts`, `AttendanceHeatmap.tsx`, `HorizontalBarChart.tsx` — the shared severity map and the two genuinely new chart types (heatmap, horizontal bar) Recharts didn't already provide.
- `components/hod-intelligence/LiveAttendanceSection.tsx`, `DepartmentHealthSnapshot.tsx`, `PlacementFunnelSection.tsx`, `DepartmentBriefingCard.tsx` — the feature sections themselves.
- `app/hod/faculty-monitoring/page.tsx`, `app/hod/assessment-analytics/page.tsx` — the two genuinely new pages (their domains had no existing page to extend).

### Modified existing files (every one minimal, listed with reason)
| File | Reason |
|---|---|
| `app/main.py` | +1 import, +1 `include_router` line for the new router. |
| `app/hod/layout.tsx` | +2 new nav items ("Faculty Monitoring", "Assessment Analytics"), appended — nothing renamed/removed/reordered. |
| `app/hod/page.tsx` | +3 additive sections (`DepartmentBriefingCard`, `DepartmentHealthSnapshot`, `LiveAttendanceSection`) inserted between existing, untouched sections. |
| `app/hod/placements/page.tsx` | +1 additive section (`PlacementFunnelSection`) appended after existing, untouched content. |
| `app/routers/admin.py` | CTC-tier block replaced with a call to the extracted, shared `classify_ctc_tiers` — **verified byte-for-byte identical output** via a real before/after capture against the live DB before committing. |
| `requirements.txt` | +`pytest`, +`httpx` (test-only; no runtime behavior change). |
| `anviksha-app/.gitignore`, `anviksha-backend/.gitignore` | Added `.env.local`, `db_backups/`, `*.log` — none of these existed as ignore rules before; all are things that should never be committed. |

**Nothing else was touched.** No existing endpoint's behavior changed except the one verified-identical `admin.py` extraction.

## 3. Business rules reused (file:function) and new rules defined

**Reused, never re-implemented:**
- `_matching_student_ids`, `_teacher_student_ids`, `_teacher_student_ids_for_subject`, `_active_batches` — `app/routers/teacher.py` (teaching-assignment → real-student-roster mapping, including the "section only enforced when real section data exists" rule).
- `_real_subject_attendance_pct` — `app/routers/teacher.py` (subject-specific attendance %).
- The HOD's own at-risk formula (backlogs>0 OR attendance<75%) — extracted from `hod.py`'s two inline call sites into `hod_metrics.py::at_risk_from_students`, byte-identical, and those two call sites now point at it.
- CTC-tier classification (Regular <6 / Dream 6-10 / Super Dream >10 LPA) — extracted from `admin.py` into `placement_rules.py::classify_ctc_tiers`, verified byte-identical output.
- `_department_or_403` — `app/routers/hod.py` (department resolution), imported directly, never duplicated.
- `require_role("hod")` — `app/core/security.py`, used on every single new endpoint.
- `generate_dashboard_insight`'s prompt/fallback pattern and `_call_with_fallback` — `app/core/llm_client.py`.

**New rules, explicitly documented (nothing like them existed before):**
| Rule | Value | Where |
|---|---|---|
| Attendance severity thresholds | green ≥75%, amber ≥50%, red <50% | `hod_metrics.py::attendance_severity` — reuses the app's own existing 75%/50% attendance thresholds (from hod.py's and teacher.py's own at-risk rules), not invented numbers. |
| Internal-marks pass threshold | ≥40% of available max_marks | `hod_metrics.py::PASS_THRESHOLD_PCT` — standard VTU convention; nothing existed to reuse. |
| Pass-rate outlier threshold | >15 percentage points from department average | `hod_metrics.py::PASS_RATE_OUTLIER_THRESHOLD_PP` |
| "Today" convention | server-local `date.today()` | `hod_metrics.py::_today()` — no timezone/"today" concept existed anywhere in the backend before this. |
| Briefing cache TTL | 5 minutes, in-memory, per department/faculty | `hod_metrics.py::_BRIEFING_CACHE_TTL_SECONDS` |

## 4. Alert and status condition definitions

- **Missing attendance**: fires for a (faculty, subject) pair only if that faculty has recorded ≥1 real `AttendanceSession` for that subject historically (proving it's a real, tracked class) AND has recorded none today. A subject with zero attendance history ever is never flagged.
- **Pending marks**: fires for a (subject, exam_type) only if ≥1 real `Marks` row already exists for it (proving the assessment has genuinely started); the count is real enrolled students still missing that exam_type's row.
- **Faculty status**: `Up to Date` (0 open alerts) or `Pending` (≥1 open alert). `Attention Required` is defined in code (`faculty_status`) but structurally unreachable — it would require a passed DB-established deadline, and none exists. The UI states this plainly rather than hiding the tier silently.

## 5. Migrations

**None.** Every phase was read/aggregate-only over existing tables. If a persisted briefing-cache table is ever wanted instead of the in-memory one, that would need a new, separately-approved Alembic revision — deliberately avoided here.

## 6. Validation and regression results

- Backend: `python -m compileall app` clean at every phase. `pytest` — **27/27 passing** (final count; grew from 0 pre-existing tests). `alembic current`/`heads` both `b2c3d4e5f6a7` throughout — no drift.
- Frontend: `npx tsc --noEmit` clean at every phase. `next build` clean at every phase — **44/44 routes** in the final build (was 42 before this feature; two new pages added). `next lint` — no ESLint config exists anywhere in this project (confirmed via the interactive setup prompt); this predates the feature and wasn't introduced or fixed here.
- Regression checklist, final pass (fresh JWTs per role against the live server):
  - **Student**: `/student/dashboard` 200, `/student/ask-ai` 200.
  - **Teacher**: `/teacher/dashboard-stats` 200, `/teacher/students` 200, `/teacher/my-batches` 200.
  - **HOD (existing, untouched)**: `/hod/stats`, `/hod/students`, `/hod/faculty`, `/hod/placements`, `/hod/faculty-workload` — all 200, unaffected.
  - **HOD (new, all 6 phases)**: `/hod/intelligence/attendance/today`, `/faculty/overview`, `/health-snapshot`, `/assessment/bloom-coverage`, `/placement/funnel`, `/briefing` — all 200.
  - **Admin**: `/admin/stats` 200, `/admin/placements` 200 (the refactored one — output verified byte-identical to pre-refactor).
  - **Cross-role guard**: teacher JWT → 403 on new HOD routes; student JWT → 403; unauthenticated → 401.
  - All 13 relevant frontend routes (login, hod × 7, teacher × 3, student, admin) return 200 after a full dev-server restart.

## 7. Known limitations & what data would unlock the reduced features

- **Sections**: not one of 327 real students has a `Section` value. Populating it (Admin's student-edit already supports a `section` field) would make section-scoped attendance breakdowns, heatmap columns, and section comparison show real per-section splits instead of collapsing to a single bucket — the code is already written to do this the moment the data exists.
- **Marks**: the real `Marks` table has 0 rows. Populating real IA marks would immediately activate pass-rate outliers, the "average internal marks" faculty-detail figures, and the pending-marks alert — again, no code change needed.
- **Timetable/schedule**: no day/period/expected-session data exists anywhere. Adding one would let "missing attendance" become schedule-based instead of history-based, and would make the "Attention Required" status tier and a real "Delayed Academic Activities" alert type finally meaningful.
- **Syllabus/lesson-plan coverage**: doesn't exist at all. Adding a module-completion-percentage field (per teaching assignment, per date) would unlock "Syllabus Progress" as specified in the original nav map.
- **Backlog-to-subject attribution**: `Student.backlogs` is a lifetime total with no subject link. A per-subject backlog/arrear table would be required to ever build "repeat-offender subjects" honestly.
- **Placement stages**: `Placement` has no Applied/Shortlisted/Interviewed field. Adding a `stage` column (or a separate drive/application table) would unlock a real multi-stage funnel and "eligible but not applied."

## 8. How to remove this feature cleanly

1. Delete `app/core/hod_metrics.py`, `app/routers/hod_intelligence.py`, `app/core/placement_rules.py`.
2. Remove the 2 lines in `app/main.py` (`hod_intelligence` import + `include_router`).
3. Revert `app/routers/admin.py`'s CTC-tier block to its pre-extraction inline form (or leave the extraction — it's harmless and now `placement_rules.py` would need to stay, or be inlined back).
4. Revert `app/routers/hod.py`'s two at-risk call sites back to their inline form (optional — `at_risk_from_students` lives in the file being deleted, so this revert is required if step 1 is done first).
5. Delete the 2 new frontend pages (`app/hod/faculty-monitoring/`, `app/hod/assessment-analytics/`), the `components/hod-intelligence/` and `components/charts/hod-intelligence/` folders, `components/ui/MetricExplain.tsx`, `hooks/useLiveRefresh.ts`, `lib/hodIntelligenceApi.ts`.
6. Remove the 2 nav entries from `app/hod/layout.tsx` and the additive `<...Section/>`/`<...Card/>` lines from `app/hod/page.tsx` and `app/hod/placements/page.tsx`.
7. Delete `tests/` entirely (or keep it — it's a real, standalone pytest scaffold with no dependency on the rest of this feature beyond the tests themselves).
8. No migration to roll back — none was made.

No existing table, endpoint, or page requires any change to complete this removal.
