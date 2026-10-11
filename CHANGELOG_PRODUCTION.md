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
