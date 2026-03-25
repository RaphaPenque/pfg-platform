import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { insertWorkerSchema, insertProjectSchema, insertAssignmentSchema, insertDocumentSchema, insertOemTypeSchema, insertRoleSlotSchema } from "@shared/schema";

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
    storage.deleteWorker(parseInt(req.params.id));
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
