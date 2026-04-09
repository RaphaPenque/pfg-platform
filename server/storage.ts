import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { eq, and, gt, desc, sql } from "drizzle-orm";
import {
  workers, projects, assignments, documents, oemTypes, roleSlots,
  users, sessions, magicLinks, auditLogs, projectLeads, payrollRules,
  type Worker, type InsertWorker,
  type Project, type InsertProject,
  type Assignment, type InsertAssignment,
  type Document, type InsertDocument,
  type OemType, type InsertOemType,
  type RoleSlot, type InsertRoleSlot,
  type User, type InsertUser,
  type Session, type MagicLink, type AuditLog, type ProjectLead,
  type PayrollRule, type InsertPayrollRule,
} from "@shared/schema";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  max: 5,
  idleTimeoutMillis: 60000,
  connectionTimeoutMillis: 30000,
});

// Prevent unhandled error events from crashing the process
pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err.message);
});

export const db = drizzle(pool);

export interface IStorage {
  // Workers
  getWorkers(): Promise<Worker[]>;
  getWorker(id: number): Promise<Worker | undefined>;
  createWorker(data: InsertWorker): Promise<Worker>;
  updateWorker(id: number, data: Partial<InsertWorker>): Promise<Worker | undefined>;
  deleteWorker(id: number): Promise<void>;

  // Projects
  getProjects(): Promise<Project[]>;
  getProject(id: number): Promise<Project | undefined>;
  getProjectByCode(code: string): Promise<Project | undefined>;
  createProject(data: InsertProject): Promise<Project>;
  updateProject(id: number, data: Partial<InsertProject>): Promise<Project | undefined>;
  updateProjectStatus(id: number, status: string): Promise<Project | undefined>;
  deleteProject(id: number): Promise<void>;

  // Assignments
  getAssignments(): Promise<Assignment[]>;
  getAssignmentsByWorker(workerId: number): Promise<Assignment[]>;
  getAssignmentsByProject(projectId: number): Promise<Assignment[]>;
  createAssignment(data: InsertAssignment): Promise<Assignment>;
  updateAssignment(id: number, data: Partial<InsertAssignment>): Promise<Assignment | undefined>;
  deleteAssignment(id: number): Promise<void>;

  // Documents
  getDocumentsByWorker(workerId: number): Promise<Document[]>;
  createDocument(data: InsertDocument): Promise<Document>;
  deleteDocument(id: number): Promise<void>;
  upsertDocument(workerId: number, type: string, name: string, data: Partial<InsertDocument>): Promise<Document>;

  // Role Slots
  getRoleSlotsByProject(projectId: number): Promise<RoleSlot[]>;
  getRoleSlot(id: number): Promise<RoleSlot | undefined>;
  createRoleSlot(data: InsertRoleSlot): Promise<RoleSlot>;
  updateRoleSlot(id: number, data: Partial<InsertRoleSlot>): Promise<RoleSlot | undefined>;
  deleteRoleSlot(id: number): Promise<void>;

  // OEM Types
  getOemTypes(): Promise<OemType[]>;
  createOemType(data: InsertOemType): Promise<OemType>;

  // Users
  getUsers(): Promise<User[]>;
  getUserById(id: number): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(data: InsertUser): Promise<User>;
  updateUser(id: number, data: Partial<InsertUser>): Promise<User | undefined>;

  // Sessions
  createSession(data: { userId: number; token: string; expiresAt: Date; userAgent?: string; ipAddress?: string }): Promise<Session>;
  getSessionByToken(token: string): Promise<Session | undefined>;
  deleteSession(token: string): Promise<void>;

  // Magic Links
  createMagicLink(data: { email: string; token: string; expiresAt: Date }): Promise<MagicLink>;
  getMagicLinkByToken(token: string): Promise<MagicLink | undefined>;
  markMagicLinkUsed(token: string): Promise<void>;

  // Audit Logs
  createAuditLog(data: { userId: number | null; action: string; entityType: string; entityId: number; entityName?: string; changes?: object; metadata?: object }): Promise<void>;
  getAuditLogs(filters?: { entityType?: string; entityId?: number; limit?: number }): Promise<AuditLog[]>;

  // Project Leads
  getProjectLead(projectId: number): Promise<ProjectLead | undefined>;
  setProjectLead(projectId: number, userId: number): Promise<ProjectLead>;
  removeProjectLead(projectId: number): Promise<void>;

  // Payroll Rules
  getPayrollRules(): Promise<PayrollRule[]>;
  getPayrollRulesByCostCentre(costCentre: string): Promise<PayrollRule | undefined>;
  upsertPayrollRule(rule: InsertPayrollRule): Promise<PayrollRule>;
  deletePayrollRule(id: number): Promise<void>;
}

export class PostgresStorage implements IStorage {
  // Workers
  async getWorkers(): Promise<Worker[]> {
    return db.select().from(workers);
  }

  async getWorker(id: number): Promise<Worker | undefined> {
    const [row] = await db.select().from(workers).where(eq(workers.id, id));
    return row;
  }

  async createWorker(data: InsertWorker): Promise<Worker> {
    const [row] = await db.insert(workers).values(data).returning();
    return row;
  }

  async updateWorker(id: number, data: Partial<InsertWorker>): Promise<Worker | undefined> {
    const [row] = await db.update(workers).set(data).where(eq(workers.id, id)).returning();
    return row;
  }

  async deleteWorker(id: number): Promise<void> {
    await db.delete(workers).where(eq(workers.id, id));
  }

  // Projects
  async getProjects(): Promise<Project[]> {
    return db.select().from(projects);
  }

  async getProject(id: number): Promise<Project | undefined> {
    const [row] = await db.select().from(projects).where(eq(projects.id, id));
    return row;
  }

  async getProjectByCode(code: string): Promise<Project | undefined> {
    const [row] = await db.select().from(projects).where(eq(projects.code, code));
    return row;
  }

  async createProject(data: InsertProject): Promise<Project> {
    const [row] = await db.insert(projects).values(data).returning();
    return row;
  }

  async updateProject(id: number, data: Partial<InsertProject>): Promise<Project | undefined> {
    const [row] = await db.update(projects).set(data).where(eq(projects.id, id)).returning();
    return row;
  }

  async updateProjectStatus(id: number, status: string): Promise<Project | undefined> {
    const [row] = await db.update(projects).set({ status }).where(eq(projects.id, id)).returning();
    return row;
  }

  async deleteProject(id: number): Promise<void> {
    await db.delete(assignments).where(eq(assignments.projectId, id));
    await db.delete(roleSlots).where(eq(roleSlots.projectId, id));
    await db.delete(projectLeads).where(eq(projectLeads.projectId, id));
    await db.delete(projects).where(eq(projects.id, id));
  }

  // Assignments
  async getAssignments(): Promise<Assignment[]> {
    return db.select().from(assignments);
  }

  async getAssignmentsByWorker(workerId: number): Promise<Assignment[]> {
    return db.select().from(assignments).where(eq(assignments.workerId, workerId));
  }

  async getAssignmentsByProject(projectId: number): Promise<Assignment[]> {
    return db.select().from(assignments).where(eq(assignments.projectId, projectId));
  }

  async createAssignment(data: InsertAssignment): Promise<Assignment> {
    const [row] = await db.insert(assignments).values(data).returning();
    return row;
  }

  async updateAssignment(id: number, data: Partial<InsertAssignment>): Promise<Assignment | undefined> {
    const [row] = await db.update(assignments).set(data).where(eq(assignments.id, id)).returning();
    return row;
  }

  async deleteAssignment(id: number): Promise<void> {
    await db.delete(assignments).where(eq(assignments.id, id));
  }

  // Documents
  async getDocumentsByWorker(workerId: number): Promise<Document[]> {
    return db.select().from(documents).where(eq(documents.workerId, workerId));
  }

  async createDocument(data: InsertDocument): Promise<Document> {
    const [row] = await db.insert(documents).values(data).returning();
    return row;
  }

  async deleteDocument(id: number): Promise<void> {
    await db.delete(documents).where(eq(documents.id, id));
  }

  async upsertDocument(workerId: number, type: string, name: string, data: Partial<InsertDocument>): Promise<Document> {
    // Check if document of this type already exists for the worker
    const [existing] = await db.select().from(documents)
      .where(and(eq(documents.workerId, workerId), eq(documents.type, type)));
    if (existing) {
      const [updated] = await db.update(documents)
        .set({ ...data, name, uploadedAt: new Date().toISOString() })
        .where(eq(documents.id, existing.id))
        .returning();
      return updated;
    }
    const [created] = await db.insert(documents)
      .values({ workerId, type, name, ...data, uploadedAt: new Date().toISOString() } as InsertDocument)
      .returning();
    return created;
  }

  // Role Slots
  async getRoleSlotsByProject(projectId: number): Promise<RoleSlot[]> {
    return db.select().from(roleSlots).where(eq(roleSlots.projectId, projectId));
  }

  async getRoleSlot(id: number): Promise<RoleSlot | undefined> {
    const [row] = await db.select().from(roleSlots).where(eq(roleSlots.id, id));
    return row;
  }

  async createRoleSlot(data: InsertRoleSlot): Promise<RoleSlot> {
    const [row] = await db.insert(roleSlots).values(data).returning();
    return row;
  }

  async updateRoleSlot(id: number, data: Partial<InsertRoleSlot>): Promise<RoleSlot | undefined> {
    const [row] = await db.update(roleSlots).set(data).where(eq(roleSlots.id, id)).returning();
    return row;
  }

  async deleteRoleSlot(id: number): Promise<void> {
    await db.delete(roleSlots).where(eq(roleSlots.id, id));
  }

  // OEM Types
  async getOemTypes(): Promise<OemType[]> {
    return db.select().from(oemTypes);
  }

  async createOemType(data: InsertOemType): Promise<OemType> {
    const [row] = await db.insert(oemTypes).values(data).returning();
    return row;
  }

  // Users
  async getUsers(): Promise<User[]> {
    return db.select().from(users);
  }

  async getUserById(id: number): Promise<User | undefined> {
    const [row] = await db.select().from(users).where(eq(users.id, id));
    return row;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [row] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
    return row;
  }

  async createUser(data: InsertUser): Promise<User> {
    const [row] = await db.insert(users).values({ ...data, email: data.email.toLowerCase() }).returning();
    return row;
  }

  async updateUser(id: number, data: Partial<InsertUser>): Promise<User | undefined> {
    const [row] = await db.update(users).set(data).where(eq(users.id, id)).returning();
    return row;
  }

  // Sessions
  async createSession(data: { userId: number; token: string; expiresAt: Date; userAgent?: string; ipAddress?: string }): Promise<Session> {
    const [row] = await db.insert(sessions).values(data).returning();
    return row;
  }

  async getSessionByToken(token: string): Promise<Session | undefined> {
    const [row] = await db.select().from(sessions)
      .where(and(eq(sessions.token, token), gt(sessions.expiresAt, new Date())));
    return row;
  }

  async deleteSession(token: string): Promise<void> {
    await db.delete(sessions).where(eq(sessions.token, token));
  }

  // Magic Links
  async createMagicLink(data: { email: string; token: string; expiresAt: Date }): Promise<MagicLink> {
    const [row] = await db.insert(magicLinks).values(data).returning();
    return row;
  }

  async getMagicLinkByToken(token: string): Promise<MagicLink | undefined> {
    const [row] = await db.select().from(magicLinks).where(eq(magicLinks.token, token));
    return row;
  }

  async markMagicLinkUsed(token: string): Promise<void> {
    await db.update(magicLinks).set({ usedAt: new Date() }).where(eq(magicLinks.token, token));
  }

  // Audit Logs
  async createAuditLog(data: { userId: number | null; action: string; entityType: string; entityId: number; entityName?: string; changes?: object; metadata?: object }): Promise<void> {
    await db.insert(auditLogs).values({
      userId: data.userId,
      action: data.action,
      entityType: data.entityType,
      entityId: data.entityId,
      entityName: data.entityName || null,
      changes: data.changes || null,
      metadata: data.metadata || null,
    });
  }

  async getAuditLogs(filters?: { entityType?: string; entityId?: number; limit?: number }): Promise<AuditLog[]> {
    let query = db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt));
    if (filters?.limit) {
      query = query.limit(filters.limit) as typeof query;
    }
    const rows = await query;
    if (filters?.entityType) {
      return rows.filter(r => r.entityType === filters.entityType);
    }
    if (filters?.entityId) {
      return rows.filter(r => r.entityId === filters.entityId);
    }
    return rows;
  }

  // Project Leads
  async getProjectLead(projectId: number): Promise<ProjectLead | undefined> {
    const [row] = await db.select().from(projectLeads).where(eq(projectLeads.projectId, projectId));
    return row;
  }

  async setProjectLead(projectId: number, userId: number): Promise<ProjectLead> {
    // Remove existing lead first
    await db.delete(projectLeads).where(eq(projectLeads.projectId, projectId));
    const [row] = await db.insert(projectLeads).values({ projectId, userId }).returning();
    return row;
  }

  async removeProjectLead(projectId: number): Promise<void> {
    await db.delete(projectLeads).where(eq(projectLeads.projectId, projectId));
  }

  // ─── Payroll Rules (raw SQL to avoid esbuild scope issues with Drizzle table refs) ──
  async getPayrollRules(): Promise<PayrollRule[]> {
    const result = await pool.query(`
      SELECT id, cost_centre as "costCentre", country_code as "countryCode",
        country_name as "countryName",
        weekly_ot_threshold_hours as "weeklyOtThresholdHours",
        annual_ot_threshold_hours as "annualOtThresholdHours",
        night_shift_start as "nightShiftStart",
        night_shift_end as "nightShiftEnd",
        track_sunday_hours as "trackSundayHours",
        standby_day_hours as "standbyDayHours",
        notes, updated_at as "updatedAt", updated_by as "updatedBy"
      FROM payroll_rules ORDER BY country_name
    `);
    return result.rows as PayrollRule[];
  }

  async getPayrollRulesByCostCentre(costCentre: string): Promise<PayrollRule | undefined> {
    const result = await pool.query(`
      SELECT id, cost_centre as "costCentre", country_code as "countryCode",
        country_name as "countryName",
        weekly_ot_threshold_hours as "weeklyOtThresholdHours",
        annual_ot_threshold_hours as "annualOtThresholdHours",
        night_shift_start as "nightShiftStart",
        night_shift_end as "nightShiftEnd",
        track_sunday_hours as "trackSundayHours",
        standby_day_hours as "standbyDayHours",
        notes, updated_at as "updatedAt", updated_by as "updatedBy"
      FROM payroll_rules WHERE cost_centre = $1 LIMIT 1
    `, [costCentre]);
    return result.rows[0] as PayrollRule | undefined;
  }

  async upsertPayrollRule(rule: InsertPayrollRule): Promise<PayrollRule> {
    const result = await pool.query(`
      INSERT INTO payroll_rules
        (cost_centre, country_code, country_name, weekly_ot_threshold_hours,
         annual_ot_threshold_hours, night_shift_start, night_shift_end,
         track_sunday_hours, standby_day_hours, notes, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
      ON CONFLICT (cost_centre) DO UPDATE SET
        country_code = EXCLUDED.country_code,
        country_name = EXCLUDED.country_name,
        weekly_ot_threshold_hours = EXCLUDED.weekly_ot_threshold_hours,
        annual_ot_threshold_hours = EXCLUDED.annual_ot_threshold_hours,
        night_shift_start = EXCLUDED.night_shift_start,
        night_shift_end = EXCLUDED.night_shift_end,
        track_sunday_hours = EXCLUDED.track_sunday_hours,
        standby_day_hours = EXCLUDED.standby_day_hours,
        notes = EXCLUDED.notes,
        updated_at = NOW()
      RETURNING id, cost_centre as "costCentre", country_code as "countryCode",
        country_name as "countryName",
        weekly_ot_threshold_hours as "weeklyOtThresholdHours",
        annual_ot_threshold_hours as "annualOtThresholdHours",
        night_shift_start as "nightShiftStart", night_shift_end as "nightShiftEnd",
        track_sunday_hours as "trackSundayHours", standby_day_hours as "standbyDayHours",
        notes, updated_at as "updatedAt"
    `, [
      rule.costCentre, rule.countryCode, rule.countryName,
      rule.weeklyOtThresholdHours ?? null, rule.annualOtThresholdHours ?? null,
      rule.nightShiftStart ?? null, rule.nightShiftEnd ?? null,
      rule.trackSundayHours ?? false, rule.standbyDayHours ?? 8,
      rule.notes ?? null
    ]);
    return result.rows[0] as PayrollRule;
  }

  async deletePayrollRule(id: number): Promise<void> {
    await pool.query(`DELETE FROM payroll_rules WHERE id = $1`, [id]);
  }
}

export const storage: IStorage = new PostgresStorage();
