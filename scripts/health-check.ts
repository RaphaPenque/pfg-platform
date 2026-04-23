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
 */

import { Pool } from "pg";
import * as dotenv from "dotenv";
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
