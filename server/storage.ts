import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, like, and, sql } from "drizzle-orm";
import {
  workers, projects, assignments, documents, oemTypes, roleSlots,
  type Worker, type InsertWorker,
  type Project, type InsertProject,
  type Assignment, type InsertAssignment,
  type Document, type InsertDocument,
  type OemType, type InsertOemType,
  type RoleSlot, type InsertRoleSlot,
} from "@shared/schema";

import fs from "fs";
import path from "path";

// Use persistent disk on Render (/data/pfg.db), fall back to local
const RENDER_DB = "/data/pfg.db";
const LOCAL_DB = "pfg.db";
const SEED_DB = "pfg-seed.db";

function getDbPath(): string {
  // If /data exists (Render disk), use it
  if (fs.existsSync("/data")) {
    if (!fs.existsSync(RENDER_DB) && fs.existsSync(SEED_DB)) {
      console.log("Seeding database to persistent disk...");
      fs.copyFileSync(SEED_DB, RENDER_DB);
    }
    if (fs.existsSync(RENDER_DB)) return RENDER_DB;
  }
  // Fall back to local (dev mode)
  return LOCAL_DB;
}

const dbPath = getDbPath();
console.log(`Using database: ${dbPath}`);
const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
export const db = drizzle(sqlite);

export interface IStorage {
  // Workers
  getWorkers(): Worker[];
  getWorker(id: number): Worker | undefined;
  createWorker(data: InsertWorker): Worker;
  updateWorker(id: number, data: Partial<InsertWorker>): Worker | undefined;
  deleteWorker(id: number): void;

  // Projects
  getProjects(): Project[];
  getProject(id: number): Project | undefined;
  getProjectByCode(code: string): Project | undefined;
  createProject(data: InsertProject): Project;
  updateProject(id: number, data: Partial<InsertProject>): Project | undefined;
  updateProjectStatus(id: number, status: string): Project | undefined;
  deleteProject(id: number): void;

  // Assignments
  getAssignments(): Assignment[];
  getAssignmentsByWorker(workerId: number): Assignment[];
  getAssignmentsByProject(projectId: number): Assignment[];
  createAssignment(data: InsertAssignment): Assignment;
  updateAssignment(id: number, data: Partial<InsertAssignment>): Assignment | undefined;
  deleteAssignment(id: number): void;

  // Documents
  getDocumentsByWorker(workerId: number): Document[];
  createDocument(data: InsertDocument): Document;
  deleteDocument(id: number): void;

  // Role Slots
  getRoleSlotsByProject(projectId: number): RoleSlot[];
  createRoleSlot(data: InsertRoleSlot): RoleSlot;
  deleteRoleSlot(id: number): void;

  // OEM Types
  getOemTypes(): OemType[];
  createOemType(data: InsertOemType): OemType;
}

export class SqliteStorage implements IStorage {
  // Workers
  getWorkers(): Worker[] {
    return db.select().from(workers).all();
  }

  getWorker(id: number): Worker | undefined {
    return db.select().from(workers).where(eq(workers.id, id)).get();
  }

  createWorker(data: InsertWorker): Worker {
    return db.insert(workers).values(data).returning().get();
  }

  updateWorker(id: number, data: Partial<InsertWorker>): Worker | undefined {
    return db.update(workers).set(data).where(eq(workers.id, id)).returning().get();
  }

  deleteWorker(id: number): void {
    db.delete(workers).where(eq(workers.id, id)).run();
  }

  // Projects
  getProjects(): Project[] {
    return db.select().from(projects).all();
  }

  getProject(id: number): Project | undefined {
    return db.select().from(projects).where(eq(projects.id, id)).get();
  }

  getProjectByCode(code: string): Project | undefined {
    return db.select().from(projects).where(eq(projects.code, code)).get();
  }

  createProject(data: InsertProject): Project {
    return db.insert(projects).values(data).returning().get();
  }

  updateProject(id: number, data: Partial<InsertProject>): Project | undefined {
    return db.update(projects).set(data).where(eq(projects.id, id)).returning().get();
  }

  updateProjectStatus(id: number, status: string): Project | undefined {
    return db.update(projects).set({ status }).where(eq(projects.id, id)).returning().get();
  }

  deleteProject(id: number): void {
    // Cascade delete: assignments first, then role slots, then project
    db.delete(assignments).where(eq(assignments.projectId, id)).run();
    db.delete(roleSlots).where(eq(roleSlots.projectId, id)).run();
    db.delete(projects).where(eq(projects.id, id)).run();
  }

  // Assignments
  getAssignments(): Assignment[] {
    return db.select().from(assignments).all();
  }

  getAssignmentsByWorker(workerId: number): Assignment[] {
    return db.select().from(assignments).where(eq(assignments.workerId, workerId)).all();
  }

  getAssignmentsByProject(projectId: number): Assignment[] {
    return db.select().from(assignments).where(eq(assignments.projectId, projectId)).all();
  }

  createAssignment(data: InsertAssignment): Assignment {
    return db.insert(assignments).values(data).returning().get();
  }

  updateAssignment(id: number, data: Partial<InsertAssignment>): Assignment | undefined {
    return db.update(assignments).set(data).where(eq(assignments.id, id)).returning().get();
  }

  deleteAssignment(id: number): void {
    db.delete(assignments).where(eq(assignments.id, id)).run();
  }

  // Documents
  getDocumentsByWorker(workerId: number): Document[] {
    return db.select().from(documents).where(eq(documents.workerId, workerId)).all();
  }

  createDocument(data: InsertDocument): Document {
    return db.insert(documents).values(data).returning().get();
  }

  deleteDocument(id: number): void {
    db.delete(documents).where(eq(documents.id, id)).run();
  }

  // Role Slots
  getRoleSlotsByProject(projectId: number): RoleSlot[] {
    return db.select().from(roleSlots).where(eq(roleSlots.projectId, projectId)).all();
  }

  createRoleSlot(data: InsertRoleSlot): RoleSlot {
    return db.insert(roleSlots).values(data).returning().get();
  }

  deleteRoleSlot(id: number): void {
    db.delete(roleSlots).where(eq(roleSlots.id, id)).run();
  }

  // OEM Types
  getOemTypes(): OemType[] {
    return db.select().from(oemTypes).all();
  }

  createOemType(data: InsertOemType): OemType {
    return db.insert(oemTypes).values(data).returning().get();
  }
}

export const storage = new SqliteStorage();
