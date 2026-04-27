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

## Reporting & Timesheet Workflow Invariants — Non-Negotiable Rules

These are the rules established as the safe manual workflow for weekly reports, timesheets, and customer-facing emails. Each invariant is enforced by either a code-content check or a production-data check in `scripts/health-check.ts` (Section N). A regression must surface in the health check before it can reach the customer.

### Paid-day rules (timesheets)
- **MOB and DEMOB days never contribute paid hours.** This applies to `mob`, `demob`, `partial_mob`, and `partial_demob`. Use `shared/timesheet-hours.ts` (`isPaidDay`, `paidHours`, `sumPaidHours`) for every row total, grand total, PDF, customer email, and billing summary. Do NOT rely on `total_hours` directly — stale values may persist on rows that were converted from `working` to MOB/DEMOB.
- **Worker week row total = sum of paid (working) entries.** On `sent_to_customer` / `customer_approved` weeks, the per-(worker, week) sum of all entry rows must equal the sum of just the working-day rows. Anything else means the customer is seeing a row total that disagrees with the underlying day rows. (Health check: N3.)
- Health check: N1 pins `PAID_DAY_TYPES` to `['working']`; N2 fails if any submitted/approved entry has `day_type IN ('mob','demob','partial_mob','partial_demob')` with `total_hours > 0`.

### Weekly report draft / preview safety
- **Draft generation never emails the customer.** The endpoint `POST /api/weekly-ops/generate-weekly-report-preview` writes a `weekly_reports` row with `status = 'draft'` and returns a portal preview URL. It does not call `sendMail`. (Health check: N10.)
- **Drafts must have `sent_at IS NULL`.** A draft with `sent_at` populated means the safe-preview rule was bypassed. (Health check: N4.)
- **Customers must not see drafts.** `GET /api/portal/:code/weekly-reports` filters to `status = 'published'` for customer (token-only) access. Drafts are visible only when the request carries an authenticated PFG session for an `admin`, `project_manager`, or `resource_manager` user AND `?preview=1` is set. (Health check: N11.)
- **Tokenized portal preview URL format:** `/#/portal/<code>?token=<portalAccessToken>&preview=1`. The `&preview=1` is required for PM/admin/RM to see drafts; without it, even an authenticated PM session sees only published reports.

### PM sender identity (Microsoft Graph)
- Outbound project emails resolve sender via `getProjectSenderIdentity` (`server/project-sender.ts`).
- **Resolution rules** (mirrored in unit tests `tests/smoke/project-sender.test.ts` and `tests/smoke/workflow-invariants.test.ts`):
  - Assigned PM (project_leads → users) with `@powerforce.global` email → `from = pmEmail`, `replyTo = pmEmail`, `fromName = pmName`. Graph send-as requires `Mail.Send` on that mailbox.
  - Off-domain PM email → `from = undefined` (central MAIL_FROM), `replyTo = pmEmail`, `fromName = pmName`. Replies still reach the PM.
  - No PM email → `from = undefined`, `replyTo = undefined`, `fromName = pmName` (if any).
  - No PM lead → fall back to central MAIL_FROM entirely.
- Health check: N7 (PM lead present), N8 (PM has email), N9 (PM email is `@powerforce.global`).

### Customer portal token
- Every active project that is intended to be visible to customers must have a `portal_access_token`. New projects auto-generate one on creation.
- Tokenized URL: `/#/portal/<code>?token=<portalAccessToken>` (and append `&preview=1` for an authenticated PM/admin/RM viewing drafts).
- Health check: N6 (and F1 — they overlap intentionally).

### PM 'Approve without Supervisor' override (implemented 2026-04-27)
- A PM/admin/resource-manager may approve a timesheet week as a **controlled exception** when no supervisor has submitted (supervisor link delivery failed, supervisor unreachable, etc.). This is not a normal approval — it is labelled as an **Override approval** wherever the week is shown.
- Endpoint: `POST /api/weekly-ops/approve-without-supervisor` (in `server/weekly-ops-routes.ts`).
- Body fields (every one is required):
  - `projectId` (number)
  - `weekCommencing` (`YYYY-MM-DD`)
  - `reason` (string, ≥ 10 chars — written to `audit_logs.metadata.reason`)
  - `evidence` (string, ≥ 3 chars — ticket id, email subject, phone log entry, or short note. **No file uploads in this route** — keep the change small; link to the supporting record instead)
  - `acknowledgeNoSupervisor` (must be literal `true`)
  - `acknowledgeCustomerSendSeparate` (must be literal `true`)
- Hard rules enforced by the handler:
  1. **Role gate** — `requireRole("admin", "project_manager", "resource_manager")`.
  2. **`weekCommencing` is a real calendar date** — the regex check is followed by a `new Date(...)` round-trip so impossible dates (e.g. `2026-02-30`) return HTTP 400, not a Postgres 500.
  3. **Reason and evidence length caps** — `reason` capped at 1000 chars, `evidence` at 500 chars (`REASON_MAX`/`EVIDENCE_MAX` constants). Bounds the audit-log PII surface and abuse risk; UI mirrors with `maxLength`.
  4. **Status guard** — only allowed from `draft` or `submitted`. Refused on `pm_approved`, `sent_to_customer`, `customer_approved`, `recalled`, etc. (anywhere the customer is already in the loop or a recall is in flight).
  5. **No supervisor submission may already be on file** — if either `day_sup_submitted_at` or `night_sup_submitted_at` is set, the route refuses with HTTP 409 and instructs the user to use the normal PM approval flow.
  6. **`customer_signoff_required=false` refused with 409** — the normal approve route generates the customer-facing PDFs when it transitions a week directly to `customer_approved`. Mirroring that PDF-generation path in the override is non-trivial and would silently drift, so the override is refused entirely on those projects. Operators must use the standard approval flow once supervisor submission is restored.
  7. **Customer send isolated** — the handler MUST NOT call `sendMail` and the resulting status is always `pm_approved`. Sending to the customer remains a separate, explicit Weekly Ops action.
  8. **Atomic conditional UPDATE** — the status change is a single `UPDATE timesheet_weeks ... WHERE id = ? AND status IN ('draft','submitted') AND day_sup_submitted_at IS NULL AND night_sup_submitted_at IS NULL AND pm_approve_override_at IS NULL`. The handler verifies `rowCount === 1` before writing the audit log. Two concurrent overrides racing the same week cannot both succeed and cannot double-audit.
  9. **Audit log** — `storage.createAuditLog` is called AFTER the conditional UPDATE confirms it applied, with `action="timesheet.approve_override"`, `entityType="timesheet_week"`, and `metadata` containing `projectId`, `projectCode`, `weekCommencing`, `previousStatus`, `resultingStatus`, `missingSupervisors` (which shifts had no submission), `reason`, `evidence`, the dual acknowledgement, `requiresCustomerSignoff`, and the actor (`id`, `email`, `role`, `ip`, `userAgent`).
  10. **Surfaced on the row** — the override columns `pm_approve_override_at`, `pm_approve_override_by`, `pm_approve_override_reason`, `pm_approve_override_evidence` are written on `timesheet_weeks` so the Weekly Ops UI can render the "Override approval" badge without re-querying audit logs. Supervisor token / submission columns are deliberately untouched, so the missing supervisor stays visible in the data.
- UI: surfaced in **Weekly Ops** (`client/src/pages/WeeklyOperations.tsx`) — the "Approve without supervisor (override)" button is enabled only when a timesheet week exists, status is `draft` or `submitted`, and at least one active shift has no supervisor submission. The confirmation modal collects the reason and evidence, requires both acknowledgements, and opens with amber styling so the operator cannot mistake it for a normal approval. Once recorded, the headline carries an "Override approval" badge and the PM-approved checklist row reads `PM approved — OVERRIDE (no supervisor submission)` with the reason / evidence inline.
- Smoke test: `tests/smoke/workflow-invariants.test.ts` ("approve-without-supervisor controlled-override contract") — four static-source assertions covering role gate, reason+evidence+dual-ack, audit-log shape, status guard, and the no-`sendMail` rule.
- Health check: N13 (`scripts/health-check.ts`) — code-content check that mirrors the smoke test against the production source on every health run.

### Worker certificate upload persistence
- **Cert files must persist onto the worker after upload.** The fix RM Andre needed (Manuel Rabano, id=44) was: when `POST /api/workers/:id/upload` receives a file with `type` starting with `cert_`, the handler must upsert a `documents` row with `filePath`, `fileName`, `mimeType`, and `fileSize` set. Without this upsert, the file lands on the persistent disk but no row references it, so on reload the certificate appears not to have saved.
- **Date-only saves must not wipe the file pointer.** `PUT /api/workers/:workerId/documents` accepts dates, names, and (optionally) file metadata. Only fields that are explicitly present in the request body are written. The legacy code wrote `filePath: filePath || null`, which meant any dates-only save (the wizard's "Save" button when no new file was picked) overwrote the existing `filePath` with `null` and the file became orphaned.
- **Storage contract:** `storage.upsertDocument(workerId, type, name, data)` does an INSERT-or-UPDATE keyed on `(worker_id, type)`. The signature is pinned by the smoke test.
- Health check: O1 (upload route upserts cert document), O2 (PUT does not blind-null filePath), O3 (live data — cert documents with dates but no file_path indicates regression residue).
- Smoke test: `tests/smoke/worker-certificates.test.ts`.
- Files: `server/routes.ts` (POST /api/workers/:id/upload, PUT /api/workers/:workerId/documents).

### Worker document → portal Team SQEP workflow
This is the full chain from a PM uploading a certificate or passport on the worker profile through the customer-facing Team SQEP zip. Every step is invariant — break any one and the customer pack ships with missing files.

**1. Upload (worker profile → disk + DB row).**
- `POST /api/workers/:id/upload` writes the file to `/data/uploads/<workerId>/`.
- `type === "photo"` updates `workers.profile_photo_path`. `type === "passport"` updates `workers.passport_path`. Any `cert_*` type upserts a row in `documents` (see "Worker certificate upload persistence" above).

**2. Read (worker profile / allocation / portal must reconcile the DB row with disk).**
- Some legacy rows have `file_path = NULL` because of the regression PR #9 fixes. Files often still exist on `/data/uploads/<workerId>/`.
- The read paths (`GET /api/workers/:id/full`, `GET /api/workers/:workerId/documents`, `GET /api/dashboard`, `GET /api/portal/:code`) all run `reconcileDocsWithDisk(workerId, dbDocs)` and `reconcileWorkerFilePaths(worker)` (`server/routes.ts`). These helpers are **read-only** — they synthesize a `filePath` (or surface a disk-only cert as a `fromDisk: true` doc entry) without writing to the DB. The health check pins this in O4.
- The static-source assertion in `tests/smoke/worker-certificates.test.ts` ("reconcileDocsWithDisk must not touch the database") guards the read-only contract.

**3. Worker profile UI affordances.**
- **Certificates tab** renders a download icon for every doc with a non-empty `filePath`; the renderer handles certs surfaced from disk identically to certs sourced from the DB row.
- **Profile card** shows a passport download icon (`data-testid="passport-download-${worker.id}"`) when `worker.passportPath` is set. The icon is rendered next to the "Passport" header so PMs can download the file even when no passport number / expiry has been captured. Health check: O6.

**4. Customer portal link (Project Hub detail header + Project Allocation card).**
- Direct click must open the customer portal in a **new tab** with the hash URL `/#/portal/<code>?token=<portalAccessToken>`. Both call sites use a plain `<a target="_blank" rel="noopener noreferrer" href=…>` — wouter's `<Link>` would navigate the current tab, hijacking the PM's working view, which is the user-reported regression. The "Copy link" button on the Project Hub still produces the same URL for sharing externally. Health check: O5a, O5b.

**5. Customer portal Team SQEP zip (`client/src/lib/sqep-pdf.ts → downloadCustomerPack`).**
- For each unique assigned worker, the export creates `<safeName>/SQEP_<safeName>.pdf` and a `<safeName>/Certificates/` folder, then iterates `worker.documents` and fetches every doc with a non-empty `filePath`. Reconciliation in step 2 is what makes this work for legacy workers (Manuel Rabano on GIL specifically).
- The export does **not** include passports today. The `worker.passportPath` is rendered on the worker profile but is not bundled into the customer Team SQEP. If passport inclusion is ever required, it must be a deliberate change with explicit customer approval — passports are sensitive personal data.
- Failed fetches are skipped silently per existing behaviour; the rest of the zip continues.

**Manual QA after deploy (Manuel Rabano on GIL):**
1. Workforce → Manuel Rabano → upload a PT certificate. Reload — cert row shows download icon.
2. Open any worker with an existing passport on file → confirm a small download icon appears next to the "Passport" header and the file opens in a new tab.
3. Project Hub → GIL → click "Customer Portal" — the portal must open in a new tab, the project hub must remain on screen.
4. On the portal, click "Download Team SQEP" — the resulting zip should contain `<ManuelRabano>/Certificates/` with at least the cert file uploaded in step 1.

Files: `server/routes.ts` (helpers + read paths), `client/src/pages/WorkforceTable.tsx` (passport icon), `client/src/pages/ProjectHubDetail.tsx`, `client/src/pages/ProjectAllocation.tsx` (portal link target), `client/src/lib/sqep-pdf.ts` (Team SQEP zip).

### Weekly report PDF header (period + progress)
- Period field uses the reporting **week** (`weekStart`–`weekEnd`) by default. Falls back to project span. **Never blank.**
- Project Progress is computed from project span at the END of the reported week, clamped 0–100. When project dates are missing, displays `Schedule not available` instead of `126 of 126 days · 0% complete`.
- Helpers: `shared/report-period.ts` exports `formatPeriod` and `computeProgress`. Unit tests: `tests/smoke/report-period.test.ts`.
- Health check: N12 verifies the helper exports stay present.

---

### Weekly Ops workflow status card (UX clarity, added 2026-04-27)

The Weekly Ops page (`client/src/pages/WeeklyOperations.tsx`) now renders a single-glance **Workflow status card** above the existing warnings + checklist. The card is a thin renderer over pure derivations in `shared/weekly-ops-workflow.ts`; the renderer lives at `client/src/components/WeeklyOpsWorkflowCard.tsx`.

The card surfaces five things — every one is required and every one is invariant:

1. **Stage chip** — the authoritative key, derived from `timesheet_weeks.status` plus override/recall markers. Stages: `not_built`, `draft`, `awaiting_supervisor`, `supervisor_submitted`, `pm_approved`, `pm_approved_override`, `sent_to_customer`, `customer_approved`, `recalled`. Stage tone is colour AND icon AND label so the card never relies on hue alone.
2. **Customer-exposure boundary** — always visible, prominent, two states only:
   - `Not sent to customer` (amber, EyeOff icon) for every stage EXCEPT `sent_to_customer` and `customer_approved`. **PM approval (with or without override) is NEVER customer-facing.**
   - `Customer-facing — sent` / `Customer-facing — approved` (blue, Mail icon) for the two terminal stages.
   The PR #10 wording (`Sending is a separate, explicit action.`) is reproduced verbatim so a PM glancing at the card cannot mistake approval for sending.
3. **Override evidence summary** — only when `stage === pm_approved_override`. Shows reason, evidence reference, and re-states that the customer has not been emailed.
4. **Next safe action** — single-sentence, four tones (`info`, `warn`, `blocked`, `done`). Blocked specifically when stage is `pm_approved` / `pm_approved_override` AND `customerEmailsCount === 0`.
5. **Compact progress list** — built / day-link / day-submit / [night-link / night-submit | night-skip] / pm / sent / approved / report. First pending step is marked `current`. Recalled stage regresses the `pm` step to `current`.

Hard rules pinned by `tests/smoke/weekly-ops-workflow-card.test.ts` (and inherently by the type system since the helpers are typed):
- `isCustomerFacing` returns true for exactly two stages: `sent_to_customer` and `customer_approved`.
- `STAGE_META.pm_approved_override.description` must contain the phrase `Customer has NOT been emailed`.
- `pm_approved_override.tone === "amber"` and `pm_approved.tone === "success"` so the two are visually distinct.
- `deriveNextAction` returns tone `blocked` for any PM-approved variant with zero customer emails.
- `deriveNextAction` returns tone `info` with "Generate & send" for any PM-approved variant WITH customer emails — the override does NOT auto-send.
- The `pm` step in `deriveSteps` is labelled `PM approved — OVERRIDE` for the override stage, otherwise `PM approved`.

UI affordances pinned by component test ids (used by Playwright / future component tests): `weekly-ops-workflow-card`, `workflow-stage-badge` (carries `data-stage`), `workflow-customer-exposure` (carries `data-customer-facing`), `workflow-override-badge`, `workflow-recalled-badge`, `workflow-override-evidence`, `workflow-next-action` (carries `data-tone`), `workflow-progress-list`, `workflow-step-{id}` (carries `data-step-state`).

**Manual QA expectations** (after deploy):
1. Weekly Ops → pick a `customer_approved` week → card shows `Customer-facing — approved` (blue Mail icon) and a `done` next-safe-action.
2. Pick a `pm_approved` week with customer emails on file → card shows `PM approved — ready to send` (green chip), `Not sent to customer` (amber EyeOff), and next-safe-action `Generate & send the weekly report to the customer`.
3. Pick a `pm_approved` week on a project with NO customer emails → card shows the same green chip but next-safe-action goes `blocked` with the wording `no customer-facing emails`.
4. Pick an override-approved week → card shows the amber override chip, the `OVERRIDE` PM step, and the audit summary block with reason + evidence.
5. Pick a `sent_to_customer` week → customer-exposure flips to blue `Customer-facing — sent`, next-safe-action says "Waiting on customer approval".
6. Pick a recalled week → recalled badge shown, PM step regresses to `current`, next-safe-action tells PM to edit + re-approve.

Files:
- `shared/weekly-ops-workflow.ts` — pure derivations (stage, next-action, customer exposure, steps, stage meta).
- `client/src/components/WeeklyOpsWorkflowCard.tsx` — JSX renderer.
- `client/src/pages/WeeklyOperations.tsx` — wires the card in immediately above the warnings card; existing headline + checklist + actions panels are preserved unchanged so the per-stage timestamps and manual triggers stay intact.
- `tests/smoke/weekly-ops-workflow-card.test.ts` — 25 static-source / pure-function assertions guarding stage, customer-exposure, next-action, and step derivations.

This card is **UX-only**. No backend behaviour changes; no new fields on the status payload; the existing `/api/weekly-ops/status` shape is reused as-is. No customer-send path is touched.

---

## Future-Session Discipline — When Workflow Rules Change

If you change anything in the timesheet → weekly report → customer email chain, the change is not done until **all four** of the following are true. Do not close the session until this list is complete:

1. **Code change shipped** — implementation merged.
2. **PLATFORM_CONTEXT.md updated** — add or amend the relevant rule under "Reporting & Timesheet Workflow Invariants" above. State the rule, the code path that enforces it, and the health-check ID. If you removed a rule, delete it here too.
3. **Health-check coverage added or updated** — extend `scripts/health-check.ts` Section N (or another section if more appropriate). Prefer:
   - **Code-content check** (read a source file, assert a string/regex) for shape rules that live in code only (e.g. "`PAID_DAY_TYPES` is `['working']`", "preview endpoint does not call `sendMail`").
   - **Production-data SQL check** for invariants on live data (e.g. "no MOB/DEMOB entry has paid hours on a sent week", "no draft has `sent_at` set").
4. **Smoke / unit test added or updated** — extend `tests/smoke/workflow-invariants.test.ts` (or a sibling file) with a pure-function or static-source assertion that fails fast in CI before the health check runs against live data. Use this for the same rule from the opposite side: the helper is correct in isolation, *and* the production data conforms.

If a rule cannot be fully enforced (e.g. a Graph permission cannot be checked from the platform), state the gap explicitly and add the closest-approximation health-check warning.

When in doubt, write the rule down here first. The order is: rule → context doc → health check → test → code. Reversing this leaves rules ungoverned.

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

## Demand Curve (Gantt Chart)
- Includes: active + completed projects
- Assignment statuses included: active, confirmed, completed, flagged, pending_confirmation
- activeProjects (for card count) = status='active' ONLY — separate from demandProjectIds
- demandProjectIds = active + completed — never use activeProjectIds for the demand curve

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

### 2026-04-27 (evening) — Production QA: PR #10 Override + PR #12 Workflow Status Card

**Status:** Both PR #10 (PM 'Approve without Supervisor' controlled override) and PR #12 (Weekly Ops workflow status card) are merged, deployed, and have passed production QA. No regressions observed; no customer-facing emails were sent during QA.

**PR #10 production QA (Approve without Supervisor override):**
- Project: GNT / GE ST Gent Belgium. Week id: 875. Week commencing: 2026-04-20.
- Operator approved the override with explicit acknowledgement of both gates (no supervisor submission on file; customer send remains a separate explicit action).
- Status transitioned `draft` → `pm_approved` strictly via the override path. Supervisor submission columns left untouched as designed (missing supervisor remains visible in the data for audit reconstruction).
- Audit log row recorded: `audit_logs.id = 2267`, `action = "timesheet.approve_override"`, `entity_type = "timesheet_week"`. Reason and evidence captured; both acknowledgements captured in metadata; actor recorded.
- Customer send remained isolated. Post-QA DB checks on the affected week confirmed:
  - `sent_to_customer_at IS NULL`
  - `customer_approved_at IS NULL`
  - `recalled_at IS NULL`
  - `weekly_reports` row count for `project_id = 9`, week `2026-04-20` is `0` (no draft, no published — generation is a separate explicit Weekly Ops action and was not triggered).

**PR #12 production QA (Weekly Ops Workflow Status Card):**
- PR URL: https://github.com/RaphaPenque/pfg-platform/pull/12
- Merge commit: `1571b802dad30dd5eadaf34ffbf6041d320208fb`
- QA target: GNT week 875 (the same override-approved week from the PR #10 QA above).
- Card observations:
  - Workflow status card visible at the top of the Weekly Ops page above the existing warnings and checklist panels.
  - Stage chip rendered the override variant (`pm_approved_override`) with the amber tone and the "OVERRIDE" label on the PM step.
  - Override evidence summary block visible with reason and evidence inline, re-stating that the customer has not been emailed.
  - Customer-exposure boundary correctly read `Not sent to customer` (amber EyeOff) — confirming PM approval (with or without override) is NEVER customer-facing.
  - Existing checklist on the Weekly Ops page intact; per-stage timestamps and manual triggers unchanged.
- No weekly report generation, no customer send, no emails dispatched during the QA pass.

**Next build item:**
- **Reports tab workflow card.** With the Timesheet workflow card now done (PR #12), the next piece is the equivalent single-glance workflow card for the Reports tab — same single-source-of-truth pattern (pure derivations + thin renderer + smoke test pinning the rules), surfacing draft / published / sent-to-customer states and the customer-exposure boundary.

**Security note (re-affirmed — applies every session):**
- Do NOT paste production database secrets or connection strings into chat, commits, PRs, issues, or any other artifact that is checked in or shared. The Render Postgres password should be rotated once the current production work is stable, if not already done.

### 2026-04-27 (later, follow-up #3) — Weekly Ops Workflow Status Card (UX clarity)

**Background:** PMs working from the Weekly Ops page had to read a stack of timestamps and warnings to figure out what stage a week was in, whether the customer had been emailed, and what the next safe action was. Override-approved weeks were even harder to read — the badge was tucked next to the headline. PR #10 codified the override but did not give it a single-glance home.

**Implemented:**
- New shared module `shared/weekly-ops-workflow.ts` — pure derivations (`deriveStage`, `deriveNextAction`, `deriveCustomerExposure`, `deriveSteps`, `isCustomerFacing`, `STAGE_META`).
- New reusable component `client/src/components/WeeklyOpsWorkflowCard.tsx` — JSX-only renderer over the pure derivations. Surfaces stage chip, customer-exposure boundary (always visible), override evidence summary (when applicable), next-safe-action panel, and a compact progress list.
- Wired into `client/src/pages/WeeklyOperations.tsx` between the headline card and the warnings card. Existing timeline checklist, draft panel, stats, and manual action buttons preserved unchanged.

**Coverage:**
- New smoke test `tests/smoke/weekly-ops-workflow-card.test.ts` — 25 static-source / pure-function assertions covering stage derivation for every server-emitted status, the customer-exposure boundary (only `sent_to_customer` and `customer_approved` are customer-facing), override stage wording (`Customer has NOT been emailed`), next-safe-action blocking when no customer emails on file, and progress-list step transitions.
- `PLATFORM_CONTEXT.md` — new "Weekly Ops workflow status card" subsection under Reporting & Timesheet Workflow Invariants pins the rules.

**Caveats / what this PR deliberately does NOT do:**
- No backend / API change. The card derives everything from the existing `/api/weekly-ops/status` payload.
- No mutation of timesheet workflow behaviour. The override approval path (PR #10) is unchanged; the card just makes it easier to read.
- No customer-send path touched. Customer send remains a separate, explicit Weekly Ops action.
- No changes to the existing checklist / actions panels — they still carry the per-step timestamps and manual triggers PMs use today.
- Health-check Section N is unchanged. The card invariants are protected by the new smoke test (pure helpers + static source) which runs faster than the live-data health checks.

### 2026-04-27 (later, follow-up #2b) — Approve-without-Supervisor Override hardening (code review)

**Background:** Code review on PR #10 flagged six concerns. All addressed in the same branch.

- **Concurrency (server):** the override now applies via a single conditional `UPDATE timesheet_weeks ... WHERE id=? AND status IN ('draft','submitted') AND day_sup_submitted_at IS NULL AND night_sup_submitted_at IS NULL AND pm_approve_override_at IS NULL` and verifies `rowCount === 1` before writing the audit log. Two concurrent overrides cannot both succeed and cannot double-audit.
- **Calendar-date validation (server):** `weekCommencing` is now round-tripped through `new Date(...)` so `2026-02-30`-style values return HTTP 400 instead of a Postgres 500.
- **Length caps (server + UI):** `reason` capped at 1000 chars, `evidence` at 500 chars (`REASON_MAX`/`EVIDENCE_MAX`). UI mirrors the caps via `maxLength` on the form fields. Bounds audit-log PII surface and abuse risk.
- **`customer_signoff_required=false` refused (server):** the override now refuses with HTTP 409 on those projects. The normal approve route generates customer-facing PDFs on direct transition to `customer_approved`; mirroring that here would silently drift. Resulting status of the override is therefore always `pm_approved`.
- **Audit metadata (server):** `actor.ip` and `actor.userAgent` are recorded when available on the request.
- **UI (`client/src/pages/WeeklyOperations.tsx`):** removed a tautological `((day>0 && !daySubmitted)) === ((day>0 && !daySubmitted))` clause from `overrideEligible`. Modal now resets reason / evidence / both acknowledgements on close, cancel, and after success.
- **Coverage:** smoke test `tests/smoke/workflow-invariants.test.ts` extended with five new assertions (calendar date, length caps, customer_signoff_required=false refuse, conditional UPDATE + rowCount, audit ip/user-agent). Health-check N13 (`scripts/health-check.ts`) extended to assert the same gates against live source.

### 2026-04-27 (later, follow-up #2) — PM 'Approve without Supervisor' Override

**Background:** Codified as a planned invariant on 2026-04-27 (hardening). RM Andre and the PMs need a controlled, audited way to approve a timesheet week when supervisor submission is unavailable (link delivery failure, supervisor on leave / unreachable). Until now the only path was for a developer to flip the row state manually — no audit trail, no reason captured.

**Implemented (`server/weekly-ops-routes.ts`):**
- New endpoint `POST /api/weekly-ops/approve-without-supervisor`.
- Role-gated to `admin`, `project_manager`, `resource_manager`.
- Body must contain `reason` (≥10 chars), `evidence` (≥3 chars, free-text reference — no file upload here), `acknowledgeNoSupervisor === true`, `acknowledgeCustomerSendSeparate === true`.
- Status guard: only allowed from `draft` or `submitted`. Returns 409 from any other state. Also returns 409 if any supervisor has actually submitted.
- Resulting status mirrors normal PM approval (`pm_approved`, or `customer_approved` when sign-off is disabled). Sets `pm_approved_at` plus the four override columns.
- Writes an `audit_logs` row with `action="timesheet.approve_override"` capturing project / week / previous status / resulting status / missing supervisor shifts / reason / evidence / acknowledgement / actor.
- Does NOT call `sendMail` — customer send remains a separate Weekly Ops action.

**Schema (`server/migrate-to-postgres.ts`):**
- Four new nullable columns on `timesheet_weeks`: `pm_approve_override_at` (timestamptz), `pm_approve_override_by` (integer), `pm_approve_override_reason` (text), `pm_approve_override_evidence` (text). Added via `ALTER TABLE … ADD COLUMN IF NOT EXISTS` per the platform's no-Drizzle-migrate convention.

**UI (`client/src/pages/WeeklyOperations.tsx`):**
- New "Approve without supervisor (override)" button in the Weekly Ops actions panel. Enabled only when a timesheet week exists, status is `draft` or `submitted`, no supervisor has submitted, and at least one active shift is missing its supervisor.
- New `Dialog` confirmation modal (separate from the existing `AlertDialog`) collecting reason, evidence, and two checkbox acknowledgements (no supervisor submission; customer send remains separate). Submit is gated on all four being valid.
- Override approval is surfaced in the headline ("Override approval" amber badge), in the checklist row ("PM approved — OVERRIDE (no supervisor submission)" with reason/evidence inline), and in the GET /api/weekly-ops/status payload (`timesheetWeek.overrideApproval`).

**Coverage:**
- Smoke test `tests/smoke/workflow-invariants.test.ts` — extended the "approve-without-supervisor controlled-override contract" section from 1 to 4 static-source assertions covering: role gate, reason+evidence+dual-ack, audit-log shape (including `action="timesheet.approve_override"`, `missingSupervisors`, `previousStatus`), and status-guard + no-`sendMail`. Same `readHandler` helper now searches for the route REGISTRATION (`app.post(...)`) rather than the docstring mention.
- Health check `scripts/health-check.ts` — new check N13 mirrors all five gates against the live source on every health run.
- `PLATFORM_CONTEXT.md` — flipped the "PM 'Approve without Supervisor' override (planned, not yet implemented)" subsection to "(implemented 2026-04-27)" with the full body / status / audit / UI contract.

**Caveats / what this PR deliberately does NOT do:**
- No file upload for evidence — adding evidence files is a larger change touching `/data/uploads/` semantics and customer-portal exposure rules. The text reference field is enough for the documented use cases (ticket id, email subject, phone log entry).
- The supervisor token / submission columns on `timesheet_weeks` are deliberately not cleared by the override — the missing supervisor must stay visible in the data, otherwise an audit reconstruction would not show why the override was needed.
- No automated email is sent on override (no PM notification, no worker notification, no customer email). The audit log + Weekly Ops surface are the system of record.
- Order of operations from the customer's perspective is unchanged: override approval has the same downstream behaviour as normal PM approval — the existing send-to-customer route still applies and still requires explicit confirmation.

**Manual QA after deploy:**
1. Weekly Ops → pick a project / week with `status='draft'` or `status='submitted'` and no supervisor submission. The "Approve without supervisor (override)" button should be enabled.
2. Click the button. Modal opens with reason, evidence, and two checkboxes. Submit is disabled until all four are valid.
3. Fill a reason (≥10 chars) and evidence (≥3 chars), tick both checkboxes, click "Record override approval". Toast confirms `previousStatus → newStatus`. Headline shows the amber "Override approval" badge. The "PM approved" checklist row reads `PM approved — OVERRIDE (no supervisor submission)` with reason/evidence inline.
4. Confirm the customer was NOT emailed (email poller logs / Microsoft Graph audit unchanged for this project).
5. Confirm `audit_logs` has a row with `action='timesheet.approve_override'`, `entity_type='timesheet_week'`, full metadata.
6. Try to override a week that is `pm_approved`, `sent_to_customer`, `customer_approved`, or `recalled` — the button should be disabled and the API should return 409.

### 2026-04-27 (later, follow-up) — Worker Document → Customer Portal Team SQEP Workflow

**Reported by:** RM Andre, after re-testing the Manuel Rabano flow end-to-end. Three additional issues:
1. Uploaded passports could not be downloaded from the worker profile — the file was on disk and the DB column was set, but no download affordance existed on the card.
2. Clicking the "Customer Portal" link on the project hub navigated the same tab, forcing the PM to use "Copy link" + manual paste in a new tab instead.
3. Downloading the Team SQEP from the customer portal did not include Manuel Rabano's certificates folder, even after the PR #9 fix — because pre-existing rows still had `file_path = NULL` (the regression had been wiping pointers for weeks).

**Root causes:**
- **Passport download**: `WorkforceTable.tsx` rendered passport metadata (number / expiry) but had no `<a href={worker.passportPath}>` anywhere — the column was set but unreachable from the UI.
- **Portal link direct-click**: `ProjectHubDetail.tsx` and `ProjectAllocation.tsx` used `<Link href="/portal/...">` from wouter's `useHashLocation` router. That produces a same-tab hash navigation; the PM's working view was being replaced by the customer portal. The "Copy link" button alongside built a different URL with `target="_blank"` semantics, which is why copy + paste worked.
- **SQEP missing certs**: `client/src/lib/sqep-pdf.ts → downloadCustomerPack` correctly iterates `worker.documents` and fetches every entry with a `filePath`, but the portal API was returning the unmodified DB rows. For workers whose `documents.file_path` had been wiped (the PR #9 regression) the SQEP zip simply skipped them — even though the actual cert files were sitting on the persistent disk at `/data/uploads/<workerId>/`.

**Fix (`server/routes.ts`):**
- New read-only helpers `reconcileDocsWithDisk(workerId, docs)` and `reconcileWorkerFilePaths(worker)`. The first synthesises a `filePath` for any DB doc whose `file_path` is empty but where a matching file exists on disk, and appends a `fromDisk: true` synthetic entry for any `cert_*` file present on disk with no DB row at all. The second backfills `passportPath` / `profilePhotoPath` from disk when those columns are blank. Neither helper writes to the DB — the legacy contract that "the regression must be fixed without overwriting customer data" still holds.
- Wired into `GET /api/workers/:id/full`, `GET /api/workers/:workerId/documents`, `GET /api/portal/:code`, and `GET /api/dashboard`.

**Fix (frontend):**
- `client/src/pages/WorkforceTable.tsx` — Passport block now renders next to a small download anchor (`data-testid="passport-download-${worker.id}"`) when `worker.passportPath` is set. The block also opens when only a passport file is on record (no number / expiry yet).
- `client/src/pages/ProjectHubDetail.tsx` and `client/src/pages/ProjectAllocation.tsx` — replaced the wouter `<Link>` with a plain `<a target="_blank" rel="noopener noreferrer" href={`/#/portal/<code>?token=<portalAccessToken>`}>`. Same testids preserved (`project-customer-portal-link`, `share-customer-${code}`). The "Copy link" button is unchanged.

**Coverage:**
- `tests/smoke/worker-certificates.test.ts` — extended with five assertions covering the four reconciled read paths, the read-only contract on the helpers, the passport download anchor, the new-tab portal link on both pages, and the SQEP iteration over `worker.documents`.
- `scripts/health-check.ts` — Section O extended with O4 (read paths reconcile docs with disk), O5a/O5b (portal links open in a new tab), O6 (passport download anchor present).
- `PLATFORM_CONTEXT.md` — new "Worker document → portal Team SQEP workflow" subsection capturing the full chain and manual QA steps.

**Caveats / what this PR deliberately does NOT do:**
- No DB writes from any of the read paths. The orphaned rows are reconciled in-memory on every read. The user can still re-upload at their leisure, which will re-set `file_path` via the existing PR #9 cert upsert path.
- **Passports are NOT included in the Team SQEP zip.** The customer pack contains an SQEP PDF and the worker's certificates folder only. Adding passports to the zip is a deliberate sensitive-data decision that requires explicit business sign-off and is out of scope for this fix.
- Fetching cert files from disk relies on the renamed-on-upload filename convention (`<CleanName>_<CertType>_<Year>.<ext>`) or the legacy `<type>.<ext>`. Files saved with different naming conventions outside this code path may not be matched; the best signal in those cases remains a fresh re-upload.
- The portal API still requires the project's `portal_access_token` query param. Public access to passports / certs is unchanged: a customer with a valid portal token who opens the SQEP zip can read everything inside, exactly as before.

**Manual QA after deploy:**
1. Workforce → Manuel Rabano → certificates tab. Upload a PT/PWT PDF. Reload — cert row shows download icon and dates if entered.
2. Open any worker with `passport_path` set on the DB row. The "Passport" block on the profile card now has a small download icon next to the header. Click it — the file opens in a new tab.
3. Project Hub → GIL → click "Customer Portal". Verify the portal opens in a **new tab** (the project hub must remain on screen). The "Copy link" button still copies the same URL for paste-elsewhere use.
4. From the customer portal, click "Download Team SQEP" — the resulting zip must contain `<ManuelRabano>/Certificates/` with at least the cert files uploaded in step 1 (and any pre-existing cert files that physically exist on `/data/uploads/44/`).

### 2026-04-27 (later) — Worker Certificate Upload Persistence Fix

**Reported by:** RM Andre — uploaded certificates to worker Manuel Rabano (id=44) appeared to succeed but did not save onto the worker file.

**Root cause (two-part):**
1. `POST /api/workers/:id/upload` (`server/routes.ts`) wrote the file to `/data/uploads/<workerId>/` but only persisted a database reference for `type === "photo"` and `type === "passport"`. For any `cert_*` type, the file landed on disk and the endpoint returned `{ path, filename, type }`, but **no `documents` row was created**. The frontend wizard then either (a) called `PUT /api/workers/:workerId/documents` with `type`, `name`, `issuedDate`, `expiryDate` only — never sending the file path — or (b) just refreshed the documents list (Replace flow). In both cases the doc row had `file_path = NULL`, so the worker file showed the cert as "not uploaded" on reload.
2. `PUT /api/workers/:workerId/documents` destructured `filePath || null` etc. from the request body. When the wizard re-saved dates without re-attaching the file, the absent fields fell through to `null` and **wiped any previously-uploaded `file_path`**.

**Fix (`server/routes.ts`):**
- POST upload route now branches on `fileType.startsWith("cert_")` and calls `storage.upsertDocument(workerId, certType, docName, { filePath, fileName, mimeType, fileSize, status: "valid", ...optional dates })`. The cert label is derived from the `cert_*` key (e.g. `cert_first_aid` → `First Aid`) and may be overridden by `req.body.name` if the frontend sends one.
- PUT documents route now reads file fields with `'filePath' in body`, etc., so date-only saves preserve the existing `file_path`. `name` and `type` remain mandatory.
- No deletion of existing documents. No DB schema change. No email side-effects.

**Coverage added:**
- Smoke test `tests/smoke/worker-certificates.test.ts` — three static-source assertions: cert branch upserts, PUT presence-checks file fields, storage signature pinned. Run: `npx tsx tests/smoke/worker-certificates.test.ts`.
- Health check Section O (`scripts/health-check.ts`):
  - O1: POST upload route upserts a document for `cert_*` types.
  - O2: PUT documents route does not blind-null filePath.
  - O3: production data — count of cert documents with dates but no `file_path` (WARN).
- PLATFORM_CONTEXT.md — new "Worker certificate upload persistence" subsection under Reporting & Timesheet Workflow Invariants and a UI Card-Data row is unaffected.

**Manual QA after deploy:**
1. Open Workforce → Manuel Rabano → certificates tab.
2. Click upload on any cert (e.g. PT/PWT). Pick a PDF.
3. Reload the page. The cert row should show the green status, the issued/expiry dates if entered, and a download icon linking to `/api/uploads/44/<filename>`.
4. Edit the issued/expiry dates without re-attaching a file and Save. Reload. The download icon must still be there — the file pointer must not have been wiped.

### 2026-04-27 (hardening) — Reporting/Timesheet Workflow Invariants Codified

**No product behaviour changed.** This session writes the rules established earlier today into `PLATFORM_CONTEXT.md`, expands `scripts/health-check.ts` with a new Section N (12 checks), and adds a new smoke test `tests/smoke/workflow-invariants.test.ts` mirroring those checks against the in-process helpers.

- New context section: **Reporting & Timesheet Workflow Invariants** (above) — single source of truth for paid-day rules (MOB/DEMOB), draft preview safety, PM sender identity, portal-token contract, the planned PM "approve-without-supervisor" override, and the weekly report PDF header.
- New context section: **Future-Session Discipline — When Workflow Rules Change** — every workflow change must update this doc, the health check, and a smoke test before the session closes. Prevents the "context-doc lag" pattern that triggered this PR.
- Health check Section N: 12 checks covering MOB/DEMOB paid-hours leakage on sent weeks, draft `sent_at IS NULL`, recent published rows have `sent_at` set, portal token presence, PM lead/email/domain, code-content checks pinning the safe-preview endpoint and the portal-list draft gate, and helper-export pins for `shared/report-period.ts` and `shared/timesheet-hours.ts`.
- Files: `PLATFORM_CONTEXT.md`, `scripts/health-check.ts`, `tests/smoke/workflow-invariants.test.ts`.

### 2026-04-24 (late night, continued) — Demand Curve Fix
- `client/src/pages/GanttChart.tsx`: demand curve was silently reusing `activeProjectIds` (scoped to `status='active'` for the card count in Session #5), which dropped completed projects (Torness Jan–Mar, Saltend Apr) out of the chart and produced flat-zero weeks Jan through mid-March. Added a separate `demandProjectIds = active + completed` for the demand computation and expanded the assignment status filter from `['active', 'confirmed']` to `['active', 'confirmed', 'completed', 'flagged', 'pending_confirmation']`. `activeProjects` / `activeProjectIds` untouched — they still drive the Active Projects card count and `totalPositions`.
- Added Demand Curve section to the filter spec above so `activeProjectIds` and `demandProjectIds` cannot be conflated again.
- Commit: `8515ca5`.

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

### 2026-04-27 — Weekly Report PDF Header Fixes + Weekly Ops Process Notes

**Process rule (added at user's request — applies every session):**
- After ANY platform change, update PLATFORM_CONTEXT.md before closing the session. Do not rely on commit messages alone — context lives here.

**Weekly report PDF header fixes (`server/report-generator.ts`, `shared/report-period.ts`):**
- Period field was rendering blank (`Period →`) when `startDate`/`endDate` were not set on the project. Period now uses the reporting **week** (`weekStart`–`weekEnd`) by default, falls back to project span, never blank.
- Project Progress text was hardcoded as `126 of 126 days · 0% complete` — wrong for any project whose total span is not 126 days, and contradictory when % was 0. Now computed from real project span (`endDate − startDate`) evaluated at the END of the reported week, clamped 0–100. When project dates are missing, displays `Schedule not available` instead of misleading numbers.
- New shared helper `shared/report-period.ts` exports `formatPeriod` and `computeProgress` with full unit-test coverage in `tests/smoke/report-period.test.ts`. Run with `npx tsx tests/smoke/report-period.test.ts`.
- No DB writes; no email sends; preserves visual layout exactly.

**Weekly Ops workflow guarantees (re-affirmed this session — these rules already implemented, documenting here for handoff):**
- **Safe preview:** `POST /api/weekly-ops/generate-weekly-report-preview` writes a `weekly_reports` row in **draft** state and returns a portal preview URL with `?preview=1`. Drafts are gated server-side — the customer-facing portal hides any report whose status is not published. Generating a preview is non-destructive and never sends email.
- **Drafts not visible to customers:** the portal endpoint filters out unpublished/draft rows. `?preview=1&token=…` is required to view a draft, and that URL is intended for internal review only.
- **PM sender identity:** outbound weekly report emails (when manually sent via Weekly Ops) are sent **from the project's PM email** — not the platform service account — so customer replies route to the PM. Sender is resolved from `projects.pm_email` (or signatory email fallback). Health check Section F flags projects missing this field.
- **MOB / DEMOB rule:** Mobilisation and Demobilisation days are **not paid days** for the customer. Weekly billing/reporting must exclude MOB and DEMOB calendar days from chargeable days. (Operational rule — not yet enforced in code; flagged here as known requirement for the timesheet/billing rebuild.)

**How to regenerate a GRTY draft preview after this PR deploys:**
```bash
curl -X POST "$APP/api/weekly-ops/generate-weekly-report-preview" \
  -H "x-internal-key: pfg-internal-2026" \
  -H "Content-Type: application/json" \
  -d '{"projectCode":"GRTY","weekStart":"2026-04-20"}'
```
The response includes `previewPortalUrl` and `pdfUrl` (both with `?preview=1&token=…`). Open `pdfUrl` to verify the Period header now reads `20 Apr – 26 Apr 2026` and Project Progress reads `~14 of 126 days · 11% complete` (not `126 of 126 · 0%`).
