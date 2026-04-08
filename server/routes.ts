import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { insertWorkerSchema, insertProjectSchema, insertAssignmentSchema, insertDocumentSchema, insertOemTypeSchema, insertRoleSlotSchema } from "@shared/schema";
import multer from "multer";
import path from "path";
import fs from "fs";

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
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

export function registerRoutes(server: Server, app: Express) {
  // ===== WORKERS =====
  app.get("/api/workers", (_req, res) => {
    const workers = storage.getWorkers();
    res.json(workers);
  });

  app.get("/api/workers/:id", (req, res) => {
    const worker = storage.getWorker(parseInt(req.params.id));
    if (!worker) return res.status(404).json({ error: "Worker not found" });
    res.json(worker);
  });

  app.post("/api/workers", (req, res) => {
    const parsed = insertWorkerSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error });
    const worker = storage.createWorker(parsed.data);
    res.status(201).json(worker);
  });

  app.patch("/api/workers/:id", (req, res) => {
    const worker = storage.updateWorker(parseInt(req.params.id), req.body);
    if (!worker) return res.status(404).json({ error: "Worker not found" });
    res.json(worker);
  });

  app.delete("/api/workers/:id", (req, res) => {
    const id = parseInt(req.params.id);
    const worker = storage.getWorker(id);
    if (!worker) return res.status(404).json({ error: "Worker not found" });

    // Check for active assignments (end_date >= today)
    const today = new Date().toISOString().split("T")[0];
    const workerAssignments = storage.getAssignmentsByWorker(id);
    const activeAssignments = workerAssignments.filter(a => a.endDate && a.endDate >= today && a.status === "active");
    if (activeAssignments.length > 0) {
      const allProjects = storage.getProjects();
      const projectMap = Object.fromEntries(allProjects.map(p => [p.id, p]));
      const projectNames = Array.from(new Set(activeAssignments.map(a => projectMap[a.projectId]?.name || "Unknown")));
      return res.status(409).json({ message: "Worker has active assignments", projects: projectNames });
    }

    // Cascade: delete assignments and documents first, then worker
    for (const a of workerAssignments) {
      storage.deleteAssignment(a.id);
    }
    const docs = storage.getDocumentsByWorker(id);
    for (const d of docs) {
      storage.deleteDocument(d.id);
    }
    storage.deleteWorker(id);
    res.status(204).send();
  });

  // Worker with assignments (enriched view)
  app.get("/api/workers/:id/full", (req, res) => {
    const worker = storage.getWorker(parseInt(req.params.id));
    if (!worker) return res.status(404).json({ error: "Worker not found" });
    const workerAssignments = storage.getAssignmentsByWorker(worker.id);
    const workerDocs = storage.getDocumentsByWorker(worker.id);
    // Enrich assignments with project info
    const allProjects = storage.getProjects();
    const projectMap = Object.fromEntries(allProjects.map(p => [p.id, p]));
    const enrichedAssignments = workerAssignments.map(a => ({
      ...a,
      project: projectMap[a.projectId] || null,
    }));
    res.json({ ...worker, assignments: enrichedAssignments, documents: workerDocs });
  });

  // ===== PROJECTS =====
  app.get("/api/projects", (_req, res) => {
    const allProjects = storage.getProjects();
    res.json(allProjects);
  });

  app.get("/api/projects/:id", (req, res) => {
    const project = storage.getProject(parseInt(req.params.id));
    if (!project) return res.status(404).json({ error: "Project not found" });
    res.json(project);
  });

  app.post("/api/projects", (req, res) => {
    const parsed = insertProjectSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error });
    const project = storage.createProject(parsed.data);
    res.status(201).json(project);
  });

  app.patch("/api/projects/:id", (req, res) => {
    const project = storage.updateProject(parseInt(req.params.id), req.body);
    if (!project) return res.status(404).json({ error: "Project not found" });
    res.json(project);
  });

  // Change project status
  app.post("/api/projects/:id/status", (req, res) => {
    const { status } = req.body;
    if (!status || !["active", "completed", "cancelled", "potential"].includes(status)) {
      return res.status(400).json({ error: "Invalid status. Must be: active, completed, cancelled, or potential" });
    }
    const project = storage.getProject(parseInt(req.params.id));
    if (!project) return res.status(404).json({ error: "Project not found" });

    // When cancelling an active project, mark all assignments as removed
    if (status === "cancelled" && project.status === "active") {
      const projectAssignments = storage.getAssignmentsByProject(project.id);
      for (const a of projectAssignments) {
        if (a.status === "active") {
          storage.updateAssignment(a.id, { status: "removed" });
        }
      }
    }

    const updated = storage.updateProjectStatus(project.id, status);
    res.json(updated);
  });

  // Delete project (cascade-deletes role_slots and assignments) — only for potential projects
  app.delete("/api/projects/:id", (req, res) => {
    const project = storage.getProject(parseInt(req.params.id));
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (project.status !== "potential") {
      return res.status(400).json({ error: "Only potential projects can be deleted" });
    }
    storage.deleteProject(project.id);
    res.status(204).send();
  });

  // Project with team members
  app.get("/api/projects/:id/team", (req, res) => {
    const project = storage.getProject(parseInt(req.params.id));
    if (!project) return res.status(404).json({ error: "Project not found" });
    const projectAssignments = storage.getAssignmentsByProject(project.id);
    const allWorkers = storage.getWorkers();
    const workerMap = Object.fromEntries(allWorkers.map(w => [w.id, w]));
    const team = projectAssignments.map(a => ({
      ...a,
      worker: workerMap[a.workerId] || null,
    }));
    res.json({ ...project, team });
  });

  // ===== NOTIFY TEMPS =====
  app.post("/api/projects/notify-temps", (req, res) => {
    const { projectId, assignmentIds } = req.body;
    if (!projectId || !Array.isArray(assignmentIds)) {
      return res.status(400).json({ error: "projectId and assignmentIds[] required" });
    }
    const project = storage.getProject(projectId);
    if (!project) return res.status(404).json({ error: "Project not found" });

    let sent = 0;
    let skipped = 0;
    const noEmail: string[] = [];

    for (const aId of assignmentIds) {
      const allAssignments = storage.getAssignments();
      const assignment = allAssignments.find(a => a.id === aId);
      if (!assignment) { skipped++; continue; }

      const worker = storage.getWorker(assignment.workerId);
      if (!worker) { skipped++; continue; }
      if (worker.status !== "Temp") { skipped++; continue; }

      if (!worker.personalEmail) {
        noEmail.push(worker.name);
        skipped++;
        continue;
      }

      // Log the email that would be sent (Outlook integration wired separately)
      const firstName = worker.name.split(" ")[0];
      console.log(`[NOTIFY-TEMP] Would send email to ${worker.personalEmail}:
Subject: Project Assignment — ${project.name}

Dear ${firstName},

We would like to allocate you to the following project with Powerforce Global.

Project: ${project.name}
Location: ${project.location || "TBC"}
Role: ${assignment.role || "TBC"}
Start Date: ${assignment.startDate || "TBC"}
End Date: ${assignment.endDate || "TBC"}

If you are available and would be interested in joining us on this project, please reply as soon as possible.

Kind regards,
Powerforce Global`);
      sent++;
    }

    res.json({ sent, skipped, noEmail });
  });

  // ===== ASSIGNMENTS =====
  app.get("/api/assignments", (_req, res) => {
    res.json(storage.getAssignments());
  });

  app.post("/api/assignments", (req, res) => {
    const parsed = insertAssignmentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error });
    const assignment = storage.createAssignment(parsed.data);
    res.status(201).json(assignment);
  });

  app.patch("/api/assignments/:id", (req, res) => {
    const assignment = storage.updateAssignment(parseInt(req.params.id), req.body);
    if (!assignment) return res.status(404).json({ error: "Assignment not found" });
    res.json(assignment);
  });

  app.delete("/api/assignments/:id", (req, res) => {
    storage.deleteAssignment(parseInt(req.params.id));
    res.status(204).send();
  });

  // ===== DOCUMENTS =====
  app.get("/api/workers/:workerId/documents", (req, res) => {
    const docs = storage.getDocumentsByWorker(parseInt(req.params.workerId));
    res.json(docs);
  });

  app.post("/api/documents", (req, res) => {
    const parsed = insertDocumentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error });
    const doc = storage.createDocument(parsed.data);
    res.status(201).json(doc);
  });

  app.delete("/api/documents/:id", (req, res) => {
    storage.deleteDocument(parseInt(req.params.id));
    res.status(204).send();
  });

  // ===== ROLE SLOTS =====
  app.get("/api/projects/:projectId/role-slots", (req, res) => {
    const slots = storage.getRoleSlotsByProject(parseInt(req.params.projectId));
    res.json(slots);
  });

  app.post("/api/role-slots", (req, res) => {
    const parsed = insertRoleSlotSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error });
    const slot = storage.createRoleSlot(parsed.data);
    res.status(201).json(slot);
  });

  app.patch("/api/role-slots/:id", (req, res) => {
    const slot = storage.updateRoleSlot(parseInt(req.params.id), req.body);
    if (!slot) return res.status(404).json({ error: "Role slot not found" });
    res.json(slot);
  });

  app.delete("/api/role-slots/:id", (req, res) => {
    storage.deleteRoleSlot(parseInt(req.params.id));
    res.status(204).send();
  });

  // ===== OEM TYPES =====
  app.get("/api/oem-types", (_req, res) => {
    res.json(storage.getOemTypes());
  });

  app.post("/api/oem-types", (req, res) => {
    const parsed = insertOemTypeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error });
    const oemType = storage.createOemType(parsed.data);
    res.status(201).json(oemType);
  });

  // ===== FILE UPLOADS =====
  app.post("/api/workers/:id/upload", upload.single("file"), (req: any, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const workerId = req.params.id;
    const fileType = req.body?.type || "file";
    const filePath = `/api/uploads/${workerId}/${req.file.filename}`;

    // Update worker record with file path
    if (fileType === "photo") {
      storage.updateWorker(parseInt(workerId), { profilePhotoPath: filePath });
    } else if (fileType === "passport") {
      storage.updateWorker(parseInt(workerId), { passportPath: filePath });
    }

    res.json({ path: filePath, filename: req.file.filename, type: fileType });
  });

  // Serve uploaded files
  app.get("/api/uploads/:workerId/:filename", (req, res) => {
    const { workerId, filename } = req.params;
    const filePath = path.join(UPLOAD_BASE, workerId, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File not found" });
    res.sendFile(path.resolve(filePath));
  });

  // ===== DASHBOARD SUMMARY =====
  // Single endpoint that returns everything the dashboard needs
  app.get("/api/dashboard", (_req, res) => {
    const allWorkers = storage.getWorkers();
    const allProjects = storage.getProjects();
    const allAssignments = storage.getAssignments();
    const allOemTypes = storage.getOemTypes();

    // Build enriched workers with their assignments
    const projectMap = Object.fromEntries(allProjects.map(p => [p.id, p]));
    const assignmentsByWorker: Record<number, any[]> = {};
    allAssignments.forEach(a => {
      if (!assignmentsByWorker[a.workerId]) assignmentsByWorker[a.workerId] = [];
      const proj = projectMap[a.projectId];
      assignmentsByWorker[a.workerId].push({
        ...a,
        projectCode: proj?.code || '',
        projectName: proj?.name || '',
        customer: proj?.customer || '',
        location: proj?.location || '',
        equipmentType: proj?.equipmentType || '',
      });
    });

    const enrichedWorkers = allWorkers.map(w => ({
      ...w,
      oemExperience: w.oemExperience ? JSON.parse(w.oemExperience) : [],
      assignments: assignmentsByWorker[w.id] || [],
    }));

    // Build role slots by project
    const allRoleSlots: any[] = [];
    allProjects.forEach(p => {
      const slots = storage.getRoleSlotsByProject(p.id);
      slots.forEach(s => allRoleSlots.push({ ...s, projectCode: p.code, projectName: p.name }));
    });

    res.json({
      workers: enrichedWorkers,
      projects: allProjects,
      assignments: allAssignments,
      roleSlots: allRoleSlots,
      oemTypes: allOemTypes,
    });
  });
}
