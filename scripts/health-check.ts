/**
 * PFG Platform — Health Check Script
 * ====================================
 * Runs a comprehensive audit of live database integrity and data consistency.
 *
 * Usage:
 *   DATABASE_URL=<your-postgres-url> npx tsx scripts/health-check.ts
 *
 * Or against the Render production database (from your local machine or CI):
 *   DATABASE_URL="postgresql://..." npx tsx scripts/health-check.ts
 *
 * Output: colour-coded terminal report. Exit code 0 = all pass, 1 = failures found.
 *
 * Sections:
 *   A. Core Data Integrity      — broken links, orphaned records, missing required fields
 *   B. Assignment Cascade       — worker ↔ project ↔ timesheet ↔ portal chain
 *   C. Timesheet Consistency    — timesheet entries match assignments, no stuck states
 *   D. Project KPI Accuracy     — on-site count, headcount, status integrity
 *   E. Weekly Report Accuracy   — aggregated data matches source records
 *   F. Customer Portal          — portal tokens, SQEP data, published reports
 *   G. QHSE Records             — safety data integrity
 *   H. Worker Profile           — employment type, status vs assignment, document basics
 *   I. Person Schedule & Assignment Accuracy — stale, overlapping, and over-utilised assignments
 *   K. FTE Baseline, Worker Status & Deployed Today — live baseline, status validity, deployment plausibility
 *   L. UI Card Data Accuracy   — ground-truth DB counts for Active Projects, Headcount, Deployed Today, Available FTE
 *   M. Filter & Logic Consistency — UI filter implementations match platform spec
 *   N. Reporting & Timesheet Workflow Invariants — MOB/DEMOB paid-day rules,
 *      weekly_reports draft/sent state, portal token presence, PM sender identity
 */

import { Pool } from "pg";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config();

// ── Terminal colours ────────────────────────────────────────────────────────
const C = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  red:    "\x1b[31m",
  green:  "\x1b[32m",
  yellow: "\x1b[33m",
  blue:   "\x1b[34m",
  cyan:   "\x1b[36m",
  grey:   "\x1b[90m",
};

const pass  = (msg: string) => console.log(`  ${C.green}✓${C.reset} ${msg}`);
const fail  = (msg: string) => console.log(`  ${C.red}✗${C.reset} ${C.red}${msg}${C.reset}`);
const warn  = (msg: string) => console.log(`  ${C.yellow}⚠${C.reset} ${C.yellow}${msg}${C.reset}`);
const info  = (msg: string) => console.log(`  ${C.grey}  ${msg}${C.reset}`);
const section = (title: string) => {
  console.log(`\n${C.bold}${C.cyan}── ${title} ${"─".repeat(Math.max(0, 60 - title.length))}${C.reset}`);
};

// ── Result tracking ─────────────────────────────────────────────────────────
let totalChecks = 0;
let totalFails = 0;
let totalWarns = 0;

function check(label: string, ok: boolean, detail?: string, isWarn = false) {
  totalChecks++;
  if (ok) {
    pass(label);
    if (detail) info(detail);
  } else {
    if (isWarn) {
      totalWarns++;
      warn(`${label}${detail ? ` — ${detail}` : ""}`);
    } else {
      totalFails++;
      fail(`${label}${detail ? ` — ${detail}` : ""}`);
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    console.error(`${C.red}ERROR: DATABASE_URL not set. Run with DATABASE_URL=... npx tsx scripts/health-check.ts${C.reset}`);
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes("render.com") || DATABASE_URL.includes("neon.tech")
      ? { rejectUnauthorized: false }
      : false,
    connectionTimeoutMillis: 30_000,
  });

  const q = async (sql: string, params: any[] = []) => {
    const res = await pool.query(sql, params);
    return res.rows;
  };

  console.log(`\n${C.bold}${C.blue}PFG Workforce Intelligence Platform — Health Check${C.reset}`);
  console.log(`${C.grey}${new Date().toISOString()}${C.reset}`);
  console.log(`${C.grey}Database: ${DATABASE_URL.replace(/:[^:@]+@/, ":***@")}${C.reset}`);

  // ═══════════════════════════════════════════════════════════════════════════
  section("A. Core Data Integrity");
  // ═══════════════════════════════════════════════════════════════════════════

  // A1 — All assignments point to valid workers
  const orphanedAssignments = await q(`
    SELECT COUNT(*) AS n FROM assignments a
    LEFT JOIN workers w ON w.id = a.worker_id
    WHERE w.id IS NULL
  `);
  check("All assignments have valid worker_id", +orphanedAssignments[0].n === 0,
    orphanedAssignments[0].n > 0 ? `${orphanedAssignments[0].n} assignments point to non-existent workers` : undefined);

  // A2 — All assignments point to valid projects
  const orphanedAssignmentsProj = await q(`
    SELECT COUNT(*) AS n FROM assignments a
    LEFT JOIN projects p ON p.id = a.project_id
    WHERE p.id IS NULL
  `);
  check("All assignments have valid project_id", +orphanedAssignmentsProj[0].n === 0,
    orphanedAssignmentsProj[0].n > 0 ? `${orphanedAssignmentsProj[0].n} assignments point to non-existent projects` : undefined);

  // A3 — Role slot references are valid (where set)
  const brokenRoleSlotRefs = await q(`
    SELECT COUNT(*) AS n FROM assignments a
    WHERE a.role_slot_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM role_slots r WHERE r.id = a.role_slot_id)
  `);
  check("All role_slot_id references are valid", +brokenRoleSlotRefs[0].n === 0,
    brokenRoleSlotRefs[0].n > 0 ? `${brokenRoleSlotRefs[0].n} assignments reference missing role slots` : undefined);

  // A4 — Role slot periods point to valid role slots
  const orphanedPeriods = await q(`
    SELECT COUNT(*) AS n FROM role_slot_periods rsp
    LEFT JOIN role_slots rs ON rs.id = rsp.role_slot_id
    WHERE rs.id IS NULL
  `);
  check("All role_slot_periods have valid role_slot_id", +orphanedPeriods[0].n === 0,
    orphanedPeriods[0].n > 0 ? `${orphanedPeriods[0].n} orphaned role slot periods` : undefined);

  // A5 — Documents point to valid workers
  const orphanedDocs = await q(`
    SELECT COUNT(*) AS n FROM documents d
    LEFT JOIN workers w ON w.id = d.worker_id
    WHERE w.id IS NULL
  `);
  check("All documents have valid worker_id", +orphanedDocs[0].n === 0,
    orphanedDocs[0].n > 0 ? `${orphanedDocs[0].n} documents point to non-existent workers` : undefined);

  // A6 — Daily reports point to valid projects
  const orphanedReports = await q(`
    SELECT COUNT(*) AS n FROM daily_reports dr
    LEFT JOIN projects p ON p.id = dr.project_id
    WHERE p.id IS NULL
  `);
  check("All daily_reports have valid project_id", +orphanedReports[0].n === 0,
    orphanedReports[0].n > 0 ? `${orphanedReports[0].n} daily reports reference missing projects` : undefined);

  // A7 — Work packages point to valid projects
  const orphanedWPs = await q(`
    SELECT COUNT(*) AS n FROM work_packages wp
    LEFT JOIN projects p ON p.id = wp.project_id
    WHERE p.id IS NULL
  `);
  check("All work_packages have valid project_id", +orphanedWPs[0].n === 0,
    orphanedWPs[0].n > 0 ? `${orphanedWPs[0].n} work packages reference missing projects` : undefined);

  // A8 — Users referenced as project leads exist and are active
  const inactiveLeads = await q(`
    SELECT pl.project_id, u.email, u.is_active
    FROM project_leads pl
    JOIN users u ON u.id = pl.user_id
    WHERE u.is_active = false
  `);
  check("All project leads are active users", inactiveLeads.length === 0,
    inactiveLeads.length > 0 ? `${inactiveLeads.length} project(s) have inactive user as lead` : undefined, true);

  // A9 — Workers have required fields
  const workersNoName = await q(`SELECT COUNT(*) AS n FROM workers WHERE name IS NULL OR TRIM(name) = ''`);
  check("All workers have a name", +workersNoName[0].n === 0,
    +workersNoName[0].n > 0 ? `${workersNoName[0].n} workers have no name` : undefined);

  const workersNoRole = await q(`SELECT COUNT(*) AS n FROM workers WHERE role IS NULL OR TRIM(role) = ''`);
  check("All workers have a role", +workersNoRole[0].n === 0,
    +workersNoRole[0].n > 0 ? `${workersNoRole[0].n} workers have no role assigned` : undefined, true);

  // A10 — Projects have required fields
  const projectsNoCode = await q(`SELECT COUNT(*) AS n FROM projects WHERE code IS NULL OR TRIM(code) = ''`);
  check("All projects have a code", +projectsNoCode[0].n === 0,
    +projectsNoCode[0].n > 0 ? `${projectsNoCode[0].n} projects have no code` : undefined);

  const projectsNoCustomer = await q(`
    SELECT code FROM projects
    WHERE (customer IS NULL OR TRIM(customer) = '')
    AND status NOT IN ('cancelled')
  `);
  check("All active/potential projects have a customer", projectsNoCustomer.length === 0,
    projectsNoCustomer.length > 0 ? `Projects missing customer: ${projectsNoCustomer.map((p: any) => p.code).join(", ")}` : undefined, true);


  // ═══════════════════════════════════════════════════════════════════════════
  section("B. Assignment Cascade");
  // ═══════════════════════════════════════════════════════════════════════════

  // B1 — Active workers with no assignments (potential issue)
  const activeNoAssignment = await q(`
    SELECT COUNT(*) AS n FROM workers w
    WHERE w.status IN ('on_site', 'allocated')
    AND NOT EXISTS (
      SELECT 1 FROM assignments a
      WHERE a.worker_id = w.id AND a.status IN ('active', 'flagged')
    )
  `);
  check("All on_site/allocated workers have an active assignment", +activeNoAssignment[0].n === 0,
    +activeNoAssignment[0].n > 0 ? `${activeNoAssignment[0].n} workers are marked on_site/allocated but have no active/flagged assignment — status mismatch` : undefined);

  // B2 — Workers with active assignments but wrong status
  const wrongStatus = await q(`
    SELECT w.id, w.name, w.status
    FROM workers w
    WHERE w.status IN ('available', 'unavailable')
    AND EXISTS (
      SELECT 1 FROM assignments a
      WHERE a.worker_id = w.id AND a.status IN ('active', 'flagged')
      AND a.start_date <= CURRENT_DATE::text
      AND (a.end_date IS NULL OR a.end_date >= CURRENT_DATE::text)
    )
  `);
  check("No workers have active assignments but show as available/unavailable", wrongStatus.length === 0,
    wrongStatus.length > 0
      ? `${wrongStatus.length} worker(s) have current active assignments but wrong status: ${wrongStatus.slice(0, 5).map((w: any) => `${w.name} (${w.status})`).join(", ")}${wrongStatus.length > 5 ? "..." : ""}`
      : undefined, true);

  // B3 — Duplicate active assignments (same worker, overlapping dates, different projects)
  const duplicateAssignments = await q(`
    SELECT a1.worker_id, w.name,
           a1.project_id AS project1, a2.project_id AS project2,
           a1.start_date AS start1, a1.end_date AS end1,
           a2.start_date AS start2, a2.end_date AS end2
    FROM assignments a1
    JOIN assignments a2
      ON a1.worker_id = a2.worker_id
      AND a1.id < a2.id
      AND a1.project_id != a2.project_id
      AND a1.status IN ('active', 'flagged')
      AND a2.status IN ('active', 'flagged')
      AND (
        (a1.start_date <= COALESCE(a2.end_date, '9999-12-31'))
        AND (COALESCE(a1.end_date, '9999-12-31') >= a2.start_date)
      )
    JOIN workers w ON w.id = a1.worker_id
    LIMIT 20
  `);
  check("No workers have overlapping active assignments on different projects", duplicateAssignments.length === 0,
    duplicateAssignments.length > 0
      ? `${duplicateAssignments.length} overlap(s) found: ${duplicateAssignments.slice(0, 3).map((d: any) => `${d.name} (projects ${d.project1} & ${d.project2})`).join(", ")}`
      : undefined);

  // B4 — Assignments on completed/cancelled projects still marked active
  const activeOnClosedProjects = await q(`
    SELECT COUNT(*) AS n
    FROM assignments a
    JOIN projects p ON p.id = a.project_id
    WHERE a.status IN ('active', 'flagged')
    AND p.status IN ('completed', 'cancelled')
  `);
  check("No active assignments on completed/cancelled projects", +activeOnClosedProjects[0].n === 0,
    +activeOnClosedProjects[0].n > 0 ? `${activeOnClosedProjects[0].n} active/flagged assignments on closed projects` : undefined, true);

  // B5 — All active project assignments appear in portal worker list (spot check: role slots match)
  const assignmentsWithoutRoleSlot = await q(`
    SELECT COUNT(*) AS n
    FROM assignments a
    JOIN projects p ON p.id = a.project_id
    WHERE a.status IN ('active', 'flagged')
    AND a.role_slot_id IS NULL
    AND p.status = 'active'
  `);
  check("All active assignments have a role slot linked", +assignmentsWithoutRoleSlot[0].n === 0,
    +assignmentsWithoutRoleSlot[0].n > 0 ? `${assignmentsWithoutRoleSlot[0].n} active assignments have no role_slot_id — may not appear on Gantt correctly` : undefined, true);


  // ═══════════════════════════════════════════════════════════════════════════
  section("C. Timesheet Consistency");
  // ═══════════════════════════════════════════════════════════════════════════

  // Fetch timesheet data (if tables exist)
  let timesheetWeeks: any[] = [];
  let timesheetEntries: any[] = [];
  try {
    timesheetWeeks = await q(`SELECT * FROM timesheet_weeks ORDER BY week_commencing DESC LIMIT 100`);
    timesheetEntries = await q(`SELECT * FROM timesheet_entries WHERE timesheet_week_id IN (SELECT id FROM timesheet_weeks ORDER BY week_commencing DESC LIMIT 100)`);
  } catch (e: any) {
    warn(`Could not read timesheet tables — ${e.message}`);
  }

  if (timesheetWeeks.length > 0) {
    // C1 — No timesheet weeks stuck in 'sent_to_customer' for > 30 days without customer approval
    const stuckTimesheets = await q(`
      SELECT tw.id, tw.week_commencing, tw.status, tw.sent_to_customer_at, p.code
      FROM timesheet_weeks tw
      JOIN projects p ON p.id = tw.project_id
      WHERE tw.status = 'sent_to_customer'
      AND tw.sent_to_customer_at < NOW() - INTERVAL '30 days'
    `);
    check("No timesheets stuck in sent_to_customer > 30 days", stuckTimesheets.length === 0,
      stuckTimesheets.length > 0
        ? `${stuckTimesheets.length} timesheet(s) outstanding: ${stuckTimesheets.map((t: any) => `${t.code} w/c ${t.week_commencing}`).join(", ")}`
        : undefined, true);

    // C2 — Workers on active projects this week have timesheet entries
    const thisMonday = (() => {
      const d = new Date();
      const day = d.getUTCDay();
      const diff = day === 0 ? -6 : 1 - day;
      d.setUTCDate(d.getUTCDate() + diff);
      return d.toISOString().split("T")[0];
    })();
    const currentWeeks = timesheetWeeks.filter((tw: any) => tw.week_commencing === thisMonday);
    if (currentWeeks.length > 0) {
      const weekIds = currentWeeks.map((w: any) => w.id);
      const workersCoveredThisWeek = new Set(
        timesheetEntries.filter((e: any) => weekIds.includes(e.timesheet_week_id)).map((e: any) => e.worker_id)
      );

      const activeAssignmentsThisWeek = await q(`
        SELECT DISTINCT a.worker_id, w.name
        FROM assignments a
        JOIN workers w ON w.id = a.worker_id
        JOIN projects p ON p.id = a.project_id
        WHERE a.status IN ('active', 'flagged')
        AND p.status = 'active'
        AND a.start_date <= $1
        AND (a.end_date IS NULL OR a.end_date >= $1)
      `, [thisMonday]);

      const missingFromTimesheet = activeAssignmentsThisWeek.filter(
        (a: any) => !workersCoveredThisWeek.has(a.worker_id)
      );
      check(
        `Workers on active projects this week (${thisMonday}) have timesheet entries`,
        missingFromTimesheet.length === 0,
        missingFromTimesheet.length > 0
          ? `${missingFromTimesheet.length} worker(s) missing: ${missingFromTimesheet.slice(0, 5).map((a: any) => a.name).join(", ")}${missingFromTimesheet.length > 5 ? "..." : ""}`
          : undefined, true
      );
    } else {
      warn(`No timesheet week found for current Monday (${thisMonday}) — may not have been built yet`);
    }

    // C3 — No timesheet entries with zero total_hours where status is submitted/approved
    const zeroHourEntries = await q(`
      SELECT COUNT(*) AS n
      FROM timesheet_entries te
      JOIN timesheet_weeks tw ON tw.id = te.timesheet_week_id
      WHERE (te.total_hours = 0 OR te.total_hours IS NULL)
      AND tw.status IN ('submitted', 'pm_approved', 'sent_to_customer', 'customer_approved')
    `);
    check("No submitted/approved timesheets have zero total hours", +zeroHourEntries[0].n === 0,
      +zeroHourEntries[0].n > 0 ? `${zeroHourEntries[0].n} entries with 0 hours in approved state` : undefined, true);

    // C4 — No duplicate timesheet entries (same worker, same week)
    const dupEntries = await q(`
      SELECT timesheet_week_id, worker_id, COUNT(*) AS n
      FROM timesheet_entries
      GROUP BY timesheet_week_id, worker_id
      HAVING COUNT(*) > 7
    `);
    check("No duplicate timesheet entries (worker + week)", dupEntries.length === 0,
      dupEntries.length > 0 ? `${dupEntries.length} duplicate worker/week combination(s)` : undefined);

  } else {
    warn("No timesheet weeks in database — skipping timesheet checks");
  }


  // ═══════════════════════════════════════════════════════════════════════════
  section("D. Project KPI Accuracy");
  // ═══════════════════════════════════════════════════════════════════════════

  const activeProjects = await q(`SELECT * FROM projects WHERE status IN ('active', 'potential', 'capacity_planning')`);

  for (const project of activeProjects) {
    const code = project.code;

    // D1 — Headcount field matches actual assigned worker count
    const actualCount = await q(`
      SELECT COUNT(DISTINCT worker_id) AS n
      FROM assignments
      WHERE project_id = $1 AND status IN ('active', 'flagged')
    `, [project.id]);
    const dbHeadcount = project.headcount ?? 0;
    const actualHeadcount = +actualCount[0].n;

    if (dbHeadcount > 0 && Math.abs(dbHeadcount - actualHeadcount) > 2) {
      check(
        `[${code}] Headcount field (${dbHeadcount}) roughly matches assigned workers (${actualHeadcount})`,
        false,
        `Gap of ${Math.abs(dbHeadcount - actualHeadcount)} — headcount field may be stale`,
        true
      );
    } else {
      check(
        `[${code}] Headcount plausible — field: ${dbHeadcount}, active assignments: ${actualHeadcount}`,
        true
      );
    }

    // D2 — On-site count: workers whose role slot period covers today
    const todayStr = new Date().toISOString().split("T")[0];

    const assignmentsForProject = await q(`
      SELECT a.worker_id, a.start_date, a.end_date, a.role_slot_id
      FROM assignments a
      WHERE a.project_id = $1 AND a.status IN ('active', 'flagged')
    `, [project.id]);

    const periodsBySlot: Record<number, any[]> = {};
    const periods = await q(`
      SELECT * FROM role_slot_periods WHERE project_id = $1
    `, [project.id]);
    periods.forEach((p: any) => {
      if (!periodsBySlot[p.role_slot_id]) periodsBySlot[p.role_slot_id] = [];
      periodsBySlot[p.role_slot_id].push(p);
    });

    const onSiteWorkerIds = new Set<number>();
    for (const a of assignmentsForProject) {
      const slotPeriods = a.role_slot_id ? (periodsBySlot[a.role_slot_id] || []) : [];
      if (slotPeriods.length > 0) {
        if (slotPeriods.some((p: any) => p.start_date <= todayStr && p.end_date >= todayStr)) {
          onSiteWorkerIds.add(a.worker_id);
        }
      } else {
        const s = a.start_date ? a.start_date.slice(0, 10) : null;
        const e = a.end_date ? a.end_date.slice(0, 10) : null;
        if ((!s || s <= todayStr) && (!e || e >= todayStr)) {
          onSiteWorkerIds.add(a.worker_id);
        }
      }
    }

    const onSiteCount = onSiteWorkerIds.size;
    info(`[${code}] On-site count today: ${onSiteCount} worker(s)`);

    // D3 — Projects with end date in past but still 'active'
    if (project.status === "active" && project.end_date && project.end_date < todayStr) {
      check(
        `[${code}] Project end date has passed but status is still 'active'`,
        false,
        `End date: ${project.end_date} — should this be completed?`,
        true
      );
    }

    // D4 — Active projects with no assigned workers at all
    if (actualHeadcount === 0 && project.status === "active") {
      check(
        `[${code}] Active project has no assigned workers`,
        false,
        `No active/flagged assignments found`,
        true
      );
    }
  }

  // D5 — Project statuses are valid values
  const invalidStatuses = await q(`
    SELECT code, status FROM projects
    WHERE status NOT IN ('active', 'potential', 'capacity_planning', 'completed', 'cancelled')
  `);
  check("All project statuses are valid", invalidStatuses.length === 0,
    invalidStatuses.length > 0 ? `Invalid statuses: ${invalidStatuses.map((p: any) => `${p.code}=${p.status}`).join(", ")}` : undefined);


  // ═══════════════════════════════════════════════════════════════════════════
  section("E. Weekly Report Accuracy");
  // ═══════════════════════════════════════════════════════════════════════════

  const weeklyReports = await q(`SELECT * FROM weekly_reports ORDER BY created_at DESC LIMIT 20`);

  if (weeklyReports.length === 0) {
    warn("No weekly reports found — skipping weekly report checks");
  } else {
    for (const report of weeklyReports) {
      const agg = report.aggregated_data as any;
      if (!agg || typeof agg !== "object") {
        fail(`[Weekly Report ID ${report.id}] aggregated_data is null or invalid`);
        totalFails++;
        continue;
      }

      // E1 — Safety stats in report match source records for that week
      const [ttCount, safetyObsCount, incidentCount] = await Promise.all([
        q(`SELECT COUNT(*) AS n FROM toolbox_talks WHERE project_id = $1 AND report_date BETWEEN $2 AND $3`,
          [report.project_id, report.week_commencing, report.week_ending]),
        q(`SELECT COUNT(*) AS n FROM safety_observations WHERE project_id = $1 AND observation_date BETWEEN $2 AND $3`,
          [report.project_id, report.week_commencing, report.week_ending]),
        q(`SELECT COUNT(*) AS n FROM incident_reports WHERE project_id = $1 AND incident_date BETWEEN $2 AND $3`,
          [report.project_id, report.week_commencing, report.week_ending]),
      ]);

      const dbTT = +ttCount[0].n;
      const dbObs = +safetyObsCount[0].n;
      const dbInc = +incidentCount[0].n;
      const aggSafety = agg.safetyStats || {};

      const ttMatch = aggSafety.toolboxTalks === dbTT;
      const obsMatch = aggSafety.observations === dbObs;

      check(
        `[Weekly Report ID ${report.id} / w/c ${report.week_commencing}] Safety stats match source data`,
        ttMatch && obsMatch,
        (!ttMatch || !obsMatch)
          ? `Report has TBT:${aggSafety.toolboxTalks ?? "?"} Obs:${aggSafety.observations ?? "?"} — DB has TBT:${dbTT} Obs:${dbObs}`
          : `TBT: ${dbTT}, Obs: ${dbObs}, Incidents: ${dbInc}`
      );

      // E2 — Team members in report match active assignments for that week
      const aggTeam = Array.isArray(agg.teamMembers) ? agg.teamMembers.length : 0;
      const actualTeam = await q(`
        SELECT COUNT(DISTINCT a.worker_id) AS n
        FROM assignments a
        WHERE a.project_id = $1
        AND a.status IN ('active', 'flagged', 'confirmed')
        AND a.start_date <= $3
        AND (a.end_date IS NULL OR a.end_date >= $2)
      `, [report.project_id, report.week_commencing, report.week_ending]);
      const dbTeam = +actualTeam[0].n;

      check(
        `[Weekly Report ID ${report.id}] Team member count matches assignments`,
        Math.abs(aggTeam - dbTeam) <= 1,  // Allow ±1 tolerance
        Math.abs(aggTeam - dbTeam) > 1 ? `Report shows ${aggTeam} team members — DB has ${dbTeam} active assignments for that week` : `${dbTeam} team member(s)`,
        Math.abs(aggTeam - dbTeam) > 1
      );

      // E3 — Delays in report match source daily report records for that week
      const dailyReportsForWeek = await q(`
        SELECT id, delays_log FROM daily_reports
        WHERE project_id = $1 AND report_date BETWEEN $2 AND $3
      `, [report.project_id, report.week_commencing, report.week_ending]);
      const totalDelays = dailyReportsForWeek.reduce((sum: number, r: any) => {
        const dl = Array.isArray(r.delays_log) ? r.delays_log : [];
        return sum + dl.length;
      }, 0);
      const aggDelays = Array.isArray(agg.delays) ? agg.delays.length : 0;

      check(
        `[Weekly Report ID ${report.id}] Delay count matches daily reports`,
        aggDelays === totalDelays,
        aggDelays !== totalDelays ? `Report has ${aggDelays} delays — DB daily reports have ${totalDelays} for that week` : `${totalDelays} delay(s)`,
        aggDelays !== totalDelays
      );
    }
  }


  // ═══════════════════════════════════════════════════════════════════════════
  section("F. Customer Portal");
  // ═══════════════════════════════════════════════════════════════════════════

  // F1 — Active projects have a portal access token
  const activeProjectsNoToken = await q(`
    SELECT code FROM projects
    WHERE status = 'active'
    AND (portal_access_token IS NULL OR TRIM(portal_access_token) = '')
  `);
  check("All active projects have a portal access token", activeProjectsNoToken.length === 0,
    activeProjectsNoToken.length > 0
      ? `Projects missing portal token: ${activeProjectsNoToken.map((p: any) => p.code).join(", ")}`
      : undefined, true);

  // F2 — Timesheet signatory set on active projects (needed for customer email)
  const activeProjectsNoSignatory = await q(`
    SELECT code FROM projects
    WHERE status = 'active'
    AND (timesheet_signatory_email IS NULL OR TRIM(timesheet_signatory_email) = '')
  `);
  check("All active projects have a timesheet signatory email", activeProjectsNoSignatory.length === 0,
    activeProjectsNoSignatory.length > 0
      ? `Projects missing signatory: ${activeProjectsNoSignatory.map((p: any) => p.code).join(", ")}`
      : undefined, true);

  // F3 — Customer PM email set on active projects
  const activeProjectsNoPM = await q(`
    SELECT code FROM projects
    WHERE status = 'active'
    AND (customer_project_manager_email IS NULL OR TRIM(customer_project_manager_email) = '')
  `);
  check("All active projects have a customer PM email", activeProjectsNoPM.length === 0,
    activeProjectsNoPM.length > 0
      ? `Projects missing customer PM email: ${activeProjectsNoPM.map((p: any) => p.code).join(", ")}`
      : undefined, true);

  // F4 — Published daily reports exist for each active project
  for (const project of activeProjects.filter((p: any) => p.status === "active")) {
    const publishedReports = await q(`
      SELECT COUNT(*) AS n FROM daily_reports
      WHERE project_id = $1 AND published_to_portal = true
    `, [project.id]);
    const n = +publishedReports[0].n;
    check(
      `[${project.code}] Has at least one published daily report on portal`,
      n > 0,
      n === 0 ? `No daily reports have been published to the portal yet` : `${n} published report(s)`,
      n === 0
    );
  }


  // ═══════════════════════════════════════════════════════════════════════════
  section("G. QHSE Records");
  // ═══════════════════════════════════════════════════════════════════════════

  // G1 — Safety observations reference valid project
  const orphanedSafetyObs = await q(`
    SELECT COUNT(*) AS n FROM safety_observations so
    WHERE so.project_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = so.project_id)
  `);
  check("All safety observations reference valid projects", +orphanedSafetyObs[0].n === 0,
    +orphanedSafetyObs[0].n > 0 ? `${orphanedSafetyObs[0].n} orphaned safety observations` : undefined);

  // G2 — Incident reports reference valid project
  const orphanedIncidents = await q(`
    SELECT COUNT(*) AS n FROM incident_reports ir
    WHERE ir.project_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = ir.project_id)
  `);
  check("All incident reports reference valid projects", +orphanedIncidents[0].n === 0,
    +orphanedIncidents[0].n > 0 ? `${orphanedIncidents[0].n} orphaned incident reports` : undefined);

  // G3 — Open incidents (not closed after 30 days)
  const oldOpenIncidents = await q(`
    SELECT ir.id, ir.incident_type, ir.incident_date, p.code
    FROM incident_reports ir
    LEFT JOIN projects p ON p.id = ir.project_id
    WHERE ir.status = 'open'
    AND ir.incident_date < (CURRENT_DATE - INTERVAL '30 days')::text
    ORDER BY ir.incident_date ASC
  `);
  check("No incidents left open for > 30 days", oldOpenIncidents.length === 0,
    oldOpenIncidents.length > 0
      ? `${oldOpenIncidents.length} incident(s) unresolved > 30 days: ${oldOpenIncidents.slice(0, 3).map((i: any) => `[${i.code}] ${i.incident_type} on ${i.incident_date}`).join("; ")}`
      : undefined, true);

  // G4 — Toolbox talks with no project assigned (pending_assignment)
  const pendingTBTs = await q(`
    SELECT COUNT(*) AS n FROM toolbox_talks WHERE project_id IS NULL
  `);
  check("No toolbox talks awaiting project assignment", +pendingTBTs[0].n === 0,
    +pendingTBTs[0].n > 0 ? `${pendingTBTs[0].n} toolbox talk(s) not assigned to a project` : undefined, true);

  // G5 — Supervisor reports pending assignment
  const pendingSupervisorReports = await q(`
    SELECT COUNT(*) AS n FROM supervisor_reports WHERE status = 'pending_assignment'
  `);
  check("No supervisor reports pending project assignment", +pendingSupervisorReports[0].n === 0,
    +pendingSupervisorReports[0].n > 0 ? `${pendingSupervisorReports[0].n} supervisor report(s) need assigning to a project` : undefined, true);


  // ═══════════════════════════════════════════════════════════════════════════
  section("H. Worker Profiles");
  // ═══════════════════════════════════════════════════════════════════════════

  // H1 — All workers have employment type set
  const workersNoEmpType = await q(`
    SELECT COUNT(*) AS n FROM workers
    WHERE employment_type IS NULL OR TRIM(employment_type) = ''
  `);
  check("All workers have employment_type (FTE/Temp)", +workersNoEmpType[0].n === 0,
    +workersNoEmpType[0].n > 0 ? `${workersNoEmpType[0].n} workers have no employment_type set` : undefined, true);

  // H2 — Passport expiry check — flag workers with expiring passports in the next 90 days
  const expiringPassports = await q(`
    SELECT name, passport_expiry
    FROM workers
    WHERE passport_expiry IS NOT NULL
    AND passport_expiry != ''
    AND passport_expiry <= (CURRENT_DATE + INTERVAL '90 days')::text
    AND passport_expiry >= CURRENT_DATE::text
    ORDER BY passport_expiry ASC
  `);
  check(
    "No worker passports expiring in the next 90 days",
    expiringPassports.length === 0,
    expiringPassports.length > 0
      ? `${expiringPassports.length} passport(s) expiring soon: ${expiringPassports.slice(0, 5).map((w: any) => `${w.name} (${w.passport_expiry})`).join(", ")}`
      : undefined, true
  );

  // H3 — Expired passports
  const expiredPassports = await q(`
    SELECT name, passport_expiry
    FROM workers
    WHERE passport_expiry IS NOT NULL
    AND passport_expiry != ''
    AND passport_expiry < CURRENT_DATE::text
    ORDER BY passport_expiry ASC
  `);
  check(
    "No workers have expired passports",
    expiredPassports.length === 0,
    expiredPassports.length > 0
      ? `${expiredPassports.length} worker(s) with expired passports: ${expiredPassports.slice(0, 5).map((w: any) => `${w.name} (expired ${w.passport_expiry})`).join(", ")}`
      : undefined, true
  );

  // H4 — Workers currently on site with no emergency contact
  const onSiteNoEmergencyContact = await q(`
    SELECT w.name FROM workers w
    WHERE w.status = 'on_site'
    AND (w.emergency_contact_name IS NULL OR TRIM(w.emergency_contact_name) = '')
  `);
  check("All on-site workers have an emergency contact", onSiteNoEmergencyContact.length === 0,
    onSiteNoEmergencyContact.length > 0
      ? `${onSiteNoEmergencyContact.length} on-site worker(s) missing emergency contact: ${onSiteNoEmergencyContact.map((w: any) => w.name).join(", ")}`
      : undefined, true);

  // H5 — Workers with work email who don't have a platform user account
  const workersWithEmailNoAccount = await q(`
    SELECT w.name, w.work_email
    FROM workers w
    WHERE w.work_email IS NOT NULL AND TRIM(w.work_email) != ''
    AND NOT EXISTS (
      SELECT 1 FROM users u WHERE LOWER(u.email) = LOWER(w.work_email)
    )
  `);
  // This is informational — not necessarily an error
  if (workersWithEmailNoAccount.length > 0) {
    info(`${workersWithEmailNoAccount.length} worker(s) have a work email but no platform login account`);
  }


  // ═══════════════════════════════════════════════════════════════════════════
  section("I. Person Schedule & Assignment Accuracy");
  // ═══════════════════════════════════════════════════════════════════════════

  // I1 — Count of active/confirmed/flagged assignments on completed or cancelled projects.
  // Historical assignments on closed projects are intentional — the Person Schedule
  // relies on them to render past deployment bars. Logged as INFO only.
  const staleOnClosed = await q(`
    SELECT a.id, a.status AS assignment_status, w.name AS worker_name,
           p.code AS project_code, p.status AS project_status,
           a.start_date, a.end_date
      FROM assignments a
      JOIN workers w ON w.id = a.worker_id
      LEFT JOIN role_slots rs ON rs.id = a.role_slot_id
      JOIN projects p ON p.id = COALESCE(rs.project_id, a.project_id)
     WHERE a.status IN ('active', 'confirmed', 'flagged', 'pending_confirmation')
       AND p.status IN ('completed', 'cancelled')
     ORDER BY p.code, w.name
  `);
  info(`${staleOnClosed.length} historical active/confirmed/flagged assignment(s) on completed/cancelled projects (intentional — powers Person Schedule history)`);

  // I2 — No worker has overlapping active assignments on two different projects on the same date.
  // Workers can only be on one project at a time.
  // IMPORTANT: Uses assignment start_date/end_date directly — NOT role_slot_periods.
  // Periods are sub-windows within an assignment (e.g. two stints on the same project)
  // and must NOT be used for overlap detection — they cause false positives when a worker
  // has a future period that overlaps with a sequential assignment on a different project.
  const overlappingActive = await q(`
    SELECT a1.worker_id, w.name,
           a1.project_id AS project1_id, p1.code AS project1,
           a2.project_id AS project2_id, p2.code AS project2,
           a1.start_date AS start1, a1.end_date AS end1,
           a2.start_date AS start2, a2.end_date AS end2
      FROM assignments a1
      JOIN assignments a2
        ON a1.worker_id = a2.worker_id
       AND a1.project_id <> a2.project_id
       AND a1.id < a2.id
       AND a1.status IN ('active', 'confirmed', 'flagged')
       AND a2.status IN ('active', 'confirmed', 'flagged')
       AND a1.start_date IS NOT NULL AND a1.end_date IS NOT NULL
       AND a2.start_date IS NOT NULL AND a2.end_date IS NOT NULL
       AND a1.start_date::date <= a2.end_date::date
       AND a2.start_date::date <= a1.end_date::date
      JOIN workers w ON w.id = a1.worker_id
      JOIN projects p1 ON p1.id = a1.project_id
      JOIN projects p2 ON p2.id = a2.project_id
     LIMIT 20
  `);
  check(
    "No worker appears on the Person Schedule with overlapping assignments on two projects the same day",
    overlappingActive.length === 0,
    overlappingActive.length > 0
      ? `${overlappingActive.length} overlap(s): ${overlappingActive.slice(0, 3).map((o: any) => `${o.name} on ${o.project1} (${o.start1}→${o.end1}) & ${o.project2} (${o.start2}→${o.end2})`).join("; ")}${overlappingActive.length > 3 ? "..." : ""}`
      : undefined,
    true
  );

  // I3 — Utilisation outliers.
  // Calendar days between start_date and end_date clamped to the current year,
  // summed per worker across non-cancelled / non-declined assignments.
  const utilisationOutliers = await q(`
    WITH bounds AS (
      SELECT date_trunc('year', CURRENT_DATE)::date AS year_start,
             (date_trunc('year', CURRENT_DATE) + INTERVAL '1 year - 1 day')::date AS year_end
    ),
    clamped AS (
      SELECT a.worker_id,
             GREATEST(a.start_date::date, (SELECT year_start FROM bounds)) AS s,
             LEAST(COALESCE(a.end_date::date, (SELECT year_end FROM bounds)),
                   (SELECT year_end FROM bounds)) AS e
        FROM assignments a
       WHERE a.status NOT IN ('cancelled', 'declined', 'removed')
         AND a.start_date IS NOT NULL
         AND a.start_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
         AND (a.end_date IS NULL OR a.end_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
    ),
    totals AS (
      SELECT worker_id, SUM(GREATEST((e - s) + 1, 0))::int AS days
        FROM clamped
       WHERE e >= s
       GROUP BY worker_id
    )
    SELECT w.name, t.days
      FROM totals t
      JOIN workers w ON w.id = t.worker_id
     WHERE t.days > 250
     ORDER BY t.days DESC
  `);

  const impossibleUtilisation = utilisationOutliers.filter((r: any) => +r.days > 365);
  const highUtilisation = utilisationOutliers.filter((r: any) => +r.days > 250 && +r.days <= 365);

  check(
    "No workers with > 365 assigned days in current year (impossible — duplicate or stale data)",
    impossibleUtilisation.length === 0,
    impossibleUtilisation.length > 0
      ? `${impossibleUtilisation.length} worker(s): ${impossibleUtilisation.slice(0, 5).map((r: any) => `${r.name} (${r.days}d)`).join(", ")}`
      : undefined
  );

  check(
    "No workers over-utilised (> 250 assigned days in current year)",
    highUtilisation.length === 0,
    highUtilisation.length > 0
      ? `${highUtilisation.length} worker(s) worth reviewing: ${highUtilisation.slice(0, 5).map((r: any) => `${r.name} (${r.days}d)`).join(", ")}${highUtilisation.length > 5 ? "..." : ""}`
      : undefined,
    true
  );


  // ═══════════════════════════════════════════════════════════════════════════
  section("K. FTE Baseline, Worker Status & Deployed Today");
  // ═══════════════════════════════════════════════════════════════════════════

  // K1 — FTE Baseline must be derived from live API, not a hardcoded constant.
  const scriptDir = path.dirname(new URL(import.meta.url).pathname);
  const ganttPath = path.join(scriptDir, "..", "client", "src", "pages", "GanttChart.tsx");
  const ganttSource = fs.readFileSync(ganttPath, "utf8");
  const hasHardcodedBaseline = ganttSource.includes("FTE_BASELINE = 54");
  check(
    "GanttChart.tsx FTE Baseline is live (not hardcoded)",
    !hasHardcodedBaseline,
    hasHardcodedBaseline
      ? "GanttChart.tsx still has hardcoded FTE_BASELINE — must be derived from live API"
      : undefined
  );

  // K2 — All workers must have status = 'FTE' or 'Temp'.
  const invalidStatus = await q(`SELECT COUNT(*)::int AS n FROM workers WHERE status NOT IN ('FTE', 'Temp')`);
  const invalidStatusCount = +invalidStatus[0].n;
  check(
    "All workers have valid status (FTE or Temp)",
    invalidStatusCount === 0,
    invalidStatusCount > 0
      ? `${invalidStatusCount} worker(s) have invalid status (must be FTE or Temp)`
      : undefined,
    false
  );

  // K3 — Deployed Today card plausibility (0–200 workers on site today).
  const deployedToday = await q(`
    SELECT COUNT(DISTINCT a.worker_id)::int AS n
      FROM assignments a
      JOIN role_slot_periods rsp ON rsp.role_slot_id = a.role_slot_id
     WHERE a.status IN ('active','confirmed','completed','pending_confirmation','flagged')
       AND rsp.start_date::date <= CURRENT_DATE
       AND rsp.end_date::date >= CURRENT_DATE
  `);
  const deployedCount = +deployedToday[0].n;
  const deployedPlausible = deployedCount >= 0 && deployedCount <= 200;
  check(
    deployedPlausible
      ? `Deployed Today count plausible — ${deployedCount} worker(s) on site today`
      : `Deployed Today count implausible — ${deployedCount} (expected 0–200)`,
    deployedPlausible,
    undefined,
    true
  );


  // ═══════════════════════════════════════════════════════════════════════════
  section("L. UI Card Data Accuracy");
  // ═══════════════════════════════════════════════════════════════════════════

  // L1 — Active Projects card (Gantt).
  const activeProjectsRow = await q(`SELECT COUNT(*)::int AS n FROM projects WHERE status = 'active'`);
  const activeProjectCount = +activeProjectsRow[0].n;
  check(
    `Active Projects ground truth: ${activeProjectCount} active project(s) — Gantt card must match`,
    activeProjectCount > 0,
    activeProjectCount === 0 ? "No active projects found — DB state is wrong" : undefined,
    false
  );

  // L2 — Workforce headcount (FTE + Temp).
  const fteRow = await q(`SELECT COUNT(*)::int AS n FROM workers WHERE status = 'FTE'`);
  const tempRow = await q(`SELECT COUNT(*)::int AS n FROM workers WHERE status = 'Temp'`);
  const fteCount = +fteRow[0].n;
  const tempCount = +tempRow[0].n;
  const totalWorkforce = fteCount + tempCount;
  check(
    `Workforce headcount: ${fteCount} FTE + ${tempCount} Temp = ${totalWorkforce} total workers`,
    fteCount > 0 && tempCount > 0,
    fteCount === 0 || tempCount === 0
      ? `Missing workforce category — FTE=${fteCount}, Temp=${tempCount}`
      : undefined,
    false
  );

  // L3 — Deployed Today (workers with active assignment spanning today).
  const deployedL3Row = await q(`
    SELECT COUNT(DISTINCT a.worker_id)::int AS n
      FROM assignments a
      JOIN role_slots rs ON rs.id = a.role_slot_id
      JOIN role_slot_periods rsp ON rsp.role_slot_id = rs.id
     WHERE a.status IN ('active','confirmed','flagged','pending_confirmation')
       AND rsp.start_date::date <= CURRENT_DATE
       AND rsp.end_date::date >= CURRENT_DATE
  `);
  const deployedL3Count = +deployedL3Row[0].n;
  check(
    `Deployed Today: ${deployedL3Count} worker(s) on site — Workforce Table card must match`,
    deployedL3Count <= 200,
    deployedL3Count > 200 ? `Implausible deployed count: ${deployedL3Count}` : undefined,
    true
  );

  // L4 — Available FTE (FTE workers with no active assignment today).
  const availableFteRow = await q(`
    SELECT COUNT(*)::int AS n FROM workers w
     WHERE w.status = 'FTE'
       AND NOT EXISTS (
         SELECT 1 FROM assignments a
           JOIN role_slots rs ON rs.id = a.role_slot_id
           JOIN role_slot_periods rsp ON rsp.role_slot_id = rs.id
          WHERE a.worker_id = w.id
            AND a.status IN ('active','confirmed','flagged','pending_confirmation')
            AND rsp.start_date::date <= CURRENT_DATE
            AND rsp.end_date::date >= CURRENT_DATE
       )
  `);
  const availableFteCount = +availableFteRow[0].n;
  check(
    `Available FTE: ${availableFteCount} FTE worker(s) not currently deployed`,
    availableFteCount <= fteCount,
    availableFteCount > fteCount
      ? `Available FTE (${availableFteCount}) exceeds total FTE (${fteCount}) — impossible`
      : undefined,
    true
  );


  // ═══════════════════════════════════════════════════════════════════════════
  section("M. Filter & Logic Consistency");
  // ═══════════════════════════════════════════════════════════════════════════

  const repoRoot = path.resolve(__dirname, "..");

  // M1 — WorkforceTable Available filter uses isCurrentlyActive (date-aware).
  try {
    const workforceTablePath = path.join(repoRoot, "client/src/pages/WorkforceTable.tsx");
    const workforceSrc = fs.readFileSync(workforceTablePath, "utf8");
    const availableIdx = workforceSrc.indexOf('filterAssigned.includes("Available")');
    let m1Ok = false;
    if (availableIdx >= 0) {
      const winStart = Math.max(0, availableIdx - 300);
      const winEnd = Math.min(workforceSrc.length, availableIdx + 300);
      const window = workforceSrc.slice(winStart, winEnd);
      m1Ok = window.includes("isCurrentlyActive");
    }
    check(
      m1Ok
        ? "Available filter uses isCurrentlyActive (date-aware)"
        : "WorkforceTable Available filter does not use isCurrentlyActive — will show wrong results",
      m1Ok
    );
  } catch (e: any) {
    check(`WorkforceTable.tsx read failed: ${e.message}`, false);
  }

  // M2 — GanttChart Active Projects uses status='active' only (not completed).
  try {
    const ganttPath = path.join(repoRoot, "client/src/pages/GanttChart.tsx");
    const ganttSrc = fs.readFileSync(ganttPath, "utf8");
    const activeIdx = ganttSrc.indexOf("activeProjects =");
    let m2Ok = true;
    if (activeIdx >= 0) {
      const winStart = Math.max(0, activeIdx - 50);
      const winEnd = Math.min(ganttSrc.length, activeIdx + 200);
      const window = ganttSrc.slice(winStart, winEnd);
      m2Ok = !window.includes('p.status === "completed"');
    } else {
      m2Ok = false;
    }
    check(
      m2Ok
        ? "GanttChart Active Projects filter is status='active' only"
        : "GanttChart activeProjects filter includes completed projects — inflates Active Projects count",
      m2Ok
    );
  } catch (e: any) {
    check(`GanttChart.tsx read failed: ${e.message}`, false);
  }

  // M3 — PersonSchedule VISIBLE_ASSIGNMENT_STATUSES matches canonical status set.
  try {
    const personSchedulePath = path.join(repoRoot, "client/src/pages/PersonSchedule.tsx");
    const constantsPath = path.join(repoRoot, "client/src/lib/constants.ts");
    const psSrc = fs.readFileSync(personSchedulePath, "utf8");
    const constSrc = fs.readFileSync(constantsPath, "utf8");
    const extract = (src: string, marker: string): Set<string> | null => {
      const idx = src.indexOf(marker);
      if (idx < 0) return null;
      const open = src.indexOf("[", idx);
      const close = src.indexOf("]", open);
      if (open < 0 || close < 0) return null;
      const arr = src.slice(open + 1, close);
      const statuses = Array.from(arr.matchAll(/['"]([a-z_]+)['"]/g)).map(m => m[1]);
      return new Set(statuses);
    };
    const psSet = extract(psSrc, "VISIBLE_ASSIGNMENT_STATUSES");
    const canonicalSet = extract(constSrc, "INCLUDE_STATUSES");
    const expected = ["active", "confirmed", "completed", "pending_confirmation", "flagged"];
    const sameSet = (a: Set<string> | null, b: Set<string> | null) =>
      !!a && !!b && a.size === b.size && [...a].every(x => b.has(x));
    const m3Ok = sameSet(psSet, canonicalSet) &&
      expected.every(s => psSet!.has(s)) && psSet!.size === expected.length;
    check(
      m3Ok
        ? "PersonSchedule VISIBLE_ASSIGNMENT_STATUSES matches shared assignment-status constants"
        : "VISIBLE_ASSIGNMENT_STATUSES in PersonSchedule.tsx does not match shared/assignment-status.ts SCHEDULE_VISIBLE_STATUSES",
      m3Ok,
      m3Ok ? undefined : `PersonSchedule=${psSet ? [...psSet].join(",") : "missing"} vs canonical=${canonicalSet ? [...canonicalSet].join(",") : "missing"}`
    );
  } catch (e: any) {
    check(`PersonSchedule/constants read failed: ${e.message}`, false);
  }

  // M4 — calcUtilisation excludes cancelled/declined (no 'cancelled' inside INCLUDE_STATUSES window).
  try {
    const constantsPath = path.join(repoRoot, "client/src/lib/constants.ts");
    const constSrc = fs.readFileSync(constantsPath, "utf8");
    const includeIdx = constSrc.indexOf("INCLUDE_STATUSES");
    let m4Ok = true;
    if (includeIdx >= 0) {
      const window = constSrc.slice(includeIdx, Math.min(constSrc.length, includeIdx + 300));
      m4Ok = !window.includes('"cancelled"') && !window.includes("'cancelled'");
    } else {
      m4Ok = false;
    }
    check(
      m4Ok
        ? "calcUtilisation correctly excludes cancelled/declined assignments"
        : "calcUtilisation INCLUDE_STATUSES may include cancelled/declined — check constants.ts",
      m4Ok
    );
  } catch (e: any) {
    check(`constants.ts read failed: ${e.message}`, false);
  }


  // ═══════════════════════════════════════════════════════════════════════════
  section("N. Reporting & Timesheet Workflow Invariants");
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // Codifies the manual reporting/timesheet workflow rules established in the
  // 2026-04-27 hardening pass. These rules are documented in PLATFORM_CONTEXT.md
  // (section "Reporting & Timesheet Workflow Invariants") and must remain true
  // on production data — any drift surfaces here.

  // N1 — MOB/DEMOB paid-hour rule: shared helper marks mob/demob as non-paid.
  // Code-content check on shared/timesheet-hours.ts so the canonical helper
  // cannot silently start counting MOB/DEMOB as paid.
  try {
    const helperPath = path.join(repoRoot, "shared/timesheet-hours.ts");
    const helperSrc = fs.readFileSync(helperPath, "utf8");
    const paidSetMatch = helperSrc.match(/PAID_DAY_TYPES\s*=\s*new Set<string>\(\[([^\]]*)\]\)/);
    const paidTypes = paidSetMatch
      ? Array.from(paidSetMatch[1].matchAll(/['"]([a-z_]+)['"]/g)).map(m => m[1])
      : [];
    const onlyWorking = paidTypes.length === 1 && paidTypes[0] === "working";
    check(
      onlyWorking
        ? "shared/timesheet-hours.ts PAID_DAY_TYPES = ['working'] (MOB/DEMOB non-paid)"
        : `shared/timesheet-hours.ts PAID_DAY_TYPES drift: [${paidTypes.join(", ")}] — MOB/DEMOB must be excluded`,
      onlyWorking,
    );
  } catch (e: any) {
    check(`shared/timesheet-hours.ts read failed: ${e.message}`, false);
  }

  // N2 — Production check: no MOB/DEMOB entry on a sent/approved week may
  // contribute paid hours. If this fires, the customer was billed for
  // a non-paid day — critical.
  try {
    const mobBilled = await q(`
      SELECT te.id, to_char(te.entry_date, 'YYYY-MM-DD') AS entry_date,
             te.day_type, te.total_hours,
             tw.status AS week_status, p.code AS project_code
        FROM timesheet_entries te
        JOIN timesheet_weeks tw ON tw.id = te.timesheet_week_id
        JOIN projects p ON p.id = tw.project_id
       WHERE te.day_type IN ('mob','demob','partial_mob','partial_demob')
         AND te.total_hours IS NOT NULL
         AND te.total_hours > 0
         AND tw.status IN ('submitted','pm_approved','sent_to_customer','customer_approved')
       LIMIT 20
    `);
    check(
      "No MOB/DEMOB entries with paid hours on submitted/approved weeks",
      mobBilled.length === 0,
      mobBilled.length > 0
        ? `${mobBilled.length} entry/entries violate MOB/DEMOB non-paid rule: ${mobBilled.slice(0, 3).map((r: any) => `${r.project_code} ${r.entry_date} (${r.day_type}=${r.total_hours}h, week ${r.week_status})`).join("; ")}`
        : undefined,
      false,
    );
  } catch (e: any) {
    check(`MOB/DEMOB paid-hours query failed: ${e.message}`, false);
  }

  // N3 — Worker week totals on sent_to_customer / customer_approved weeks must
  // equal the sum of paid (working) entries. Anything else means the customer
  // is seeing a row total that disagrees with the underlying day rows.
  // Computed in SQL as: per (timesheet_week_id, worker_id), the sum of
  // total_hours for working days vs the sum across ALL day rows.
  // We only flag weeks where the two sums differ AND any non-working day
  // carries hours (i.e. the divergence is real, not floating-point noise).
  try {
    const totalsMismatch = await q(`
      SELECT te.timesheet_week_id,
             te.worker_id,
             p.code AS project_code,
             to_char(tw.week_commencing, 'YYYY-MM-DD') AS week_commencing,
             SUM(CASE WHEN te.day_type = 'working' THEN COALESCE(te.total_hours, 0) ELSE 0 END)::numeric(8,2) AS paid_hours,
             SUM(COALESCE(te.total_hours, 0))::numeric(8,2) AS row_hours,
             tw.status AS week_status
        FROM timesheet_entries te
        JOIN timesheet_weeks tw ON tw.id = te.timesheet_week_id
        JOIN projects p ON p.id = tw.project_id
       WHERE tw.status IN ('sent_to_customer','customer_approved')
       GROUP BY te.timesheet_week_id, te.worker_id, p.code, tw.week_commencing, tw.status
      HAVING SUM(CASE WHEN te.day_type = 'working' THEN COALESCE(te.total_hours, 0) ELSE 0 END)
           <> SUM(COALESCE(te.total_hours, 0))
       LIMIT 20
    `);
    check(
      "On sent/approved weeks, sum(working hours) = sum(all entry hours) (no stale MOB/DEMOB hours)",
      totalsMismatch.length === 0,
      totalsMismatch.length > 0
        ? `${totalsMismatch.length} worker/week row(s) have non-working hours leaking into the total: ${totalsMismatch.slice(0, 3).map((r: any) => `${r.project_code} w/c ${r.week_commencing}: paid=${r.paid_hours} vs row=${r.row_hours}`).join("; ")}`
        : undefined,
      true,
    );
  } catch (e: any) {
    check(`Worker week totals query failed: ${e.message}`, false);
  }

  // N4 — Draft weekly_reports must have sent_at NULL. A draft with sent_at set
  // means a draft was emailed to the customer (the safe-preview rule was bypassed).
  try {
    const draftsWithSent = await q(`
      SELECT id, project_id, week_commencing, sent_at, status
        FROM weekly_reports
       WHERE status = 'draft'
         AND sent_at IS NOT NULL
       LIMIT 20
    `);
    check(
      "Draft weekly_reports rows have sent_at NULL (draft preview never emails customer)",
      draftsWithSent.length === 0,
      draftsWithSent.length > 0
        ? `${draftsWithSent.length} draft weekly_report(s) have sent_at populated: ${draftsWithSent.slice(0, 3).map((r: any) => `id=${r.id} w/c ${r.week_commencing} sent_at=${r.sent_at}`).join("; ")}`
        : undefined,
      false,
    );
  } catch (e: any) {
    check(`Draft weekly_reports query failed: ${e.message}`, false);
  }

  // N5 — Published/sent weekly_reports should have sent_at populated. WARN
  // because some pre-existing rows pre-date the sent_at column being written.
  try {
    const publishedWithoutSent = await q(`
      SELECT id, project_id, week_commencing, status
        FROM weekly_reports
       WHERE status = 'published'
         AND sent_at IS NULL
         AND created_at > (CURRENT_DATE - INTERVAL '60 days')
       LIMIT 20
    `);
    check(
      "Recent published weekly_reports have sent_at set",
      publishedWithoutSent.length === 0,
      publishedWithoutSent.length > 0
        ? `${publishedWithoutSent.length} recent published row(s) missing sent_at — verify generator wrote sent_at on email send: ${publishedWithoutSent.slice(0, 3).map((r: any) => `id=${r.id} w/c ${r.week_commencing}`).join("; ")}`
        : undefined,
      true,
    );
  } catch (e: any) {
    check(`Published weekly_reports query failed: ${e.message}`, false);
  }

  // N6 — Active projects intended for customer-portal use should have a
  // portal_access_token. F1 already does the equality check; here we record
  // the token+preview URL contract so future regressions surface clearly.
  try {
    const activeNoToken = await q(`
      SELECT code FROM projects
       WHERE status = 'active'
         AND (portal_access_token IS NULL OR TRIM(portal_access_token) = '')
    `);
    check(
      "All active projects have a portal_access_token (tokenized portal URL: /#/portal/<code>?token=...)",
      activeNoToken.length === 0,
      activeNoToken.length > 0
        ? `${activeNoToken.length} active project(s) without portal token — customer portal link cannot be issued: ${activeNoToken.map((p: any) => p.code).join(", ")}`
        : undefined,
      true,
    );
  } catch (e: any) {
    check(`Portal token check failed: ${e.message}`, false);
  }

  // N7 — Each active project must have an assigned PM (project_leads row).
  // The Weekly Ops sender identity resolves PM email from project_leads → users.
  // No PM = falls back to central MAIL_FROM (warning, not failure).
  try {
    const activeNoPmLead = await q(`
      SELECT p.code FROM projects p
       WHERE p.status = 'active'
         AND NOT EXISTS (
           SELECT 1 FROM project_leads pl
            WHERE pl.project_id = p.id
         )
    `);
    check(
      "All active projects have an assigned PM (project_leads row)",
      activeNoPmLead.length === 0,
      activeNoPmLead.length > 0
        ? `${activeNoPmLead.length} active project(s) without an assigned PM — outbound emails will fall back to central sender: ${activeNoPmLead.map((p: any) => p.code).join(", ")}`
        : undefined,
      true,
    );
  } catch (e: any) {
    check(`Active project PM lead check failed: ${e.message}`, false);
  }

  // N8 — Assigned PM has an email on file. Without an email we cannot set
  // replyTo or fromName, so customer replies route to central MAIL_FROM.
  try {
    const pmsNoEmail = await q(`
      SELECT p.code, u.name AS pm_name
        FROM projects p
        JOIN project_leads pl ON pl.project_id = p.id
        JOIN users u ON u.id = pl.user_id
       WHERE p.status = 'active'
         AND (u.email IS NULL OR TRIM(u.email) = '')
    `);
    check(
      "All active-project PMs have an email address",
      pmsNoEmail.length === 0,
      pmsNoEmail.length > 0
        ? `${pmsNoEmail.length} PM(s) missing email: ${pmsNoEmail.slice(0, 5).map((r: any) => `${r.code} (${r.pm_name})`).join(", ")}`
        : undefined,
      true,
    );
  } catch (e: any) {
    check(`PM email check failed: ${e.message}`, false);
  }

  // N9 — Assigned PM email is on @powerforce.global so Graph can send-as.
  // Off-domain PMs still get replyTo + fromName, but the customer sees
  // central MAIL_FROM as the sender. Warning only — many off-domain users
  // are intentional (consultants).
  try {
    const pmsOffDomain = await q(`
      SELECT p.code, u.email
        FROM projects p
        JOIN project_leads pl ON pl.project_id = p.id
        JOIN users u ON u.id = pl.user_id
       WHERE p.status = 'active'
         AND u.email IS NOT NULL
         AND TRIM(u.email) <> ''
         AND LOWER(u.email) NOT LIKE '%@powerforce.global'
    `);
    check(
      "All active-project PMs have @powerforce.global email (Graph send-as)",
      pmsOffDomain.length === 0,
      pmsOffDomain.length > 0
        ? `${pmsOffDomain.length} PM(s) off-domain — outbound 'from' will fall back to central sender (replyTo still set): ${pmsOffDomain.slice(0, 5).map((r: any) => `${r.code} (${r.email})`).join(", ")}`
        : undefined,
      true,
    );
  } catch (e: any) {
    check(`PM @powerforce.global check failed: ${e.message}`, false);
  }

  // N10 — Code-content check: the safe-preview endpoint writes a draft and
  // does NOT email the customer. Guards against a future refactor enabling
  // sends from the preview endpoint.
  //
  // Anchors on app.post(...generate-weekly-report-preview...) — the actual
  // handler registration — not the URL mentioned in the file's leading
  // comment block, which would scoop in unrelated email-sending handlers.
  try {
    const wopsPath = path.join(repoRoot, "server/weekly-ops-routes.ts");
    const wopsSrc = fs.readFileSync(wopsPath, "utf8");
    const handlerRegex = /app\.post\(\s*["']\/api\/weekly-ops\/generate-weekly-report-preview["']/;
    const m = handlerRegex.exec(wopsSrc);
    let n10Ok = false;
    if (m) {
      // Walk from handlerStart to the matching close paren of app.post(...)
      // by counting parens. Fallback to a generous slice if walking fails.
      const handlerStart = m.index;
      let depth = 0;
      let inString: string | null = null;
      let escape = false;
      let handlerEnd = wopsSrc.length;
      for (let i = handlerStart; i < wopsSrc.length; i++) {
        const ch = wopsSrc[i];
        if (escape) { escape = false; continue; }
        if (inString) {
          if (ch === "\\") { escape = true; continue; }
          if (ch === inString) inString = null;
          continue;
        }
        if (ch === '"' || ch === "'" || ch === "`") { inString = ch; continue; }
        if (ch === "(") depth++;
        else if (ch === ")") {
          depth--;
          if (depth === 0) { handlerEnd = i + 1; break; }
        }
      }
      const handlerSrc = wopsSrc.slice(handlerStart, handlerEnd);
      const hasPreviewFlag = handlerSrc.includes('mode: "preview"') || handlerSrc.includes("emailedCustomer: false");
      const callsSendMail = /\bsendMail\s*\(/.test(handlerSrc);
      n10Ok = hasPreviewFlag && !callsSendMail;
    }
    check(
      n10Ok
        ? "generate-weekly-report-preview handler is non-emailing (writes draft only)"
        : "generate-weekly-report-preview may email the customer — safe-preview contract broken",
      n10Ok,
    );
  } catch (e: any) {
    check(`weekly-ops-routes.ts preview-handler read failed: ${e.message}`, false);
  }

  // N11 — Code-content check: portal weekly-reports list endpoint hides drafts
  // unless the request is an authenticated PM/admin/RM preview.
  try {
    const routesPath = path.join(repoRoot, "server/routes.ts");
    const routesSrc = fs.readFileSync(routesPath, "utf8");
    const listIdx = routesSrc.indexOf('"/api/portal/:code/weekly-reports"');
    let n11Ok = false;
    if (listIdx >= 0) {
      const win = routesSrc.slice(listIdx, Math.min(routesSrc.length, listIdx + 3000));
      const gatesPreview = win.includes("isInternalPreview");
      const filtersDraft = win.includes("status === 'published'") || win.includes('status === "published"');
      const requiresRole = /\["admin",\s*"project_manager",\s*"resource_manager"\]/.test(win);
      n11Ok = gatesPreview && filtersDraft && requiresRole;
    }
    check(
      n11Ok
        ? "Portal weekly-reports endpoint hides drafts from customers (preview gated to PM/admin/RM session)"
        : "Portal weekly-reports endpoint may leak drafts to customers — preview gating drift",
      n11Ok,
    );
  } catch (e: any) {
    check(`server/routes.ts portal-list read failed: ${e.message}`, false);
  }

  // N12 — report-period helper exists and exports formatPeriod + computeProgress.
  // Pinned because the weekly-report PDF header was previously hardcoded.
  try {
    const periodHelperPath = path.join(repoRoot, "shared/report-period.ts");
    const helperSrc = fs.readFileSync(periodHelperPath, "utf8");
    const hasFormat = /export\s+function\s+formatPeriod\b/.test(helperSrc) ||
                      /export\s+const\s+formatPeriod\b/.test(helperSrc);
    const hasProgress = /export\s+function\s+computeProgress\b/.test(helperSrc) ||
                        /export\s+const\s+computeProgress\b/.test(helperSrc);
    check(
      hasFormat && hasProgress
        ? "shared/report-period.ts exports formatPeriod and computeProgress"
        : "shared/report-period.ts missing formatPeriod / computeProgress export — weekly report header may regress",
      hasFormat && hasProgress,
    );
  } catch (e: any) {
    check(`shared/report-period.ts read failed: ${e.message}`, true);
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════════════════════════════════

  console.log(`\n${C.bold}${"═".repeat(64)}${C.reset}`);

  const failColor = totalFails > 0 ? C.red : C.green;
  const warnColor = totalWarns > 0 ? C.yellow : C.green;

  console.log(
    `${C.bold}Results: ${totalChecks} checks — ` +
    `${failColor}${totalFails} failed${C.reset}${C.bold}, ` +
    `${warnColor}${totalWarns} warnings${C.reset}${C.bold}, ` +
    `${C.green}${totalChecks - totalFails - totalWarns} passed${C.reset}`
  );

  if (totalFails === 0 && totalWarns === 0) {
    console.log(`\n${C.green}${C.bold}  ✓ Platform data looks healthy.${C.reset}\n`);
  } else if (totalFails === 0) {
    console.log(`\n${C.yellow}${C.bold}  ⚠ No critical failures, but ${totalWarns} warning(s) worth reviewing.${C.reset}\n`);
  } else {
    console.log(`\n${C.red}${C.bold}  ✗ ${totalFails} critical issue(s) found. Review failures above before making changes.${C.reset}\n`);
  }

  await pool.end();
  process.exit(totalFails > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(`${C.red}Health check crashed: ${err.message}${C.reset}`);
  process.exit(1);
});
