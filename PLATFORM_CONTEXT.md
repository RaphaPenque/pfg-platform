# PFG Platform — Context Document

> **READ THIS BEFORE TOUCHING ANY CODE.**
>
> This document is the single source of truth for any agent working on this platform. It must be loaded at the start of every session. It must be updated after every change. Violating the rules in this document causes real operational harm — this platform is how PowerForce Global runs its business.

---

## What This Platform Is

The **PFG Workforce Intelligence Platform** is not just a tool — **it is PowerForce Global**. Every worker, project, timesheet, and report on this platform represents real people, real jobs, and real money. Decisions about staffing, billing, health & safety, and customer relationships are made directly from data on this platform.

It is the company's **single source of truth** and its **operational backbone**.

PowerForce Global is a specialist labour supply company operating in the energy sector — specifically outage maintenance and craft labour for power generation facilities. They supply skilled technicians (e.g. turbine engineers, supervisors) to projects at power stations, typically on fixed-term contracts.

The platform will eventually evolve into a full CRM: when a sale is closed, a project is automatically created, and all downstream operations — staffing, logistics, execution, billing, closure — flow through the platform from that single trigger.

---

## The Project Lifecycle (End-to-End)

Every feature on this platform exists to support one or more stages of this lifecycle. **An agent must understand this sequence before making any change.**

```
1. PROJECT CREATED
   └─ Project record created with code, customer, location, dates, contract type

2. ROLES PLANNED
   └─ Role slots defined: what roles are needed, how many, for what period
   └─ Drives headcount planning and Gantt chart

3. WORKERS ALLOCATED
   └─ Workers assigned to role slots
   └─ Smart matching logic considers:
       - Availability (no conflicting active assignments)
       - Employment type (FTE vs Temp)
       - Job role match
       - Utilisation (prefer underutilised workers)
       - OEM experience (prior experience with that manufacturer)
       - Direct equipment experience (GT, ST, STV etc.)
   └─ Assignment confirmation sent to worker via email

4. PRE-PROJECT PLANNING  ⚠️ NOT YET BUILT
   └─ Logistics planning (travel, flights, accommodation)
   └─ PPE requests (sizes from worker profiles → warehouse)

5. MOBILISATION  ⚠️ NOT YET BUILT IN PORTAL
   └─ Logistics tab exists but is not operational
   └─ Workers travel to site

6. PROJECT EXECUTION (ON SITE)
   └─ Daily Reports logged (tasks, delays, personnel notes, tooling, WP variations)
   └─ Safety Observations filed
   └─ Incidents reported
   └─ Toolbox Talks logged
   └─ Supervisor Reports submitted (email or upload)
   └─ Weekly Timesheets submitted → PM approved → Sent to Customer
   └─ Weekly Reports published to Customer Portal

7. PROJECT COMPLETION
   └─ Customer Satisfaction Survey sent and collected
   └─ Lessons Learned completed
   └─ Milestone / Completion Certificates issued and approved

8. PROJECT CLOSED
   └─ Status set to Completed
   └─ Workers return to available pool
```

---

## Architecture & Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite, Wouter (hash routing) |
| UI Components | Radix UI + shadcn/ui, Tailwind CSS |
| State / Data | TanStack React Query |
| Backend | Node.js, Express 5 |
| Database | PostgreSQL (production via Render), Drizzle ORM |
| Auth | Magic link email (no passwords), session cookies (`pfg_session`) |
| Email | Microsoft Graph API (Azure MSAL) |
| PDF generation | jsPDF, pdf-lib, html-pdf |
| Hosting | Render.com (web service + managed PostgreSQL) |
| Repo | `RaphaPenque/pfg-platform` on GitHub, `main` branch |

**Routing:** The app uses **hash-based routing** (`useHashLocation` from wouter). All internal navigation is `/#/path`. The server routes everything to the SPA except `/api/*` and known public routes.

**Database migrations:** There is no Drizzle migrate workflow. Schema changes are applied via `runSchemaUpdates()` in `server/migrate-to-postgres.ts`, which runs on every server boot using `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. New tables and columns must be added there.

**File storage:** Uploaded files (passports, certificates, reports) are stored at `/data/uploads/` on the Render persistent disk. Never delete or restructure this path.

---

## Database Schema — Tables & Relationships

### Core entities and their relationships:

```
workers ──────────────────────────────────────────────────────┐
  │                                                            │
  ├── assignments (worker_id → workers.id)                    │
  │     ├── project_id → projects.id                          │
  │     └── role_slot_id → role_slots.id                      │
  │                                                            │
  ├── documents (worker_id → workers.id)                      │
  ├── work_experience (worker_id → workers.id)                │
  └── oem_experience (worker_id → workers.id)                 │
                                                               │
projects ─────────────────────────────────────────────────────┘
  │
  ├── role_slots (project_id → projects.id)
  │     └── role_slot_periods (role_slot_id → role_slots.id)
  │
  ├── work_packages (project_id → projects.id)
  ├── daily_reports (project_id → projects.id)
  │     └── daily_report_wp_progress (report_id, wp_id)
  ├── comments_log (project_id → projects.id)
  ├── delay_approvals (project_id, report_id)
  ├── supervisor_reports (project_id → projects.id)
  ├── toolbox_talks (project_id → projects.id)
  ├── safety_observations (project_id → projects.id)
  ├── incident_reports (project_id → projects.id)
  ├── milestone_certificates (project_id → projects.id)
  ├── weekly_reports (project_id → projects.id)
  ├── survey_tokens (project_id → projects.id)
  ├── survey_responses (project_id → projects.id)
  ├── lessons_learned (project_id → projects.id)
  ├── project_leads (project_id → projects.id)
  └── payroll_rules (cost_centre — not a FK, matched by value)

users
  ├── sessions (user_id → users.id)
  ├── magic_links (email, not FK)
  └── audit_logs (user_id → users.id)
```

### Worker statuses (business meaning):
- `available` — on the bench, can be allocated to a new project
- `allocated` — has an upcoming or active assignment
- `on_site` — currently working on a project
- `standby` — assigned but not currently active on site
- `unavailable` — cannot be assigned (leave, training, personal)

### Worker employment types:
- `FTE` — Full-Time Employee (permanent headcount)
- `Temp` — Temporary / contract worker

### Assignment statuses:
- `active` — confirmed, currently running
- `flagged` — used in timesheet engine (included in timesheets alongside active)
- `completed` — finished
- `cancelled` — removed

### Project statuses:
- `active` — currently running (default view shows these)
- `potential` — pipeline / not yet confirmed (shown in default view)
- `completed` — finished
- `cancelled` — abandoned
- Default view shows `active` + `potential`. `completed` and `cancelled` are toggled on/off.

---

## Critical Data Cascade — The Chain That Must Never Break

**If any link in this chain is wrong, everything downstream is wrong:**

```
Worker Profile
  → Assignment (links worker to project + role slot)
    → Timesheet entries (built from active/flagged assignments)
      → PM Approval
        → Customer email + timesheet sent to customer
          → Customer Portal (approved timesheet visible)

Role Slots
  → Assignments
    → Gantt Chart (visual timeline of who is where)
    → Person Schedule (utilisation view per worker)
    → "On Site Now" KPI (count of workers active today)

Project
  → Daily Reports → Weekly Report (aggregated) → Customer Portal
  → Work Packages → Milestone Certificates → Customer Approval
  → Survey Tokens → Survey Responses → NPS / satisfaction scores
```

**Key rule:** If a worker is assigned to a project, they:
1. Cannot be assigned to another overlapping project
2. Must appear on that project's timesheets
3. Must appear in the Customer Portal team list
4. Must be reflected in Gantt, Schedule, and utilisation KPIs

---

## Modules — What Exists, What Works, What Doesn't

### ✅ Stable / Working
| Module | Location | Notes |
|---|---|---|
| Workforce Table | `WorkforceTable.tsx` | Main worker list, filters, SQEP |
| Project Hub | `ProjectHub.tsx`, `ProjectHubDetail.tsx` | Project list + detail tabs |
| Project Team tab | `ProjectTeamTab.tsx` | Workers on a project |
| Gantt Chart | `GanttChart.tsx` | Visual timeline |
| Person Schedule | `PersonSchedule.tsx` | Per-worker utilisation |
| Daily Report Hub | `DailyReportHub.tsx` | Daily reports per project |
| Commercial Tab | `CommercialTab.tsx` | Working |
| Timesheet flow | `TimesheetHub.tsx`, `timesheet-routes.ts` | Complex — see section below |
| Customer Portal | `CustomerPortal.tsx` | Token-gated, per-project |
| User Management | `UserManagement.tsx` | Admin only |
| Payroll Rules | `PayrollRules.tsx` | Admin only |
| Magic link auth | `server/routes.ts` | Session cookie based |
| Email poller | `server/email-poller.ts` | Receive-only — active |

### ⚠️ Partially Built / Known Issues
| Module | Issue |
|---|---|
| Team Allocation logic | Not functioning correctly — worker matching/filtering unreliable |
| Customer Portal PDF | SQEP pack / customer report PDF not pulling data correctly |
| Milestone / Completion Certificates | `MilestoneCertificateTab.tsx` — not functioning properly yet |
| Logistics tab | Exists in Project Hub but not operational |
| Lessons Learned tab | Exists but not in correct format for proper use |

### 🔴 Deliberately Off / Not Built Yet
| Feature | Status | Rule |
|---|---|---|
| All auto-sends | **DISABLED** | Weekly reports, timesheet reminders, survey reminders are all manual-only. Re-enable one-by-one after end-to-end testing. See `server/index.ts` commented-out setIntervals |
| Email poller sends | **RECEIVE ONLY** | Poller may never trigger outbound sends |
| Billing Summaries | Pre-built, not in use | Do not activate without explicit instruction |
| Payroll exports | Pre-built, not in use | Do not activate without explicit instruction |
| Pre-project planning | Not built | Future feature |
| Logistics (operational) | Not built | Future feature |
| PPE requests | Not built | Future feature |
| Mobile app | Concept only | Not in development |
| Audit Trail (manual temp confirmations) | Deferred | Do not build |
| CRM / sales pipeline | Future phase | Not in current scope |

---

## The Timesheet Flow (Most Fragile Area)

The timesheet system is the most complex and most frequently broken part of the platform. Every agent must read `server/timesheet-routes.ts` (1,832 lines) before touching anything timesheet-related.

**Correct flow:**
```
1. Timesheet entries built from active + flagged assignments (not completed/cancelled)
2. Worker submits timesheet
3. Supervisor reviews (optional, project-dependent)
4. PM approves
5. PM sends to customer → customer receives email with approval link
6. Customer approves via token link
```

**Recall flow:**
```
Recalled timesheet → reverts to DRAFT (all timestamps cleared)
PM can edit directly in draft state
PM can re-approve and resend without worker resubmission
```

**Known history of breakages in this area:**
- Auto-sends caused mass duplicate emails during server restarts → all auto-sends now permanently disabled
- Resend logic caused duplicate sends → fixed with `sentAt` check
- `reset-and-resend` endpoint was added to fix stuck `sent_to_customer` status
- `restore-tw-timestamps` endpoint exists to recover from bad resets
- `rebuild-timesheets` internal endpoint available for rebuilding entries
- Timesheet entries must only include `active` and `flagged` assignments (not all)

---

## Email System

- Outbound via **Microsoft Graph API** (Azure MSAL credentials in env vars)
- Login emails (magic links) send from the configured sender — **not James** (this was a bug, now fixed)
- Assignment confirmations send from the platform email
- Customer portal links, timesheet approvals, milestone approvals all use **signed tokens** in URLs
- **All scheduled/automated sends are disabled.** Only manual triggers from the platform UI send emails.
- Email poller (`server/email-poller.ts`) runs every 15 minutes — **receive only**

---

## Authentication

- No passwords. Magic link only.
- Login sends a time-limited token to the user's email
- Token verified at `/api/auth/verify?token=...` → sets `pfg_session` cookie
- Session stored in `sessions` table, validated on every `requireAuth` middleware call
- User roles: `admin`, `resource_manager`, `project_manager`, `finance`, `observer`
- Public routes (no auth): `/portal/*`, `/confirm/*`, `/milestone-approval/*`, `/timesheet-approval/*`, `/timesheet-supervisor/*`

---

## Routes Reference

### Frontend (Hash Router)
| Path | Component | Auth |
|---|---|---|
| `/#/` | WorkforceTable | Required |
| `/#/projects` | ProjectHub | Required |
| `/#/projects/:code` | ProjectHubDetail | Required |
| `/#/projects/allocation` | ProjectAllocation | Required |
| `/#/gantt` | GanttChart | Required |
| `/#/schedule` | PersonSchedule | Required |
| `/#/admin/payroll-rules` | PayrollRules | Admin only |
| `/#/admin/users` | UserManagement | Admin only |
| `/#/portal/:projectCode` | CustomerPortal | Public (token) |
| `/#/confirm/:token` | ConfirmAssignment | Public |
| `/#/milestone-approval/:token` | MilestoneApprovalPage | Public |
| `/#/timesheet-approval/:token` | TimesheetApprovalPage | Public |
| `/#/timesheet-supervisor/:token` | TimesheetSupervisorPage | Public |

### Backend (Key API groups in `server/routes.ts`)
- `/api/auth/*` — login, verify, logout, session
- `/api/workers/*` — CRUD, documents, SQEP, OEM experience
- `/api/projects/*` — CRUD, role slots, assignments, portal
- `/api/timesheets/*` — in `server/timesheet-routes.ts`
- `/api/daily-reports/*` — daily report CRUD
- `/api/weekly-reports/*` — weekly report generation + send
- `/api/supervisor-reports/*` — email-in and upload
- `/api/toolbox-talks/*`, `/api/safety-observations/*`, `/api/incidents/*`
- `/api/milestone-certificates/*`
- `/api/surveys/*`
- `/api/payroll-rules/*`
- `/api/workers/fte-count` — returns `{ count }` live count of workers with `status = 'FTE'`; used by GanttChart demand curve as the FTE baseline (replaces the previous hardcoded `FTE_BASELINE = 54`)

---

## Non-Negotiable Rules for Every Session

These apply **regardless of how simple the task appears**:

### 1. Understand before touching
Before writing a single line of code, read every file that the change will touch. State explicitly what you are going to change and what other parts of the system connect to it.

### 2. One change at a time
Never bundle multiple fixes or improvements into a single commit. Each commit should do exactly one thing. If you discover a second issue while fixing the first, stop — report it, do not fix it inline.

### 3. Confirm the plan first
Always write out the plan and explicitly state what files will be changed and why. Wait for approval before writing any code.

### 4. Never silently change behaviour
If you change a function that is called from multiple places, identify every caller first. State the downstream impact. Do not assume a change is isolated.

### 5. Never re-enable disabled features
The commented-out auto-sends in `server/index.ts` are disabled deliberately. Do not uncomment them. Do not re-enable any manual-first feature without an explicit conversation.

### 6. The platform is the business
Every field, every status, every workflow exists because it maps to a real operation at PowerForce Global. If something seems redundant or confusing, ask — do not remove or simplify it.

---

## Session Start Checklist

At the start of every platform session, do the following **before accepting any task**:

1. **Read this file** (`PLATFORM_CONTEXT.md`)
2. **Read `CHANGELOG.md`** (last 5 entries) for recent changes
3. **Identify which module** the task touches
4. **Check the "Partially Built / Known Issues" table** — is this area flagged?
5. **Check the "Deliberately Off" table** — does the task risk activating something that should stay off?
6. Only then: write a plan and wait for approval

---

## Health Check — Last Run

> Run: 2026-04-24 (late evening) | 68 checks | **0 critical failures, 18 warnings, 50 passed**

Sections: A projects · B role slots · C timesheets · D headcount · E workers · F portal/customer emails · G assignments · H workers core fields · I person schedule · J documents · K FTE baseline + worker deployment · L UI card data accuracy · **M filter & logic consistency (new, 2026-04-24 late evening)**

The Active Projects card on the Gantt Chart was fixed this session to filter `status='active'` only (previously included `completed` and `confirmed`, inflating the count from 11 to 20).

| Status | Issue |
|---|---|
| ✅ PASS | No duplicate timesheet entries |
| ✅ PASS | Section H — all workers have valid `employment_type` (Telmo Alfaro id=178 fixed this session) |
| ✅ PASS | Section K1 — `GanttChart.tsx` does not contain hardcoded `FTE_BASELINE` constant |
| ✅ PASS | Section K2 — 0 workers with `status` outside `['FTE', 'Temp']` |
| ✅ PASS | Section K3 — Deployed Today count plausible (0–200) |
| 🟡 WARN | Stale `headcount` field (Target) on GNT, GRTY — now displayed separately as "Target Headcount"; live count shown correctly |
| 🟡 WARN | Projects with no assigned workers: OSKSHM, OLKL1, GIL, SZWL, DHC — expected, pending reassignment |
| 🟡 WARN | Missing timesheet signatory + customer PM emails on OSKSHM, OLKL1, GIL, SZWL, DHC — intentional |
| 🟡 WARN | No daily reports published to portal on OSKSHM, OLKL1, GIL, SZWL, DHC — expected |
| 🟡 WARN | 18 timesheet entries with 0 hours in approved state — residual, harmless |
| 🟡 WARN | No timesheet week for current Monday 2026-04-20 — not yet built |
| 🟡 WARN | Section I — 5 person schedule overlaps (Luka Stefanac, Luka Brozovic, Antonio Manuel Moreira dos Santos + 2 more) — INFO only, historical |

Run the health check again before starting any new development: `DATABASE_URL=... npm run health-check`

### Section K (added 2026-04-24 evening)
- **K1**: Code-content check — verifies `client/src/pages/GanttChart.tsx` does NOT contain the hardcoded constant `FTE_BASELINE`. FAIL if present (prevents regression of the hardcode fix).
- **K2**: Verifies 0 workers have `status` outside `['FTE', 'Temp']`. FAIL if violated.
- **K3**: Deployed Today count plausible (0–200). WARN if out of range.

### Section L (added 2026-04-24 late evening)
- **L1**: Active Projects ground truth — `SELECT COUNT(*) FROM projects WHERE status='active'`. FAIL if 0 (DB state wrong). The Gantt Active Projects card must match this number.
- **L2**: Workforce headcount — FTE + Temp counts. FAIL if either is 0.
- **L3**: Deployed Today — distinct workers with an active assignment (`active`/`confirmed`/`flagged`/`pending_confirmation`) whose role_slot_period spans today. WARN if > 200.
- **L4**: Available FTE — FTE workers with no active assignment today. WARN if > total FTE (impossible).

### Section M — Filter & Logic Consistency (added 2026-04-24 late evening)
- **M1**: Available filter uses `isCurrentlyActive` (date-aware), not status-only
- **M2**: GanttChart `activeProjects` filter is `status='active'` only
- **M3**: PersonSchedule `VISIBLE_ASSIGNMENT_STATUSES` matches shared constants
- **M4**: `calcUtilisation` excludes cancelled/declined

---

## Filter Specification — Non-Negotiable Rules

### Available Filter (WorkforceTable)
- Definition: worker has NO active assignment where start_date <= today <= end_date
- Future assignments (start_date > today) do NOT make a worker "Assigned"
- Implementation MUST use `isCurrentlyActive(assignment, slot?.periods)` — not raw status check
- Health check: M1 verifies this on every run

### Assigned Filter (WorkforceTable)
- Definition: worker HAS an active assignment where start_date <= today <= end_date
- Same `isCurrentlyActive` logic — must match "Deployed Today" card exactly

### Active Projects Filter (GanttChart)
- Definition: projects WHERE `status = 'active'` ONLY
- `completed`/`confirmed`/`cancelled` must NEVER be counted as "active"
- Health check: M2 verifies this on every run

### Person Schedule Visibility
- Shows: `active`, `confirmed`, `completed`, `pending_confirmation`, `flagged` assignments
- Hides: `cancelled`, `declined`, `removed`
- Must match `SCHEDULE_VISIBLE_STATUSES` in `shared/assignment-status.ts`
- Health check: M3 verifies this on every run

---

## UI Card Data — Source of Truth

Every summary card in the platform must be backed by a DB query. This table is the authoritative mapping.

| Card | Page | DB Query | Health Check |
|---|---|---|---|
| Active Projects | Gantt Chart | SELECT COUNT(*) FROM projects WHERE status='active' | L1 |
| Total Positions | Gantt Chart | Sum of headcount on active project rows (from assignments) | — |
| Peak Demand | Gantt Chart | Max simultaneous workers across any week on active projects | — |
| FTE Baseline | Gantt Chart | SELECT COUNT(*) FROM workers WHERE status='FTE' (via /api/workers/fte-count) | K1 |
| Headcount (FTE/Temp) | Workforce Table | SELECT COUNT(*) FROM workers WHERE status='FTE'/'Temp' | L2 |
| FTE Utilisation % | Workforce Table | calcUtilisation() avg across FTE workers (187-day basis, excl. cancelled/declined) | — |
| Deployed Today | Workforce Table | Workers with active assignment where role_slot_period spans today | L3 |
| Available FTE | Workforce Table | FTE workers with no active assignment spanning today | L4 |

**Known technical debt:** `Total Positions` and `Peak Demand` on the Gantt Chart are frontend-computed from assignment data — no direct DB validation in the health check yet. Add coverage when tackling Gantt summary data.

---

## Changelog

> Keep a running log of significant changes. Most recent first. Format: `YYYY-MM-DD | What changed | Why | Files touched`

### 2026-04-23 — PDF Generation Fix + Report Regeneration
- Fixed `server/report-scheduler.ts`: safety observations array, toolbox talks array, and delay report dates were not being passed to the PDF generator. Generator was correct; scheduler was only passing scalar counts.
- Fixed `server/routes.ts` (one-off regenerate endpoint): comment mapping used `{ shift, text }` but generator expected `{ entry, userName }` — caused split error. Fixed to match type.
- Regenerated GRTY w/c 13 Apr (weekly_reports id=1) PDF with corrected data: obsCount=6, tbtCount=7, delayCount=8.
- One-off regenerate endpoint removed after successful use.
- Auto-generated project codes: new format PREFIX-YEAR-SEQ (e.g. GEV-2026-001), auto-populated on project creation form, duplicate 409 handling added.
- Headcount variants (3): project overview live count + target field, Gantt peak headcount (date-aware), demand curve includes confirmed assignments.
- Duplicate timesheet fix: expanded skip guard (sent_to_customer, pm_approved) + stale-worker DELETE.
- Health-check C4 threshold fixed: >1 → >7 (was causing false positive on legitimate daily reports).

| Date | Change | Reason | Files |
|---|---|---|---|
| 2026-04-23 | Add duplicate code handling to POST /api/projects — returns 409 instead of raw DB error on duplicate code | Previously surfaced as unhandled 500 | `server/routes.ts` |
| 2026-04-23 | Auto-populate project code from customer name on project creation form — calls generate-code endpoint, user can override, code resets on modal close | Eliminates free-text code entry errors | `client/src/pages/ProjectHub.tsx` |
| 2026-04-23 | Add POST /api/projects/generate-code endpoint — derives 3-char prefix from customer name, sequences by year (e.g. GEV-2026-001). Existing project codes unchanged. | Standardises new project codes to format PREFIX-YEAR-SEQ | `server/routes.ts` |
| 2026-04-23 | Headcount variant 3 — demand curve now includes `confirmed` assignments (committed headcount, not just active) | Confirmed workers are real committed headcount and must show on demand curve | `client/src/pages/GanttChart.tsx` |
| 2026-04-23 | Headcount variant 2 — Gantt headcount column now shows peak headcount (max simultaneous workers on any day, active + confirmed, date-aware 7-day sampling) | Was only counting active assignments with no date awareness | `client/src/pages/GanttChart.tsx` |
| 2026-04-23 | Headcount variant 1 — project overview now shows live "On Site Today" count (active + confirmed assignments covering today) plus separate editable "Target Headcount" field | Was showing a stale manually-entered number | `client/src/pages/ProjectHubDetail.tsx` |
| 2026-04-23 | Fixed health-check.ts C4 duplicate entries check — threshold was `> 1` (wrong, flags every worker) corrected to `> 7` (one row per day × 7 days = correct) | Health check was reporting 397 false-positive critical failures | `scripts/health-check.ts` |
| 2026-04-23 | Fixed timesheet rebuild — expanded week-skip guard to include `sent_to_customer` and `pm_approved` weeks; added stale-worker DELETE to clean orphan entries from cancelled assignments | Prevents duplicate entries when assignments are replaced; protects GRTY w/c 13 Apr 2026 (sent_to_customer) from being overwritten | `server/timesheet-routes.ts` |
| 2026-04-23 | **KNOWN BUG — NOT YET FIXED:** 404 duplicate timesheet entries on GNT and GRTY. Root cause: timesheet rebuild creates new day entries for new assignments without clearing entries from old `removed` assignments on the same worker/week. Fix needed in `server/timesheet-routes.ts` — rebuild logic must check for existing entries before inserting. DO NOT touch timesheet rebuild logic without reading this first. The one real submitted timesheet (GRTY w/c 13 April, status: `sent_to_customer`) must not be affected by the fix. | Known bug | `server/timesheet-routes.ts` |
| 2026-04-23 | Added `capacity_planning` as valid project status across server, Gantt, Schedule, Allocation pages and health check | HEY-001 and CAR-ST were failing health check with invalid status | `server/routes.ts`, `GanttChart.tsx`, `PersonSchedule.tsx`, `ProjectAllocation.tsx`, `health-check.ts` |
| 2026-04-23 | Cancelled 66 assignments outside GNT/GRTY on active projects (DHC, GIL, HEY-001, OLKL1, OSKSHM, SZWL) and marked 33 assignments completed on finished projects (TRNS, SALT, SVRN, TRNZN) | Clean slate before fresh reassignment | DB direct |
| 2026-04-23 | Fixed customer portal loading (grey boxes) — added `/api/portal/*` to auth middleware bypass | Customers with no session cookie were being blocked by auth middleware before reaching portal API | `server/routes.ts` line 795 |

### 2026-04-23 (afternoon) — Role Slot Deletion + Portal Data Fixes

**Fix 1 — Role slot deletion (commit 01fb386):**
- DELETE /api/role-slots/:id now blocks deletion if real workers are assigned (returns 409 with clear message)
- Cascade-deletes placeholder (worker_id IS NULL) assignments before deleting the slot
- Added requireAuth middleware (was missing)

**Fix 2 — Portal weekly report showing zeros (commit 1b9dd9f):**
- Root cause: aggregated_data stored keys as `safetyData`/`delaysLog`/`commentsEntries` but portal frontend reads `safetyStats`/`delays`/`comments`
- Fixed key names in report-scheduler.ts aggregatedData object
- Added toolboxTalks and safetyObservations arrays to aggregatedData
- Re-patched live GRTY weekly_reports id=1 row with corrected key names

**Fix 3 — Blank comment text in weekly reports (commit f3668ae):**
- Root cause: original report generation captured comment rows before users had entered text (entry was blank)
- Added .filter((c) => (c.entry || '').trim()) before both reportComments.map() calls in report-scheduler.ts
- Re-patched GRTY weekly_reports id=1 aggregated_data.comments with 6 real comment entries for w/c 13–19 Apr

**Known upcoming work (Piece 2):**
- Remove QTY field from role slot creation (slots are always quantity 1)
- Period splitting + demob action from Team tab
- Timesheet filter: show workers whose assignment period overlaps the selected week

### 2026-04-23 (evening) — Role Planning + Team Tab + Timesheet Redesign (Piece 2)

**2A — Migrate multi-qty role slots (commit d20cb0f):**
- Migration script expanded 23 multi-qty role_slots into individual quantity-1 slots
- 83 slots → 152 slots. All periods copied to new slots. Ran atomically in one transaction.
- Script: scripts/migrate-multi-qty-slots.ts

**2B — Remove QTY from role slot creation (commit 62b02ab):**
- Removed QTY input field from frontend form (ProjectRolePlanningTab.tsx)
- Backend POST /api/role-slots now hardcodes quantity: 1, ignores any qty in request body
- One slot = one named position. Add multiple slots for multiple workers in the same role.

**2C — Demob action + period splitting (commit dd5c3c6):**
- New endpoint: POST /api/role-slot-periods/:id/demob — takes { demobDate }
- Splits period at demob date: current period end_date = demobDate, new 'remob' period created for remainder (worker_id = NULL)
- If demobDate == endDate: marks period as completed, no split
- Demob button added to Active Personnel tab in Team tab with inline date picker

**2D — Timesheet worker filter (commit 4e34745):**
- Timesheet now only shows workers whose role_slot_period overlaps the selected week
- Overlap check: period.start_date <= weekEnd AND period.end_date >= weekStart
- Workers demobbed mid-week still appear on that week's timesheet
- Fix applied in server/timesheet-routes.ts (buildTimesheetEntries)

**Note on role_slot_periods schema:**
- role_slot_periods has NO worker_id or status columns in this codebase
- Worker assignment is via the assignments table (assignment → role_slot → role_slot_periods)

### 2026-04-23 (late evening) — Role Slot Deletion Refinement + PM Permissions

**Fix — Role slot deletion refinement (commit fcbaea3):**
- Treat cancelled/completed assignments as safe to cascade-delete (same as null-worker placeholders)
- Only active/confirmed worker assignments now block role slot deletion
- Fixes: slots with cancelled assignments were incorrectly blocking deletion

**Fix — PM permissions match Resource Manager (commit 0294af9):**
- Add Worker button on Workforce Table now visible to project_manager role (was admin/RM only — UI/server mismatch)
- POST/PATCH/DELETE /api/role-slots now require admin/resource_manager/project_manager (previously auth-only — security gap closed)
- PATCH /api/projects/:id now allows resource_manager (fixes Commercial tab 403 for RMs)
- ProjectHubDetail.tsx required no changes — PMs already paired with RMs via isAdminOrPM at every tab/access check

**Remaining priority list:**
1. Re-assign workers to projects (DHC, GIL, OSKSHM, OLKL1, SZWL, HEY-001, CAR-ST, GNT)
2. Clean up stale timesheet_entries after workforce reassignment (one-off DB script)
3. Review completed project data accuracy (TRNS, SALT, SVRN, TRNZN)
4. Add health check coverage for generated document content (PDF data validation)
5. Piece 2 — Timesheet stale worker display (will self-resolve after reassignment + cleanup script)

### 2026-04-23 (night) — Demand Curve + PM Permissions

**Fix — Demand curve includes completed projects (commit 0a1fa26):**
- GanttChart.tsx line 122: changed status filter from `=== "active"` to `["active", "confirmed", "completed"]`
- Completed projects (e.g. TRNS/Torness) now show historical headcount on the demand curve
- Cancelled projects remain excluded
- Summary cards (Active Projects, Total Positions, Peak Demand) also benefit from this fix

**Note — Demand curve filter is frontend-only:**
- Backend /api/dashboard returns all projects with no status filter
- The STATUS_FILTERS UI toggles only affect Gantt table rows, not the demand curve

| 2026-04-21 | Added portal access token per-project | Secure customer portal access | `shared/schema.ts`, `server/routes.ts` |
| 2026-04-21 | Fixed On Site Now KPI to use server-side period-aware count | Frontend count was wrong | `server/routes.ts`, `client/src/hooks/use-dashboard-data.ts` |
| 2026-04-20 | DISABLED all auto-sends | Mass duplicate emails during restarts | `server/index.ts` |
| 2026-04-20 | Fixed send-to-customer: rollback on failure, allow resend | Stuck `sent_to_customer` states | `server/timesheet-routes.ts` |
| 2026-04-19 | Fixed recall: PM can edit directly in draft, re-approve without worker resubmission | PM workflow improvement | `server/timesheet-routes.ts` |
| 2026-04-19 | DB fix + env restore | Production outage recovery | `server/index.ts` |

## Platform Data Chain — How Everything Connects

### Core data flow
Role Planning (role_slots + role_slot_periods)
  → Team tab (assignments — links workers to role_slot_periods)
  → Person Schedule (reads assignments + role_slot_periods for timeline)
  → Workforce Table (reads assignments for utilization % and availability)
  → Timesheets (reads assignments to determine which workers appear per week)
  → Weekly Reports / PDF (reads timesheet_entries + daily_reports + assignments)
  → Customer Portal (reads weekly_reports.aggregated_data)

### Key rules
- A stale assignment (active/confirmed on a completed/cancelled project) poisons ALL downstream views simultaneously: Person Schedule shows wrong bars, Workforce Table shows wrong utilization, Timesheets show wrong workers
- Utilization = (sum of assignment calendar days in current year, excluding cancelled/declined, minus 2 travel days per assignment) / 187 target days × 100%
- Timesheet workers = only those with a role_slot_period overlapping the selected week
- Portal data = weekly_reports.aggregated_data JSONB (keys: safetyStats, delays, comments, toolboxTalks, safetyObservations, teamMembers)
- Role slots = always quantity 1. One slot = one named position. Multiple periods per slot = different workers at different stages.

### 2026-04-23 (session close) — Utilization + Schedule Fixes
- calcUtilisation rewritten: date-based current-year calc, excludes cancelled/declined, 2 travel days per assignment period (commit c3e39a9)
- 27 stale assignments on TRNS + SALT marked completed (cleanup-stale-assignments.ts)
- Health check section I added: Person Schedule and assignment accuracy (I1 stale assignments, I2 overlapping assignments, I3 utilization outliers)
- Demand curve includes completed projects (commit 0a1fa26 / 98308be)
- PM permissions match Resource Manager (commit 0294af9)

### 2026-04-24 (evening) — Session #4: FTE Baseline + Worker Data Fixes + Health Check Section K

**Fixes — Worker data cleanup:**
- Joao Paulo (commit e4c2d75): status already correct (`Temp`); idempotent script documents the state.
- Telmo Alfaro id=178 (commit 5a7c1b3): `employment_type` was `null` → corrected to `'Temp'`. Resolves Section H warning.

**Fix — FTE Baseline no longer hardcoded (commit 6d668de):**
- `client/src/pages/GanttChart.tsx` previously had `const FTE_BASELINE = 54` hardcoded. Removed.
- New backend endpoint `GET /api/workers/fte-count` returns `{ count }` from live DB (`SELECT COUNT(*) FROM workers WHERE status = 'FTE'`).
- GanttChart fetches the count on mount via `useEffect`; demand curve baseline now tracks live FTE headcount.

**Health check Section K added (commits f295c50, fa49928):**
- K1: code-content check — verifies `GanttChart.tsx` does NOT contain `FTE_BASELINE` (prevents hardcode regression). PASS.
- K2: verifies 0 workers have `status` outside `['FTE', 'Temp']`. PASS.
- K3: Deployed Today count plausible (0–200). PASS.
- Runtime bug fixes in Section K: ESM `__dirname` handling, correct `role_slot_periods` join column, date cast.

**Health check state at session close: 64 checks — 0 failed, 18 warnings, 46 passed.**
- H warning (Telmo Alfaro employment_type) resolved.
- F warning for MIT-2026-002 missing portal token resolved (token now present).
- K1/K2/K3 all passing.
- Remaining 18 warnings are all operational / expected: C2/C3 timesheets, D1 stale headcount, F missing emails/portal reports, I person schedule overlaps (5 workers, historical).

### 2026-04-24 (late evening) — UI Card Data Accuracy

**Fix — GanttChart Active Projects count (commit e5206e5):**
- `client/src/pages/GanttChart.tsx` line 129: filter was `status === 'active' || 'confirmed' || 'completed'` — inflated card count from 11 (true active) to 20.
- Corrected to `status === 'active'` only. `activeProjectIds` used downstream for the demand curve is derived from `activeProjects`, so the fix propagates automatically: demand curve now only reflects active projects.

**Health check Section L added (commit 2cf72d2):**
- L1: Active Projects ground truth (SELECT COUNT(*) FROM projects WHERE status='active'). 11 active. FAIL if 0.
- L2: Workforce headcount — 45 FTE + 133 Temp = 178 total. FAIL if either is 0.
- L3: Deployed Today — distinct workers with active assignment spanning today. 39 on site. WARN if > 200.
- L4: Available FTE — FTE workers not deployed today. 18 available. WARN if > total FTE.

**Docs updated (this commit):**
- Added "UI Card Data — Source of Truth" table to PLATFORM_CONTEXT.md.
- Added Known technical debt note: Total Positions and Peak Demand still frontend-only (no DB validation yet).

**Health check state at session close: 68 checks — 0 failed, 18 warnings, 50 passed.**
