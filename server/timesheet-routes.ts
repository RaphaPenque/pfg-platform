/**
 * Timesheet Module — API Routes
 * Steps 1–7 of the PFG Timesheet Module build.
 */

import { type Express, type Request, type Response } from "express";
import { sql } from "drizzle-orm";
import { db } from "./storage";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { sendMail } from "./email";
import { generateTimesheetPdfHtml } from "./html-pdf";

const APP_URL = process.env.APP_URL || "https://pfg-platform.onrender.com";
const UPLOAD_ROOT = process.env.UPLOAD_ROOT || "/data/uploads";

// ─── DB: uses shared pool from storage.ts ──────────────────────────────────

// ─── Helpers ────────────────────────────────────────────────────────────────

function isoDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

/** Return the Monday of the ISO week containing `date` */
function weekMonday(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  const day = d.getUTCDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

/** Calculate total hours: (time_out - time_in) - unpaid_break */
function calcTotalHours(timeIn: string | null, timeOut: string | null, breakMin: number): number | null {
  if (!timeIn || !timeOut) return null;
  const [h1, m1] = timeIn.split(":").map(Number);
  const [h2, m2] = timeOut.split(":").map(Number);
  let mins = h2 * 60 + m2 - (h1 * 60 + m1);
  if (mins < 0) mins += 24 * 60; // overnight shift
  mins -= breakMin;
  return Math.round((mins / 60) * 100) / 100;
}

/** Generate approval preimage and hash from timesheet_entries */
function buildApprovalHash(entries: any[]): { hash: string; preimage: any[] } {
  const sorted = [...entries].sort((a, b) => {
    if (a.worker_id !== b.worker_id) return a.worker_id - b.worker_id;
    return a.entry_date < b.entry_date ? -1 : 1;
  });
  const preimage = sorted.map(e => ({
    worker_id: e.worker_id,
    entry_date: e.entry_date,
    shift: e.shift,
    time_in: e.time_in ?? null,
    time_out: e.time_out ?? null,
    unpaid_break_minutes: e.unpaid_break_minutes ?? null,
    day_type: e.day_type,
    total_hours: e.total_hours !== null && e.total_hours !== undefined ? String(e.total_hours) : null,
  }));
  const json = JSON.stringify(preimage);
  const hash = crypto.createHash("sha256").update(json).digest("hex");
  return { hash, preimage };
}

/** Get PM email for a project */
async function getPmEmailForProject(projectId: number): Promise<string | null> {
  try {
    const res = await db.execute(sql`
      SELECT u.email FROM project_leads pl
      JOIN users u ON u.id = pl.user_id
      WHERE pl.project_id = ${projectId}
      LIMIT 1
    `);
    return (res.rows[0] as any)?.email ?? null;
  } catch {
    return null;
  }
}

// ─── Auto-build engine ───────────────────────────────────────────────────────

export async function buildTimesheetEntries(projectId: number) {
  try {
    // Get config
    const cfgRes = await db.execute(sql`
      SELECT * FROM timesheet_config WHERE project_id = ${projectId}
    `);
    const cfg = cfgRes.rows[0] as any;
    if (!cfg) return;

    const workingDays: string[] = cfg.working_days || ["mon","tue","wed","thu","fri","sat"];
    const DAY_MAP: Record<number, string> = { 0:"sun", 1:"mon", 2:"tue", 3:"wed", 4:"thu", 5:"fri", 6:"sat" };

    // Get all active assignments for this project
    const asRes = await db.execute(sql`
      SELECT a.id, a.worker_id, a.shift, a.start_date, a.end_date, REGEXP_REPLACE(w.name, ' [(][^)]*[)]$', '') as worker_name
      FROM assignments a
      JOIN workers w ON w.id = a.worker_id
      WHERE a.project_id = ${projectId}
        AND a.status IN ('active','flagged','confirmed')
    `);
    const assignments = asRes.rows as any[];

    if (assignments.length === 0) return;

    // Determine date range: from earliest assignment start to latest end
    const starts = assignments.map(a => a.start_date).filter(Boolean);
    const ends = assignments.map(a => a.end_date).filter(Boolean);
    if (starts.length === 0) return;

    const minStart = starts.sort()[0];
    const maxEnd = ends.sort().reverse()[0] || isoDate(new Date(Date.now() + 90 * 24 * 60 * 60 * 1000));

    const rangeStart = weekMonday(new Date(minStart));
    const rangeEnd = new Date(maxEnd);
    // Extend to end of that week
    const endDay = rangeEnd.getUTCDay();
    if (endDay !== 0) rangeEnd.setUTCDate(rangeEnd.getUTCDate() + (7 - endDay));

    // For each week in range
    const cur = new Date(rangeStart);
    while (cur <= rangeEnd) {
      const weekComm = isoDate(cur);

      // Upsert timesheet_week
      await db.execute(sql`
        INSERT INTO timesheet_weeks (project_id, week_commencing, status)
        VALUES (${projectId}, ${weekComm}::date, 'draft')
        ON CONFLICT (project_id, week_commencing) DO NOTHING
      `);

      const twRes = await db.execute(sql`
        SELECT id, status FROM timesheet_weeks
        WHERE project_id = ${projectId} AND week_commencing = ${weekComm}::date
      `);
      const tw = twRes.rows[0] as any;
      if (!tw || tw.status === 'customer_approved') {
        cur.setUTCDate(cur.getUTCDate() + 7);
        continue;
      }
      const twId = tw.id;

      // Task 2: Delete existing entries for draft weeks before re-building
      // This ensures stale entries from old config are cleaned up
      if (tw.status === 'draft') {
        await db.execute(sql`
          DELETE FROM timesheet_entries WHERE timesheet_week_id = ${twId}
        `);
      }

      // Build entries for each worker
      for (const asgn of assignments) {
        const mobDate = asgn.start_date ? new Date(asgn.start_date) : null;
        const demobDate = asgn.end_date ? new Date(asgn.end_date) : null;
        const shift = (asgn.shift || "Day").toLowerCase().startsWith("n") ? "night" : "day";
        const timeIn = shift === "day"
          ? (cfg.day_shift_start || "07:00")
          : (cfg.night_shift_start || "19:00");
        const timeOut = shift === "day"
          ? (cfg.day_shift_end || "19:00")
          : (cfg.night_shift_end || "07:00");
        const breakMin = cfg.unpaid_break_minutes || 60;

        for (let d = 0; d < 7; d++) {
          const dayDate = new Date(cur);
          dayDate.setUTCDate(dayDate.getUTCDate() + d);
          const dateStr = isoDate(dayDate);

          // Skip days before MOB
          if (mobDate && dayDate < new Date(isoDate(mobDate))) continue;
          // Skip days after DEMOB
          if (demobDate && dayDate > new Date(isoDate(demobDate))) continue;

          // Determine day_type
          let dayType: string;
          let tIn: string | null = timeIn;
          let tOut: string | null = timeOut;
          let totalHours: number | null = null;

          const isMobDay = mobDate && isoDate(dayDate) === isoDate(mobDate);
          const isDemobDay = demobDate && isoDate(dayDate) === isoDate(demobDate);

          if (isMobDay && isDemobDay) {
            dayType = "mob"; // same day mob+demob → treat as mob
            tIn = null; tOut = null;
          } else if (isMobDay) {
            dayType = "mob";
            tIn = null; tOut = null;
          } else if (isDemobDay) {
            dayType = "demob";
            tIn = null; tOut = null;
          } else {
            const dayKey = DAY_MAP[dayDate.getUTCDay()];
            if (workingDays.includes(dayKey)) {
              dayType = "working";
              totalHours = calcTotalHours(tIn, tOut, breakMin);
            } else {
              dayType = "rest_day";
              tIn = null; tOut = null;
            }
          }

          // Upsert entry — don't overwrite is_override=true rows (supervisor-edited)
          await db.execute(sql`
            INSERT INTO timesheet_entries
              (timesheet_week_id, worker_id, entry_date, shift, time_in, time_out,
               unpaid_break_minutes, day_type, total_hours, is_override)
            VALUES
              (${twId}, ${asgn.worker_id}, ${dateStr}::date, ${shift},
               ${tIn ? tIn : null}, ${tOut ? tOut : null},
               ${breakMin}, ${dayType},
               ${totalHours}, false)
            ON CONFLICT (timesheet_week_id, worker_id, entry_date)
            DO UPDATE SET
              shift = EXCLUDED.shift,
              time_in = CASE WHEN timesheet_entries.is_override THEN timesheet_entries.time_in ELSE EXCLUDED.time_in END,
              time_out = CASE WHEN timesheet_entries.is_override THEN timesheet_entries.time_out ELSE EXCLUDED.time_out END,
              unpaid_break_minutes = EXCLUDED.unpaid_break_minutes,
              day_type = CASE WHEN timesheet_entries.is_override THEN timesheet_entries.day_type ELSE EXCLUDED.day_type END,
              total_hours = CASE WHEN timesheet_entries.is_override THEN timesheet_entries.total_hours ELSE EXCLUDED.total_hours END
          `);
        }
      }

      cur.setUTCDate(cur.getUTCDate() + 7);
    }
  } catch (e) {
    console.error("[buildTimesheetEntries]", e);
  }
}

// ─── Register routes ─────────────────────────────────────────────────────────

export function registerTimesheetRoutes(app: Express, requireAuth: any, requireRole: any) {

  // ── GET /api/projects/:id/timesheet-config ──────────────────────────────
  app.get("/api/projects/:id/timesheet-config",
    requireAuth,
    requireRole("admin","resource_manager","project_manager","finance"),
    async (req: Request, res: Response) => {
      const projectId = parseInt(String(req.params.id));
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project ID" });
        try {
        const r = await db.execute(sql`
          SELECT * FROM timesheet_config WHERE project_id = ${projectId}
        `);
        return res.json(r.rows[0] || null);
      } catch (e: any) { res.status(500).json({ error: String((e as any).message || e) }); }
    }
  );

  // ── POST /api/projects/:id/timesheet-config ─────────────────────────────
  app.post("/api/projects/:id/timesheet-config",
    requireAuth,
    requireRole("admin","resource_manager","project_manager"),
    async (req: Request, res: Response) => {
      const projectId = parseInt(String(req.params.id));
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project ID" });
      const {
        day_shift_start, day_shift_end,
        night_shift_start, night_shift_end,
        unpaid_break_minutes, working_days,
        customer_signoff_required,
      } = req.body;

        try {
        await db.execute(sql`
          INSERT INTO timesheet_config
            (project_id, day_shift_start, day_shift_end, night_shift_start, night_shift_end,
             unpaid_break_minutes, working_days, customer_signoff_required, updated_at)
          VALUES
            (${projectId},
             ${day_shift_start || null}, ${day_shift_end || null},
             ${night_shift_start || null}, ${night_shift_end || null},
             ${unpaid_break_minutes || 60},
             ${'{' + (working_days || ["mon","tue","wed","thu","fri","sat"]).join(',') + '}'}::text[],
             ${customer_signoff_required !== false},
             NOW())
          ON CONFLICT (project_id) DO UPDATE SET
            day_shift_start           = EXCLUDED.day_shift_start,
            day_shift_end             = EXCLUDED.day_shift_end,
            night_shift_start         = EXCLUDED.night_shift_start,
            night_shift_end           = EXCLUDED.night_shift_end,
            unpaid_break_minutes      = EXCLUDED.unpaid_break_minutes,
            working_days              = EXCLUDED.working_days,
            customer_signoff_required = EXCLUDED.customer_signoff_required,
            updated_at                = NOW()
        `);

        const r = await db.execute(sql`SELECT * FROM timesheet_config WHERE project_id = ${projectId}`);
        const cfg = r.rows[0];

        // Trigger auto-build engine in background
        setImmediate(() => {
          buildTimesheetEntries(projectId).catch(e =>
            console.error("[timesheet] auto-build error:", e.message)
          );
        });

        return res.json(cfg);
      } catch (e: any) { res.status(500).json({ error: String((e as any).message || e) }); }
    }
  );

  // ── GET /api/projects/:id/timesheet-weeks ───────────────────────────────
  app.get("/api/projects/:id/timesheet-weeks",
    requireAuth,
    requireRole("admin","resource_manager","project_manager","finance"),
    async (req: Request, res: Response) => {
      const projectId = parseInt(String(req.params.id));
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project ID" });
        try {
        const r = await db.execute(sql`
          SELECT * FROM timesheet_weeks
          WHERE project_id = ${projectId}
          ORDER BY week_commencing DESC
        `);
        return res.json(r.rows);
      } catch (e: any) { res.status(500).json({ error: String((e as any).message || e) }); }
    }
  );

  // ── GET /api/timesheet-weeks/:id/entries ────────────────────────────────
  app.get("/api/timesheet-weeks/:id/entries",
    requireAuth,
    requireRole("admin","resource_manager","project_manager","finance"),
    async (req: Request, res: Response) => {
      const weekId = parseInt(String(req.params.id));
      if (isNaN(weekId)) return res.status(400).json({ error: "Invalid week ID" });
        try {
        const r = await db.execute(sql`
          SELECT e.*, REGEXP_REPLACE(w.name, ' [(][^)]*[)]$', '') as worker_name, w.role as worker_role, w.cost_centre
          FROM timesheet_entries e
          JOIN workers w ON w.id = e.worker_id
          WHERE e.timesheet_week_id = ${weekId}
          ORDER BY w.name, e.entry_date
        `);
        return res.json(r.rows);
      } catch (e: any) { res.status(500).json({ error: String((e as any).message || e) }); }
    }
  );

  // ── PATCH /api/timesheet-entries/:id ────────────────────────────────────
  // Supervisor updates a cell
  app.patch("/api/timesheet-entries/:id",
    requireAuth,
    requireRole("admin","resource_manager","project_manager"),
    async (req: Request, res: Response) => {
      const entryId = parseInt(String(req.params.id));
      if (isNaN(entryId)) return res.status(400).json({ error: "Invalid entry ID" });

      // Check the week is not locked
        try {
        const entRes = await db.execute(sql`
          SELECT e.*, tw.status FROM timesheet_entries e
          JOIN timesheet_weeks tw ON tw.id = e.timesheet_week_id
          WHERE e.id = ${entryId}
        `);
        const entry = entRes.rows[0] as any;
        if (!entry) return res.status(404).json({ error: "Entry not found" });
        if (entry.status === "customer_approved") {
          return res.status(403).json({ error: "Timesheet is customer-approved and locked" });
        }

        const { time_in, time_out, day_type, supervisor_note, unpaid_break_minutes } = req.body;
        const breakMin = unpaid_break_minutes ?? entry.unpaid_break_minutes ?? 60;
        const tIn = time_in !== undefined ? time_in : entry.time_in;
        const tOut = time_out !== undefined ? time_out : entry.time_out;
        const totalHours = (tIn && tOut) ? calcTotalHours(tIn, tOut, breakMin) : null;

        const r = await db.execute(sql`
          UPDATE timesheet_entries SET
            time_in = ${tIn ?? null},
            time_out = ${tOut ?? null},
            day_type = ${day_type ?? entry.day_type},
            supervisor_note = ${supervisor_note ?? entry.supervisor_note},
            unpaid_break_minutes = ${breakMin},
            total_hours = ${totalHours},
            is_override = true
          WHERE id = ${entryId}
          RETURNING *
        `);
        return res.json(r.rows[0]);
      } catch (e: any) { res.status(500).json({ error: String((e as any).message || e) }); }
    }
  );

  // ── POST /api/timesheet-weeks/:id/submit ────────────────────────────────
  // Supervisor submits week for PM review
  app.post("/api/timesheet-weeks/:id/submit",
    requireAuth,
    requireRole("admin","resource_manager","project_manager"),
    async (req: Request, res: Response) => {
      const weekId = parseInt(String(req.params.id));
      if (isNaN(weekId)) return res.status(400).json({ error: "Invalid week ID" });
        try {
        const twRes = await db.execute(sql`SELECT * FROM timesheet_weeks WHERE id = ${weekId}`);
        const tw = twRes.rows[0] as any;
        if (!tw) return res.status(404).json({ error: "Week not found" });
        if (tw.status !== "draft") return res.status(400).json({ error: `Cannot submit from status: ${tw.status}` });

        await db.execute(sql`
          UPDATE timesheet_weeks SET status = 'submitted', submitted_at = NOW()
          WHERE id = ${weekId}
        `);

        // Notify PM
        const pmEmail = await getPmEmailForProject(tw.project_id);
        if (pmEmail) {
          const projRes = await db.execute(sql`SELECT name, code FROM projects WHERE id = ${tw.project_id}`);
          const proj = projRes.rows[0] as any;
          const weekUrl = `${APP_URL}/#/projects/${proj?.code}`;
          await sendMail({
            to: pmEmail,
            subject: `Timesheet submitted for review — ${proj?.name || "Project"}`,
            html: buildNotificationEmail(
              "Timesheet Ready for Review",
              `The timesheet for week commencing ${tw.week_commencing} on <strong>${proj?.name || "project"}</strong> has been submitted by a supervisor and is ready for your review.`,
              weekUrl,
              "Review Timesheet"
            ),
          });
        }

        const updated = await db.execute(sql`SELECT * FROM timesheet_weeks WHERE id = ${weekId}`);
        return res.json(updated.rows[0]);
      } catch (e: any) { res.status(500).json({ error: String((e as any).message || e) }); }
    }
  );

  // ── POST /api/timesheet-weeks/:id/approve ───────────────────────────────
  // PM approves
  app.post("/api/timesheet-weeks/:id/approve",
    requireAuth,
    requireRole("admin","resource_manager","project_manager"),
    async (req: Request, res: Response) => {
      const weekId = parseInt(String(req.params.id));
      if (isNaN(weekId)) return res.status(400).json({ error: "Invalid week ID" });
        try {
        const twRes = await db.execute(sql`SELECT * FROM timesheet_weeks WHERE id = ${weekId}`);
        const tw = twRes.rows[0] as any;
        if (!tw) return res.status(404).json({ error: "Week not found" });
        // Allow PM to approve from 'submitted' or 'draft' (recalled timesheets — PM edits and reapproves directly)
        if (tw.status !== "submitted" && tw.status !== "draft") return res.status(400).json({ error: `Cannot approve from status: ${tw.status}` });

        // Check if customer sign-off required
        const cfgRes = await db.execute(sql`SELECT customer_signoff_required FROM timesheet_config WHERE project_id = ${tw.project_id}`);
        const cfg = cfgRes.rows[0] as any;
        const requiresSignoff = cfg?.customer_signoff_required !== false;

        const newStatus = requiresSignoff ? "pm_approved" : "customer_approved";
        await db.execute(sql`
          UPDATE timesheet_weeks SET status = ${newStatus}, pm_approved_at = NOW()
          WHERE id = ${weekId}
        `);

        if (!requiresSignoff) {
          // Skip customer sign-off — generate outputs directly
          setImmediate(() => {
            generateTimesheetOutputs(weekId).catch(e =>
              console.error("[timesheet] auto-output error:", e.message)
            );
          });
        }

        const updated = await db.execute(sql`SELECT * FROM timesheet_weeks WHERE id = ${weekId}`);
        return res.json(updated.rows[0]);
      } catch (e: any) { res.status(500).json({ error: String((e as any).message || e) }); }
    }
  );

  // ── POST /api/timesheet-weeks/:id/reject ────────────────────────────────
  // PM rejects — back to draft
  app.post("/api/timesheet-weeks/:id/reject",
    requireAuth,
    requireRole("admin","resource_manager","project_manager"),
    async (req: Request, res: Response) => {
      const weekId = parseInt(String(req.params.id));
      if (isNaN(weekId)) return res.status(400).json({ error: "Invalid week ID" });
      const { comment } = req.body;
      if (!comment?.trim()) return res.status(400).json({ error: "Rejection comment required" });

        try {
        const twRes = await db.execute(sql`SELECT * FROM timesheet_weeks WHERE id = ${weekId}`);
        const tw = twRes.rows[0] as any;
        if (!tw) return res.status(404).json({ error: "Week not found" });
        if (tw.status !== "submitted") return res.status(400).json({ error: `Cannot reject from status: ${tw.status}` });

        await db.execute(sql`
          UPDATE timesheet_weeks SET status = 'draft', pm_reject_comment = ${comment}
          WHERE id = ${weekId}
        `);

        // Notify supervisors (project managers assigned)
        const pmEmail = await getPmEmailForProject(tw.project_id);
        if (pmEmail) {
          const projRes = await db.execute(sql`SELECT name, code FROM projects WHERE id = ${tw.project_id}`);
          const proj = projRes.rows[0] as any;
          const weekUrl = `${APP_URL}/#/projects/${proj?.code}`;
          await sendMail({
            to: pmEmail,
            subject: `Timesheet rejected — ${proj?.name || "Project"}`,
            html: buildNotificationEmail(
              "Timesheet Returned for Revision",
              `The timesheet for week commencing ${tw.week_commencing} was rejected.<br><br><strong>Comment:</strong> ${comment}`,
              weekUrl,
              "View Timesheet"
            ),
          });
        }

        const updated = await db.execute(sql`SELECT * FROM timesheet_weeks WHERE id = ${weekId}`);
        return res.json(updated.rows[0]);
      } catch (e: any) { res.status(500).json({ error: String((e as any).message || e) }); }
    }
  );

  // ── POST /api/timesheet-weeks/:id/send-to-customer ──────────────────────
  // PM sends to customer for sign-off
  app.post("/api/timesheet-weeks/:id/send-to-customer",
    requireAuth,
    requireRole("admin","resource_manager","project_manager"),
    async (req: Request, res: Response) => {
      const weekId = parseInt(String(req.params.id));
      if (isNaN(weekId)) return res.status(400).json({ error: "Invalid week ID" });
        try {
        const twRes = await db.execute(sql`SELECT * FROM timesheet_weeks WHERE id = ${weekId}`);
        const tw = twRes.rows[0] as any;
        if (!tw) return res.status(404).json({ error: "Week not found" });
        // Allow resend if already sent_to_customer (email may have failed silently before)
        if (tw.status !== "pm_approved" && tw.status !== "sent_to_customer") return res.status(400).json({ error: `Cannot send to customer from status: ${tw.status}` });

        // Generate approval hash from current entries
        const entriesRes = await db.execute(sql`
          SELECT * FROM timesheet_entries WHERE timesheet_week_id = ${weekId}
          ORDER BY worker_id, entry_date
        `);
        const entries = entriesRes.rows as any[];
        const { hash, preimage } = buildApprovalHash(entries);

        // Generate single-use token
        const rawToken = crypto.randomBytes(32).toString("hex");
        const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");
        const tokenExpiry = new Date(Date.now() + 48 * 60 * 60 * 1000);

        await db.execute(sql`
          UPDATE timesheet_weeks SET
            status = 'sent_to_customer',
            sent_to_customer_at = NOW(),
            approval_hash = ${hash},
            approval_preimage = ${JSON.stringify(preimage) as any},
            customer_token = ${hashedToken},
            token_expires_at = ${tokenExpiry.toISOString()},
            token_used_at = NULL
          WHERE id = ${weekId}
        `);

        // Get customer signatory from project
        const projRes = await db.execute(sql`
          SELECT name, code, timesheet_signatory_name, timesheet_signatory_email,
                 customer_project_manager, customer_project_manager_email,
                 site_manager, site_manager_email
          FROM projects WHERE id = ${tw.project_id}
        `);
        const proj = projRes.rows[0] as any;

        const signatoryEmail = proj?.timesheet_signatory_email
          || proj?.customer_project_manager_email
          || proj?.site_manager_email;
        const signatoryName = proj?.timesheet_signatory_name
          || proj?.customer_project_manager
          || proj?.site_manager
          || "Customer Representative";

        if (!signatoryEmail) {
          return res.status(400).json({ error: "No customer signatory email configured on this project. Please add a Timesheet Signatory email in the project settings." });
        }

        const approvalUrl = `${APP_URL}/#/timesheet-approval/${rawToken}`;
        const firstName = signatoryName.split(" ")[0];
        const sent = await sendMail({
          to: signatoryEmail,
          subject: `Timesheet approval required — ${proj?.name || "Project"} (w/c ${tw.week_commencing})`,
          html: buildCustomerApprovalEmail(firstName, proj?.name || "Project", tw.week_commencing, approvalUrl),
        });

        if (!sent) {
          // Roll back status so PM can retry
          await db.execute(sql`UPDATE timesheet_weeks SET status = 'pm_approved', sent_to_customer_at = NULL WHERE id = ${weekId}`);
          return res.status(500).json({ error: "Email failed to send. Please try again. If the problem persists, contact support." });
        }

        const updated = await db.execute(sql`SELECT * FROM timesheet_weeks WHERE id = ${weekId}`);
        return res.json({ ...updated.rows[0], rawToken });
      } catch (e: any) { res.status(500).json({ error: String((e as any).message || e) }); }
    }
  );

  // ── GET /api/timesheet-approval/:token ──────────────────────────────────
  // Public endpoint — customer views timesheet for approval (no auth)
  app.get("/api/timesheet-approval/:token", async (req: Request, res: Response) => {
    const rawToken = String(req.params.token);
    const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");
    try {
      const twRes = await db.execute(sql`
        SELECT tw.*, p.name as project_name, p.code as project_code, p.customer
        FROM timesheet_weeks tw
        JOIN projects p ON p.id = tw.project_id
        WHERE tw.customer_token = ${hashedToken}
      `);
      const tw = twRes.rows[0] as any;
      if (!tw) return res.status(404).json({ error: "Invalid or expired token" });
      if (tw.status === "customer_approved") return res.status(410).json({ error: "This timesheet has already been approved" });
      if (tw.token_expires_at && new Date() > new Date(tw.token_expires_at)) {
        return res.status(410).json({ error: "This approval link has expired" });
      }

      const entriesRes = await db.execute(sql`
        SELECT e.*, REGEXP_REPLACE(w.name, ' [(][^)]*[)]$', '') as worker_name, w.role as worker_role
        FROM timesheet_entries e
        JOIN workers w ON w.id = e.worker_id
        WHERE e.timesheet_week_id = ${tw.id}
        ORDER BY w.name, e.entry_date
      `);

      return res.json({
        week: tw,
        entries: entriesRes.rows,
      });
    } catch (e: any) {
      console.error("[Timesheet approval GET]", e);
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  // ── POST /api/timesheet-approval/:token/approve ─────────────────────────
  // Customer approves
  app.post("/api/timesheet-approval/:token/approve", async (req: Request, res: Response) => {
    const rawToken = String(req.params.token);
    const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");
    const { name, email } = req.body;
    const ip = req.headers["x-forwarded-for"]?.toString().split(",")[0] || req.socket.remoteAddress || "unknown";

    if (!name?.trim() || !email?.trim()) {
      return res.status(400).json({ error: "Name and email are required" });
    }

    try {
      const twRes = await db.execute(sql`
        SELECT * FROM timesheet_weeks WHERE customer_token = ${hashedToken}
      `);
      const tw = twRes.rows[0] as any;
      if (!tw) return res.status(404).json({ error: "Invalid token" });
      if (tw.status === "customer_approved") return res.status(410).json({ error: "Already approved" });
      if (tw.token_expires_at && new Date() > new Date(tw.token_expires_at)) {
        return res.status(410).json({ error: "Link has expired" });
      }

      // Verify hash integrity
      const entriesRes = await db.execute(sql`
        SELECT * FROM timesheet_entries WHERE timesheet_week_id = ${tw.id}
        ORDER BY worker_id, entry_date
      `);
      const entries = entriesRes.rows as any[];
      const { hash } = buildApprovalHash(entries);

      if (hash !== tw.approval_hash) {
        // Data was modified after the link was sent — alert PM
        const pmEmail = await getPmEmailForProject(tw.project_id);
        if (pmEmail) {
          await sendMail({
            to: pmEmail,
            subject: `ALERT: Timesheet hash mismatch — integrity check failed`,
            html: buildNotificationEmail(
              "Hash Integrity Failure",
              `The timesheet for week commencing ${tw.week_commencing} failed its integrity check. The data may have been modified after the approval link was sent. Customer approval has been blocked.`,
              `${APP_URL}/#/projects/`,
              "View Platform"
            ),
          });
        }
        return res.status(409).json({ error: "Integrity check failed — timesheet data was modified after link was sent" });
      }

      await db.execute(sql`
        UPDATE timesheet_weeks SET
          status = 'customer_approved',
          customer_approved_at = NOW(),
          approval_name = ${name},
          approval_email = ${email},
          approval_ip = ${ip},
          token_used_at = NOW()
        WHERE id = ${tw.id}
      `);

      // Generate outputs in background
      setImmediate(() => {
        generateTimesheetOutputs(tw.id).catch(e =>
          console.error("[timesheet] output generation error:", e.message)
        );
      });

      // Notify PM
      const pmEmail = await getPmEmailForProject(tw.project_id);
      if (pmEmail) {
        const projRes = await db.execute(sql`SELECT name, code FROM projects WHERE id = ${tw.project_id}`);
        const proj = projRes.rows[0] as any;
        await sendMail({
          to: pmEmail,
          subject: `Timesheet approved by customer — ${proj?.name || "Project"}`,
          html: buildNotificationEmail(
            "Customer Approval Received",
            `The timesheet for week commencing ${tw.week_commencing} was approved by ${name} (${email}) at ${new Date().toUTCString()}.`,
            `${APP_URL}/#/projects/${proj?.code}`,
            "View Project"
          ),
        });
      }

      return res.json({ ok: true });
    } catch (e: any) {
      console.error("[Timesheet approval POST]", e);
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  // ── POST /api/timesheet-approval/:token/challenge ───────────────────────
  app.post("/api/timesheet-approval/:token/challenge", async (req: Request, res: Response) => {
    const rawToken = String(req.params.token);
    const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");
    const { message } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: "Challenge message required" });

    try {
      const twRes = await db.execute(sql`
        SELECT * FROM timesheet_weeks WHERE customer_token = ${hashedToken}
      `);
      const tw = twRes.rows[0] as any;
      if (!tw) return res.status(404).json({ error: "Invalid token" });

      await db.execute(sql`
        UPDATE timesheet_weeks SET customer_challenge = ${message}
        WHERE id = ${tw.id}
      `);

      // Notify PM
      const pmEmail = await getPmEmailForProject(tw.project_id);
      if (pmEmail) {
        const projRes = await db.execute(sql`SELECT name FROM projects WHERE id = ${tw.project_id}`);
        const proj = projRes.rows[0] as any;
        await sendMail({
          to: pmEmail,
          subject: `Timesheet challenged by customer — ${proj?.name || "Project"}`,
          html: buildNotificationEmail(
            "Customer Challenge Received",
            `The customer has raised a challenge on the timesheet for week commencing ${tw.week_commencing}:<br><br><em>${message}</em>`,
            `${APP_URL}/#/projects/`,
            "View Platform"
          ),
        });
      }

      return res.json({ ok: true });
    } catch (e: any) {
      console.error("[Timesheet challenge POST]", e);
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  // ── POST /api/timesheet-weeks/:id/recall ────────────────────────────────
  app.post("/api/timesheet-weeks/:id/recall",
    requireAuth,
    requireRole("admin","resource_manager","project_manager"),
    async (req: Request, res: Response) => {
      const weekId = parseInt(String(req.params.id));
      if (isNaN(weekId)) return res.status(400).json({ error: "Invalid week ID" });
        try {
        const twRes = await db.execute(sql`SELECT * FROM timesheet_weeks WHERE id = ${weekId}`);
        const tw = twRes.rows[0] as any;
        if (!tw) return res.status(404).json({ error: "Week not found" });
        if (tw.status === "customer_approved") {
          return res.status(403).json({ error: "Cannot recall a customer-approved timesheet" });
        }

        // Archive old approval record
        const oldRecord = {
          approval_name: tw.approval_name,
          approval_email: tw.approval_email,
          approval_hash: tw.approval_hash,
          sent_to_customer_at: tw.sent_to_customer_at,
          recalled_at: new Date().toISOString(),
        };

        await db.execute(sql`
          UPDATE timesheet_weeks SET
            status = 'pm_approved',
            recalled_at = NOW(),
            customer_token = NULL,
            token_expires_at = NULL,
            token_used_at = NULL,
            approval_hash = NULL,
            approval_preimage = NULL,
            approval_name = NULL,
            approval_email = NULL,
            approval_ip = NULL,
            customer_challenge = NULL,
            pm_reject_comment = NULL,
            sent_to_customer_at = NULL
          WHERE id = ${weekId}
        `);

        // Notify customer if it was sent
        if (tw.sent_to_customer_at) {
          const projRes = await db.execute(sql`
            SELECT name, timesheet_signatory_email, customer_project_manager_email, site_manager_email
            FROM projects WHERE id = ${tw.project_id}
          `);
          const proj = projRes.rows[0] as any;
          const custEmail = proj?.timesheet_signatory_email || proj?.customer_project_manager_email || proj?.site_manager_email;
          if (custEmail) {
            await sendMail({
              to: custEmail,
              subject: `Timesheet recalled — ${proj?.name || "Project"}`,
              html: buildNotificationEmail(
                "Timesheet Recalled",
                `The timesheet for week commencing ${tw.week_commencing} on <strong>${proj?.name || "project"}</strong> has been recalled by the project team. A new version will be sent to you shortly.`,
                "",
                ""
              ),
            });
          }
        }

        const updated = await db.execute(sql`SELECT * FROM timesheet_weeks WHERE id = ${weekId}`);
        return res.json({ ...updated.rows[0], archivedRecord: oldRecord });
      } catch (e: any) { res.status(500).json({ error: String((e as any).message || e) }); }
    }
  );

  // ── GET /api/timesheet-weeks/:id/pdf ────────────────────────────────────
  app.get("/api/timesheet-weeks/:id/pdf",
    requireAuth,
    async (req: Request, res: Response) => {
      const weekId = parseInt(String(req.params.id));
      if (isNaN(weekId)) return res.status(400).json({ error: "Invalid week ID" });
        try {
        const twRes = await db.execute(sql`SELECT * FROM timesheet_weeks WHERE id = ${weekId}`);
        const tw = twRes.rows[0] as any;
        if (!tw || !tw.timesheet_pdf_path) return res.status(404).json({ error: "PDF not generated yet" });
        if (!fs.existsSync(tw.timesheet_pdf_path)) return res.status(404).json({ error: "PDF file not found on disk" });
        return res.download(tw.timesheet_pdf_path);
      } catch (e: any) { res.status(500).json({ error: String((e as any).message || e) }); }
    }
  );

  // ── GET /api/timesheet-weeks/:id/billing-pdf ────────────────────────────
  app.get("/api/timesheet-weeks/:id/billing-pdf",
    requireAuth,
    requireRole("admin","resource_manager","project_manager","finance"),
    async (req: Request, res: Response) => {
      const weekId = parseInt(String(req.params.id));
      if (isNaN(weekId)) return res.status(400).json({ error: "Invalid week ID" });
        try {
        const twRes = await db.execute(sql`SELECT * FROM timesheet_weeks WHERE id = ${weekId}`);
        const tw = twRes.rows[0] as any;
        if (!tw || !tw.billing_pdf_path) return res.status(404).json({ error: "Billing PDF not generated yet" });
        if (!fs.existsSync(tw.billing_pdf_path)) return res.status(404).json({ error: "Billing PDF file not found on disk" });
        return res.download(tw.billing_pdf_path);
      } catch (e: any) { res.status(500).json({ error: String((e as any).message || e) }); }
    }
  );

  // ── GET /api/projects/:id/timesheet-weeks/:weekId/trigger-rebuild ────────
  // Manually re-trigger auto-build for a project
  app.post("/api/projects/:id/timesheet-rebuild",
    requireAuth,
    requireRole("admin","resource_manager","project_manager"),
    async (req: Request, res: Response) => {
      const projectId = parseInt(String(req.params.id));
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project ID" });
      setImmediate(() => {
        buildTimesheetEntries(projectId).catch(e =>
          console.error("[timesheet] rebuild error:", e.message)
        );
      });
      return res.json({ ok: true, message: "Rebuild triggered" });
    }
  );

  // ── POST /api/internal/send-supervisor-timesheets ── no auth (internal cron)
  app.post("/api/internal/send-supervisor-timesheets", async (req: any, res: any) => {
    try {
      const triggerDate = req.body?.triggerDate ? new Date(req.body.triggerDate) : undefined;
      const result = await sendWeeklySupervisorLinks(triggerDate);
      return res.json({ ok: true, processed: result.processed, weekCommencing: result.weekCommencing });
    } catch (e: any) {
      return res.status(500).json({ error: String(e.message || e) });
    }
  });

  // ── GET /api/timesheet-supervisor/:token ─────────────────────────────────
  app.get("/api/timesheet-supervisor/:token", async (req: any, res: any) => {
    try {
      const rawToken = req.params.token;
      if (!rawToken) return res.status(400).json({ error: "Token required" });
      const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");

      // Find week matching day or night token
      const weekRes = await db.execute(sql`
        SELECT tw.*, p.name as project_name, p.code as project_code, p.customer
        FROM timesheet_weeks tw
        JOIN projects p ON p.id = tw.project_id
        WHERE tw.day_sup_token = ${hashedToken}
           OR tw.night_sup_token = ${hashedToken}
        LIMIT 1
      `);
      const week = weekRes.rows[0] as any;
      if (!week) return res.status(404).json({ error: "Invalid or expired link" });

      // Determine which shift this token is for
      const shift = week.day_sup_token === hashedToken ? "day" : "night";
      const supervisorName = shift === "day" ? week.day_sup_name : week.night_sup_name;

      // Fetch entries scoped to this shift
      const entriesRes = await db.execute(sql`
        SELECT e.*, REGEXP_REPLACE(w.name, ' [(][^)]*[)]$', '') as worker_name, w.role as worker_role
        FROM timesheet_entries e
        JOIN workers w ON w.id = e.worker_id
        WHERE e.timesheet_week_id = ${week.id}
          AND e.shift = ${shift}
        ORDER BY w.name, e.entry_date
      `);
      const entries = entriesRes.rows as any[];

      return res.json({
        week: {
          id: week.id,
          project_id: week.project_id,
          project_name: week.project_name,
          project_code: week.project_code,
          customer: week.customer,
          week_commencing: week.week_commencing,
          status: week.status,
          day_sup_submitted_at: week.day_sup_submitted_at,
          night_sup_submitted_at: week.night_sup_submitted_at,
          day_sup_name: week.day_sup_name,
          night_sup_name: week.night_sup_name,
          night_sup_token: week.night_sup_token,
        },
        shift,
        supervisor_name: supervisorName,
        entries,
      });
    } catch (e: any) {
      return res.status(500).json({ error: String(e.message || e) });
    }
  });

  // ── POST /api/timesheet-supervisor/:token/submit ─────────────────────────
  app.post("/api/timesheet-supervisor/:token/submit", async (req: any, res: any) => {
    try {
      const rawToken = req.params.token;
      if (!rawToken) return res.status(400).json({ error: "Token required" });
      const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");

      const weekRes = await db.execute(sql`
        SELECT tw.*, p.name as project_name, p.code as project_code
        FROM timesheet_weeks tw
        JOIN projects p ON p.id = tw.project_id
        WHERE tw.day_sup_token = ${hashedToken}
           OR tw.night_sup_token = ${hashedToken}
        LIMIT 1
      `);
      const week = weekRes.rows[0] as any;
      if (!week) return res.status(404).json({ error: "Invalid or expired link" });

      const shift = week.day_sup_token === hashedToken ? "day" : "night";
      const now = new Date();

      if (shift === "day") {
        await db.execute(sql`
          UPDATE timesheet_weeks SET day_sup_submitted_at = ${now}
          WHERE id = ${week.id}
        `);
      } else {
        await db.execute(sql`
          UPDATE timesheet_weeks SET night_sup_submitted_at = ${now}
          WHERE id = ${week.id}
        `);
      }

      // Re-fetch to check if all required shifts submitted
      const reloadRes = await db.execute(sql`
        SELECT * FROM timesheet_weeks WHERE id = ${week.id}
      `);
      const updatedWeek = reloadRes.rows[0] as any;

      const hasNightSup = !!updatedWeek.night_sup_token;
      const daySubmitted = !!updatedWeek.day_sup_submitted_at;
      const nightSubmitted = !!updatedWeek.night_sup_submitted_at;

      const allSubmitted = hasNightSup
        ? (daySubmitted && nightSubmitted)
        : daySubmitted;

      // Fetch PM for notifications
      const pmRes = await db.execute(sql`
        SELECT u.email, u.name FROM project_leads pl
        JOIN users u ON u.id = pl.user_id
        WHERE pl.project_id = ${week.project_id}
        LIMIT 1
      `);
      const pm = pmRes.rows[0] as any;
      const weekStr = updatedWeek.week_commencing?.toString().substring(0, 10) || "";

      if (allSubmitted && updatedWeek.status === "draft") {
        await db.execute(sql`
          UPDATE timesheet_weeks SET status = 'submitted', submitted_at = NOW()
          WHERE id = ${week.id}
        `);
        // Notify PM — all shifts submitted
        if (pm?.email) {
          await sendMail({
            to: pm.email,
            subject: `Timesheet ready for review — ${week.project_name} w/c ${weekStr}`,
            html: buildNotificationEmail(
              `Timesheet Ready for Review`,
              `All shifts for <strong>${week.project_name}</strong> (w/c ${weekStr}) have been submitted by the site supervisors and are ready for your approval.`,
              `${APP_URL}/#/projects/${week.project_code}`,
              "Review Timesheet"
            ),
            text: `All shifts for ${week.project_name} w/c ${weekStr} have been submitted. Please review and approve.`,
          });
        }
      } else if (!allSubmitted && hasNightSup && pm?.email) {
        // Partial submission — notify PM that day shift is in but night is pending
        const submittedShift = shift === "day" ? "Day" : "Night";
        const pendingShift = shift === "day" ? "Night" : "Day";
        await sendMail({
          to: pm.email,
          subject: `${submittedShift} shift submitted — ${week.project_name} w/c ${weekStr} (awaiting ${pendingShift})`,
          html: buildNotificationEmail(
            `${submittedShift} Shift Submitted`,
            `The <strong>${submittedShift} shift</strong> timesheet for <strong>${week.project_name}</strong> (w/c ${weekStr}) has been submitted. The <strong>${pendingShift} shift</strong> is still pending supervisor sign-off.`,
            `${APP_URL}/#/projects/${week.project_code}`,
            "View Timesheet"
          ),
          text: `${submittedShift} shift submitted for ${week.project_name} w/c ${weekStr}. Awaiting ${pendingShift} shift.`,
        });
      }

      const finalRes = await db.execute(sql`SELECT * FROM timesheet_weeks WHERE id = ${week.id}`);
      return res.json({ ok: true, week: finalRes.rows[0] });
    } catch (e: any) {
      return res.status(500).json({ error: String(e.message || e) });
    }
  });
}

// ─── Output generation (Steps 6 & 7) ────────────────────────────────────────

export async function generateTimesheetOutputs(weekId: number) {
  try {
    const twRes = await db.execute(sql`
      SELECT tw.*, p.name as project_name, p.code as project_code, p.customer
      FROM timesheet_weeks tw
      JOIN projects p ON p.id = tw.project_id
      WHERE tw.id = ${weekId}
    `);
    const tw = twRes.rows[0] as any;
    if (!tw) return;

    const entriesRes = await db.execute(sql`
      SELECT e.*, REGEXP_REPLACE(w.name, ' [(][^)]*[)]$', '') as worker_name, w.role as worker_role, w.cost_centre
      FROM timesheet_entries e
      JOIN workers w ON w.id = e.worker_id
      WHERE e.timesheet_week_id = ${weekId}
      ORDER BY w.name, e.entry_date
    `);
    const entries = entriesRes.rows as any[];

    // Ensure output dir exists
    const outDir = path.join(UPLOAD_ROOT, String(tw.project_id), "timesheets");
    fs.mkdirSync(outDir, { recursive: true });

    const weekStr = tw.week_commencing?.toString().substring(0, 10) || "unknown";

    // Generate signed timesheet PDF
    const tsFilename = `timesheet-${weekStr}-${weekId}.pdf`;
    const tsPath = path.join(outDir, tsFilename);
    await generateTimesheetPdfHtml(tw, entries, tsPath);
    await db.execute(sql`UPDATE timesheet_weeks SET timesheet_pdf_path = ${tsPath} WHERE id = ${weekId}`);

    // Generate billing summary PDF
    const billFilename = `billing-${weekStr}-${weekId}.pdf`;
    const billPath = path.join(outDir, billFilename);
    await generateBillingSummaryPdf(tw, entries, billPath);
    await db.execute(sql`UPDATE timesheet_weeks SET billing_pdf_path = ${billPath} WHERE id = ${weekId}`);

    console.log(`[timesheet] Outputs generated for week ${weekId}: ${tsPath}, ${billPath}`);
  } catch (e: any) {
    console.error("[timesheet] generateOutputs error:", e.message);
  }
}

// ─── PDF generation (Step 6 — Signed Timesheet) ─────────────────────────────

async function generateTimesheetPdf(tw: any, entries: any[], outPath: string): Promise<void> {
  const { PDFDocument, rgb, StandardFonts, degrees } = await import("pdf-lib");

  const NAVY = rgb(0.102, 0.114, 0.137);   // #1A1D23
  const GOLD = rgb(0.961, 0.741, 0.000);   // #F5BD00
  const WHITE = rgb(1, 1, 1);
  const LIGHT = rgb(0.957, 0.961, 0.965);  // #F4F5F6
  const BORDER = rgb(0.886, 0.894, 0.910); // #E2E4E8
  const MUTED = rgb(0.42, 0.447, 0.502);   // #6B7280
  const TEXT = rgb(0.067, 0.094, 0.153);   // #111827

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([841.89, 595.28]); // A4 landscape
  const { width, height } = page.getSize();

  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontReg = await pdfDoc.embedFont(StandardFonts.Helvetica);

  let logoBytes: Uint8Array | null = null;
  const logoPath = path.join(process.cwd(), "client/public/logo-gold.png");
  if (fs.existsSync(logoPath)) {
    logoBytes = fs.readFileSync(logoPath);
  }

  // ── Header band ──────────────────────────────────────────────────────────
  page.drawRectangle({ x: 0, y: height - 60, width, height: 60, color: NAVY });
  if (logoBytes) {
    try {
      const logoImg = await pdfDoc.embedPng(logoBytes);
      const scaled = logoImg.scaleToFit(120, 40);
      page.drawImage(logoImg, { x: 20, y: height - 50, width: scaled.width, height: scaled.height });
    } catch { /* skip if embed fails */ }
  }

  const projectLabel = `${tw.project_name || "Project"} — Week commencing ${tw.week_commencing?.toString().substring(0, 10) || ""}`;
  page.drawText(projectLabel, { x: 160, y: height - 38, size: 13, font: fontBold, color: WHITE });
  page.drawText("SIGNED TIMESHEET", { x: width - 160, y: height - 38, size: 10, font: fontBold, color: GOLD });

  // ── Build worker groups ──────────────────────────────────────────────────
  const workerMap = new Map<number, { name: string; role: string; entries: any[] }>();
  for (const e of entries) {
    if (!workerMap.has(e.worker_id)) {
      workerMap.set(e.worker_id, { name: e.worker_name, role: e.worker_role, entries: [] });
    }
    workerMap.get(e.worker_id)!.entries.push(e);
  }

  const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const COL_W = 90;
  const ROW_H = 28;
  const startX = 20;
  let curY = height - 75;

  // Header row
  page.drawRectangle({ x: startX, y: curY - ROW_H, width: 140, height: ROW_H, color: NAVY });
  page.drawText("WORKER / ROLE", { x: startX + 4, y: curY - 20, size: 8, font: fontBold, color: WHITE });

  const weekStart = new Date(tw.week_commencing);
  for (let d = 0; d < 7; d++) {
    const dd = new Date(weekStart);
    dd.setUTCDate(dd.getUTCDate() + d);
    const colX = startX + 140 + d * COL_W;
    page.drawRectangle({ x: colX, y: curY - ROW_H, width: COL_W, height: ROW_H, color: NAVY });
    page.drawText(dayLabels[d], { x: colX + 4, y: curY - 14, size: 8, font: fontBold, color: GOLD });
    page.drawText(`${dd.getUTCDate()}/${dd.getUTCMonth() + 1}`, { x: colX + 4, y: curY - 24, size: 7, font: fontReg, color: WHITE });
  }
  // Totals column
  const totColX = startX + 140 + 7 * COL_W;
  page.drawRectangle({ x: totColX, y: curY - ROW_H, width: 55, height: ROW_H, color: NAVY });
  page.drawText("TOTAL", { x: totColX + 4, y: curY - 20, size: 8, font: fontBold, color: WHITE });
  curY -= ROW_H;

  let rowAlt = false;
  for (const [, worker] of Array.from(workerMap)) {
    const rowBg = rowAlt ? LIGHT : WHITE;
    rowAlt = !rowAlt;
    page.drawRectangle({ x: startX, y: curY - ROW_H, width: 140, height: ROW_H, color: rowBg });
    page.drawText(worker.name.substring(0, 20), { x: startX + 4, y: curY - 14, size: 8, font: fontBold, color: NAVY });
    page.drawText((worker.role || "").substring(0, 20), { x: startX + 4, y: curY - 24, size: 7, font: fontReg, color: MUTED });

    let totalHours = 0;
    const sortedEntries = [...worker.entries].sort((a, b) => String(a.entry_date).localeCompare(String(b.entry_date)));
    for (let d = 0; d < 7; d++) {
      const dd = new Date(weekStart);
      dd.setUTCDate(dd.getUTCDate() + d);
      const dateStr = isoDate(dd);
      const entry = sortedEntries.find(e => String(e.entry_date).substring(0, 10) === dateStr);
      const colX = startX + 140 + d * COL_W;
      page.drawRectangle({ x: colX, y: curY - ROW_H, width: COL_W, height: ROW_H, color: rowBg });
      page.drawRectangle({ x: colX, y: curY - ROW_H, width: COL_W, height: ROW_H, color: BORDER, opacity: 0 });

      if (entry) {
        const dtLabel = formatDayType(entry.day_type);
        if (entry.day_type === "working" && entry.time_in && entry.time_out) {
          page.drawText(`${entry.time_in?.substring(0, 5) || ""}–${entry.time_out?.substring(0, 5) || ""}`, { x: colX + 2, y: curY - 14, size: 7, font: fontReg, color: TEXT });
          const hrs = parseFloat(entry.total_hours) || 0;
          totalHours += hrs;
          page.drawText(`${hrs.toFixed(1)}h`, { x: colX + 2, y: curY - 24, size: 7, font: fontBold, color: NAVY });
        } else {
          page.drawText(dtLabel, { x: colX + 2, y: curY - 20, size: 7, font: fontReg, color: MUTED });
        }
      }
      // Border
      page.drawLine({ start: { x: colX, y: curY - ROW_H }, end: { x: colX, y: curY }, thickness: 0.5, color: BORDER });
    }

    // Total column
    page.drawRectangle({ x: totColX, y: curY - ROW_H, width: 55, height: ROW_H, color: rowBg });
    page.drawText(`${totalHours.toFixed(1)}h`, { x: totColX + 4, y: curY - 20, size: 9, font: fontBold, color: NAVY });
    page.drawLine({ start: { x: startX, y: curY - ROW_H }, end: { x: totColX + 55, y: curY - ROW_H }, thickness: 0.5, color: BORDER });
    curY -= ROW_H;
  }

  // ── Footer ───────────────────────────────────────────────────────────────
  const footerY = 30;
  page.drawRectangle({ x: 0, y: footerY - 10, width, height: 40, color: LIGHT });
  const approvalLine = tw.approval_name
    ? `Approved by: ${tw.approval_name} <${tw.approval_email}> | ${new Date(tw.customer_approved_at).toUTCString()} | Hash: ${tw.approval_hash?.substring(0, 12) || "pending"}`
    : `Document generated: ${new Date().toUTCString()} | Hash: ${tw.approval_hash?.substring(0, 12) || "pending"}`;
  page.drawText(approvalLine, { x: 20, y: footerY, size: 7, font: fontReg, color: MUTED });

  const pdfBytes = await pdfDoc.save();
  fs.writeFileSync(outPath, pdfBytes);
}

function formatDayType(dt: string): string {
  const map: Record<string, string> = {
    rest_day: "Rest",
    mob: "MOB",
    demob: "DEMOB",
    absent_sick: "Sick",
    absent_unauthorised: "Absent",
    partial_mob: "MOB½",
    partial_demob: "DEM½",
    working: "Work",
  };
  return map[dt] || dt;
}

// ─── PDF generation (Step 7 — Billing Summary) ──────────────────────────────

async function generateBillingSummaryPdf(tw: any, entries: any[], outPath: string): Promise<void> {
  const { PDFDocument, rgb, StandardFonts } = await import("pdf-lib");

  const NAVY = rgb(0.102, 0.114, 0.137);
  const GOLD = rgb(0.961, 0.741, 0.000);
  const WHITE = rgb(1, 1, 1);
  const LIGHT = rgb(0.957, 0.961, 0.965);
  const BORDER = rgb(0.886, 0.894, 0.910);
  const MUTED = rgb(0.42, 0.447, 0.502);
  const TEXT = rgb(0.067, 0.094, 0.153);

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // A4 portrait
  const { width, height } = page.getSize();

  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontReg = await pdfDoc.embedFont(StandardFonts.Helvetica);

  let logoBytes: Uint8Array | null = null;
  const logoPath = path.join(process.cwd(), "client/public/logo-gold.png");
  if (fs.existsSync(logoPath)) logoBytes = fs.readFileSync(logoPath);

  // Header
  page.drawRectangle({ x: 0, y: height - 70, width, height: 70, color: NAVY });
  if (logoBytes) {
    try {
      const img = await pdfDoc.embedPng(logoBytes);
      const scaled = img.scaleToFit(100, 35);
      page.drawImage(img, { x: 20, y: height - 55, width: scaled.width, height: scaled.height });
    } catch { }
  }
  page.drawText("BILLING SUMMARY", { x: 140, y: height - 40, size: 16, font: fontBold, color: WHITE });
  page.drawText(`${tw.project_name || "Project"} · ${tw.customer || ""}`, { x: 140, y: height - 58, size: 10, font: fontReg, color: GOLD });
  page.drawText(`Week commencing: ${tw.week_commencing?.toString().substring(0, 10) || ""}`, { x: width - 200, y: height - 48, size: 10, font: fontReg, color: WHITE });

  let curY = height - 90;

  // ── Group by role ──────────────────────────────────────────────────────
  const roleMap = new Map<string, { workers: Set<string>; totalHours: number; mobDays: number; demobDays: number; restDays: number; sickDays: number; absentDays: number }>();
  let grandTotalHours = 0;
  let grandMob = 0;
  let grandDemob = 0;

  for (const e of entries) {
    const role = e.worker_role || "Unknown";
    if (!roleMap.has(role)) {
      roleMap.set(role, { workers: new Set(), totalHours: 0, mobDays: 0, demobDays: 0, restDays: 0, sickDays: 0, absentDays: 0 });
    }
    const rg = roleMap.get(role)!;
    rg.workers.add(String(e.worker_id));
    if (e.total_hours) rg.totalHours += parseFloat(e.total_hours) || 0;
    if (e.day_type === "mob" || e.day_type === "partial_mob") rg.mobDays++;
    if (e.day_type === "demob" || e.day_type === "partial_demob") rg.demobDays++;
    if (e.day_type === "rest_day") rg.restDays++;
    if (e.day_type === "absent_sick") rg.sickDays++;
    if (e.day_type === "absent_unauthorised") rg.absentDays++;
    grandTotalHours += parseFloat(e.total_hours) || 0;
    if (e.day_type === "mob" || e.day_type === "partial_mob") grandMob++;
    if (e.day_type === "demob" || e.day_type === "partial_demob") grandDemob++;
  }

  // Table header
  const cols = [{ label: "ROLE", x: 20, w: 160 }, { label: "WORKERS", x: 180, w: 60 }, { label: "TOTAL HRS", x: 240, w: 80 }, { label: "MOB", x: 320, w: 50 }, { label: "DEMOB", x: 370, w: 55 }, { label: "REST", x: 425, w: 50 }, { label: "SICK", x: 475, w: 50 }, { label: "ABSENT", x: 525, w: 55 }];
  const ROW_H = 26;

  page.drawRectangle({ x: 20, y: curY - ROW_H, width: width - 40, height: ROW_H, color: NAVY });
  for (const col of cols) {
    page.drawText(col.label, { x: col.x + 4, y: curY - 17, size: 8, font: fontBold, color: WHITE });
  }
  curY -= ROW_H;

  let rowAlt = false;
  for (const [role, data] of Array.from(roleMap)) {
    const rowBg = rowAlt ? LIGHT : WHITE;
    rowAlt = !rowAlt;
    page.drawRectangle({ x: 20, y: curY - ROW_H, width: width - 40, height: ROW_H, color: rowBg });
    const vals = [role.substring(0, 24), String(data.workers.size), data.totalHours.toFixed(1), String(data.mobDays), String(data.demobDays), String(data.restDays), String(data.sickDays), String(data.absentDays)];
    cols.forEach((col, i) => {
      page.drawText(vals[i], { x: col.x + 4, y: curY - 17, size: 9, font: i === 0 ? fontBold : fontReg, color: i === 2 ? NAVY : TEXT });
    });
    page.drawLine({ start: { x: 20, y: curY - ROW_H }, end: { x: width - 20, y: curY - ROW_H }, thickness: 0.5, color: BORDER });
    curY -= ROW_H;
  }

  // Grand total row
  curY -= 4;
  page.drawRectangle({ x: 20, y: curY - ROW_H, width: width - 40, height: ROW_H, color: NAVY });
  page.drawText("GRAND TOTAL", { x: 24, y: curY - 17, size: 9, font: fontBold, color: WHITE });
  page.drawText(grandTotalHours.toFixed(1), { x: 244, y: curY - 17, size: 9, font: fontBold, color: GOLD });
  page.drawText(String(grandMob), { x: 324, y: curY - 17, size: 9, font: fontBold, color: WHITE });
  page.drawText(String(grandDemob), { x: 374, y: curY - 17, size: 9, font: fontBold, color: WHITE });

  // Footer
  page.drawText(`Generated: ${new Date().toUTCString()} | ${tw.project_name || ""} | Week ${tw.week_commencing?.toString().substring(0, 10) || ""}`, {
    x: 20, y: 20, size: 7, font: fontReg, color: MUTED,
  });

  const pdfBytes = await pdfDoc.save();
  fs.writeFileSync(outPath, pdfBytes);
}

// ─── Timesheet reminder scheduler ────────────────────────────────────────────

/** Send a pm_approved timesheet to the customer signatory. Exported for manual triggers. */
export async function autoSendToCustomer(tw: any): Promise<void> {
  const entriesRes = await db.execute(sql`SELECT * FROM timesheet_entries WHERE timesheet_week_id = ${tw.id} ORDER BY worker_id, entry_date`);
  const entries = entriesRes.rows as any[];
  const { hash: realHash, preimage: realPreimage } = buildApprovalHash(entries);

  const rawToken = crypto.randomBytes(32).toString('hex');
  const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
  const tokenExpiry = new Date(Date.now() + 48 * 60 * 60 * 1000);

  await db.execute(sql`
    UPDATE timesheet_weeks SET
      status = 'sent_to_customer',
      sent_to_customer_at = NOW(),
      approval_hash = ${realHash},
      approval_preimage = ${JSON.stringify(realPreimage) as any},
      customer_token = ${hashedToken},
      token_expires_at = ${tokenExpiry.toISOString()},
      token_used_at = NULL
    WHERE id = ${tw.id}
  `);

  const signatoryEmail = tw.timesheet_signatory_email || tw.customer_project_manager_email || tw.site_manager_email;
  const signatoryName = tw.timesheet_signatory_name || tw.customer_project_manager || tw.site_manager || 'Customer Representative';

  if (signatoryEmail) {
    const approvalUrl = `${APP_URL}/#/timesheet-approval/${rawToken}`;
    const firstName = signatoryName.split(' ')[0];
    await sendMail({
      to: signatoryEmail,
      subject: `Timesheet approval required — ${tw.project_name || tw.project_code} (w/c ${tw.week_commencing})`,
      html: buildCustomerApprovalEmail(firstName, tw.project_name || tw.project_code, tw.week_commencing, approvalUrl),
    });
    console.log(`[timesheet] Sent to customer ${signatoryEmail} for ${tw.project_code} w/c ${tw.week_commencing}`);
  } else {
    console.warn(`[timesheet] No customer email for ${tw.project_code} week ${tw.id} — skipping send`);
  }
}

export async function checkTimesheetReminders() {
  try {
    const now = new Date();
    // Monday 8am BST = 07:00 UTC. Give a 2-hour grace window (07:00–08:59 UTC) in case the
    // server restarts and the interval fires slightly late.
    const isMonday8amWindow = now.getUTCDay() === 1 && now.getUTCHours() >= 7 && now.getUTCHours() < 9;

    // ── AUTO-SEND TO CUSTOMER RULE 1: Monday 8am window — send all pm_approved timesheets ──
    if (isMonday8amWindow) {
      const mondayReadyRes = await db.execute(sql`
        SELECT tw.*, p.name as project_name, p.code as project_code,
               p.timesheet_signatory_email, p.customer_project_manager_email, p.site_manager_email
        FROM timesheet_weeks tw
        JOIN projects p ON p.id = tw.project_id
        WHERE tw.status = 'pm_approved'
          AND tw.sent_to_customer_at IS NULL
          AND p.status = 'active'
      `);
      for (const tw of mondayReadyRes.rows as any[]) {
        await autoSendToCustomer(tw);
      }
    }

    // ── AUTO-SEND TO CUSTOMER RULE 2: 24h after PM approval (if missed Monday window) ──
    const lateApprovalRes = await db.execute(sql`
      SELECT tw.*, p.name as project_name, p.code as project_code,
             p.timesheet_signatory_email, p.customer_project_manager_email, p.site_manager_email
      FROM timesheet_weeks tw
      JOIN projects p ON p.id = tw.project_id
      WHERE tw.status = 'pm_approved'
        AND tw.sent_to_customer_at IS NULL
        AND tw.pm_approved_at IS NOT NULL
        AND tw.pm_approved_at < NOW() - INTERVAL '24 hours'
        AND tw.pm_approved_at > NOW() - INTERVAL '25 hours'
        AND p.status = 'active'
    `);
    for (const tw of lateApprovalRes.rows as any[]) {
      await autoSendToCustomer(tw);
    }

    // 24h reminder for sent_to_customer (no action yet)
    const remind24Res = await db.execute(sql`
      SELECT tw.*, p.name as project_name, p.timesheet_signatory_email,
             p.customer_project_manager_email, p.site_manager_email
      FROM timesheet_weeks tw
      JOIN projects p ON p.id = tw.project_id
      WHERE tw.status = 'sent_to_customer'
        AND tw.sent_to_customer_at IS NOT NULL
        AND tw.sent_to_customer_at < NOW() - INTERVAL '24 hours'
        AND tw.sent_to_customer_at > NOW() - INTERVAL '25 hours'
        AND tw.token_used_at IS NULL
    `);

    for (const tw of remind24Res.rows as any[]) {
      const custEmail = tw.timesheet_signatory_email || tw.customer_project_manager_email || tw.site_manager_email;
      if (custEmail && tw.customer_token) {
        // We stored the hashed token — we need to generate a new token for the reminder
        // Re-send with a new token
        const rawToken = crypto.randomBytes(32).toString("hex");
        const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");
        const newExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await db.execute(sql`
          UPDATE timesheet_weeks SET customer_token = ${hashedToken}, token_expires_at = ${newExpiry.toISOString()}
          WHERE id = ${tw.id}
        `);
        const approvalUrl = `${APP_URL}/#/timesheet-approval/${rawToken}`;
        await sendMail({
          to: custEmail,
          subject: `REMINDER: Timesheet approval required — ${tw.project_name} (w/c ${tw.week_commencing})`,
          html: buildCustomerApprovalEmail("", tw.project_name, tw.week_commencing, approvalUrl, true),
        });
      }
    }

    // 48h expiry notification to PM
    const expiredRes = await db.execute(sql`
      SELECT tw.*, p.name as project_name, p.id as project_id
      FROM timesheet_weeks tw
      JOIN projects p ON p.id = tw.project_id
      WHERE tw.status = 'sent_to_customer'
        AND tw.token_expires_at IS NOT NULL
        AND tw.token_expires_at < NOW()
        AND tw.token_used_at IS NULL
    `);

    for (const tw of expiredRes.rows as any[]) {
      const pmEmail = await getPmEmailForProject(tw.project_id);
      if (pmEmail) {
        await sendMail({
          to: pmEmail,
          subject: `Timesheet approval link expired — ${tw.project_name}`,
          html: buildNotificationEmail(
            "Approval Link Expired",
            `The customer approval link for the timesheet (week commencing ${tw.week_commencing}) has expired with no response. Please resend from the platform.`,
            `${APP_URL}/#/projects/`,
            "View Platform"
          ),
        });
      }
      // Mark as recalled to stop repeated reminders
      await db.execute(sql`
        UPDATE timesheet_weeks SET status = 'pm_approved' WHERE id = ${tw.id}
      `);
    }
  } catch (e: any) {
    console.error("[timesheet-reminders] error:", e.message);
  }
}

// ─── Email templates ─────────────────────────────────────────────────────────

function buildNotificationEmail(title: string, body: string, url: string, ctaLabel: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;background:#f4f4f5;padding:40px 0;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
    <div style="background:#1A1D23;padding:28px 32px;text-align:center;">
      <img src="${APP_URL}/logo-gold.png" alt="Powerforce Global" height="36" style="display:block;margin:0 auto;" />
    </div>
    <div style="padding:32px;color:#1A1D23;">
      <h2 style="margin:0 0 16px;font-size:18px;font-weight:700;">${title}</h2>
      <p style="margin:0 0 24px;color:#4b5563;font-size:14px;line-height:1.6;">${body}</p>
      ${url && ctaLabel ? `<div style="text-align:center;"><a href="${url}" style="display:inline-block;background:#F5BD00;color:#1A1D23;font-weight:700;font-size:14px;padding:12px 28px;border-radius:8px;text-decoration:none;">${ctaLabel}</a></div>` : ""}
    </div>
    <div style="padding:16px 32px;font-size:11px;color:#9ca3af;border-top:1px solid #f0f0f0;text-align:center;">
      &copy; ${new Date().getFullYear()} Powerforce Global &middot; Confidential
    </div>
  </div>
</body></html>`;
}

function buildCustomerApprovalEmail(firstName: string, projectName: string, weekComm: string, approvalUrl: string, isReminder = false): string {
  const greeting = firstName ? `Hi ${firstName},` : "Dear Customer Representative,";
  const weekStr = weekComm?.toString().substring(0, 10) || "";
  const iconUrl = `${APP_URL}/logo-gold-mark.png`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F4F5F7;font-family:'Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F4F5F7;min-height:100vh;"><tr><td align="center" style="padding:40px 16px;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:540px;background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 4px 24px rgba(17,24,39,0.09);">
      <!-- Header -->
      <tr><td style="background:#1a2744;padding:20px 32px;border-bottom:3px solid #D4A017;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td><img src="${iconUrl}" alt="Powerforce Global" height="34" style="display:block;height:34px;width:auto;"/></td>
          <td align="right" style="vertical-align:middle;"><span style="font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:rgba(255,255,255,0.4);">Timesheet ${isReminder ? "Reminder" : "Approval"}</span></td>
        </tr></table>
      </td></tr>
      <!-- Body -->
      <tr><td style="padding:28px 32px 22px;">
        <p style="margin:0 0 20px;font-size:19px;font-weight:700;color:#111827;">${greeting}</p>
        <!-- Project card -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#EEF1F7;border-radius:8px;margin-bottom:22px;overflow:hidden;"><tr>
          <td style="padding:18px 20px;">
            <p style="margin:0 0 2px;font-size:9px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#6B7C93;">Project</p>
            <p style="margin:0 0 14px;font-size:16px;font-weight:700;color:#111827;">${projectName}</p>
            <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
              <td width="50%"><p style="margin:0 0 2px;font-size:9px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#6B7C93;">Week Commencing</p><p style="margin:0;font-size:13px;font-weight:600;color:#111827;">${weekStr}</p></td>
            </tr></table>
          </td>
          <td width="4" style="background:#D4A017;">&nbsp;</td>
        </tr></table>
        <p style="margin:0 0 20px;font-size:13px;color:#374151;line-height:1.65;">Please review the full timesheet for all personnel and either <strong>approve</strong> it or <strong>raise a challenge</strong> if you have any concerns.</p>
        <!-- CTA -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0;"><tr><td align="center;">
          <a href="${approvalUrl}" style="display:inline-block;background:#D4A017;color:#1a2744;font-family:'Helvetica Neue',Arial,sans-serif;font-weight:700;font-size:14px;padding:13px 34px;border-radius:8px;text-decoration:none;">Review &amp; Approve Timesheet &rarr;</a>
        </td></tr></table>
        <p style="margin:0;font-size:11px;color:#9CA3AF;line-height:1.6;text-align:center;">This link is personal to you and expires in <strong style="color:#6B7280;">48 hours</strong>.<br>By approving, your name, email, IP address and timestamp will be recorded.</p>
      </td></tr>
      <!-- Divider -->
      <tr><td style="padding:0 32px;"><div style="height:1px;background:#E5E7EB;"></div></td></tr>
      <!-- Footer -->
      <tr><td style="padding:16px 32px 20px;"><table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td><p style="margin:0;font-size:11px;color:#9CA3AF;">Sent by <strong style="color:#6B7280;">Powerforce Global</strong><br>&copy; ${new Date().getFullYear()} Powerforce Global &middot; Confidential</p></td>
        <td align="right"><span style="display:inline-block;background:#EEF1F7;color:#6B7C93;font-size:9px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;padding:4px 8px;border-radius:3px;">Confidential</span></td>
      </tr></table></td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

// ─── Supervisor email template ────────────────────────────────────────────────

function buildSupervisorTimesheetEmail(
  supervisorName: string,
  projectName: string,
  projectCode: string,
  weekComm: string,
  shift: string,
  reviewUrl: string,
): string {
  const firstName = supervisorName.split(" ")[0];
  const weekFormatted = weekComm?.toString().substring(0, 10) || "";
  const shiftLabel = shift === "night" ? "Night" : "Day";
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;background:#f4f4f5;padding:40px 0;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
    <div style="background:#1A1D23;padding:28px 32px;text-align:center;">
      <img src="${APP_URL}/logo-gold.png" alt="Powerforce Global" height="36" style="display:block;margin:0 auto;" />
    </div>
    <div style="padding:32px;color:#1A1D23;">
      <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;">Hi ${firstName},</h2>
      <p style="margin:0 0 16px;color:#4b5563;font-size:15px;line-height:1.6;">
        Please review and submit the <strong>${shiftLabel} Shift</strong> timesheet for
        <strong>${projectName}</strong> (${projectCode}) — week commencing <strong>${weekFormatted}</strong>.
      </p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px;">
        <tr style="border-bottom:1px solid #f0f0f0;">
          <td style="padding:8px 12px;color:#6b7280;">Project</td>
          <td style="padding:8px 12px;font-weight:600;color:#1A1D23;">${projectName}</td>
        </tr>
        <tr style="border-bottom:1px solid #f0f0f0;">
          <td style="padding:8px 12px;color:#6b7280;">Week commencing</td>
          <td style="padding:8px 12px;font-weight:600;color:#1A1D23;">${weekFormatted}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;color:#6b7280;">Your shift</td>
          <td style="padding:8px 12px;font-weight:600;color:#1A1D23;">${shiftLabel} Shift</td>
        </tr>
      </table>
      <p style="margin:0 0 8px;color:#4b5563;font-size:14px;line-height:1.6;">
        Review each worker's hours, make any corrections needed, then click <strong>Submit Timesheet</strong>.
        This will notify your project manager that the timesheet is ready for review.
      </p>
      <div style="text-align:center;margin:28px 0;">
        <a href="${reviewUrl}" style="display:inline-block;background:#1A1D23;color:#F5BD00;font-weight:700;font-size:15px;padding:14px 36px;border-radius:8px;text-decoration:none;">
          Review Timesheet &rarr;
        </a>
      </div>
      <p style="margin:16px 0 0;font-size:12px;color:#9ca3af;text-align:center;">
        This link is personal to you. Do not forward it to others.
      </p>
    </div>
    <div style="padding:16px 32px;font-size:11px;color:#9ca3af;border-top:1px solid #f0f0f0;text-align:center;">
      &copy; ${new Date().getFullYear()} Powerforce Global &middot; Confidential
    </div>
  </div>
</body></html>`;
}

// ─── Sunday send: generate & dispatch supervisor timesheet links ─────────────

/** Return the Monday of the NEXT ISO week after triggerDate (or today) */
function previousMondayBefore(triggerDate?: Date): Date {
  // Sunday send: return the Monday that started the week just finished
  // e.g. triggered Sunday 19 Apr → returns Monday 13 Apr
  const base = triggerDate ? new Date(triggerDate) : new Date();
  base.setUTCHours(0, 0, 0, 0);
  const day = base.getUTCDay(); // 0=Sun, 1=Mon...
  // If Sunday (0): go back 6 days to previous Monday
  // If any other day: go back to the Monday of the current week
  const daysBack = day === 0 ? 6 : day - 1;
  base.setUTCDate(base.getUTCDate() - daysBack);
  return base;
}

export async function sendWeeklySupervisorLinks(triggerDate?: Date): Promise<{ processed: number; weekCommencing?: string }> {
  let processed = 0;
  let weekCommencing: string | undefined;
  try {
    // 1. Get all active projects
    const projRes = await db.execute(sql`
      SELECT id, name, code FROM projects WHERE status = 'active'
    `);
    const projects = projRes.rows as any[];
    if (projects.length === 0) {
      console.log("[supervisor-links] No active projects found.");
      return { processed: 0 };
    }

    const prevMonday = previousMondayBefore(triggerDate);
    const weekComm = isoDate(prevMonday);
    weekCommencing = weekComm;
    console.log(`[supervisor-links] Sending for week commencing ${weekComm}, ${projects.length} active projects`);

    // Accumulate missing-email warnings keyed by PM email
    // { pmEmail: { pmEmail, lines: string[] } }
    const pmWarnings = new Map<string, { pmEmail: string; lines: string[] }>();

    for (const project of projects) {
      try {
        // 2. Ensure timesheet_weeks row exists
        await db.execute(sql`
          INSERT INTO timesheet_weeks (project_id, week_commencing, status)
          VALUES (${project.id}, ${weekComm}::date, 'draft')
          ON CONFLICT (project_id, week_commencing) DO NOTHING
        `);

        const twRes = await db.execute(sql`
          SELECT id FROM timesheet_weeks
          WHERE project_id = ${project.id} AND week_commencing = ${weekComm}::date
        `);
        const tw = twRes.rows[0] as any;
        if (!tw) continue;
        const twId = tw.id;

        // 3. Find PM email via project_leads → users
        const pmRes = await db.execute(sql`
          SELECT u.email FROM project_leads pl
          JOIN users u ON u.id = pl.user_id
          WHERE pl.project_id = ${project.id}
          LIMIT 1
        `);
        const pmEmail = (pmRes.rows[0] as any)?.email || null;

        // 4. Find day shift supervisor (Superintendent > Foreman)
        const dayWorkersRes = await db.execute(sql`
          SELECT w.id, REGEXP_REPLACE(w.name, ' [(][^)]*[)]$', '') as name, w.role,
                 COALESCE(w.work_email, w.personal_email) as email
          FROM assignments a
          JOIN workers w ON w.id = a.worker_id
          WHERE a.project_id = ${project.id}
            AND a.status NOT IN ('cancelled','declined')
            AND LOWER(a.shift) LIKE 'day%'
          ORDER BY
            CASE WHEN w.role ILIKE '%superintendent%' THEN 0 ELSE 1 END,
            w.id
        `);
        const dayWorkers = dayWorkersRes.rows as any[];

        // 5. Find night shift workers
        const nightWorkersRes = await db.execute(sql`
          SELECT w.id, REGEXP_REPLACE(w.name, ' [(][^)]*[)]$', '') as name, w.role,
                 COALESCE(w.work_email, w.personal_email) as email
          FROM assignments a
          JOIN workers w ON w.id = a.worker_id
          WHERE a.project_id = ${project.id}
            AND a.status NOT IN ('cancelled','declined')
            AND LOWER(a.shift) LIKE 'night%'
          ORDER BY
            CASE WHEN w.role ILIKE '%superintendent%' THEN 0 ELSE 1 END,
            w.id
        `);
        const nightWorkers = nightWorkersRes.rows as any[];
        const hasNightShift = nightWorkers.length > 0;

        // Find supervisor from workers list (Superintendent > Foreman > first available)
        const pickSupervisor = (workers: any[]): any | null => {
          const super_ = workers.find(w => w.role?.toLowerCase().includes("superintendent"));
          if (super_) return super_;
          const foreman = workers.find(w => w.role?.toLowerCase().includes("foreman"));
          if (foreman) return foreman;
          return workers[0] || null;
        };

        const daySup = pickSupervisor(dayWorkers);
        const nightSup = hasNightShift ? pickSupervisor(nightWorkers) : null;

        // Check if already sent this week — skip entirely if tokens already exist
        const existingRes = await db.execute(sql`
          SELECT day_sup_token, night_sup_token FROM timesheet_weeks WHERE id = ${twId}
        `);
        const existing = existingRes.rows[0] as any;
        if (existing?.day_sup_token && (!hasNightShift || existing?.night_sup_token)) {
          console.log(`[supervisor-links] Already sent for ${project.code} w/c ${weekComm} — skipping`);
          processed++;
          continue;
        }

        // 6. Process day supervisor
        if (daySup && !existing?.day_sup_token) {
          const rawToken = crypto.randomBytes(32).toString("hex");
          const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");
          await db.execute(sql`
            UPDATE timesheet_weeks
            SET day_sup_token = ${hashedToken},
                day_sup_name = ${daySup.name}
            WHERE id = ${twId}
          `);
          const reviewUrl = `${APP_URL}/#/timesheet-supervisor/${rawToken}`;
          if (!daySup.email) {
            if (pmEmail) {
              if (!pmWarnings.has(pmEmail)) pmWarnings.set(pmEmail, { pmEmail, lines: [] });
              pmWarnings.get(pmEmail)!.lines.push(`<li><strong>${project.name}</strong> — ${daySup.name} (${daySup.role}, Day Shift): <a href="${reviewUrl}">review link</a></li>`);
            }
            console.log(`[supervisor-links] No email for day sup ${daySup.name} on ${project.code}`);
          } else {
            await sendMail({
              to: daySup.email,
              from: pmEmail || undefined,
              subject: `Timesheet review — ${project.name} w/c ${weekComm}`,
              html: buildSupervisorTimesheetEmail(daySup.name, project.name, project.code, weekComm, "day", reviewUrl),
              text: `Hi ${daySup.name},\n\nPlease review the Day Shift timesheet for ${project.name} w/c ${weekComm}:\n\n${reviewUrl}\n\nPowerforce Global`,
            });
            console.log(`[supervisor-links] Sent day link to ${daySup.email} for ${project.code}`);
          }
        }

        // 7. Process night supervisor
        if (nightSup && !existing?.night_sup_token) {
          const rawNightToken = crypto.randomBytes(32).toString("hex");
          const hashedNightToken = crypto.createHash("sha256").update(rawNightToken).digest("hex");
          await db.execute(sql`
            UPDATE timesheet_weeks
            SET night_sup_token = ${hashedNightToken},
                night_sup_name = ${nightSup.name}
            WHERE id = ${twId}
          `);
          const nightReviewUrl = `${APP_URL}/#/timesheet-supervisor/${rawNightToken}`;
          if (!nightSup.email) {
            if (pmEmail) {
              if (!pmWarnings.has(pmEmail)) pmWarnings.set(pmEmail, { pmEmail, lines: [] });
              pmWarnings.get(pmEmail)!.lines.push(`<li><strong>${project.name}</strong> — ${nightSup.name} (${nightSup.role}, Night Shift): <a href="${nightReviewUrl}">review link</a></li>`);
            }
            console.log(`[supervisor-links] No email for night sup ${nightSup.name} on ${project.code}`);
          } else {
            await sendMail({
              to: nightSup.email,
              from: pmEmail || undefined,
              subject: `Timesheet review — ${project.name} w/c ${weekComm}`,
              html: buildSupervisorTimesheetEmail(nightSup.name, project.name, project.code, weekComm, "night", nightReviewUrl),
              text: `Hi ${nightSup.name},\n\nPlease review the Night Shift timesheet for ${project.name} w/c ${weekComm}:\n\n${nightReviewUrl}\n\nPowerforce Global`,
            });
            console.log(`[supervisor-links] Sent night link to ${nightSup.email} for ${project.code}`);
          }
        }



        processed++;
      } catch (projErr: any) {
        console.error(`[supervisor-links] Error processing project ${project.id}:`, projErr.message);
      }
    }

    // Send ONE email per PM covering all their projects with missing supervisor emails
    for (const [, warning] of pmWarnings) {
      await sendMail({
        to: warning.pmEmail,
        subject: `Timesheet links not sent — missing worker emails (w/c ${weekComm})`,
        html: `<p>The following supervisors could not be sent their timesheet review link for week commencing <strong>${weekComm}</strong> because no email address is on their worker record:</p><ul style="line-height:2">${warning.lines.join('')}</ul><p>Please update their email addresses in the platform. The review links above can be shared manually in the meantime.</p>`,
        text: `Some supervisor timesheet links could not be sent w/c ${weekComm} due to missing emails. Please update worker records.`,
      });
      console.log(`[supervisor-links] Sent consolidated warning to ${warning.pmEmail} (${warning.lines.length} missing)`);
    }

    console.log(`[supervisor-links] Done. Processed ${processed}/${projects.length} projects for w/c ${weekComm}.`);
  } catch (e: any) {
    console.error("[supervisor-links] Fatal error:", e.message);
  }
  return { processed };
}
