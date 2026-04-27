/**
 * Weekly Operations — PM-facing manual controls
 *
 * Surfaces the Sunday/Monday workflow so a Project Manager can see at a glance
 * what state each project's week is in and trigger the missing steps manually.
 *
 * Endpoints:
 *   GET  /api/weekly-ops/projects                                — projects available for this view
 *   GET  /api/weekly-ops/status?projectId=&weekCommencing=        — status for a project + week
 *   POST /api/weekly-ops/resend-supervisor-link                   — resend a single supervisor link (day|night)
 *   POST /api/weekly-ops/generate-weekly-report                   — generate + email weekly report (customer-facing)
 *   POST /api/weekly-ops/generate-weekly-report-preview           — generate weekly report PDF + draft DB row, NO email
 *
 * FUTURE (not yet implemented):
 *   POST /api/weekly-ops/approve-without-supervisor               — let a PM approve a timesheet
 *     week even though no supervisor has submitted, e.g. when supervisor link delivery has
 *     failed or the supervisor is unreachable. Should be gated to admin/PM, require an
 *     audit-logged reason, and live next to the existing supervisor-resend flow above.
 *
 * NOTE: The send-customer-timesheets and supervisor sends ALWAYS hit live email.
 * The frontend gates the customer-facing actions behind explicit confirmations.
 * No new unauthenticated destructive endpoints are introduced — every action
 * route requires session auth and PM/admin/resource-manager role.
 */

import { type Express, type Request, type Response } from "express";
import { sql } from "drizzle-orm";
import crypto from "crypto";
import { db } from "./storage";
import { sendMail } from "./email";
import { buildSupervisorTimesheetEmail } from "./timesheet-routes";
import { getProjectSenderIdentity } from "./project-sender";

const APP_URL = process.env.APP_URL || "https://pfg-platform.onrender.com";

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Return the Monday of the week containing `date` (UTC). */
function weekMondayUTC(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  const day = d.getUTCDay(); // 0=Sun .. 6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

function isoDate(d: Date): string {
  return d.toISOString().substring(0, 10);
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

function parseWeekCommencing(input: unknown): string {
  if (typeof input === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return input;
  }
  // default: previous Monday relative to today
  return isoDate(weekMondayUTC(addDays(new Date(), -1)));
}

// ─── route registration ───────────────────────────────────────────────────────

export function registerWeeklyOpsRoutes(
  app: Express,
  requireAuth: any,
  requireRole: any,
) {
  // ── GET /api/weekly-ops/projects ─────────────────────────────────────────
  // List active projects for the picker, plus default week.
  app.get(
    "/api/weekly-ops/projects",
    requireAuth,
    requireRole("admin", "project_manager", "resource_manager", "observer"),
    async (_req: Request, res: Response) => {
      try {
        const projRes = await db.execute(sql`
          SELECT id, code, name, customer, status,
                 customer_project_manager, customer_project_manager_email,
                 site_manager, site_manager_email,
                 timesheet_signatory_name, timesheet_signatory_email
          FROM projects
          WHERE status = 'active'
          ORDER BY code
        `);
        const defaultWeek = parseWeekCommencing(undefined);
        return res.json({ ok: true, defaultWeekCommencing: defaultWeek, projects: projRes.rows });
      } catch (e: any) {
        return res.status(500).json({ error: e.message || String(e) });
      }
    },
  );

  // ── GET /api/weekly-ops/status?projectId=&weekCommencing= ─────────────────
  // Composite read endpoint — single round-trip for the PM panel.
  app.get(
    "/api/weekly-ops/status",
    requireAuth,
    requireRole("admin", "project_manager", "resource_manager", "observer"),
    async (req: Request, res: Response) => {
      try {
        const projectId = parseInt(String(req.query.projectId || ""), 10);
        if (!projectId || isNaN(projectId)) {
          return res.status(400).json({ error: "projectId is required" });
        }

        const weekCommencing = parseWeekCommencing(req.query.weekCommencing);
        const weekEnding = isoDate(addDays(new Date(weekCommencing + "T00:00:00Z"), 6));

        // 1. project + key contacts
        const projRes = await db.execute(sql`
          SELECT id, code, name, customer, status, shift,
                 start_date, end_date,
                 customer_project_manager, customer_project_manager_email,
                 site_manager, site_manager_email,
                 timesheet_signatory_name, timesheet_signatory_email,
                 sourcing_contact_email,
                 portal_access_token
          FROM projects WHERE id = ${projectId}
        `);
        const project: any = projRes.rows[0];
        if (!project) return res.status(404).json({ error: "Project not found" });

        // 2. PM (resource owner) for this project
        const pmRes = await db.execute(sql`
          SELECT u.id, u.name, u.email
          FROM project_leads pl
          JOIN users u ON u.id = pl.user_id
          WHERE pl.project_id = ${projectId}
          LIMIT 1
        `);
        const pm: any = pmRes.rows[0] || null;

        // 3. timesheet_week (project + week)
        const twRes = await db.execute(sql`
          SELECT id, status, submitted_at, pm_approved_at, sent_to_customer_at,
                 customer_approved_at, recalled_at, day_sup_token, day_sup_name,
                 day_sup_submitted_at, night_sup_token, night_sup_name,
                 night_sup_submitted_at, customer_token, token_expires_at,
                 token_used_at, billing_pdf_path, timesheet_pdf_path
          FROM timesheet_weeks
          WHERE project_id = ${projectId} AND week_commencing = ${weekCommencing}::date
          LIMIT 1
        `);
        const tw: any = twRes.rows[0] || null;

        // 4. entries summary
        let entries = { count: 0, workers: 0, totalHours: 0 };
        if (tw) {
          const r = await db.execute(sql`
            SELECT COUNT(*)::int  as cnt,
                   COUNT(DISTINCT worker_id)::int as workers,
                   COALESCE(SUM(CASE WHEN day_type = 'working' THEN total_hours ELSE 0 END), 0) as total_hours
            FROM timesheet_entries WHERE timesheet_week_id = ${tw.id}
          `);
          const row: any = r.rows[0] || {};
          entries = {
            count: Number(row.cnt || 0),
            workers: Number(row.workers || 0),
            totalHours: Number(row.total_hours || 0),
          };
        }

        // 5. assignments active in week — to determine if night shift applies
        const assignRes = await db.execute(sql`
          SELECT COUNT(*) FILTER (WHERE LOWER(shift) LIKE 'night%')::int as night,
                 COUNT(*) FILTER (WHERE LOWER(shift) LIKE 'day%')::int   as day,
                 COUNT(*)::int as total
          FROM assignments
          WHERE project_id = ${projectId}
            AND status NOT IN ('cancelled','declined','removed')
            AND (start_date IS NULL OR start_date <= ${weekEnding})
            AND (end_date   IS NULL OR end_date   >= ${weekCommencing})
        `);
        const shiftCounts: any = assignRes.rows[0] || { day: 0, night: 0, total: 0 };
        const hasNightShift = Number(shiftCounts.night || 0) > 0;

        // 6. weekly_reports — has a row for this week?
        const wrRes = await db.execute(sql`
          SELECT id, status, sent_at, pdf_path, aggregated_data
          FROM weekly_reports
          WHERE project_id = ${projectId} AND week_commencing = ${weekCommencing}
          LIMIT 1
        `);
        const wrRow: any = wrRes.rows[0] || null;
        const aggData = wrRow
          ? typeof wrRow.aggregated_data === "string"
            ? JSON.parse(wrRow.aggregated_data)
            : (wrRow.aggregated_data || {})
          : null;
        const weeklyReport = wrRow
          ? {
              id: wrRow.id,
              status: wrRow.status,
              sentAt: wrRow.sent_at,
              hasPdf: !!(wrRow.pdf_path || aggData?.pdfBase64),
              hasAggregatedData: !!(aggData && Object.keys(aggData).length > 0),
            }
          : null;

        // 7. published daily reports for the week
        const drRes = await db.execute(sql`
          SELECT COUNT(*)::int as published_count
          FROM daily_reports
          WHERE project_id = ${projectId}
            AND published_to_portal = true
            AND report_date BETWEEN ${weekCommencing} AND ${weekEnding}
        `);
        const dailyReportsPublished = Number((drRes.rows[0] as any)?.published_count || 0);

        // 8. compute warnings (plain English)
        const warnings: { code: string; level: "warn" | "info" | "block"; message: string }[] = [];

        const customerEmails = [
          project.timesheet_signatory_email,
          project.customer_project_manager_email,
          project.site_manager_email,
          project.sourcing_contact_email,
        ].filter(Boolean);

        if (!tw) {
          warnings.push({
            code: "no_timesheet_week",
            level: "warn",
            message: "No timesheet week exists for this project / week. Sunday job has not run.",
          });
        }
        if (tw && !tw.day_sup_token) {
          warnings.push({
            code: "no_day_token",
            level: "warn",
            message: "Day supervisor link has not been sent.",
          });
        }
        if (tw && hasNightShift && !tw.night_sup_token) {
          warnings.push({
            code: "no_night_token",
            level: "warn",
            message: "Night shift detected but no night supervisor link has been sent.",
          });
        }
        if (tw && tw.day_sup_token && !tw.day_sup_submitted_at) {
          warnings.push({
            code: "day_sup_not_submitted",
            level: "warn",
            message: "Day supervisor link sent but not yet submitted.",
          });
        }
        if (tw && hasNightShift && tw.night_sup_token && !tw.night_sup_submitted_at) {
          warnings.push({
            code: "night_sup_not_submitted",
            level: "warn",
            message: "Night supervisor link sent but not yet submitted.",
          });
        }
        if (tw && entries.count === 0) {
          warnings.push({
            code: "no_entries",
            level: "warn",
            message: "Timesheet week exists but has no entries.",
          });
        }
        if (customerEmails.length === 0) {
          warnings.push({
            code: "no_customer_emails",
            level: "block",
            message: "No customer-facing emails on the project. Customer report send will be skipped.",
          });
        }
        if (dailyReportsPublished === 0) {
          warnings.push({
            code: "no_published_daily_reports",
            level: "warn",
            message: "No daily reports have been published to the portal for this week — weekly report will be empty.",
          });
        }
        if (!weeklyReport) {
          warnings.push({
            code: "weekly_report_missing",
            level: "info",
            message: "No weekly_reports row yet for this week.",
          });
        }

        // 9. derive plain-English headline state
        let headline = "Awaiting supervisor submission";
        if (!tw) headline = "Timesheet week not built";
        else if (tw.status === "customer_approved") headline = "Customer approved";
        else if (tw.status === "sent_to_customer") headline = "Sent to customer — awaiting approval";
        else if (tw.status === "pm_approved") headline = "PM approved — ready to send to customer";
        else if (tw.status === "submitted") headline = "Submitted by supervisors — needs PM review";
        else if (tw.day_sup_submitted_at && (!hasNightShift || tw.night_sup_submitted_at)) {
          headline = "All supervisors submitted";
        } else if (tw.day_sup_token || tw.night_sup_token) {
          headline = "Awaiting supervisor submission";
        } else {
          headline = "Supervisor links not sent";
        }

        // Build portal preview URLs surfaced directly in the status payload so
        // the Weekly Ops UI can render obvious "Open draft" / "Download draft"
        // actions when a draft exists. Drafts are gated server-side: the portal
        // hides drafts from public consumers, so leaking the token here is no
        // worse than the existing public portal URL.
        const portalToken = project.portal_access_token || null;
        const previewPortalUrl = portalToken
          ? `${APP_URL}/#/portal/${project.code}?token=${portalToken}&preview=1`
          : null;
        const draftPdfUrl = (weeklyReport && portalToken)
          ? `/api/portal/${project.code}/weekly-reports/${weeklyReport.id}/pdf?preview=1&token=${portalToken}`
          : null;

        return res.json({
          ok: true,
          appUrl: APP_URL,
          project: {
            id: project.id,
            code: project.code,
            name: project.name,
            customer: project.customer,
            status: project.status,
            shift: project.shift,
            startDate: project.start_date,
            endDate: project.end_date,
            customerProjectManager: project.customer_project_manager,
            customerProjectManagerEmail: project.customer_project_manager_email,
            siteManager: project.site_manager,
            siteManagerEmail: project.site_manager_email,
            timesheetSignatoryName: project.timesheet_signatory_name,
            timesheetSignatoryEmail: project.timesheet_signatory_email,
            sourcingContactEmail: project.sourcing_contact_email,
            portalAccessToken: portalToken,
            previewPortalUrl,
            draftPdfUrl,
          },
          pm,
          weekCommencing,
          weekEnding,
          timesheetWeek: tw
            ? {
                id: tw.id,
                status: tw.status,
                submittedAt: tw.submitted_at,
                pmApprovedAt: tw.pm_approved_at,
                sentToCustomerAt: tw.sent_to_customer_at,
                customerApprovedAt: tw.customer_approved_at,
                recalledAt: tw.recalled_at,
                daySupName: tw.day_sup_name,
                daySupTokenExists: !!tw.day_sup_token,
                daySupSubmittedAt: tw.day_sup_submitted_at,
                nightSupName: tw.night_sup_name,
                nightSupTokenExists: !!tw.night_sup_token,
                nightSupSubmittedAt: tw.night_sup_submitted_at,
                hasBillingPdf: !!tw.billing_pdf_path,
                hasTimesheetPdf: !!tw.timesheet_pdf_path,
                customerTokenExists: !!tw.customer_token,
                customerTokenExpiresAt: tw.token_expires_at,
              }
            : null,
          entries,
          assignments: {
            day: Number(shiftCounts.day || 0),
            night: Number(shiftCounts.night || 0),
            total: Number(shiftCounts.total || 0),
            hasNightShift,
          },
          weeklyReport,
          dailyReportsPublished,
          warnings,
          headline,
        });
      } catch (e: any) {
        return res.status(500).json({ error: e.message || String(e) });
      }
    },
  );

  // ── POST /api/weekly-ops/resend-supervisor-link ───────────────────────────
  // Generates a NEW token for the requested shift and emails the link.
  // Reason: tokens are stored hashed — we cannot recover the original.
  // Body: { projectId, weekCommencing, shift: "day"|"night" }
  app.post(
    "/api/weekly-ops/resend-supervisor-link",
    requireAuth,
    requireRole("admin", "project_manager", "resource_manager"),
    async (req: Request, res: Response) => {
      try {
        const { projectId, weekCommencing, shift } = req.body || {};
        const pid = parseInt(String(projectId), 10);
        if (!pid || isNaN(pid)) return res.status(400).json({ error: "projectId required" });
        if (!weekCommencing || !/^\d{4}-\d{2}-\d{2}$/.test(weekCommencing)) {
          return res.status(400).json({ error: "weekCommencing (YYYY-MM-DD) required" });
        }
        if (shift !== "day" && shift !== "night") {
          return res.status(400).json({ error: "shift must be 'day' or 'night'" });
        }

        // Locate timesheet_week
        const twRes = await db.execute(sql`
          SELECT tw.id, tw.day_sup_name, tw.night_sup_name,
                 p.name as project_name, p.code as project_code
          FROM timesheet_weeks tw
          JOIN projects p ON p.id = tw.project_id
          WHERE tw.project_id = ${pid} AND tw.week_commencing = ${weekCommencing}::date
          LIMIT 1
        `);
        const tw: any = twRes.rows[0];
        if (!tw) {
          return res.status(404).json({ error: "Timesheet week does not exist for this project/week" });
        }

        // Find supervisor for shift
        const workersRes = await db.execute(sql`
          SELECT w.id, REGEXP_REPLACE(w.name, ' [(][^)]*[)]$', '') as name, w.role,
                 COALESCE(w.work_email, w.personal_email) as email
          FROM assignments a
          JOIN workers w ON w.id = a.worker_id
          WHERE a.project_id = ${pid}
            AND a.status NOT IN ('cancelled','declined','removed')
            AND LOWER(a.shift) LIKE ${shift + "%"}
          ORDER BY
            CASE WHEN w.role ILIKE '%superintendent%' THEN 0 ELSE 1 END,
            CASE WHEN w.role ILIKE '%foreman%'        THEN 0 ELSE 1 END,
            w.id
        `);
        const workers = workersRes.rows as any[];
        const sup = workers[0];
        if (!sup) {
          return res.status(404).json({ error: `No ${shift} shift workers found for this project/week` });
        }
        if (!sup.email) {
          return res.status(422).json({
            error: `Supervisor ${sup.name} has no email on file. Update worker record before resending.`,
            supervisorName: sup.name,
          });
        }

        // Generate fresh token
        const rawToken = crypto.randomBytes(32).toString("hex");
        const hashed = crypto.createHash("sha256").update(rawToken).digest("hex");

        if (shift === "day") {
          await db.execute(sql`
            UPDATE timesheet_weeks
            SET day_sup_token = ${hashed},
                day_sup_name  = ${sup.name}
            WHERE id = ${tw.id}
          `);
        } else {
          await db.execute(sql`
            UPDATE timesheet_weeks
            SET night_sup_token = ${hashed},
                night_sup_name  = ${sup.name}
            WHERE id = ${tw.id}
          `);
        }

        const reviewUrl = `${APP_URL}/#/timesheet-supervisor/${rawToken}`;

        // Resolve project PM as sender — supervisor link should appear FROM the
        // project's assigned PM, not the logged-in operator.
        const senderIdentity = await getProjectSenderIdentity(pid);
        if (senderIdentity.warnings.length > 0) {
          console.log(`[weekly-ops:resend] sender resolution: ${senderIdentity.warnings.join("; ")}`);
        }

        await sendMail({
          to: sup.email,
          from: senderIdentity.from,
          fromName: senderIdentity.fromName,
          replyTo: senderIdentity.replyTo,
          subject: `Timesheet review — ${tw.project_name} w/c ${weekCommencing}`,
          html: buildSupervisorTimesheetEmail(
            sup.name,
            tw.project_name,
            tw.project_code,
            weekCommencing,
            shift,
            reviewUrl,
          ),
          text:
            `Hi ${sup.name},\n\nPlease review the ${shift === "night" ? "Night" : "Day"} Shift timesheet for ${tw.project_name} w/c ${weekCommencing}:\n\n${reviewUrl}\n\nPowerforce Global`,
        });

        return res.json({
          ok: true,
          shift,
          supervisorName: sup.name,
          supervisorEmail: sup.email,
          weekCommencing,
        });
      } catch (e: any) {
        return res.status(500).json({ error: e.message || String(e) });
      }
    },
  );

  // ── POST /api/weekly-ops/generate-weekly-report ─────────────────────────
  // Wraps existing report-scheduler.sendReportForProject. This DOES email the
  // customer (sourcing/customer PM/site manager). The frontend gates this
  // behind explicit confirmation copy.
  // Body: { projectId, confirmSendToCustomer: true }
  app.post(
    "/api/weekly-ops/generate-weekly-report",
    requireAuth,
    requireRole("admin", "project_manager", "resource_manager"),
    async (req: Request, res: Response) => {
      try {
        const { projectId, confirmSendToCustomer } = req.body || {};
        const pid = parseInt(String(projectId), 10);
        if (!pid || isNaN(pid)) return res.status(400).json({ error: "projectId required" });
        if (confirmSendToCustomer !== true) {
          return res.status(400).json({
            error: "confirmSendToCustomer must be true. This action emails customer contacts.",
          });
        }

        const { sendReportForProject } = await import("./report-scheduler");
        const projRes = await db.execute(sql`SELECT * FROM projects WHERE id = ${pid}`);
        const project: any = projRes.rows[0];
        if (!project) return res.status(404).json({ error: "Project not found" });

        await sendReportForProject(project, false);

        const wrRes = await db.execute(sql`
          SELECT id, status, sent_at, week_commencing, pdf_path
          FROM weekly_reports
          WHERE project_id = ${pid}
          ORDER BY week_commencing DESC
          LIMIT 1
        `);
        return res.json({ ok: true, weeklyReport: wrRes.rows[0] || null });
      } catch (e: any) {
        return res.status(500).json({ error: e.message || String(e) });
      }
    },
  );

  // ── POST /api/weekly-ops/generate-weekly-report-preview ─────────────────
  // Internal preview only — generates PDF + writes draft weekly_reports row,
  // does NOT email anyone. Targets an explicit weekCommencing so PMs can
  // preview a chosen week (e.g. w/c 2026-04-20) regardless of which daily
  // reports were most recently published.
  // Body: { projectId, weekCommencing }
  app.post(
    "/api/weekly-ops/generate-weekly-report-preview",
    requireAuth,
    requireRole("admin", "project_manager", "resource_manager"),
    async (req: Request, res: Response) => {
      try {
        const { projectId, weekCommencing } = req.body || {};
        const pid = parseInt(String(projectId), 10);
        if (!pid || isNaN(pid)) return res.status(400).json({ error: "projectId required" });

        const wc = parseWeekCommencing(weekCommencing);

        const { generateWeeklyReportPreview } = await import("./report-scheduler");
        const projRes = await db.execute(sql`SELECT * FROM projects WHERE id = ${pid}`);
        const project: any = projRes.rows[0];
        if (!project) return res.status(404).json({ error: "Project not found" });

        const result = await generateWeeklyReportPreview(project, wc);

        const portalToken = project.portal_access_token;
        const previewPortalUrl = portalToken
          ? `${APP_URL}/#/portal/${project.code}?token=${portalToken}&preview=1`
          : `${APP_URL}/#/portal/${project.code}?preview=1`;
        const pdfUrl = `/api/portal/${project.code}/weekly-reports/${result.weeklyReportId}/pdf?preview=1${portalToken ? `&token=${portalToken}` : ""}`;

        return res.json({
          ok: true,
          mode: "preview",
          emailedCustomer: false,
          weeklyReport: {
            id: result.weeklyReportId,
            status: result.status,
            weekCommencing: result.weekStart,
            weekEnding: result.weekEnd,
            hasPdf: result.hasPdf,
            publishedDailyReports: result.publishedDailyReports,
          },
          previewPortalUrl,
          pdfUrl,
          message: result.publishedDailyReports === 0
            ? "Preview generated but no daily reports were published for this week — the report content will be empty."
            : `Preview generated from ${result.publishedDailyReports} published daily report(s) for w/c ${result.weekStart}.`,
        });
      } catch (e: any) {
        return res.status(500).json({ error: e.message || String(e) });
      }
    },
  );
}
