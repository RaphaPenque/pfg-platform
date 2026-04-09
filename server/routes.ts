import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { insertWorkerSchema, insertProjectSchema, insertAssignmentSchema, insertDocumentSchema, insertOemTypeSchema, insertRoleSlotSchema, insertWorkExperienceSchema } from "@shared/schema";
import type { User, WorkExperience } from "@shared/schema";
import { sendMail, magicLinkEmail, welcomeEmail, confirmationEmail, confirmationResultEmail } from "./email";
import { insertPayrollRulesSchema } from "@shared/schema";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";

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
  limits: { fileSize: 10 * 1024 * 1024 },
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

  app.post("/api/auth/request-link", async (req: Request, res: Response) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email required" });

    const user = await storage.getUserByEmail(email);
    // Always return the same response to prevent email enumeration
    // If user doesn't exist or is inactive, silently succeed — no info leaked
    if (!user || !user.isActive) {
      // Delay response slightly to prevent timing attacks
      await new Promise(resolve => setTimeout(resolve, 400));
      return res.json({ message: "If that address is registered, a login link is on its way" });
    }

    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
    await storage.createMagicLink({ email: email.toLowerCase(), token, expiresAt });

    const loginUrl = `https://pfg-platform.onrender.com/#/auth/verify?token=${token}`;
    // Always log for fallback/debugging
    console.log(`[MAGIC-LINK] Login link for ${email}: ${loginUrl}`);

    // Send via Microsoft Graph
    const tmpl = magicLinkEmail(user.name, loginUrl);
    sendMail({ to: email, subject: tmpl.subject, html: tmpl.html, text: tmpl.text })
      .catch(err => console.error("[email] Magic link send error:", err));

    res.json({ message: "If that address is registered, a login link is on its way" });
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
    const project = await storage.getProjectByCode(req.params.code.toUpperCase());
    if (!project) return res.status(404).json({ error: "Project not found" });

    const [projectAssignments, allWorkers, roleSlots] = await Promise.all([
      storage.getAssignmentsByProject(project.id),
      storage.getWorkers(),
      storage.getRoleSlotsByProject(project.id),
    ]);

    const workerMap = Object.fromEntries(allWorkers.map(w => [w.id, w]));

    // Build enriched worker objects for assigned workers (with OEM experience parsed)
    const assignedWorkerIds = new Set(
      projectAssignments.filter(a => a.status === "active" || a.status === "flagged").map(a => a.workerId)
    );
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
      .filter(a => a.status === "active" || a.status === "flagged")
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
        scopeOfWork: project.scopeOfWork,
      }));

    // Attach assignments to each worker object so SQEP PDF can render work experience
    for (const a of assignments) {
      if (workers[a.workerId]) {
        workers[a.workerId].assignments.push(a);
      }
    }

    res.json({ project, roleSlots, assignments, workers });
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
    // Skip auth for auth routes, portal, and confirmation
    if (req.path.startsWith("/auth/") || req.path.startsWith("/portal/") || req.path.startsWith("/confirm/")) return next();
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

  app.post("/api/workers", requireRole("admin", "resource_manager"), async (req: Request, res: Response) => {
    const parsed = insertWorkerSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error });
    const worker = await storage.createWorker(parsed.data);
    await logAudit(req.user!.id, "worker.create", "worker", worker.id, worker.name);
    res.status(201).json(worker);
  });

  app.patch("/api/workers/:id", requireRole("admin", "resource_manager"), async (req: Request, res: Response) => {
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

  app.delete("/api/workers/:id", requireRole("admin", "resource_manager"), async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    const worker = await storage.getWorker(id);
    if (!worker) return res.status(404).json({ error: "Worker not found" });

    const today = new Date().toISOString().split("T")[0];
    const workerAssignments = await storage.getAssignmentsByWorker(id);
    const activeAssignments = workerAssignments.filter(a => a.endDate && a.endDate >= today && a.status === "active");
    if (activeAssignments.length > 0) {
      const allProjects = await storage.getProjects();
      const projectMap = Object.fromEntries(allProjects.map(p => [p.id, p]));
      const projectNames = Array.from(new Set(activeAssignments.map(a => projectMap[a.projectId]?.name || "Unknown")));
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

  app.delete("/api/work-experience/:id", async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    await storage.deleteWorkExperience(id);
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

    if (status === "cancelled" && project.status === "active") {
      const projectAssignments = await storage.getAssignmentsByProject(project.id);
      for (const a of projectAssignments) {
        if (a.status === "active") {
          await storage.updateAssignment(a.id, { status: "removed" });
        }
      }
    }

    const updated = await storage.updateProjectStatus(project.id, status);
    await logAudit(req.user!.id, "project.status", "project", project.id, project.name, { status: { from: project.status, to: status } });
    res.json(updated);
  });

  app.delete("/api/projects/:id", requireRole("admin", "resource_manager"), async (req: Request, res: Response) => {
    const project = await storage.getProject(parseInt(req.params.id));
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (project.status !== "potential") {
      return res.status(400).json({ error: "Only potential projects can be deleted" });
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

  app.put("/api/projects/:id/lead", requireRole("admin", "resource_manager"), async (req: Request, res: Response) => {
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

  app.post("/api/assignments/:id/send-confirmation", requireRole("admin", "resource_manager"), async (req: Request, res: Response) => {
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

  app.post("/api/projects/:id/send-all-confirmations", requireRole("admin", "resource_manager"), async (req: Request, res: Response) => {
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
    res.status(201).json(assignment);
  });

  app.patch("/api/assignments/:id", requireRole("admin", "resource_manager", "project_manager"), async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    const assignment = await storage.updateAssignment(id, req.body);
    if (!assignment) return res.status(404).json({ error: "Assignment not found" });
    await logAudit(req.user!.id, "assignment.update", "assignment", id);
    res.json(assignment);
  });

  app.delete("/api/assignments/:id", async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    await storage.deleteAssignment(id);
    await logAudit(req.user!.id, "assignment.delete", "assignment", id);
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

  app.delete("/api/documents/:id", async (req: Request, res: Response) => {
    await storage.deleteDocument(parseInt(req.params.id));
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

    const enrichedWorkers = allWorkers.map(w => ({
      ...w,
      oemExperience: w.oemExperience ? JSON.parse(w.oemExperience) : [],
      assignments: assignmentsByWorker[w.id] || [],
      documents: documentsByWorker[w.id] || [],
    }));

    const allRoleSlots: any[] = [];
    for (const p of allProjects) {
      const slots = await storage.getRoleSlotsByProject(p.id);
      slots.forEach(s => allRoleSlots.push({ ...s, projectCode: p.code, projectName: p.name }));
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

    res.json({
      workers: enrichedWorkers,
      projects: allProjects,
      assignments: allAssignments,
      roleSlots: allRoleSlots,
      oemTypes: allOemTypes,
      projectLeads: projectLeadMap,
    });
  });
}
