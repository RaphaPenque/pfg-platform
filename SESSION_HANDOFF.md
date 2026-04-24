# PFG Platform — Session Handoff

> Snapshot written at the close of each session. Always read this **and** `PLATFORM_CONTEXT.md` at the start of the next session, in that order.

---

## Session #8 — 2026-04-24 (late night, continued) — Demand Curve Fix

### What Was Done This Session

| Commit | Change |
|---|---|
| `8515ca5` | Fix demand curve — include completed projects + completed/flagged assignments for full year history |
| (this commit) | Update PLATFORM_CONTEXT.md + SESSION_HANDOFF.md — demand curve fix, session close |

### Detail

1. **Workforce Demand Curve missing historical data** — in `GanttChart.tsx`, the demand curve reused `activeProjectIds` (narrowed to `status='active'` in Session #5 for the card count), so completed projects (Torness Jan–Mar, Saltend Apr, etc.) dropped out of the chart and the curve showed flat zero from Jan through mid-March. The assignment filter was also restricted to `['active', 'confirmed']`, which would have excluded completed-project workers even with the project set fixed. Added a separate `demandProjectIds = active + completed`, and expanded the assignment status filter to `['active', 'confirmed', 'completed', 'flagged', 'pending_confirmation']`. `activeProjects`/`activeProjectIds` are untouched — they still drive the Active Projects card count and `totalPositions`.

---

## Session #7 — 2026-04-24 (late night) — I2 False Positive Fix

### What Was Done This Session

| Commit | Change |
|---|---|
| `ff22668` | Fix I2 overlap query — use assignment dates directly, not role_slot_periods (false positive fix) |
| `3f3ed63` | Update SESSION_HANDOFF.md — I2 false positive fix, health check state |

### Detail

1. **I2 overlap false positive** — the I2 check used `LEFT JOIN role_slot_periods` and `COALESCE(rsp.start_date, a.start_date)` to compute span dates. This fanned out each assignment into one row per period, so a worker with multiple sub-windows (e.g. two stints on GNT: Mar–May and Jun–Jul) had the Jun–Jul period falsely overlap with a sequential assignment (e.g. SZWL May–Jul) on a different project. Replaced the CTE with a direct self-join on `assignments` using `a.start_date`/`a.end_date`. Periods are sub-windows within an assignment (demob/remob planning) and must NOT be used for overlap detection. Confirmed: I2 now reports 0 overlaps.

---

## Session #6 — 2026-04-24 (late evening, continued) — Filter Fix + Section M

### Filter fix + Section M session (2026-04-24 late evening)

| Commit | Change |
|---|---|
| `4aa7185` | Fix Available filter — use isCurrentlyActive (date-aware) not status-only check |
| `afde997` | Add health check Section M — filter and logic consistency (M1–M4) |
| (this commit) | Update PLATFORM_CONTEXT.md and SESSION_HANDOFF.md — filter spec, Section M, session close |

### Detail
1. **WorkforceTable Available/Assigned filter** — the filter previously checked assignment status only. A worker with a future-dated (`start_date > today`) `active` assignment was counted as Assigned, even though they are not currently deployed. Result: filter showed 1 Available when 19 were actually available. Now uses `isCurrentlyActive(assignment, slot?.periods)` to require `start_date <= today <= end_date`. Matches the "Deployed Today" card logic exactly.
2. **Section M health check** — M1 (Available filter uses isCurrentlyActive), M2 (GanttChart activeProjects status='active' only), M3 (PersonSchedule VISIBLE_ASSIGNMENT_STATUSES matches canonical set), M4 (calcUtilisation excludes cancelled/declined). All code-content checks — cheap and regression-proof.
3. **Docs** — PLATFORM_CONTEXT.md gained a Filter Specification block (non-negotiable rules for Available/Assigned/Active Projects/Person Schedule visibility) and Section M in the health check description.

---

## Session #5 — 2026-04-24 (late evening) — UI Data Accuracy

### What Was Done This Session

| Commit | Change |
|---|---|
| `e5206e5` | Fix GanttChart Active Projects count — filter to status='active' only (was including completed/confirmed) |
| `2cf72d2` | Add health check Section L — UI card data accuracy (L1 active projects, L2 headcount, L3 deployed today, L4 available FTE) |
| `b37d044` | Update PLATFORM_CONTEXT.md + SESSION_HANDOFF.md — UI card accuracy, Section L, session close |

### Detail

1. **GanttChart Active Projects card** — filter previously included `active`, `confirmed`, and `completed`, inflating the card from 11 to 20. Corrected to `status === 'active'` only. `activeProjectIds` (used for the demand curve further down) is derived from `activeProjects`, so the demand curve also now only reflects active projects.
2. **Section L health check** — added to `scripts/health-check.ts`:
   - **L1**: Active Projects ground truth — `SELECT COUNT(*) FROM projects WHERE status='active'`. 11 active. FAIL if 0.
   - **L2**: Workforce headcount — 45 FTE + 133 Temp = 178 total. FAIL if either is 0.
   - **L3**: Deployed Today — 39 workers on site. WARN if > 200.
   - **L4**: Available FTE — 18 FTE not deployed today. WARN if > total FTE.
3. **Docs** — PLATFORM_CONTEXT.md gained a "UI Card Data — Source of Truth" table mapping each summary card to its DB query and covering health check. Noted Total Positions and Peak Demand as remaining technical debt (frontend-computed, no DB validation yet).

---

## Health Check — Current State

> 72 checks | **0 critical failures, 17 warnings, 55 passed** (run at session close after demand curve fix)

| Section | Status | Notes |
|---|---|---|
| A projects | ✅ | All projects have valid statuses |
| B role slots | ✅ | All slots quantity 1; periods well-formed |
| C timesheets | 🟡 | C2/C3 operational warnings — not yet actioned (team) |
| D headcount | 🟡 | D1 stale headcount fields on GNT, GRTY (Target field — live count displayed correctly) |
| E workers | ✅ | |
| F portal/customer emails | 🟡 | OSKSHM, OLKL1, GIL, SZWL, DHC — missing emails / portal reports (expected) |
| G assignments | ✅ | |
| H workers core fields | ✅ | Telmo Alfaro `employment_type` fixed previously |
| I person schedule | ✅ | I2 overlap query fixed — uses assignment dates directly, no false positives |
| J documents | ✅ | |
| K FTE baseline / deployment | ✅ | K1/K2/K3 all passing |
| L UI card data accuracy | ✅ | L1 (11 active projects), L2 (45 FTE + 133 Temp), L3 (39 deployed today), L4 (18 available FTE) all passing |
| M filter & logic consistency (new) | ✅ | M1 Available filter date-aware, M2 GanttChart active only, M3 PersonSchedule statuses match, M4 calcUtilisation excludes cancelled — all passing |

**Resolved this session:**
- I2 person schedule overlap check — fixed false positive caused by joining `role_slot_periods` and fanning each assignment into one row per period. Now uses assignment dates directly. Down from 5 false-positive overlaps to 0 real overlaps.

**Remaining 17 warnings are all operational** (team to action): C2/C3 timesheets, D1 stale headcount fields, F missing emails/portal reports.

Run: `DATABASE_URL=... npm run health-check`

---

## Next Session — Priority List

### Immediate (operational, team owner)
1. **Re-assign workers** to projects DHC, GIL, OSKSHM, OLKL1, SZWL, HEY-001, CAR-ST, GNT.
2. **Clean up stale timesheet_entries** after workforce reassignment (one-off DB script).
3. **Review completed project data accuracy** for TRNS, SALT, SVRN, TRNZN.
4. **Add email addresses + portal tokens** for projects flagged in F (OSKSHM, OLKL1, GIL, SZWL, DHC).
5. **Daily reports** — publish reports to portal for OSKSHM, OLKL1, GIL, SZWL, DHC once projects are back in flight.

### Platform / dev
6. Add health check coverage for generated document content (PDF data validation).
7. Piece 2 — Timesheet stale worker display (will self-resolve after reassignment + cleanup script above).
8. **Total Positions and Peak Demand cards on Gantt — not yet health-checked; frontend-computed only.** Add DB-backed ground-truth queries so the cards can be validated against the same pattern as L1–L4.

### Known bugs (not yet fixed)
- **Duplicate timesheet entries on GNT and GRTY.** Root cause: timesheet rebuild creates new day entries for new assignments without clearing entries from old `removed` assignments on the same worker/week. Fix needed in `server/timesheet-routes.ts` — rebuild logic must check for existing entries before inserting. The one real submitted timesheet (GRTY w/c 13 April, status: `sent_to_customer`) must NOT be affected by the fix. **Still unaddressed.**
- **Latent route bug at `server/routes.ts:858` area** — historically `/api/workers:id` was missing the `/`. Currently the slot at line 858 is the new `/api/workers/fte-count` endpoint and the `/api/workers/:id` route follows at line 864 correctly. If the bug re-surfaces during future edits in this file, the symptom is that requests to `/api/workers/<id>` fail to match. Keep this in mind when touching `server/routes.ts` around the workers block.

### Known issues (carry-over, not blocking)
- Team Allocation logic: worker matching/filtering unreliable.
- Customer Portal PDF: SQEP pack / customer report PDF not pulling data correctly.
- Milestone / Completion Certificates: `MilestoneCertificateTab.tsx` not functioning properly yet.
- Logistics tab: exists but not operational.
- Lessons Learned tab: exists but not in correct format for proper use.

### Deliberately off (do NOT re-enable without explicit instruction)
- All auto-sends (weekly reports, timesheet reminders, survey reminders).
- Email poller outbound sends (receive-only).
- Billing Summaries, Payroll exports.

---

## Start-of-next-session checklist

1. Read `PLATFORM_CONTEXT.md` (full).
2. Read this file (`SESSION_HANDOFF.md`).
3. Read the last 5 changelog entries in `PLATFORM_CONTEXT.md`.
4. Run `DATABASE_URL=... npm run health-check` and compare against the table above.
5. Pick the first item from the Priority List that matches today's task scope.
6. Write a plan and wait for approval before code changes (per `PLATFORM_CONTEXT.md` rule #3).
