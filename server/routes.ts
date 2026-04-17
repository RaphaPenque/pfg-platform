import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { registerTimesheetRoutes, buildTimesheetEntries, checkTimesheetReminders } from "./timesheet-routes";
import { insertWorkerSchema, insertProjectSchema, insertAssignmentSchema, insertDocumentSchema, insertOemTypeSchema, insertRoleSlotSchema, insertWorkExperienceSchema } from "@shared/schema";
import type { User, WorkExperience } from "@shared/schema";
import { sendMail, magicLinkEmail, welcomeEmail, confirmationEmail, confirmationResultEmail } from "./email";
import { insertPayrollRulesSchema } from "@shared/schema";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { generateWeeklyReportPdf } from "./report-generator";
import { imageToPdf, isImageFile } from "./image-to-pdf";

// Extend Express Request with user
declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

// Upload directory
const UPLOAD_BASE = fs.existsSync("/data") ? "/data/uploads" : "./uploads";
if (!fs.existsSync(UPLOAD_BASE)) fs.mkdirSync(UPLOAD_BASE, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const workerId = String(req.params.id || "0");
      const dir = path.join(UPLOAD_BASE, workerId);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || ".bin";
      const type = (_req.body && _req.body.type) || "file";
      cb(null, `${type}${ext}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB — covers scanned cert PDFs
});

// ─── Auth Middleware ──────────────────────────────────────────

async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const sessionToken = (req as any).cookies?.pfg_session;
  if (!sessionToken) return res.status(401).json({ error: "Not authenticated" });

  const session = await storage.getSessionByToken(sessionToken);
  if (!session) return res.status(401).json({ error: "Session expired" });

  const user = await storage.getUserById(session.userId);
  if (!user || !user.isActive) return res.status(401).json({ error: "User not found or inactive" });

  req.user = user;
  next();
}

function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    next();
  };
}

// ─── Audit Helper ────────────────────────────────────────────

async function logAudit(
  userId: number | null,
  action: string,
  entityType: string,
  entityId: number,
  entityName?: string,
  changes?: object,
) {
  try {
    await storage.createAuditLog({ userId, action, entityType, entityId, entityName, changes });
  } catch (e) {
    console.error("Audit log failed:", e);
  }
}

// ─── Routes ──────────────────────────────────────────────────

export function registerRoutes(server: Server, app: Express) {

  // ===== AUTH ROUTES (no auth required) =====

  app.post("/api/auth/request-link", (req: Request, res: Response) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email required" });

    // Respond IMMEDIATELY — never wait for DB or email (cold-start DB can take >10s)
    // The neutral message prevents email enumeration regardless of outcome
    res.json({ message: "If that address is registered, a login link is on its way" });

    // Do all async work in background after response is sent
    // Wrap in setTimeout(0) instead of setImmediate for broader Node.js compat
    setTimeout(async () => {
      console.log(`[MAGIC-LINK] Background job started for ${email}`);
      try {
        const user = await Promise.race([
          storage.getUserByEmail(email),
          new Promise<undefined>((_, reject) => setTimeout(() => reject(new Error('DB timeout after 20s')), 20000))
        ]);
        if (!user || !user.isActive) {
          console.log(`[MAGIC-LINK] No active user found for ${email} — skipping`);
          return;
        }

        const token = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
        await storage.createMagicLink({ email: email.toLowerCase(), token, expiresAt });

        const loginUrl = `https://pfg-platform.onrender.com/#/auth/verify?token=${token}`;
        console.log(`[MAGIC-LINK] Token created for ${email} — sending email`);

        const tmpl = magicLinkEmail(user.name, loginUrl);
        const sent = await sendMail({ to: email, subject: tmpl.subject, html: tmpl.html, text: tmpl.text });
        console.log(`[MAGIC-LINK] Email ${sent ? 'sent' : 'FAILED'} for ${email}. Link: ${loginUrl}`);
      } catch (err: any) {
        console.error("[MAGIC-LINK] Background error:", err?.message || err);
      }
    }, 0);
  });

  app.get("/api/auth/verify", async (req: Request, res: Response) => {
    const token = req.query.token as string;
    if (!token) return res.status(400).json({ error: "Token required" });

    const link = await storage.getMagicLinkByToken(token);
    if (!link) return res.status(404).json({ error: "Invalid link" });
    if (link.usedAt) return res.status(400).json({ error: "Link already used" });
    if (new Date() > link.expiresAt) return res.status(400).json({ error: "Link expired" });

    // Mark link as used
    await storage.markMagicLinkUsed(token);

    // Find or confirm user
    const user = await storage.getUserByEmail(link.email);
    if (!user) return res.status(404).json({ error: "User not found" });

    // Update last login
    await storage.updateUser(user.id, { lastLoginAt: new Date() } as any);

    // Create session (30 days)
    const sessionToken = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await storage.createSession({
      userId: user.id,
      token: sessionToken,
      expiresAt,
      userAgent: req.get("user-agent") || null,
      ipAddress: req.ip || null,
    } as any);

    // Set httpOnly cookie
    res.cookie("pfg_session", sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: "/",
    });

    // Redirect to app
    res.redirect("/#/");
  });

  app.post("/api/auth/logout", async (req: Request, res: Response) => {
    const sessionToken = (req as any).cookies?.pfg_session;
    if (sessionToken) {
      await storage.deleteSession(sessionToken);
    }
    res.clearCookie("pfg_session", { path: "/" });
    res.json({ message: "Logged out" });
  });

  app.get("/api/auth/me", requireAuth, (req: Request, res: Response) => {
    const u = req.user!;
    res.json({ id: u.id, email: u.email, name: u.name, role: u.role });
  });

  // ===== PORTAL (no auth required) =====
  app.get("/api/portal/:code", async (req: Request, res: Response) => {
    const project = await storage.getProjectByCode((req.params.code as string).toUpperCase());
    if (!project) return res.status(404).json({ error: "Project not found" });

    const [projectAssignments, allWorkers, rawRoleSlots] = await Promise.all([
      storage.getAssignmentsByProject(project.id),
      storage.getWorkers(),
      storage.getRoleSlotsByProject(project.id),
    ]);
    let slotPeriods: any[] = [];
    try { slotPeriods = await storage.getRoleSlotPeriodsByProject(project.id); } catch { slotPeriods = []; }
    // Attach periods to each slot
    const periodsBySlot: Record<number, any[]> = {};
    slotPeriods.forEach(p => { if (!periodsBySlot[p.roleSlotId]) periodsBySlot[p.roleSlotId] = []; periodsBySlot[p.roleSlotId].push(p); });
    const roleSlots = rawRoleSlots.map(s => ({ ...s, periods: (periodsBySlot[s.id] || []).sort((a: any, b: any) => a.startDate.localeCompare(b.startDate)) }));

    const workerMap = Object.fromEntries(allWorkers.map(w => [w.id, w]));

    // Build enriched worker objects for assigned workers (with OEM experience parsed)
    const PORTAL_STATUSES = ["active", "confirmed", "pending_confirmation", "flagged"];
    const assignedWorkerIds = Array.from(new Set(
      projectAssignments.filter(a => PORTAL_STATUSES.includes(a.status || "")).map(a => a.workerId)
    ));
    const workers: Record<number, any> = {};
    for (const wid of assignedWorkerIds) {
      const w = workerMap[wid];
      if (!w) continue;
      const docs = await storage.getDocumentsByWorker(wid);
      const allWorkExp = await storage.getWorkExperience(wid);
      workers[wid] = {
        id: w.id,
        name: w.name,
        role: w.role,
        status: w.status,
        nationality: w.nationality,
        joined: w.joined,
        englishLevel: w.englishLevel,
        techLevel: w.techLevel,
        costCentre: w.costCentre,
        dateOfBirth: w.dateOfBirth,
        age: w.age,
        driversLicenseUploaded: w.driversLicenseUploaded,
        oemExperience: w.oemExperience ? JSON.parse(w.oemExperience) : [],
        documents: docs,
        workExperience: allWorkExp,
        assignments: [], // populated below after assignments are built
      };
    }

    const assignments = projectAssignments
      .filter(a => PORTAL_STATUSES.includes(a.status || ""))
      .map(a => ({
        id: a.id,
        workerId: a.workerId,
        projectId: a.projectId,
        roleSlotId: a.roleSlotId,
        task: a.role,
        role: a.role,
        shift: a.shift,
        startDate: a.startDate,
        endDate: a.endDate,
        status: a.status,
        duration: a.duration,
        // Enriched fields for SQEP work experience page
        projectCode: project.code,
        projectName: project.name,
        customer: project.customer,
        equipmentType: project.equipmentType,
        location: project.location,
        siteName: project.siteName,
        scopeOfWork: project.scopeOfWork,
      }));

    // Attach assignments to each worker object so SQEP PDF can render work experience
    for (const a of assignments) {
      if (workers[a.workerId]) {
        workers[a.workerId].assignments.push(a);
      }
    }

    // ── Portal extra data ───────────────────────────────────────────
    const [allReports, allToolboxTalks, allSafetyObs, allIncidents, allComments] = await Promise.all([
      storage.getDailyReports(project.id),
      storage.getToolboxTalks(project.id),
      storage.getSafetyObservations(project.id),
      storage.getIncidentReports(project.id),
      storage.getCommentsLog(project.id),
    ]);

    // Published reports with their comments
    const publishedReports = allReports
      .filter((r) => r.publishedToPortal)
      .sort((a, b) => (a.reportDate < b.reportDate ? 1 : -1))
      .map((r) => ({
        id: r.id,
        reportDate: r.reportDate,
        completedTasks: r.completedTasks ?? [],
        delaysLog: r.delaysLog ?? [],
        commentsLog: allComments.filter((c) => c.reportId === r.id),
      }));

    // Safety data
    const safetyData = {
      toolboxTalks: { count: allToolboxTalks.length, list: allToolboxTalks },
      safetyObservations: { count: allSafetyObs.length, list: allSafetyObs },
      incidentReports: { count: allIncidents.length, list: allIncidents },
    };

    // KPIs
    const today = new Date();
    const startDate = project.startDate ? new Date(project.startDate) : null;
    const endDate = project.endDate ? new Date(project.endDate) : null;
    const msPerDay = 1000 * 60 * 60 * 24;
    const daysRemaining = endDate
      ? Math.max(0, Math.ceil((endDate.getTime() - today.getTime()) / msPerDay))
      : null;
    const totalDays = (startDate && endDate)
      ? Math.ceil((endDate.getTime() - startDate.getTime()) / msPerDay)
      : null;

    const totalDelays = allReports.reduce((sum, r) => {
      const dl = Array.isArray(r.delaysLog) ? r.delaysLog : [];
      return sum + dl.length;
    }, 0);

    const kpis = {
      daysRemaining,
      totalDays,
      activeTeam: Object.keys(workers).length,
      delayCount: totalDelays,
      safetyObsCount: allSafetyObs.length,
    };

    res.json({ project, roleSlots, assignments, workers, publishedReports, safetyData, kpis });
  });

  // GET /api/portal/:code/report/:reportId/pdf — public, no auth
  app.get("/api/portal/:code/report/:reportId/pdf", async (req: Request, res: Response) => {
    try {
      const code = (req.params.code as string).toUpperCase();
      const reportId = parseInt(req.params.reportId as string, 10);

      if (isNaN(reportId)) return res.status(400).json({ error: "Invalid report ID" });

      const project = await storage.getProjectByCode(code);
      if (!project) return res.status(404).json({ error: "Project not found" });

      // Fetch all reports for this project, find the one by ID
      const allReports = await storage.getDailyReports(project.id);
      const report = allReports.find(r => r.id === reportId);
      if (!report) return res.status(404).json({ error: "Report not found" });
      if (!report.publishedToPortal) return res.status(403).json({ error: "Report not published" });

      // Calculate week start/end from reportDate (Mon–Sun)
      const reportDateObj = new Date(report.reportDate + 'T00:00:00Z');
      const dayOfWeek = reportDateObj.getUTCDay(); // 0=Sun,1=Mon,...,6=Sat
      // Week starts Monday, ends Sunday
      const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const weekStartObj = new Date(reportDateObj);
      weekStartObj.setUTCDate(reportDateObj.getUTCDate() - daysToMonday);
      const weekEndObj = new Date(weekStartObj);
      weekEndObj.setUTCDate(weekStartObj.getUTCDate() + 6);
      const toISO = (d: Date) => d.toISOString().split('T')[0];
      const weekStart = toISO(weekStartObj);
      const weekEnd = toISO(weekEndObj);

      // PM name
      let pmName = 'Powerforce Global Project Management';
      try {
        const lead = await storage.getProjectLead(project.id);
        if (lead) {
          const pmUser = await storage.getUserById(lead.userId);
          if (pmUser?.name) pmName = pmUser.name;
        }
      } catch { /* ignore */ }

      // Team members
      const [assignments, allWorkers, allToolboxTalks, allSafetyObs, allIncidents, allComments] = await Promise.all([
        storage.getAssignmentsByProject(project.id),
        storage.getWorkers(),
        storage.getToolboxTalks(project.id),
        storage.getSafetyObservations(project.id),
        storage.getIncidentReports(project.id),
        storage.getCommentsLog(project.id),
      ]);

      const workerMap = Object.fromEntries(allWorkers.map(w => [w.id, w]));
      const activeAssignments = assignments.filter(a => a.status === 'active' || a.status === 'flagged');
      const teamMembers = activeAssignments.map(a => {
        const w = workerMap[a.workerId];
        return {
          name: w?.name || `Worker ${a.workerId}`,
          role: a.role || '',
          shift: a.shift || '',
          startDate: a.startDate || '',
          endDate: a.endDate || '',
        };
      });

      // Safety counts for the week
      const weekStartMs = weekStartObj.getTime();
      const weekEndMs = weekEndObj.getTime() + 86_400_000;
      const filterWeek = (items: Array<{ createdAt?: Date | string | null }>) =>
        items.filter(item => {
          if (!item.createdAt) return false;
          const t = new Date(item.createdAt as string).getTime();
          return t >= weekStartMs && t < weekEndMs;
        });

      const weekTalks = filterWeek(allToolboxTalks).length;
      const weekObs = filterWeek(allSafetyObs).length;
      const weekNearMisses = allIncidents.filter(i => {
        if (!i.createdAt) return false;
        const t = new Date(String(i.createdAt)).getTime();
        return t >= weekStartMs && t < weekEndMs && (i as any).type === 'near_miss';
      }).length;
      const weekIncidents = filterWeek(allIncidents).length;

      // Comments for this report
      const reportComments = allComments
        .filter(c => c.reportId === report.id)
        .map(c => ({
          date: (c.enteredAt || '').toString().split('T')[0],
          entry: c.entry || '',
          userName: (c as any).userName || '',
        }));

      // Days remaining / progress
      const today = new Date();
      const msPerDay = 86_400_000;
      const projStart = project.startDate ? new Date(project.startDate + 'T00:00:00Z') : null;
      const projEnd = project.endDate ? new Date(project.endDate + 'T00:00:00Z') : null;
      const daysRemaining = projEnd ? Math.max(0, Math.ceil((projEnd.getTime() - today.getTime()) / msPerDay)) : 0;
      const totalDays = (projStart && projEnd) ? Math.ceil((projEnd.getTime() - projStart.getTime()) / msPerDay) : 1;
      const elapsedDays = projStart ? Math.ceil((today.getTime() - projStart.getTime()) / msPerDay) : 0;
      const progressPct = Math.min(100, Math.max(0, (elapsedDays / totalDays) * 100));

      const completedTasks: Array<{ description: string; percentComplete?: number; notes?: string }> =
        Array.isArray(report.completedTasks) ? (report.completedTasks as any[]).map(t =>
          typeof t === 'string' ? { description: t } : t
        ) : [];

      const delaysLog: Array<{ description: string; duration?: string; agreedWithCustomer?: string }> =
        Array.isArray(report.delaysLog) ? (report.delaysLog as any[]).map(d =>
          typeof d === 'string' ? { description: d } : d
        ) : [];

      // Work packages if L/S project
      let workPackages: Array<{ name: string; plannedStart?: string; plannedFinish?: string; actualStart?: string; actualFinish?: string }> | undefined;
      const contractType = (project as any).contractType || 'T&M';
      if (contractType.toUpperCase().includes('L') && contractType.toUpperCase().includes('S')) {
        try {
          const roleSlots = await storage.getRoleSlotsByProject(project.id);
          workPackages = (roleSlots as any[]).filter(rs => rs.name).map(rs => ({
            name: rs.name || rs.role || '',
            plannedStart: rs.plannedStart || '',
            plannedFinish: rs.plannedFinish || '',
            actualStart: rs.actualStart || '',
            actualFinish: rs.actualFinish || '',
          }));
        } catch { /* ignore */ }
      }

      const reportData = {
        projectName: project.name || '',
        projectCode: project.code || '',
        customer: project.customer || '',
        siteName: project.siteName || project.location || '',
        startDate: project.startDate || '',
        endDate: project.endDate || '',
        contractType,
        shiftPattern: (project as any).shiftPattern || '',
        weekStart,
        weekEnd,
        pmName,
        completedTasks,
        delaysLog,
        commentsEntries: reportComments,
        teamMembers,
        workPackages,
        safetyData: {
          toolboxTalks: weekTalks,
          observations: weekObs,
          nearMisses: weekNearMisses,
          incidents: weekIncidents,
        },
        daysRemaining,
        activeTeam: teamMembers.length,
        progressPct,
        oemColour: (project as any).oemColour || '#005E60',
      };

      const pdfBuffer = await generateWeeklyReportPdf(reportData);

      const dateStr = report.reportDate.replace(/-/g, '');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${project.code}-report-${dateStr}.pdf"`);
      res.setHeader('Content-Length', pdfBuffer.length);
      res.send(pdfBuffer);
    } catch (err: any) {
      console.error('[portal-pdf] Error generating report PDF:', err);
      res.status(500).json({ error: 'Failed to generate PDF', detail: err?.message });
    }
  });

  // ===== PUBLIC CONFIRMATION ROUTES (no auth) =====

  app.get("/api/confirm/:token", async (req: Request, res: Response) => {
    const { token } = req.params;
    const allAssignments = await storage.getAssignments();
    const assignment = allAssignments.find(a => a.confirmationToken === token);
    if (!assignment) return res.status(404).json({ error: "Invalid or expired confirmation link" });

    const worker = await storage.getWorker(assignment.workerId);
    const project = await storage.getProject(assignment.projectId);
    const roleSlots = assignment.roleSlotId ? await storage.getRoleSlotsByProject(assignment.projectId) : [];
    const roleSlot = roleSlots.find(s => s.id === assignment.roleSlotId) || null;

    const alreadyResponded = !!(assignment.confirmedAt || assignment.declinedAt);

    res.json({
      assignment: {
        id: assignment.id,
        role: assignment.role,
        shift: assignment.shift,
        startDate: assignment.startDate,
        endDate: assignment.endDate,
        status: assignment.status,
        confirmedAt: assignment.confirmedAt,
        declinedAt: assignment.declinedAt,
      },
      worker: worker ? { id: worker.id, name: worker.name } : null,
      project: project ? { id: project.id, name: project.name, location: project.location, siteName: project.siteName } : null,
      roleSlot: roleSlot ? { id: roleSlot.id, role: roleSlot.role, shift: roleSlot.shift } : null,
      status: assignment.status,
      alreadyResponded,
    });
  });

  app.post("/api/confirm/:token/accept", async (req: Request, res: Response) => {
    const { token } = req.params;
    const allAssignments = await storage.getAssignments();
    const assignment = allAssignments.find(a => a.confirmationToken === token);
    if (!assignment) return res.status(404).json({ error: "Invalid confirmation link" });
    if (assignment.confirmedAt) return res.json({ ok: true, message: "Already confirmed" });

    const now = new Date().toISOString();
    await storage.updateAssignment(assignment.id, { status: "confirmed", confirmedAt: now });

    // Notify RM
    const project = await storage.getProject(assignment.projectId);
    const worker = await storage.getWorker(assignment.workerId);
    if (project && worker) {
      // Find RM who sent it — get project lead or fall back to all RMs
      const lead = await storage.getProjectLead(project.id);
      const allUsers = await storage.getUsers();
      const rms = lead
        ? allUsers.filter(u => u.id === lead.userId)
        : allUsers.filter(u => u.role === "resource_manager" && u.isActive);
      for (const rm of rms) {
        const tmpl = confirmationResultEmail(rm.name, worker.name, project.name, "confirmed");
        sendMail({ to: rm.email, subject: tmpl.subject, html: tmpl.html, text: tmpl.text })
          .catch(err => console.error("[email] Confirmation result send error:", err));
      }
    }

    res.json({ ok: true });
  });

  app.post("/api/confirm/:token/decline", async (req: Request, res: Response) => {
    const { token } = req.params;
    const allAssignments = await storage.getAssignments();
    const assignment = allAssignments.find(a => a.confirmationToken === token);
    if (!assignment) return res.status(404).json({ error: "Invalid confirmation link" });
    if (assignment.declinedAt) return res.json({ ok: true, message: "Already declined" });

    const now = new Date().toISOString();
    await storage.updateAssignment(assignment.id, { status: "declined", declinedAt: now });

    // Notify RM
    const project = await storage.getProject(assignment.projectId);
    const worker = await storage.getWorker(assignment.workerId);
    if (project && worker) {
      const lead = await storage.getProjectLead(project.id);
      const allUsers = await storage.getUsers();
      const rms = lead
        ? allUsers.filter(u => u.id === lead.userId)
        : allUsers.filter(u => u.role === "resource_manager" && u.isActive);
      for (const rm of rms) {
        const tmpl = confirmationResultEmail(rm.name, worker.name, project.name, "declined");
        sendMail({ to: rm.email, subject: tmpl.subject, html: tmpl.html, text: tmpl.text })
          .catch(err => console.error("[email] Confirmation result send error:", err));
      }
    }

    res.json({ ok: true });
  });

  // ===== ALL ROUTES BELOW REQUIRE AUTH =====
  app.use("/api", (req: Request, res: Response, next: NextFunction) => {
    // Skip auth for auth routes, portal, confirmation, and public survey/approval routes
    if (req.path.startsWith("/auth/") || req.path.startsWith("/portal/") || req.path.startsWith("/confirm/")) return next();
    if (req.path.startsWith("/survey/") || req.path.startsWith("/delay-approval/") || req.path.startsWith("/milestone-approval/") || req.path.startsWith("/timesheet-approval/")) return next();
    // Skip auth for uploads serving (static files)
    if (req.path.startsWith("/uploads/")) return next();
    requireAuth(req, res, next);
  });

  // ===== USERS (admin only) =====
  app.get("/api/users", requireRole("admin"), async (_req: Request, res: Response) => {
    const allUsers = await storage.getUsers();
    res.json(allUsers.map(u => ({ id: u.id, email: u.email, name: u.name, role: u.role, isActive: u.isActive, lastLoginAt: u.lastLoginAt })));
  });

  app.post("/api/users", requireRole("admin"), async (req: Request, res: Response) => {
    const { email, name, role } = req.body;
    if (!email || !name || !role) return res.status(400).json({ error: "email, name and role required" });
    const validRoles = ["admin", "resource_manager", "project_manager", "finance", "observer"];
    if (!validRoles.includes(role)) return res.status(400).json({ error: "Invalid role" });
    try {
      const existing = await storage.getUserByEmail(email.toLowerCase());
      let user;
      if (existing) {
        user = await storage.updateUser(existing.id, { name, role, isActive: true } as any);
      } else {
        user = await storage.createUser({ email: email.toLowerCase(), name, role, isActive: true } as any);
      }
      // Generate a 7-day invite token
      const token = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await storage.createMagicLink({ email: email.toLowerCase(), token, expiresAt });
      const inviteLink = `https://pfg-platform.onrender.com/#/auth/verify?token=${token}`;
      console.log(`[INVITE] ${name} (${role}): ${inviteLink}`);

      // Send welcome email via Microsoft Graph
      const tmpl = welcomeEmail(name, role, inviteLink);
      sendMail({ to: email, subject: tmpl.subject, html: tmpl.html, text: tmpl.text })
        .catch(err => console.error("[email] Invite send error:", err));

      res.json({ user, inviteLink });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/users/:id", requireRole("admin"), async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    const updates = req.body;
    const user = await storage.updateUser(id, updates);
    res.json(user);
  });

  app.get("/api/users/resource-managers", async (_req: Request, res: Response) => {
    const allUsers = await storage.getUsers();
    res.json(allUsers.filter(u => u.role === "resource_manager" && u.isActive).map(u => ({ id: u.id, name: u.name, email: u.email })));
  });

  // ===== WORKERS =====
  app.get("/api/workers", async (_req: Request, res: Response) => {
    const allWorkers = await storage.getWorkers();
    res.json(allWorkers);
  });

  app.get("/api/workers/:id", async (req: Request, res: Response) => {
    const worker = await storage.getWorker(parseInt(req.params.id));
    if (!worker) return res.status(404).json({ error: "Worker not found" });
    res.json(worker);
  });

  app.post("/api/workers", requireRole("admin", "resource_manager", "project_manager"), async (req: Request, res: Response) => {
    const parsed = insertWorkerSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error });
    const worker = await storage.createWorker(parsed.data);
    await logAudit(req.user!.id, "worker.create", "worker", worker.id, worker.name);
    res.status(201).json(worker);
  });

  app.patch("/api/workers/:id", requireRole("admin", "resource_manager", "project_manager"), async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    const before = await storage.getWorker(id);
    const worker = await storage.updateWorker(id, req.body);
    if (!worker) return res.status(404).json({ error: "Worker not found" });
    // Build changes diff
    const changes: Record<string, { from: any; to: any }> = {};
    if (before) {
      for (const key of Object.keys(req.body)) {
        const k = key as keyof typeof before;
        if (before[k] !== req.body[key]) {
          changes[key] = { from: before[k], to: req.body[key] };
        }
      }
    }
    await logAudit(req.user!.id, "worker.update", "worker", worker.id, worker.name, changes);
    res.json(worker);
  });

  app.delete("/api/workers/:id", requireRole("admin", "resource_manager", "project_manager"), async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    const worker = await storage.getWorker(id);
    if (!worker) return res.status(404).json({ error: "Worker not found" });

    const today = new Date().toISOString().split("T")[0];
    // Availability: check if worker has any role slot periods covering today
    const workerAssignments = await storage.getAssignmentsByWorker(id);
    let activePeriods: any[] = [];
    try { activePeriods = await storage.getWorkerActivePeriodsOnDate(id, today); } catch { activePeriods = []; }
    if (activePeriods.length > 0) {
      const allProjects = await storage.getProjects();
      const projectMap = Object.fromEntries(allProjects.map(p => [p.id, p]));
      const projectNames = Array.from(new Set(activePeriods.map((p: any) => projectMap[p.projectId]?.name || "Unknown")));
      return res.status(409).json({ message: "Worker has active assignments", projects: projectNames });
    }

    for (const a of workerAssignments) {
      await storage.deleteAssignment(a.id);
    }
    const docs = await storage.getDocumentsByWorker(id);
    for (const d of docs) {
      await storage.deleteDocument(d.id);
    }
    await storage.deleteWorker(id);
    await logAudit(req.user!.id, "worker.delete", "worker", id, worker.name);
    res.status(204).send();
  });

  app.get("/api/workers/:id/full", async (req: Request, res: Response) => {
    const worker = await storage.getWorker(parseInt(req.params.id));
    if (!worker) return res.status(404).json({ error: "Worker not found" });
    const workerAssignments = await storage.getAssignmentsByWorker(worker.id);
    const workerDocs = await storage.getDocumentsByWorker(worker.id);
    const allProjects = await storage.getProjects();
    const projectMap = Object.fromEntries(allProjects.map(p => [p.id, p]));
    const enrichedAssignments = workerAssignments.map(a => ({
      ...a,
      project: projectMap[a.projectId] || null,
    }));
    res.json({ ...worker, assignments: enrichedAssignments, documents: workerDocs });
  });

  // ===== WORK EXPERIENCE =====
  app.get("/api/workers/:id/work-experience", async (req: Request, res: Response) => {
    const workerId = parseInt(req.params.id);
    const entries = await storage.getWorkExperience(workerId);
    res.json(entries);
  });

  app.post("/api/workers/:id/work-experience", async (req: Request, res: Response) => {
    const workerId = parseInt(req.params.id);
    const parsed = insertWorkExperienceSchema.safeParse({ ...req.body, workerId });
    if (!parsed.success) return res.status(400).json({ error: parsed.error });
    const entry = await storage.createWorkExperience(parsed.data);
    res.status(201).json(entry);
  });

  app.patch("/api/work-experience/:id", async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    const { siteName, startDate, endDate, role, oem, equipmentType, scopeOfWork } = req.body;
    const updated = await storage.updateWorkExperience(id, {
      siteName, startDate: startDate || null, endDate: endDate || null,
      role: role || null, oem: oem || null, equipmentType: equipmentType || null, scopeOfWork: scopeOfWork || null
    });
    res.json(updated);
  });

  app.delete("/api/work-experience/:id", async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    await storage.deleteWorkExperience(id);
    res.status(204).send();
  });

  // ===== OEM EXPERIENCE =====
  // GET  /api/workers/:id/oem-experience  — list for one worker
  // PUT  /api/workers/:id/oem-experience  — replace full set (used by profile editor)
  // POST /api/workers/:id/oem-experience  — add single entry
  // DELETE /api/oem-experience/:id        — remove one entry
  app.get("/api/workers/:id/oem-experience", async (req: Request, res: Response) => {
    const workerId = parseInt(req.params.id);
    res.json(await storage.getOemExperience(workerId));
  });

  app.post("/api/workers/:id/oem-experience", async (req: Request, res: Response) => {
    const workerId = parseInt(req.params.id);
    const { oem, equipmentType, yearsExperience } = req.body;
    if (!oem || !equipmentType) return res.status(400).json({ error: "oem and equipmentType required" });
    const entry = await storage.upsertOemExperience(workerId, oem, equipmentType, yearsExperience);
    res.status(201).json(entry);
  });

  app.put("/api/workers/:id/oem-experience", async (req: Request, res: Response) => {
    const workerId = parseInt(req.params.id);
    const entries = req.body; // array of {oem, equipmentType, yearsExperience}
    if (!Array.isArray(entries)) return res.status(400).json({ error: "Expected array" });
    await storage.replaceOemExperience(workerId, entries.map((e: any) => ({ workerId, oem: e.oem, equipmentType: e.equipmentType, yearsExperience: e.yearsExperience })));
    res.json(await storage.getOemExperience(workerId));
  });

  app.delete("/api/oem-experience/:id", async (req: Request, res: Response) => {
    await storage.deleteOemExperience(parseInt(req.params.id));
    res.status(204).send();
  });

  // ===== PROJECTS =====
  app.get("/api/projects", async (_req: Request, res: Response) => {
    const allProjects = await storage.getProjects();
    res.json(allProjects);
  });

  app.get("/api/projects/:id", async (req: Request, res: Response) => {
    const project = await storage.getProject(parseInt(req.params.id));
    if (!project) return res.status(404).json({ error: "Project not found" });
    res.json(project);
  });

  app.post("/api/projects", async (req: Request, res: Response) => {
    const parsed = insertProjectSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error });
    const project = await storage.createProject(parsed.data);
    await logAudit(req.user!.id, "project.create", "project", project.id, project.name);
    res.status(201).json(project);
  });

  app.patch("/api/projects/:id", async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    const before = await storage.getProject(id);
    const project = await storage.updateProject(id, req.body);
    if (!project) return res.status(404).json({ error: "Project not found" });
    const changes: Record<string, { from: any; to: any }> = {};
    if (before) {
      for (const key of Object.keys(req.body)) {
        const k = key as keyof typeof before;
        if (before[k] !== req.body[key]) {
          changes[key] = { from: before[k], to: req.body[key] };
        }
      }
    }
    await logAudit(req.user!.id, "project.update", "project", project.id, project.name, changes);
    res.json(project);
  });

  app.post("/api/projects/:id/status", async (req: Request, res: Response) => {
    const { status } = req.body;
    if (!status || !["active", "completed", "cancelled", "potential"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }
    // Cancel requires role check
    if (status === "cancelled") {
      const allowed = ["admin", "resource_manager", "project_manager"];
      if (!req.user || !allowed.includes(req.user.role)) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }
    }

    const project = await storage.getProject(parseInt(req.params.id));
    if (!project) return res.status(404).json({ error: "Project not found" });

    if (status === "cancelled") {
      // Release all assigned workers back to available
      const projectAssignments = await storage.getAssignmentsByProject(project.id);
      const FILLED = ["active", "confirmed", "pending_confirmation", "flagged"];
      for (const a of projectAssignments) {
        if (FILLED.includes(a.status || "")) {
          await storage.updateAssignment(a.id, { status: "removed" });
        }
      }
    }

    const updated = await storage.updateProjectStatus(project.id, status);
    await logAudit(req.user!.id, "project.status", "project", project.id, project.name, { status: { from: project.status, to: status } });
    res.json(updated);
  });

  app.delete("/api/projects/:id", requireRole("admin", "resource_manager", "project_manager"), async (req: Request, res: Response) => {
    const project = await storage.getProject(parseInt(req.params.id));
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (project.status !== "potential" && project.status !== "cancelled") {
      return res.status(400).json({ error: "Only potential or cancelled projects can be deleted. Cancel the project first." });
    }
    // Release any remaining assignments before deleting
    const projectAssignments = await storage.getAssignmentsByProject(project.id);
    const FILLED = ["active", "confirmed", "pending_confirmation", "flagged"];
    for (const a of projectAssignments) {
      if (FILLED.includes(a.status || "")) {
        await storage.updateAssignment(a.id, { status: "removed" });
      }
    }
    await storage.deleteProject(project.id);
    await logAudit(req.user!.id, "project.delete", "project", project.id, project.name);
    res.status(204).send();
  });

  app.get("/api/projects/:id/team", async (req: Request, res: Response) => {
    const project = await storage.getProject(parseInt(req.params.id));
    if (!project) return res.status(404).json({ error: "Project not found" });
    const projectAssignments = await storage.getAssignmentsByProject(project.id);
    const allWorkers = await storage.getWorkers();
    const workerMap = Object.fromEntries(allWorkers.map(w => [w.id, w]));
    const team = projectAssignments.map(a => ({
      ...a,
      worker: workerMap[a.workerId] || null,
    }));
    res.json({ ...project, team });
  });

  // ===== PROJECT LEADS =====
  app.get("/api/projects/:id/lead", async (req: Request, res: Response) => {
    const lead = await storage.getProjectLead(parseInt(req.params.id));
    if (!lead) return res.json(null);
    const user = await storage.getUserById(lead.userId);
    res.json(user ? { id: user.id, name: user.name, email: user.email } : null);
  });

  app.put("/api/projects/:id/lead", requireRole("admin", "resource_manager", "project_manager"), async (req: Request, res: Response) => {
    const { userId } = req.body;
    if (!userId) {
      await storage.removeProjectLead(parseInt(req.params.id));
      return res.json(null);
    }
    const lead = await storage.setProjectLead(parseInt(req.params.id), userId);
    res.json(lead);
  });

  // ===== NOTIFY TEMPS =====
  app.post("/api/projects/notify-temps", async (req: Request, res: Response) => {
    const { projectId, assignmentIds } = req.body;
    if (!projectId || !Array.isArray(assignmentIds)) {
      return res.status(400).json({ error: "projectId and assignmentIds[] required" });
    }
    const project = await storage.getProject(projectId);
    if (!project) return res.status(404).json({ error: "Project not found" });

    let sent = 0;
    let skipped = 0;
    const noEmail: string[] = [];

    const allAssignments = await storage.getAssignments();
    for (const aId of assignmentIds) {
      const assignment = allAssignments.find(a => a.id === aId);
      if (!assignment) { skipped++; continue; }
      const worker = await storage.getWorker(assignment.workerId);
      if (!worker) { skipped++; continue; }
      if (worker.status !== "Temp") { skipped++; continue; }
      if (!worker.personalEmail) { noEmail.push(worker.name); skipped++; continue; }

      const firstName = worker.name.split(" ")[0];
      console.log(`[NOTIFY-TEMP] Would send email to ${worker.personalEmail}: Project Assignment — ${project.name} for ${firstName}`);
      sent++;
    }

    res.json({ sent, skipped, noEmail });
  });

  // ===== ASSIGNMENT CONFIRMATION =====

  app.post("/api/assignments/:id/manual-confirm", requireRole("admin", "resource_manager", "project_manager"), async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    const allAssignments = await storage.getAssignments();
    const assignment = allAssignments.find(a => a.id === id);
    if (!assignment) return res.status(404).json({ error: "Assignment not found" });
    if (assignment.status === "confirmed") return res.json({ ok: true, message: "Already confirmed" });

    const now = new Date().toISOString();
    await storage.updateAssignment(id, { status: "confirmed", confirmedAt: now });
    await logAudit(req.user!.id, "assignment.manual_confirm", "assignment", id, `Manual confirmation by ${req.user!.name}`);
    res.json({ ok: true });
  });

  app.post("/api/assignments/:id/send-confirmation", requireRole("admin", "resource_manager", "project_manager"), async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    const allAssignments = await storage.getAssignments();
    const assignment = allAssignments.find(a => a.id === id);
    if (!assignment) return res.status(404).json({ error: "Assignment not found" });

    const worker = await storage.getWorker(assignment.workerId);
    if (!worker) return res.status(404).json({ error: "Worker not found" });
    if (worker.status !== "Temp") return res.status(400).json({ error: "Only Temp workers require confirmation" });

    const project = await storage.getProject(assignment.projectId);
    if (!project) return res.status(404).json({ error: "Project not found" });

    const token = crypto.randomUUID();
    const now = new Date().toISOString();
    await storage.updateAssignment(id, {
      confirmationToken: token,
      confirmationSentAt: now,
      status: "pending_confirmation",
    });

    const baseUrl = "https://pfg-platform.onrender.com";
    const confirmUrl = `${baseUrl}/#/confirm/${token}`;
    const declineUrl = `${baseUrl}/#/confirm/${token}`;

    const recipientEmail = worker.personalEmail || worker.workEmail;
    if (recipientEmail) {
      const tmpl = confirmationEmail(
        worker.name,
        project.name,
        assignment.role || worker.role,
        assignment.shift || project.shift || "Day",
        assignment.startDate || project.startDate || "",
        assignment.endDate || project.endDate || "",
        project.location || project.siteName || "",
        confirmUrl,
        declineUrl,
      );
      sendMail({ to: recipientEmail, subject: tmpl.subject, html: tmpl.html, text: tmpl.text })
        .catch(err => console.error("[email] Confirmation send error:", err));
    }

    await logAudit(req.user!.id, "assignment.send_confirmation", "assignment", id, worker.name);
    res.json({ ok: true, token });
  });

  app.post("/api/projects/:id/send-all-confirmations", requireRole("admin", "resource_manager", "project_manager"), async (req: Request, res: Response) => {
    const projectId = parseInt(req.params.id);
    const project = await storage.getProject(projectId);
    if (!project) return res.status(404).json({ error: "Project not found" });

    const allAssignments = await storage.getAssignments();
    const projectAssignments = allAssignments.filter(
      a => a.projectId === projectId && (a.status === "active" || a.status === "pending_confirmation")
    );

    const allWorkers = await storage.getWorkers();
    const workerMap = Object.fromEntries(allWorkers.map(w => [w.id, w]));

    let sent = 0;
    let skipped = 0;

    for (const assignment of projectAssignments) {
      const worker = workerMap[assignment.workerId];
      if (!worker || worker.status !== "Temp") { skipped++; continue; }
      if (assignment.confirmedAt || assignment.declinedAt) { skipped++; continue; }

      const token = crypto.randomUUID();
      const now = new Date().toISOString();
      await storage.updateAssignment(assignment.id, {
        confirmationToken: token,
        confirmationSentAt: now,
        status: "pending_confirmation",
      });

      const baseUrl = "https://pfg-platform.onrender.com";
      const confirmUrl = `${baseUrl}/#/confirm/${token}`;
      const declineUrl = `${baseUrl}/#/confirm/${token}`;

      const recipientEmail = worker.personalEmail || worker.workEmail;
      if (recipientEmail) {
        const tmpl = confirmationEmail(
          worker.name,
          project.name,
          assignment.role || worker.role,
          assignment.shift || project.shift || "Day",
          assignment.startDate || project.startDate || "",
          assignment.endDate || project.endDate || "",
          project.location || project.siteName || "",
          confirmUrl,
          declineUrl,
        );
        sendMail({ to: recipientEmail, subject: tmpl.subject, html: tmpl.html, text: tmpl.text })
          .catch(err => console.error("[email] Confirmation send error:", err));
      }

      sent++;
    }

    await logAudit(req.user!.id, "assignment.send_all_confirmations", "project", projectId, project.name, { sent, skipped });
    res.json({ sent, skipped });
  });

  // ===== NOTIFICATIONS (extension) =====
  app.post("/api/notifications/extension", async (req: Request, res: Response) => {
    const { projectId, changeDescription, changedBy } = req.body;
    if (!projectId || !changeDescription) {
      return res.status(400).json({ error: "projectId and changeDescription required" });
    }
    const project = await storage.getProject(projectId);
    if (!project) return res.status(404).json({ error: "Project not found" });

    // Get all resource managers
    const allUsers = await storage.getUsers();
    const rms = allUsers.filter(u => u.role === "resource_manager" && u.isActive);

    for (const rm of rms) {
      console.log(`[EXTENSION-NOTIFY] Would send to ${rm.email}: Schedule change on ${project.name} — ${changedBy || "A user"} has made the following change: ${changeDescription}`);
    }

    res.json({ notified: rms.length });
  });

  // ===== ASSIGNMENTS =====
  app.get("/api/assignments", async (_req: Request, res: Response) => {
    res.json(await storage.getAssignments());
  });

  app.post("/api/assignments", requireRole("admin", "resource_manager", "project_manager"), async (req: Request, res: Response) => {
    const parsed = insertAssignmentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error });
    const assignment = await storage.createAssignment(parsed.data);
    await logAudit(req.user!.id, "assignment.create", "assignment", assignment.id);
    // Trigger timesheet auto-build if project already has config
    if (assignment.projectId) {
      setImmediate(() => {
        buildTimesheetEntries(assignment.projectId!).catch(e =>
          console.error("[timesheet] assignment-hook rebuild error:", e.message)
        );
      });
    }
    res.status(201).json(assignment);
  });

  app.patch("/api/assignments/:id", requireRole("admin", "resource_manager", "project_manager"), async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    const assignment = await storage.updateAssignment(id, req.body);
    if (!assignment) return res.status(404).json({ error: "Assignment not found" });
    await logAudit(req.user!.id, "assignment.update", "assignment", id);

    // ── Recalculate project end date = latest end date across all role slots ──
    if (req.body.endDate !== undefined && assignment.projectId) {
      const allSlots = await storage.getRoleSlotsByProject(assignment.projectId);
      const latestEnd = allSlots
        .map(s => s.endDate)
        .filter(Boolean)
        .sort()
        .pop();
      if (latestEnd) {
        const project = await storage.getProject(assignment.projectId);
        if (project && project.endDate !== latestEnd) {
          await storage.updateProject(assignment.projectId, { endDate: latestEnd });
          console.log(`[EXTENSION] Project ${project.code} end date recalculated to ${latestEnd}`);
        }
      }
    }

    res.json(assignment);
  });

  app.delete("/api/assignments/:id", async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    await storage.deleteAssignment(id);
    await logAudit(req.user!.id, "assignment.delete", "assignment", id);
    res.status(204).send();
  });

  // ===== ROLE SLOT PERIODS =====
  app.get("/api/role-slots/:roleSlotId/periods", requireAuth, async (req: Request, res: Response) => {
    const periods = await storage.getRoleSlotPeriods(parseInt(req.params.roleSlotId));
    res.json(periods);
  });

  app.post("/api/role-slots/:roleSlotId/periods", requireAuth, requireRole("admin", "resource_manager", "project_manager"), async (req: Request, res: Response) => {
    const roleSlotId = parseInt(req.params.roleSlotId);
    const { startDate, endDate, periodType, notes } = req.body;
    if (!startDate || !endDate) return res.status(400).json({ error: "startDate and endDate required" });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate))
      return res.status(400).json({ error: "Dates must be YYYY-MM-DD" });
    if (startDate > endDate) return res.status(400).json({ error: "startDate must be before endDate" });

    const existingPeriods = await storage.getRoleSlotPeriods(roleSlotId);
    if (existingPeriods.length === 0) return res.status(404).json({ error: "Role slot not found or has no initial period" });
    const projectId = existingPeriods[0].projectId;

    // No overlap within same slot
    const selfOverlap = existingPeriods.find(p => p.startDate <= endDate && p.endDate >= startDate);
    if (selfOverlap) {
      return res.status(409).json({ error: `Overlaps with existing period ${selfOverlap.startDate} – ${selfOverlap.endDate} on this slot` });
    }

    const period = await storage.createRoleSlotPeriod({
      roleSlotId,
      projectId,
      startDate,
      endDate,
      periodType: periodType || "remob",
      notes: notes || null,
    });
    await logAudit(req.user!.id, "role_slot_period.create", "role_slot_period", period.id);
    res.status(201).json(period);
  });

  app.patch("/api/role-slot-periods/:id", requireAuth, requireRole("admin", "resource_manager", "project_manager"), async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    const { startDate, endDate, periodType, notes } = req.body;
    if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return res.status(400).json({ error: "startDate must be YYYY-MM-DD" });
    if (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return res.status(400).json({ error: "endDate must be YYYY-MM-DD" });
    const period = await storage.updateRoleSlotPeriod(id, { startDate, endDate, periodType, notes });
    if (!period) return res.status(404).json({ error: "Period not found" });
    await logAudit(req.user!.id, "role_slot_period.update", "role_slot_period", id);
    res.json(period);
  });

  app.delete("/api/role-slot-periods/:id", requireAuth, requireRole("admin", "resource_manager", "project_manager"), async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    const existing = await storage.getAllRoleSlotPeriods();
    const period = existing.find(p => p.id === id);
    if (period) {
      const slotPeriods = existing.filter(p => p.roleSlotId === period.roleSlotId);
      if (slotPeriods.length <= 1) return res.status(400).json({ error: "Cannot delete the last period. Edit the role slot instead." });
    }
    await storage.deleteRoleSlotPeriod(id);
    await logAudit(req.user!.id, "role_slot_period.delete", "role_slot_period", id);
    res.status(204).send();
  });

  // ===== DOCUMENTS =====
  app.get("/api/workers/:workerId/documents", async (req: Request, res: Response) => {
    const docs = await storage.getDocumentsByWorker(parseInt(req.params.workerId));
    res.json(docs);
  });

  app.post("/api/documents", async (req: Request, res: Response) => {
    const parsed = insertDocumentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error });
    const doc = await storage.createDocument(parsed.data);
    res.status(201).json(doc);
  });

  app.patch("/api/documents/:id", requireRole("admin", "resource_manager", "project_manager"), async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    const updated = await storage.updateDocument(id, req.body);
    if (!updated) return res.status(404).json({ error: 'Document not found' });
    res.json(updated);
  });

  app.delete("/api/documents/:id", requireRole("admin", "resource_manager", "project_manager"), async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    const doc = await storage.getDocumentById(id);
    if (doc?.filePath) {
      // filePath is like /api/uploads/33/filename.pdf — strip prefix to get disk path
      const relPath = doc.filePath.replace(/^\/api\/uploads\//, '');
      const diskPath = path.join(UPLOAD_BASE, relPath);
      if (fs.existsSync(diskPath)) {
        try { fs.unlinkSync(diskPath); } catch(e) { console.error('[delete doc] unlink error:', e); }
      }
    }
    await storage.deleteDocument(id);
    res.status(204).send();
  });

  // Upsert a certificate/document for a worker (insert or update by workerId + type)
  app.put("/api/workers/:workerId/documents", async (req: Request, res: Response) => {
    const workerId = parseInt(req.params.workerId);
    const { type, name, issuedDate, expiryDate, filePath, fileName, mimeType, fileSize } = req.body;
    if (!type || !name) return res.status(400).json({ error: "type and name required" });
    const doc = await storage.upsertDocument(workerId, type, name, {
      issuedDate: issuedDate || null,
      expiryDate: expiryDate || null,
      filePath: filePath || null,
      fileName: fileName || null,
      mimeType: mimeType || null,
      fileSize: fileSize || null,
      status: "valid",
    });
    res.json(doc);
  });

  // ===== ROLE SLOTS =====
  app.get("/api/projects/:projectId/role-slots", async (req: Request, res: Response) => {
    const slots = await storage.getRoleSlotsByProject(parseInt(req.params.projectId));
    res.json(slots);
  });

  app.post("/api/role-slots", async (req: Request, res: Response) => {
    const parsed = insertRoleSlotSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error });
    const slot = await storage.createRoleSlot(parsed.data);
    await logAudit(req.user!.id, "role_slot.create", "role_slot", slot.id);
    res.status(201).json(slot);
  });

  app.patch("/api/role-slots/:id", async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    const slot = await storage.updateRoleSlot(id, req.body);
    if (!slot) return res.status(404).json({ error: "Role slot not found" });
    await logAudit(req.user!.id, "role_slot.update", "role_slot", id);

    // ── Recalculate project end date = latest end date across all role slots ──
    if (req.body.endDate !== undefined && slot.projectId) {
      const allSlots = await storage.getRoleSlotsByProject(slot.projectId);
      const latestEnd = allSlots
        .map(s => s.endDate)
        .filter(Boolean)
        .sort()
        .pop();
      if (latestEnd) {
        const project = await storage.getProject(slot.projectId);
        if (project && project.endDate !== latestEnd) {
          await storage.updateProject(slot.projectId, { endDate: latestEnd });
          console.log(`[EXTENSION] Project ${project.code} end date recalculated to ${latestEnd}`);
        }
      }
    }

    res.json(slot);
  });

  app.delete("/api/role-slots/:id", async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    await storage.deleteRoleSlot(id);
    await logAudit(req.user!.id, "role_slot.delete", "role_slot", id);
    res.status(204).send();
  });

  // ===== OEM TYPES =====
  app.get("/api/oem-types", async (_req: Request, res: Response) => {
    res.json(await storage.getOemTypes());
  });

  app.post("/api/oem-types", async (req: Request, res: Response) => {
    const parsed = insertOemTypeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error });
    const oemType = await storage.createOemType(parsed.data);
    res.status(201).json(oemType);
  });

  // ===== PAYROLL RULES =====
  app.get("/api/payroll-rules", async (_req: Request, res: Response) => {
    res.json(await storage.getPayrollRules());
  });

  app.put("/api/payroll-rules", async (req: Request, res: Response) => {
    const parsed = insertPayrollRulesSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error });
    const rule = await storage.upsertPayrollRule(parsed.data);
    res.json(rule);
  });

  app.delete("/api/payroll-rules/:id", async (req: Request, res: Response) => {
    await storage.deletePayrollRule(Number(req.params.id));
    res.json({ ok: true });
  });

  // ===== WORK PACKAGES =====
  app.get("/api/projects/:projectId/work-packages", requireAuth, async (req: Request, res: Response) => {
    const projectId = parseInt(req.params.projectId);
    const wps = await storage.getWorkPackages(projectId);
    res.json(wps);
  });

  app.post("/api/projects/:projectId/work-packages", requireAuth, requireRole("admin", "resource_manager", "project_manager"), async (req: Request, res: Response) => {
    const projectId = parseInt(req.params.projectId);
    const wp = await storage.createWorkPackage({ ...req.body, projectId });
    await logAudit(req.user!.id, "work_package.create", "work_package", wp.id, wp.name);
    res.status(201).json(wp);
  });

  app.patch("/api/work-packages/:id", requireAuth, requireRole("admin", "resource_manager", "project_manager"), async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    const wp = await storage.updateWorkPackage(id, req.body);
    if (!wp) return res.status(404).json({ error: "Work package not found" });
    await logAudit(req.user!.id, "work_package.update", "work_package", id, wp.name);
    res.json(wp);
  });

  app.delete("/api/work-packages/:id", requireAuth, requireRole("admin", "resource_manager", "project_manager"), async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    await storage.deleteWorkPackage(id);
    await logAudit(req.user!.id, "work_package.delete", "work_package", id);
    res.status(204).send();
  });

  // ===== DAILY REPORTS =====
  app.get("/api/projects/:projectId/daily-reports", requireAuth, async (req: Request, res: Response) => {
    const projectId = parseInt(req.params.projectId);
    const reports = await storage.getDailyReports(projectId);
    res.json(reports);
  });

  app.get("/api/projects/:projectId/daily-reports/:date", requireAuth, async (req: Request, res: Response) => {
    const projectId = parseInt(req.params.projectId);
    const { date } = req.params;
    const report = await storage.getDailyReport(projectId, date);
    if (!report) return res.status(404).json({ error: "Report not found" });
    res.json(report);
  });

  app.post("/api/projects/:projectId/daily-reports", requireAuth, requireRole("admin", "resource_manager", "project_manager"), async (req: Request, res: Response) => {
    const projectId = parseInt(req.params.projectId);
    const report = await storage.createDailyReport({ ...req.body, projectId, createdBy: req.user!.id });
    await logAudit(req.user!.id, "daily_report.create", "daily_report", report.id, report.reportDate);
    res.status(201).json(report);
  });

  app.patch("/api/daily-reports/:id", requireAuth, requireRole("admin", "resource_manager", "project_manager"), async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    const report = await storage.updateDailyReport(id, req.body);
    if (!report) return res.status(404).json({ error: "Report not found" });
    await logAudit(req.user!.id, "daily_report.update", "daily_report", id, report.reportDate);
    res.json(report);
  });

  app.get("/api/daily-reports/:id/wp-progress", requireAuth, async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    const progress = await storage.getWpProgress(id);
    res.json(progress);
  });

  app.put("/api/daily-reports/:id/wp-progress", requireAuth, requireRole("admin", "resource_manager", "project_manager"), async (req: Request, res: Response) => {
    const reportId = parseInt(req.params.id);
    const items: Array<{ wpId: number; actualStart?: string; actualFinish?: string; signOffStatus?: string; comments?: string }> = req.body;
    if (!Array.isArray(items)) return res.status(400).json({ error: "Body must be an array" });
    const results = await Promise.all(
      items.map(item =>
        storage.upsertWpProgress(reportId, item.wpId, {
          actualStart: item.actualStart,
          actualFinish: item.actualFinish,
          signOffStatus: item.signOffStatus,
          comments: item.comments,
        })
      )
    );
    res.json(results);
  });

  // ===== COMMENTS LOG =====
  app.get("/api/projects/:projectId/comments-log", requireAuth, async (req: Request, res: Response) => {
    const projectId = parseInt(req.params.projectId);
    const log = await storage.getCommentsLog(projectId);
    const allUsers = await storage.getUsers();
    const enriched = log.map(entry => {
      const u = allUsers.find(u => u.id === entry.enteredBy);
      return { ...entry, user: u ? u.name : "Unknown" };
    });
    res.json(enriched);
  });

  app.post("/api/projects/:projectId/comments-log", requireAuth, requireRole("admin", "resource_manager", "project_manager"), async (req: Request, res: Response) => {
    const projectId = parseInt(req.params.projectId);
    const { entry, reportId, logDate } = req.body;
    if (!entry) return res.status(400).json({ error: "entry required" });
    const logEntry = await storage.createCommentsLogEntry({
      projectId,
      entry,
      enteredBy: req.user!.id,
      reportId: reportId || null,
      logDate: logDate || new Date().toISOString().slice(0, 10),
    });
    res.status(201).json(logEntry);
  });

  // ===== DELAY APPROVALS =====
  // Public routes — no auth required
  app.get("/api/delay-approval/:token", async (req: Request, res: Response) => {
    const approval = await storage.getDelayApprovalByToken(req.params.token);
    if (!approval) return res.status(404).json({ error: "Approval not found" });
    if (approval.status !== "pending") return res.json({ approval, alreadyResponded: true });
    if (new Date() > approval.tokenExpiry) {
      await storage.updateDelayApproval(approval.id, { status: "expired" });
      return res.json({ approval: { ...approval, status: "expired" }, expired: true });
    }
    res.json({ approval });
  });

  app.post("/api/delay-approval/:token/respond", async (req: Request, res: Response) => {
    const { action } = req.body;
    if (!action || !["approved", "rejected"].includes(action)) {
      return res.status(400).json({ error: "action must be 'approved' or 'rejected'" });
    }
    const approval = await storage.getDelayApprovalByToken(req.params.token);
    if (!approval) return res.status(404).json({ error: "Approval not found" });
    if (approval.status !== "pending") return res.status(409).json({ error: "Already responded" });
    if (new Date() > approval.tokenExpiry) {
      await storage.updateDelayApproval(approval.id, { status: "expired" });
      return res.status(410).json({ error: "Token expired" });
    }
    const updated = await storage.updateDelayApproval(approval.id, {
      status: action as "approved" | "rejected",
      respondedAt: new Date(),
      respondedIp: req.ip || null,
    });
    res.json({ ok: true, approval: updated });
  });

  // Authenticated: send delay approval email
  app.post("/api/daily-reports/:id/send-delay-approval", requireAuth, requireRole("admin", "resource_manager", "project_manager"), async (req: Request, res: Response) => {
    const reportId = parseInt(req.params.id);
    const { delayIndex, recipientEmail, recipientName } = req.body;
    if (delayIndex === undefined || !recipientEmail) {
      return res.status(400).json({ error: "delayIndex and recipientEmail required" });
    }
    const report = await storage.updateDailyReport(reportId, {}); // fetch via update trick
    // Re-fetch cleanly:
    const reports = await storage.getDailyReports(0); // not ideal; use direct fetch
    // Get the actual report by ID
    const allFields = await storage.updateDailyReport(reportId, {});
    if (!allFields) return res.status(404).json({ error: "Report not found" });

    const token = crypto.randomUUID();
    const tokenExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    const approval = await storage.createDelayApproval({
      projectId: allFields.projectId,
      reportId,
      delayIndex,
      token,
      tokenExpiry,
      recipientEmail,
      recipientName: recipientName || null,
      status: "pending",
      respondedAt: null,
      respondedIp: null,
    });

    const approvalUrl = `${process.env.APP_URL || "https://pfg-platform.onrender.com"}/#/delay-approval/${token}`;
    await sendMail({
      to: recipientEmail,
      subject: `Delay Approval Request — Project Report`,
      html: `
        <p>Dear ${recipientName || "Customer"},</p>
        <p>A delay has been logged on your project and requires your approval.</p>
        <p><a href="${approvalUrl}" style="background:#F5BD00;color:#1A1D23;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:700;">Review &amp; Respond</a></p>
        <p>This link expires in 7 days.</p>
        <p>Powerforce Global</p>
      `,
      text: `Dear ${recipientName || "Customer"},\n\nA delay has been logged on your project and requires your approval.\n\nReview and respond here: ${approvalUrl}\n\nThis link expires in 7 days.\n\nPowerforce Global`,
    });

    res.status(201).json({ approval });
  });

  // ===== SUPERVISOR REPORTS =====

  // Multer config for project-scoped uploads
  const projectUpload = multer({
    storage: multer.diskStorage({
      destination: (req, _file, cb) => {
        const projectId = req.params.projectId || req.params.id || "0";
        const subDir = req.path.includes("toolbox") || req.path.includes("safety") || req.path.includes("incident") ? "qhse" : "supervisor";
        const dir = path.join(UPLOAD_BASE, projectId, subDir);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname) || ".bin";
        const ts = Date.now();
        const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 40);
        cb(null, `${ts}_${base}${ext}`);
      },
    }),
    limits: { fileSize: 25 * 1024 * 1024 },
  });

  app.get("/api/projects/:projectId/supervisor-reports", requireAuth, async (req: Request, res: Response) => {
    const projectId = parseInt(req.params.projectId);
    const reports = await storage.getSupervisorReports(projectId);
    res.json(reports);
  });

  app.get("/api/supervisor-reports/pending", requireAuth, requireRole("admin", "resource_manager", "project_manager"), async (_req: Request, res: Response) => {
    const reports = await storage.getPendingSupervisorReports();
    res.json(reports);
  });

  app.post("/api/projects/:projectId/supervisor-reports/upload", requireAuth, requireRole("admin", "resource_manager", "project_manager"), projectUpload.single("file"), async (req: any, res: Response) => {
    const projectId = parseInt(req.params.projectId);
    const { date, shift, workerId } = req.body;
    if (!date) return res.status(400).json({ error: "date required" });

    let uploadedFilePath = req.file?.path || null;
    let uploadedFileName = req.file?.originalname || null;
    let storedFilename = req.file?.filename || null;

    // If an image was uploaded, convert it to PDF automatically
    if (req.file && isImageFile(req.file.mimetype, req.file.originalname)) {
      try {
        const pdfPath = await imageToPdf(uploadedFilePath!);
        // Remove the original image file
        if (fs.existsSync(uploadedFilePath!)) fs.unlinkSync(uploadedFilePath!);
        uploadedFilePath = pdfPath;
        storedFilename = path.basename(pdfPath);
        // Rename the original filename to .pdf for display
        uploadedFileName = (uploadedFileName?.replace(/\.[^.]+$/, "") || "report") + ".pdf";
      } catch (err: any) {
        console.error("[supervisor-upload] Image-to-PDF conversion failed:", err.message);
        // Fall through — store the original image if conversion fails
      }
    }

    const filePath = uploadedFilePath ? `/api/uploads/${projectId}/supervisor/${storedFilename}` : null;
    const report = await storage.createSupervisorReport({
      projectId,
      workerId: workerId ? parseInt(workerId) : null,
      reportDate: date,
      shift: shift || null,
      submissionMethod: "upload",
      filePath,
      fileName: uploadedFileName,
      documentType: "supervisor_report",
      status: workerId ? "filed" : "pending_assignment",
      pendingAssignmentNote: workerId ? null : "Worker not specified — needs assignment",
      senderEmail: null,
    });
    await logAudit(req.user!.id, "supervisor_report.upload", "supervisor_report", report.id);
    res.status(201).json(report);
  });

  app.patch("/api/supervisor-reports/:id", requireAuth, requireRole("admin", "resource_manager", "project_manager"), async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    const { workerId, reportDate, shift } = req.body;

    // Validate — only whitelist safe fields, never allow projectId/filePath/fileName changes
    if (reportDate && !/^\d{4}-\d{2}-\d{2}$/.test(reportDate))
      return res.status(400).json({ error: "reportDate must be YYYY-MM-DD" });
    if (shift && !["Day", "Night"].includes(shift))
      return res.status(400).json({ error: "shift must be Day or Night" });
    if (workerId !== undefined) {
      const worker = await storage.getWorker(workerId);
      if (!worker) return res.status(400).json({ error: "Worker not found" });
    }

    const payload: Record<string, any> = {};
    if (reportDate !== undefined) payload.reportDate = reportDate;
    if (shift !== undefined) payload.shift = shift;
    if (workerId !== undefined) payload.workerId = workerId;
    // If assigning a worker, mark as filed
    if (workerId !== undefined) payload.status = "filed";

    const report = await storage.updateSupervisorReport(id, payload);
    if (!report) return res.status(404).json({ error: "Supervisor report not found" });
    await logAudit(req.user!.id, "supervisor_report.update", "supervisor_report", id);
    res.json(report);
  });

  app.get("/api/supervisor-reports/:id/replies", requireAuth, async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    const replies = await storage.getSupervisorReportReplies(id);
    res.json(replies);
  });

  app.post("/api/supervisor-reports/:id/replies", requireAuth, requireRole("admin", "resource_manager", "project_manager"), async (req: Request, res: Response) => {
    const reportId = parseInt(req.params.id);
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "message required" });
    const reply = await storage.createSupervisorReportReply({
      reportId,
      authorId: req.user!.id,
      message,
    });
    // Optionally email supervisor if report has a workerId
    const report = await storage.getSupervisorReports(0); // we need report by id — use workaround
    res.status(201).json(reply);
  });

  // ===== QHSE =====

  // Toolbox Talks
  app.get("/api/projects/:projectId/toolbox-talks", requireAuth, async (req: Request, res: Response) => {
    const projectId = parseInt(req.params.projectId);
    const talks = await storage.getToolboxTalks(projectId);
    res.json(talks);
  });

  app.post("/api/projects/:projectId/toolbox-talks/upload", requireAuth, requireRole("admin", "resource_manager", "project_manager"), projectUpload.single("file"), async (req: any, res: Response) => {
    const projectId = parseInt(req.params.projectId);
    const { date, shift, workerId, topic, attendeeCount, notes } = req.body;
    if (!date) return res.status(400).json({ error: "date required" });
    const filePath = req.file ? `/api/uploads/${projectId}/qhse/${req.file.filename}` : null;
    const talk = await storage.createToolboxTalk({
      projectId,
      workerId: workerId ? parseInt(workerId) : null,
      reportDate: date,
      shift: shift || null,
      topic: topic || null,
      attendeeCount: attendeeCount ? parseInt(attendeeCount) : null,
      filePath,
      fileName: req.file?.originalname || null,
      notes: notes || null,
      submissionMethod: "upload",
    });
    await logAudit(req.user!.id, "toolbox_talk.upload", "toolbox_talk", talk.id);
    res.status(201).json(talk);
  });

  app.patch("/api/toolbox-talks/:id", requireAuth, requireRole("admin", "resource_manager", "project_manager"), async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    const talk = await storage.updateToolboxTalk(id, req.body);
    if (!talk) return res.status(404).json({ error: "Toolbox talk not found" });
    await logAudit(req.user!.id, "toolbox_talk.update", "toolbox_talk", id);
    res.json(talk);
  });

  app.delete("/api/toolbox-talks/:id", requireAuth, requireRole("admin", "resource_manager", "project_manager"), async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    await storage.deleteToolboxTalk(id);
    await logAudit(req.user!.id, "toolbox_talk.delete", "toolbox_talk", id);
    res.status(204).send();
  });

  // Safety Observations
  app.get("/api/projects/:projectId/safety-observations", requireAuth, async (req: Request, res: Response) => {
    const projectId = parseInt(req.params.projectId);
    const obs = await storage.getSafetyObservations(projectId);
    res.json(obs);
  });

  app.post("/api/projects/:projectId/safety-observations", requireAuth, requireRole("admin", "resource_manager", "project_manager"), projectUpload.single("file"), async (req: any, res: Response) => {
    const projectId = parseInt(req.params.projectId);
    const filePath = req.file ? `/api/uploads/${projectId}/qhse/${req.file.filename}` : null;
    const body = req.body;
    if (!body.observationDate || !body.observationType) {
      return res.status(400).json({ error: "observationDate and observationType required" });
    }
    const obs = await storage.createSafetyObservation({
      projectId,
      reportedByWorkerId: body.reportedByWorkerId ? parseInt(body.reportedByWorkerId) : null,
      relatesToWorkerIds: body.relatesToWorkerIds || [],
      shiftSupervisorId: body.shiftSupervisorId ? parseInt(body.shiftSupervisorId) : null,
      observationDate: body.observationDate,
      observationTime: body.observationTime || null,
      shift: body.shift || null,
      observationType: body.observationType,
      locationOnSite: body.locationOnSite || null,
      description: body.description || null,
      actionsTaken: body.actionsTaken || null,
      filePath,
      fileName: req.file?.originalname || null,
      status: "open",
      submissionMethod: "upload",
    });

    // Alert PM and admins for STOP WORK observations
    if (obs.observationType === "stop_work") {
      const admins = await storage.getUsers();
      const alertRecipients = admins
        .filter(u => u.isActive && (u.role === "admin" || u.role === "project_manager"))
        .map(u => u.email);
      if (alertRecipients.length > 0) {
        await sendMail({
          to: alertRecipients,
          subject: `⚠️ STOP WORK Observation — Project ${projectId}`,
          html: `<p>A STOP WORK safety observation has been filed for project ${projectId}.</p><p>Description: ${obs.description || "N/A"}</p><p>Please review immediately.</p>`,
          text: `STOP WORK safety observation filed for project ${projectId}.\nDescription: ${obs.description || "N/A"}\nPlease review immediately.`,
        });
      }
    }

    await logAudit(req.user!.id, "safety_observation.create", "safety_observation", obs.id);
    res.status(201).json(obs);
  });

  app.patch("/api/safety-observations/:id", requireAuth, requireRole("admin", "resource_manager", "project_manager"), async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    const obs = await storage.updateSafetyObservation(id, req.body);
    if (!obs) return res.status(404).json({ error: "Safety observation not found" });
    await logAudit(req.user!.id, "safety_observation.update", "safety_observation", id);
    res.json(obs);
  });

  // Incident Reports
  app.get("/api/projects/:projectId/incident-reports", requireAuth, async (req: Request, res: Response) => {
    const projectId = parseInt(req.params.projectId);
    const incidents = await storage.getIncidentReports(projectId);
    res.json(incidents);
  });

  app.post("/api/projects/:projectId/incident-reports", requireAuth, requireRole("admin", "resource_manager", "project_manager"), projectUpload.single("file"), async (req: any, res: Response) => {
    const projectId = parseInt(req.params.projectId);
    const filePath = req.file ? `/api/uploads/${projectId}/qhse/${req.file.filename}` : null;
    const body = req.body;
    if (!body.incidentDate || !body.incidentType) {
      return res.status(400).json({ error: "incidentDate and incidentType required" });
    }
    const incident = await storage.createIncidentReport({
      projectId,
      workerInvolvedId: body.workerInvolvedId ? parseInt(body.workerInvolvedId) : null,
      reportedByWorkerId: body.reportedByWorkerId ? parseInt(body.reportedByWorkerId) : null,
      shiftSupervisorId: body.shiftSupervisorId ? parseInt(body.shiftSupervisorId) : null,
      incidentDate: body.incidentDate,
      incidentTime: body.incidentTime || null,
      shift: body.shift || null,
      incidentType: body.incidentType,
      description: body.description || null,
      lostTime: body.lostTime === true || body.lostTime === "true",
      lostTimeHours: body.lostTimeHours ? parseFloat(body.lostTimeHours) : null,
      actionsTaken: body.actionsTaken || null,
      rootCause: body.rootCause || null,
      filePath,
      fileName: req.file?.originalname || null,
      status: "open",
      submissionMethod: "upload",
    });

    // Alert PM and admins for LTI incidents
    if (incident.incidentType === "lost_time_injury" || incident.lostTime) {
      const admins = await storage.getUsers();
      const alertRecipients = admins
        .filter(u => u.isActive && (u.role === "admin" || u.role === "project_manager"))
        .map(u => u.email);
      if (alertRecipients.length > 0) {
        await sendMail({
          to: alertRecipients,
          subject: `🚨 LTI Alert — Lost Time Injury — Project ${projectId}`,
          html: `<p>A Lost Time Injury (LTI) has been reported for project ${projectId}.</p><p>Incident type: ${incident.incidentType}</p><p>Description: ${incident.description || "N/A"}</p><p>Please review immediately.</p>`,
          text: `LTI ALERT: Lost Time Injury reported for project ${projectId}.\nIncident type: ${incident.incidentType}\nDescription: ${incident.description || "N/A"}\nPlease review immediately.`,
        });
      }
    }

    await logAudit(req.user!.id, "incident_report.create", "incident_report", incident.id);
    res.status(201).json(incident);
  });

  app.patch("/api/incident-reports/:id", requireAuth, requireRole("admin", "resource_manager", "project_manager"), async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    const incident = await storage.updateIncidentReport(id, req.body);
    if (!incident) return res.status(404).json({ error: "Incident report not found" });
    await logAudit(req.user!.id, "incident_report.update", "incident_report", id);
    res.json(incident);
  });

  // ===== MILESTONE CERTIFICATES =====
  app.get("/api/projects/:projectId/milestone-certificates", requireAuth, async (req: Request, res: Response) => {
    const projectId = parseInt(req.params.projectId);
    const certs = await storage.getMilestoneCertificates(projectId);
    res.json(certs);
  });

  app.post("/api/projects/:projectId/milestone-certificates", requireAuth, requireRole("admin", "resource_manager", "project_manager"), async (req: Request, res: Response) => {
    const projectId = parseInt(req.params.projectId);
    const cert = await storage.createMilestoneCertificate({
      ...req.body,
      projectId,
      createdBy: req.user!.id,
      status: "draft",
    });
    await logAudit(req.user!.id, "milestone_cert.create", "milestone_certificate", cert.id);
    res.status(201).json(cert);
  });

  app.patch("/api/milestone-certificates/:id", requireAuth, requireRole("admin", "resource_manager", "project_manager"), async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    const cert = await storage.updateMilestoneCertificate(id, req.body);
    if (!cert) return res.status(404).json({ error: "Milestone certificate not found" });
    await logAudit(req.user!.id, "milestone_cert.update", "milestone_certificate", id);
    res.json(cert);
  });

  app.post("/api/milestone-certificates/:id/send", requireAuth, requireRole("admin", "resource_manager", "project_manager"), async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    const { recipientEmail, recipientName } = req.body;
    if (!recipientEmail) return res.status(400).json({ error: "recipientEmail required" });

    const approvalToken = crypto.randomUUID();
    const approvalTokenExpiry = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14 days

    const cert = await storage.updateMilestoneCertificate(id, {
      status: "sent",
      approvalToken,
      approvalTokenExpiry,
      approverEmail: recipientEmail,
      approverName: recipientName || null,
      sentAt: new Date(),
    });
    if (!cert) return res.status(404).json({ error: "Milestone certificate not found" });

    const approvalUrl = `${process.env.APP_URL || "https://pfg-platform.onrender.com"}/#/milestone-approval/${approvalToken}`;
    await sendMail({
      to: recipientEmail,
      subject: `Milestone Certificate — Approval Required`,
      html: `
        <p>Dear ${recipientName || "Customer"},</p>
        <p>A milestone certificate has been submitted for your approval.</p>
        <p>Milestone: ${cert.milestoneNumber || id}</p>
        <p><a href="${approvalUrl}" style="background:#F5BD00;color:#1A1D23;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:700;">Review &amp; Approve</a></p>
        <p>This link expires in 14 days.</p>
        <p>Powerforce Global</p>
      `,
      text: `Dear ${recipientName || "Customer"},\n\nA milestone certificate has been submitted for your approval.\nMilestone: ${cert.milestoneNumber || id}\n\nReview and approve here: ${approvalUrl}\n\nThis link expires in 14 days.\n\nPowerforce Global`,
    });

    await logAudit(req.user!.id, "milestone_cert.send", "milestone_certificate", id);
    res.json({ ok: true, cert });
  });

  // Public milestone approval routes
  app.get("/api/milestone-approval/:token", async (req: Request, res: Response) => {
    const cert = await storage.getMilestoneCertificateByToken(req.params.token);
    if (!cert) return res.status(404).json({ error: "Certificate not found" });
    if (cert.status === "approved") return res.json({ cert, alreadyApproved: true });
    if (cert.approvalTokenExpiry && new Date() > cert.approvalTokenExpiry) {
      return res.json({ cert, expired: true });
    }
    res.json({ cert });
  });

  app.post("/api/milestone-approval/:token/approve", async (req: Request, res: Response) => {
    const cert = await storage.getMilestoneCertificateByToken(req.params.token);
    if (!cert) return res.status(404).json({ error: "Certificate not found" });
    if (cert.status === "approved") return res.status(409).json({ error: "Already approved" });
    if (cert.approvalTokenExpiry && new Date() > cert.approvalTokenExpiry) {
      return res.status(410).json({ error: "Approval link expired" });
    }
    const { approverName } = req.body;
    const updated = await storage.updateMilestoneCertificate(cert.id, {
      status: "approved",
      approvedAt: new Date(),
      approverIp: req.ip || null,
      approverName: approverName || cert.approverName,
    });
    res.json({ ok: true, cert: updated });
  });

  // Serve project-scoped uploads (supervisor / qhse subfolders)
  app.get("/api/uploads/:projectId/:subdir/:filename", (req: Request, res: Response) => {
    const { projectId, subdir, filename } = req.params;
    const filePath = path.join(UPLOAD_BASE, projectId, subdir, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File not found" });
    res.sendFile(path.resolve(filePath));
  });

  // ===== FILE UPLOADS =====
  app.post("/api/workers/:id/upload", upload.single("file"), async (req: any, res: Response) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const workerId = req.params.id;
    const fileType = req.body?.type || "file";
    let finalFilename = req.file.filename;

    // Rename cert files to: CleanWorkerName_CertType_YYYY.ext
    if (fileType.startsWith("cert_")) {
      try {
        const worker = await storage.getWorker(parseInt(workerId));
        if (worker) {
          const cleanWorkerName = worker.name.replace(/\s*\([^)]*\)\s*$/g, "").trim().replace(/\s+/g, "_");
          const certLabel = fileType.replace(/^cert_/, "").replace(/_/g, " ");
          const certClean = certLabel.replace(/[^a-zA-Z0-9 ]/g, "").replace(/\s+/g, "_");
          const expiryYear = req.body?.expiryDate ? req.body.expiryDate.substring(0, 4) : String(new Date().getFullYear());
          const ext = path.extname(req.file.originalname) || path.extname(req.file.filename) || ".pdf";
          const newFilename = `${cleanWorkerName}_${certClean}_${expiryYear}${ext}`;
          const oldPath = path.join(UPLOAD_BASE, workerId, req.file.filename);
          const newPath = path.join(UPLOAD_BASE, workerId, newFilename);
          if (fs.existsSync(oldPath)) {
            fs.renameSync(oldPath, newPath);
            finalFilename = newFilename;
          }
        }
      } catch (e) {
        console.error("File rename error:", e);
        // Keep original filename on error
      }
    }

    const filePath = `/api/uploads/${workerId}/${finalFilename}`;

    if (fileType === "photo") {
      await storage.updateWorker(parseInt(workerId), { profilePhotoPath: filePath });
    } else if (fileType === "passport") {
      await storage.updateWorker(parseInt(workerId), { passportPath: filePath });
    }

    res.json({ path: filePath, filename: finalFilename, type: fileType });
  });

  app.get("/api/uploads/:workerId/:filename", (req: Request, res: Response) => {
    const { workerId, filename } = req.params;
    const filePath = path.join(UPLOAD_BASE, workerId, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File not found" });
    res.sendFile(path.resolve(filePath));
  });

  // ===== AUDIT LOGS =====
  app.get("/api/audit-logs", requireRole("admin", "resource_manager", "observer"), async (req: Request, res: Response) => {
    const limit = parseInt(req.query.limit as string) || 50;
    const entityType = req.query.entityType as string;
    const entityId = req.query.entityId ? parseInt(req.query.entityId as string) : undefined;
    const logs = await storage.getAuditLogs({ entityType, entityId, limit });
    res.json(logs);
  });

  // ===== DASHBOARD SUMMARY =====
  app.get("/api/dashboard", async (req: Request, res: Response) => {
    const allWorkers = await storage.getWorkers();
    const allProjects = await storage.getProjects();
    const allAssignments = await storage.getAssignments();
    const allOemTypes = await storage.getOemTypes();

    // Load all role slot periods — attach to slots, not assignments
    let allSlotPeriods: any[] = [];
    try { allSlotPeriods = await storage.getAllRoleSlotPeriods(); } catch { allSlotPeriods = []; }
    const periodsBySlotDash: Record<number, any[]> = {};
    allSlotPeriods.forEach(p => {
      if (!periodsBySlotDash[p.roleSlotId]) periodsBySlotDash[p.roleSlotId] = [];
      periodsBySlotDash[p.roleSlotId].push(p);
    });

    const projectMap = Object.fromEntries(allProjects.map(p => [p.id, p]));
    const assignmentsByWorker: Record<number, any[]> = {};
    allAssignments.forEach(a => {
      if (!assignmentsByWorker[a.workerId]) assignmentsByWorker[a.workerId] = [];
      const proj = projectMap[a.projectId];
      assignmentsByWorker[a.workerId].push({
        ...a,
        projectCode: proj?.code || "",
        projectName: proj?.name || "",
        customer: proj?.customer || "",
        location: proj?.location || "",
        equipmentType: proj?.equipmentType || "",
        scopeOfWork: proj?.scopeOfWork || "",
        siteName: proj?.siteName || "",
      });
    });

    // Load documents for all workers
    const allDocuments = await Promise.all(allWorkers.map(w => storage.getDocumentsByWorker(w.id)));
    const documentsByWorker: Record<number, any[]> = {};
    allWorkers.forEach((w, i) => { documentsByWorker[w.id] = allDocuments[i]; });

    // Load OEM experience (relational) for all workers in one batch
    const allOemExpRelational = await Promise.all(allWorkers.map(w => storage.getOemExperience(w.id)));
    const oemExpByWorker: Record<number, any[]> = {};
    allWorkers.forEach((w, i) => { oemExpByWorker[w.id] = allOemExpRelational[i]; });

    const enrichedWorkers = allWorkers.map(w => ({
      ...w,
      oemExperience: w.oemExperience ? JSON.parse(w.oemExperience) : [],
      oemExperienceRelational: oemExpByWorker[w.id] || [],
      assignments: assignmentsByWorker[w.id] || [],
      documents: documentsByWorker[w.id] || [],
      // Phase 6 new fields (passed through directly from DB record)
      employmentType: (w as any).employmentType || null,
      profileSummary: (w as any).profileSummary || null,
      passportExpiry: (w as any).passportExpiry || null,
      passportNumber: (w as any).passportNumber || null,
      emergencyContactName: (w as any).emergencyContactName || null,
      emergencyContactPhone: (w as any).emergencyContactPhone || null,
      emergencyContactRelationship: (w as any).emergencyContactRelationship || null,
    }));

    const allRoleSlots: any[] = [];
    for (const p of allProjects) {
      const slots = await storage.getRoleSlotsByProject(p.id);
      slots.forEach(s => allRoleSlots.push({
        ...s,
        projectCode: p.code,
        projectName: p.name,
        periods: (periodsBySlotDash[s.id] || []).sort((a: any, b: any) => a.startDate.localeCompare(b.startDate)),
      }));
    }

    // Load project leads
    const projectLeadMap: Record<number, { id: number; name: string }> = {};
    for (const p of allProjects) {
      const lead = await storage.getProjectLead(p.id);
      if (lead) {
        const user = await storage.getUserById(lead.userId);
        if (user) projectLeadMap[p.id] = { id: user.id, name: user.name };
      }
    }

    const allUsers = await storage.getUsers();
    const usersPublic = allUsers.map(u => ({
      id: u.id, name: u.name, email: u.email,
      role: u.role, isActive: u.isActive
    }));

    res.json({
      workers: enrichedWorkers,
      projects: allProjects,
      assignments: allAssignments,
      roleSlots: allRoleSlots,
      oemTypes: allOemTypes,
      projectLeads: projectLeadMap,
      users: usersPublic,
    });
  });

  // ===== SURVEY (public routes — no auth) =====

  // GET /api/survey/token-data?token=xxx
  app.get("/api/survey/token-data", async (req: Request, res: Response) => {
    const token = req.query.token as string;
    if (!token) return res.status(400).json({ error: "Token required" });

    const surveyToken = await storage.getSurveyTokenByToken(token);
    if (!surveyToken) return res.status(404).json({ error: "Invalid or expired link" });
    if (surveyToken.expiresAt < new Date()) return res.status(404).json({ error: "Invalid or expired link" });
    if (surveyToken.usedAt) return res.status(410).json({ error: "This survey has already been completed" });

    // Mark as opened (no explicit 'opened' field — just proceed)
    // Fetch project, assignments, and lead
    const project = await storage.getProject(surveyToken.projectId);
    if (!project) return res.status(404).json({ error: "Project not found" });

    const projectAssignments = await storage.getAssignmentsByProject(surveyToken.projectId);

    // Build team roster
    const teamMembers: any[] = [];
    const FILLED = ["active", "confirmed", "pending_confirmation", "flagged"];
    const seenWorkerIds = new Set<number>();
    for (const a of projectAssignments) {
      if (FILLED.includes(a.status || "") && a.workerId && !seenWorkerIds.has(a.workerId)) {
        seenWorkerIds.add(a.workerId);
        const worker = await storage.getWorker(a.workerId);
        if (worker) {
          // Filter out parenthetical suffixes like (SP), (UK/IE), (PO) for initials
          const cleanName = worker.name.replace(/\s*\([^)]*\)/g, '').trim();
          const nameParts = cleanName.split(/\s+/).filter(p => p.length > 0);
          const initials = nameParts.length >= 2
            ? (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase()
            : cleanName.substring(0, 2).toUpperCase();
          teamMembers.push({
            id: worker.id,
            name: worker.name,
            initials,
            role: a.role || worker.role,
            shift: (a.shift || "day").toLowerCase(),
          });
        }
      }
    }

    // Get PM name from project_leads
    let projectManagerName = "";
    const lead = await storage.getProjectLead(surveyToken.projectId);
    if (lead) {
      const pmUser = await storage.getUserById(lead.userId);
      if (pmUser) projectManagerName = pmUser.name;
    }

    // Compute respondent initials
    const contactName = surveyToken.contactName || "";
    const nameParts = contactName.trim().split(/\s+/);
    const respondentInitials = nameParts.length >= 2
      ? (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase()
      : contactName.substring(0, 2).toUpperCase();

    return res.json({
      respondentName: surveyToken.contactName || "",
      respondentInitials,
      respondentRole: surveyToken.contactRole || "",
      respondentCompany: project.customer || "",
      projectName: project.name,
      projectCode: project.code,
      projectStartDate: project.startDate || null,
      projectEndDate: project.endDate || null,
      oem: project.customer || "",
      projectManager: projectManagerName,
      team: teamMembers,
    });
  });

  // POST /api/survey/submit
  app.post("/api/survey/submit", async (req: Request, res: Response) => {
    const { token, q1, q2, q3, q4, q5, q6, nps, openFeedback, individualFeedback } = req.body;
    if (!token) return res.status(400).json({ error: "Token required" });

    const surveyToken = await storage.getSurveyTokenByToken(token);
    if (!surveyToken) return res.status(404).json({ error: "Invalid or expired link" });
    if (surveyToken.expiresAt < new Date()) return res.status(404).json({ error: "Invalid or expired link" });
    if (surveyToken.usedAt) return res.status(410).json({ error: "This survey has already been completed" });

    // Compute average score
    const scores = [q1, q2, q3, q4, q5, q6].map(Number).filter(n => !isNaN(n));
    const averageScore = scores.length > 0
      ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
      : 0;

    // Save survey response
    const surveyResponse = await storage.createSurveyResponse({
      projectId: surveyToken.projectId,
      tokenId: surveyToken.id,
      contactEmail: surveyToken.contactEmail,
      contactName: surveyToken.contactName || null,
      submitterIp: req.ip || null,
      q1Planning: Number(q1),
      q2Quality: Number(q2),
      q3Hse: Number(q3),
      q4Supervision: Number(q4),
      q5Pm: Number(q5),
      q6Overall: Number(q6),
      averageScore,
      nps: Number(nps),
      openFeedback: openFeedback || null,
      individualFeedbackGiven: Array.isArray(individualFeedback) && individualFeedback.length > 0,
    });

    // Save individual feedback
    if (Array.isArray(individualFeedback)) {
      for (const fb of individualFeedback) {
        const workerId = parseInt(fb.workerId);
        if (!isNaN(workerId) && workerId > 0) {
          await storage.createSurveyIndividualFeedback({
            surveyResponseId: surveyResponse.id,
            workerId,
            comment: fb.comment || null,
          });
        }
      }
    }

    // Mark token as used
    await storage.updateSurveyToken(surveyToken.id, { usedAt: new Date() });

    return res.json({ ok: true, score: averageScore });
  });

  // ===== SURVEY (authenticated routes) =====

  // GET /api/projects/:projectId/survey — get survey results for a project
  app.get("/api/projects/:projectId/survey", requireAuth, requireRole("admin", "resource_manager", "project_manager", "finance"), async (req: Request, res: Response) => {
    const projectId = parseInt(req.params.projectId);
    if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project ID" });

    const tokens = await storage.getSurveyTokensByProject(projectId);
    const responses = await storage.getSurveyResponsesByProject(projectId);

    return res.json({ tokens, responses });
  });

  // POST /api/projects/:projectId/survey/send — send survey to project contacts
  app.post("/api/projects/:projectId/survey/send", requireAuth, requireRole("admin", "resource_manager", "project_manager"), async (req: Request, res: Response) => {
    const projectId = parseInt(req.params.projectId);
    if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project ID" });

    const project = await storage.getProject(projectId);
    if (!project) return res.status(404).json({ error: "Project not found" });

    const baseUrl = process.env.APP_URL || `https://pfg-platform.onrender.com`;
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14 days

    // Survey goes to PM and Site Manager only — not Sourcing Contact
    const contacts: { email: string; name: string; role: string }[] = [];
    if (project.customerProjectManagerEmail) {
      contacts.push({
        email: project.customerProjectManagerEmail,
        name: project.customerProjectManager || "Project Manager",
        role: "pm",
      });
    }
    if (project.siteManagerEmail) {
      contacts.push({
        email: project.siteManagerEmail,
        name: project.siteManager || "Site Manager",
        role: "site_manager",
      });
    }

    if (contacts.length === 0) {
      return res.status(400).json({ error: "No contact emails set on this project" });
    }

    // Resolve PM email — send survey from the assigned project manager
    const projectLead = await storage.getProjectLead(projectId);
    const pmUser = projectLead ? await storage.getUser(projectLead.userId) : null;
    const pmEmail = pmUser?.email?.endsWith('@powerforce.global') ? pmUser.email : undefined;

    const created: any[] = [];
    for (const contact of contacts) {
      const token = crypto.randomBytes(32).toString("hex");
      const surveyToken = await storage.createSurveyToken({
        projectId,
        contactEmail: contact.email,
        contactName: contact.name,
        contactRole: contact.role,
        token,
        expiresAt,
      });

      const surveyUrl = `${baseUrl}/survey?token=${token}`;
      const firstName = contact.name.split(" ")[0];

      const emailHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:'Inter',Arial,sans-serif;background:#f4f4f5;padding:40px 0;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
    <div style="background:#1A1D23;padding:28px 32px;text-align:center;">
      <img src="${baseUrl}/logo-gold.png" alt="Powerforce Global" height="36" style="display:block;margin:0 auto;" />
    </div>
    <div style="padding:32px;color:#1A1D23;">
      <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#1A1D23;">Hi ${firstName},</h2>
      <p style="margin:0 0 16px;color:#4b5563;font-size:15px;line-height:1.6;">
        Thank you for working with <strong>Powerforce Global</strong> on <strong>${project.name}</strong>.
        We'd love to hear your thoughts on how the project went — it takes about 3 minutes.
      </p>
      <p style="margin:0 0 16px;color:#4b5563;font-size:14px;line-height:1.6;">
        Your feedback helps us maintain the highest standards and deliver excellence on every project.
      </p>
      <div style="text-align:center;margin:24px 0;">
        <a href="${surveyUrl}" style="display:inline-block;background:#F5BD00;color:#1A1D23;font-weight:700;font-size:15px;padding:14px 32px;border-radius:8px;text-decoration:none;">Complete Feedback Survey</a>
      </div>
      <p style="margin:16px 0 0;font-size:12px;color:#9ca3af;text-align:center;">
        This link is personal to you and expires in 14 days.
      </p>
    </div>
    <div style="text-align:center;padding:20px 32px;font-size:11px;color:#9ca3af;border-top:1px solid #f0f0f0;">
      &copy; ${new Date().getFullYear()} Powerforce Global &middot; Confidential
    </div>
  </div>
</body>
</html>`;

      // Fire-and-forget — don't block the response on email delivery
      const mailPayload = {
        to: contact.email,
        from: pmEmail, // send from PM's @powerforce.global address if available
        subject: `We'd love your feedback — ${project.name}`,
        html: emailHtml,
        text: `Hi ${firstName},\n\nWe'd love your feedback on ${project.name}.\n\nComplete the survey here: ${surveyUrl}\n\nThis link is personal to you and expires in 14 days.`,
      };
      setTimeout(() => {
        sendMail(mailPayload).then(() => {
          console.log(`[SURVEY] Email sent to ${contact.email} for project ${project.name}`);
        }).catch((err: any) => {
          console.error(`[SURVEY] Email failed to ${contact.email}:`, err?.message || err);
        });
      }, 0);

      created.push(surveyToken);
    }

    return res.json({ ok: true, sent: created.length, tokens: created });
  });

  // GET /api/projects/:projectId/lessons-learned
  app.get("/api/projects/:projectId/lessons-learned", requireAuth, requireRole("admin", "resource_manager", "project_manager"), async (req: Request, res: Response) => {
    const projectId = parseInt(req.params.projectId);
    if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project ID" });
    const record = await storage.getLessonsLearned(projectId);
    return res.json(record || null);
  });

  // POST /api/projects/:projectId/lessons-learned
  app.post("/api/projects/:projectId/lessons-learned", requireAuth, requireRole("admin", "resource_manager", "project_manager"), async (req: Request, res: Response) => {
    const projectId = parseInt(req.params.projectId);
    if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project ID" });
    const userId = req.user!.id;
    const record = await storage.upsertLessonsLearned({
      projectId,
      completedBy: userId,
      ...req.body,
    });
    return res.json(record);
  });

  // GET /api/workers/:workerId/survey-feedback
  app.get("/api/workers/:workerId/survey-feedback", requireAuth, requireRole("admin", "resource_manager", "project_manager"), async (req: Request, res: Response) => {
    const workerId = parseInt(req.params.workerId);
    if (isNaN(workerId)) return res.status(400).json({ error: "Invalid worker ID" });
    const feedback = await storage.getSurveyFeedbackByWorker(workerId);
    return res.json(feedback);
  });

  // ── Timesheet Module routes ──────────────────────────────────────────────
  registerTimesheetRoutes(app, requireAuth, requireRole);
}
