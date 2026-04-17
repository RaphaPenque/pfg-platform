import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { eq, and, gt, desc, sql } from "drizzle-orm";
import {
  workers, projects, assignments, roleSlotPeriods, documents, oemTypes, roleSlots, publicHolidays,
  users, sessions, magicLinks, auditLogs, projectLeads, payrollRules,
  workExperience, oemExperience,
  workPackages, dailyReports, dailyReportWpProgress, commentsLog, delayApprovals,
  supervisorReports, supervisorReportReplies, toolboxTalks, safetyObservations,
  incidentReports, milestoneCertificates,
  surveyTokens, surveyResponses, surveyIndividualFeedback, lessonsLearned,
  type Worker, type InsertWorker,
  type Project, type InsertProject,
  type Assignment, type InsertAssignment,
  type RoleSlotPeriod, type InsertRoleSlotPeriod,
  type PublicHoliday,
  type Document, type InsertDocument,
  type OemType, type InsertOemType,
  type RoleSlot, type InsertRoleSlot,
  type User, type InsertUser,
  type Session, type MagicLink, type AuditLog, type ProjectLead,
  type PayrollRule, type InsertPayrollRule,
  type WorkExperience, type InsertWorkExperience,
  type OemExperience, type InsertOemExperience,
  type WorkPackage, type InsertWorkPackage,
  type DailyReport, type InsertDailyReport,
  type DailyReportWpProgress,
  type CommentsLog, type InsertCommentsLog,
  type DelayApproval,
  type SupervisorReport, type InsertSupervisorReport,
  type SupervisorReportReply,
  type ToolboxTalk, type InsertToolboxTalk,
  type SafetyObservation, type InsertSafetyObservation,
  type IncidentReport, type InsertIncidentReport,
  type MilestoneCertificate, type InsertMilestoneCertificate,
  type SurveyToken, type InsertSurveyToken,
  type SurveyResponse, type InsertSurveyResponse,
  type SurveyIndividualFeedback, type InsertSurveyIndividualFeedback,
  type LessonsLearned, type InsertLessonsLearned,
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

/** Warm up the DB connection pool at server start — prevents cold-start delays on first user request */
export async function warmupDb(): Promise<void> {
  try {
    await pool.query('SELECT 1');
    console.log('[DB] Connection pool warmed up');
  } catch (err: any) {
    console.error('[DB] Warmup failed:', err.message);
  }
}

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
  getDocumentById(id: number): Promise<Document | undefined>;
  updateDocument(id: number, data: Partial<InsertDocument>): Promise<Document | undefined>;
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

  // Work Experience
  getWorkExperience(workerId: number): Promise<WorkExperience[]>;
  createWorkExperience(entry: InsertWorkExperience): Promise<WorkExperience>;
  deleteWorkExperience(id: number): Promise<void>;
  updateWorkExperience(id: number, data: Partial<InsertWorkExperience>): Promise<WorkExperience>;
  bulkCreateWorkExperience(entries: InsertWorkExperience[]): Promise<void>;
  // OEM Experience
  getOemExperience(workerId: number): Promise<OemExperience[]>;
  upsertOemExperience(workerId: number, oem: string, equipmentType: string, yearsExperience?: number): Promise<OemExperience>;
  deleteOemExperience(id: number): Promise<void>;
  replaceOemExperience(workerId: number, entries: InsertOemExperience[]): Promise<void>;

  // Work Packages
  getWorkPackages(projectId: number): Promise<WorkPackage[]>;
  createWorkPackage(data: InsertWorkPackage): Promise<WorkPackage>;
  updateWorkPackage(id: number, data: Partial<InsertWorkPackage>): Promise<WorkPackage | undefined>;
  deleteWorkPackage(id: number): Promise<void>;

  // Daily Reports
  getDailyReport(projectId: number, date: string): Promise<DailyReport | undefined>;
  getDailyReports(projectId: number): Promise<DailyReport[]>;
  createDailyReport(data: InsertDailyReport): Promise<DailyReport>;
  updateDailyReport(id: number, data: Partial<InsertDailyReport>): Promise<DailyReport | undefined>;
  getWpProgress(reportId: number): Promise<DailyReportWpProgress[]>;
  upsertWpProgress(reportId: number, wpId: number, data: Partial<DailyReportWpProgress>): Promise<DailyReportWpProgress>;

  // Comments Log
  getCommentsLog(projectId: number): Promise<CommentsLog[]>;
  createCommentsLogEntry(data: InsertCommentsLog): Promise<CommentsLog>;
  updateCommentsLogEntry(id: number, entry: string, logDate: string): Promise<CommentsLog | undefined>;
  deleteCommentsLogEntry(id: number): Promise<void>;

  // Delay Approvals
  createDelayApproval(data: Omit<DelayApproval, 'id' | 'createdAt'>): Promise<DelayApproval>;
  getDelayApprovalByToken(token: string): Promise<DelayApproval | undefined>;
  updateDelayApproval(id: number, data: Partial<DelayApproval>): Promise<DelayApproval | undefined>;

  // Supervisor Reports
  getSupervisorReports(projectId: number): Promise<SupervisorReport[]>;
  getPendingSupervisorReports(): Promise<SupervisorReport[]>;
  createSupervisorReport(data: InsertSupervisorReport): Promise<SupervisorReport>;
  updateSupervisorReport(id: number, data: Partial<InsertSupervisorReport>): Promise<SupervisorReport | undefined>;

  // Role Slot Periods
  getRoleSlotPeriods(roleSlotId: number): Promise<RoleSlotPeriod[]>;
  getRoleSlotPeriodsByProject(projectId: number): Promise<RoleSlotPeriod[]>;
  getAllRoleSlotPeriods(): Promise<RoleSlotPeriod[]>;
  createRoleSlotPeriod(data: InsertRoleSlotPeriod): Promise<RoleSlotPeriod>;
  updateRoleSlotPeriod(id: number, data: Partial<InsertRoleSlotPeriod>): Promise<RoleSlotPeriod | undefined>;
  deleteRoleSlotPeriod(id: number): Promise<void>;
  recomputeRoleSlotDates(roleSlotId: number): Promise<void>;
  getWorkerActivePeriodsOnDate(workerId: number, date: string): Promise<RoleSlotPeriod[]>;

  // Public Holidays
  getPublicHolidays(countryCode: string, year: number): Promise<PublicHoliday[]>;
  isPublicHoliday(countryCode: string, date: string): Promise<boolean>;
  getSupervisorReportReplies(reportId: number): Promise<SupervisorReportReply[]>;
  createSupervisorReportReply(data: { reportId: number; authorId: number; message: string }): Promise<SupervisorReportReply>;

  // Toolbox Talks
  getToolboxTalks(projectId: number): Promise<ToolboxTalk[]>;
  createToolboxTalk(data: InsertToolboxTalk): Promise<ToolboxTalk>;
  updateToolboxTalk(id: number, data: Partial<InsertToolboxTalk>): Promise<ToolboxTalk | undefined>;
  deleteToolboxTalk(id: number): Promise<void>;

  // Safety Observations
  getSafetyObservations(projectId: number): Promise<SafetyObservation[]>;
  createSafetyObservation(data: InsertSafetyObservation): Promise<SafetyObservation>;
  updateSafetyObservation(id: number, data: Partial<InsertSafetyObservation>): Promise<SafetyObservation | undefined>;
  deleteSafetyObservation(id: number): Promise<void>;

  // Incident Reports
  getIncidentReports(projectId: number): Promise<IncidentReport[]>;
  createIncidentReport(data: InsertIncidentReport): Promise<IncidentReport>;
  updateIncidentReport(id: number, data: Partial<InsertIncidentReport>): Promise<IncidentReport | undefined>;
  deleteIncidentReport(id: number): Promise<void>;

  // Milestone Certificates
  getMilestoneCertificates(projectId: number): Promise<MilestoneCertificate[]>;
  createMilestoneCertificate(data: InsertMilestoneCertificate): Promise<MilestoneCertificate>;
  updateMilestoneCertificate(id: number, data: Partial<InsertMilestoneCertificate>): Promise<MilestoneCertificate | undefined>;
  getMilestoneCertificateByToken(token: string): Promise<MilestoneCertificate | undefined>;

  // Survey Tokens
  createSurveyToken(data: InsertSurveyToken): Promise<SurveyToken>;
  getSurveyTokenByToken(token: string): Promise<SurveyToken | undefined>;
  updateSurveyToken(id: number, data: Partial<SurveyToken>): Promise<SurveyToken | undefined>;
  getSurveyTokensByProject(projectId: number): Promise<SurveyToken[]>;

  // Survey Responses
  createSurveyResponse(data: InsertSurveyResponse): Promise<SurveyResponse>;
  getSurveyResponsesByProject(projectId: number): Promise<SurveyResponse[]>;
  createSurveyIndividualFeedback(data: InsertSurveyIndividualFeedback): Promise<SurveyIndividualFeedback>;
  getSurveyFeedbackByWorker(workerId: number): Promise<SurveyIndividualFeedback[]>;

  // Lessons Learned
  getLessonsLearned(projectId: number): Promise<LessonsLearned | undefined>;
  upsertLessonsLearned(data: InsertLessonsLearned): Promise<LessonsLearned>;
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

  async getDocumentById(id: number): Promise<Document | undefined> {
    return db.select().from(documents).where(eq(documents.id, id)).limit(1).then(r => r[0]);
  }

  async updateDocument(id: number, data: Partial<InsertDocument>): Promise<Document | undefined> {
    const rows = await db.update(documents).set(data).where(eq(documents.id, id)).returning();
    return rows[0];
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

  // Work Experience
  async getWorkExperience(workerId: number): Promise<WorkExperience[]> {
    return db.select().from(workExperience)
      .where(eq(workExperience.workerId, workerId))
      .orderBy(desc(workExperience.startDate));
  }

  async createWorkExperience(entry: InsertWorkExperience): Promise<WorkExperience> {
    const [row] = await db.insert(workExperience).values(entry).returning();
    return row;
  }

  async deleteWorkExperience(id: number): Promise<void> {
    await db.delete(workExperience).where(eq(workExperience.id, id));
  }

  async updateWorkExperience(id: number, data: Partial<InsertWorkExperience>): Promise<WorkExperience> {
    const updated = await db.update(workExperience).set(data).where(eq(workExperience.id, id)).returning();
    return updated[0];
  }

  async bulkCreateWorkExperience(entries: InsertWorkExperience[]): Promise<void> {
    if (entries.length === 0) return;
    await db.insert(workExperience).values(entries).execute();
  }

  // ── OEM Experience ──────────────────────────────────────────────
  async getOemExperience(workerId: number): Promise<OemExperience[]> {
    return db.select().from(oemExperience)
      .where(eq(oemExperience.workerId, workerId))
      .orderBy(oemExperience.oem);
  }

  async upsertOemExperience(workerId: number, oem: string, equipmentType: string, yearsExperience?: number): Promise<OemExperience> {
    // Try update first
    const existing = await db.select().from(oemExperience)
      .where(and(eq(oemExperience.workerId, workerId), eq(oemExperience.oem, oem), eq(oemExperience.equipmentType, equipmentType)))
      .limit(1);
    if (existing.length > 0) {
      const updated = await db.update(oemExperience)
        .set({ yearsExperience: yearsExperience ?? existing[0].yearsExperience })
        .where(eq(oemExperience.id, existing[0].id))
        .returning();
      return updated[0];
    }
    const created = await db.insert(oemExperience)
      .values({ workerId, oem, equipmentType, yearsExperience })
      .returning();
    return created[0];
  }

  async deleteOemExperience(id: number): Promise<void> {
    await db.delete(oemExperience).where(eq(oemExperience.id, id));
  }

  async replaceOemExperience(workerId: number, entries: InsertOemExperience[]): Promise<void> {
    await db.delete(oemExperience).where(eq(oemExperience.workerId, workerId));
    if (entries.length > 0) {
      await db.insert(oemExperience).values(entries).execute();
    }
  }

  // ── Work Packages ────────────────────────────────────────────
  async getWorkPackages(projectId: number): Promise<WorkPackage[]> {
    return db.select().from(workPackages)
      .where(eq(workPackages.projectId, projectId))
      .orderBy(workPackages.sortOrder);
  }

  async createWorkPackage(data: InsertWorkPackage): Promise<WorkPackage> {
    const [row] = await db.insert(workPackages).values(data).returning();
    return row;
  }

  async updateWorkPackage(id: number, data: Partial<InsertWorkPackage>): Promise<WorkPackage | undefined> {
    const [row] = await db.update(workPackages).set(data).where(eq(workPackages.id, id)).returning();
    return row;
  }

  async deleteWorkPackage(id: number): Promise<void> {
    await db.delete(workPackages).where(eq(workPackages.id, id));
  }

  // ── Daily Reports ─────────────────────────────────────────────
  async getDailyReport(projectId: number, date: string): Promise<DailyReport | undefined> {
    const [row] = await db.select().from(dailyReports)
      .where(and(eq(dailyReports.projectId, projectId), eq(dailyReports.reportDate, date)));
    return row;
  }

  async getDailyReports(projectId: number): Promise<DailyReport[]> {
    return db.select().from(dailyReports)
      .where(eq(dailyReports.projectId, projectId))
      .orderBy(desc(dailyReports.reportDate));
  }

  async createDailyReport(data: InsertDailyReport): Promise<DailyReport> {
    const [row] = await db.insert(dailyReports).values(data).returning();
    return row;
  }

  async updateDailyReport(id: number, data: Partial<InsertDailyReport>): Promise<DailyReport | undefined> {
    const [row] = await db.update(dailyReports)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(dailyReports.id, id))
      .returning();
    return row;
  }

  async getWpProgress(reportId: number): Promise<DailyReportWpProgress[]> {
    return db.select().from(dailyReportWpProgress)
      .where(eq(dailyReportWpProgress.reportId, reportId));
  }

  async upsertWpProgress(reportId: number, wpId: number, data: Partial<DailyReportWpProgress>): Promise<DailyReportWpProgress> {
    const [existing] = await db.select().from(dailyReportWpProgress)
      .where(and(eq(dailyReportWpProgress.reportId, reportId), eq(dailyReportWpProgress.wpId, wpId)));
    if (existing) {
      const [updated] = await db.update(dailyReportWpProgress)
        .set(data)
        .where(eq(dailyReportWpProgress.id, existing.id))
        .returning();
      return updated;
    }
    const [created] = await db.insert(dailyReportWpProgress)
      .values({ reportId, wpId, ...data })
      .returning();
    return created;
  }

  // ── Comments Log ──────────────────────────────────────────────
  async getCommentsLog(projectId: number): Promise<CommentsLog[]> {
    return db.select().from(commentsLog)
      .where(eq(commentsLog.projectId, projectId))
      .orderBy(desc(commentsLog.logDate), desc(commentsLog.enteredAt));
  }

  async createCommentsLogEntry(data: InsertCommentsLog): Promise<CommentsLog> {
    const [row] = await db.insert(commentsLog).values(data).returning();
    return row;
  }

  async updateCommentsLogEntry(id: number, entry: string, logDate: string): Promise<CommentsLog | undefined> {
    const [row] = await db.update(commentsLog)
      .set({ entry, logDate })
      .where(eq(commentsLog.id, id))
      .returning();
    return row;
  }

  async deleteCommentsLogEntry(id: number): Promise<void> {
    await db.delete(commentsLog).where(eq(commentsLog.id, id));
  }

  // ── Delay Approvals ───────────────────────────────────────────
  async createDelayApproval(data: Omit<DelayApproval, 'id' | 'createdAt'>): Promise<DelayApproval> {
    const [row] = await db.insert(delayApprovals).values(data as any).returning();
    return row;
  }

  async getDelayApprovalByToken(token: string): Promise<DelayApproval | undefined> {
    const [row] = await db.select().from(delayApprovals).where(eq(delayApprovals.token, token));
    return row;
  }

  async updateDelayApproval(id: number, data: Partial<DelayApproval>): Promise<DelayApproval | undefined> {
    const [row] = await db.update(delayApprovals).set(data as any).where(eq(delayApprovals.id, id)).returning();
    return row;
  }

  // ── Supervisor Reports ────────────────────────────────────────
  async getSupervisorReports(projectId: number): Promise<SupervisorReport[]> {
    return db.select().from(supervisorReports)
      .where(eq(supervisorReports.projectId, projectId))
      .orderBy(desc(supervisorReports.createdAt));
  }

  async getPendingSupervisorReports(): Promise<SupervisorReport[]> {
    return db.select().from(supervisorReports)
      .where(eq(supervisorReports.status, "pending_assignment"))
      .orderBy(desc(supervisorReports.createdAt));
  }

  async createSupervisorReport(data: InsertSupervisorReport): Promise<SupervisorReport> {
    const [row] = await db.insert(supervisorReports).values(data).returning();
    return row;
  }

  // ── Role Slot Periods ─────────────────────────────────────────────────
  async getRoleSlotPeriods(roleSlotId: number): Promise<RoleSlotPeriod[]> {
    return db.select().from(roleSlotPeriods)
      .where(eq(roleSlotPeriods.roleSlotId, roleSlotId))
      .orderBy(roleSlotPeriods.startDate);
  }

  async getRoleSlotPeriodsByProject(projectId: number): Promise<RoleSlotPeriod[]> {
    return db.select().from(roleSlotPeriods)
      .where(eq(roleSlotPeriods.projectId, projectId))
      .orderBy(roleSlotPeriods.startDate);
  }

  async getAllRoleSlotPeriods(): Promise<RoleSlotPeriod[]> {
    return db.select().from(roleSlotPeriods).orderBy(roleSlotPeriods.startDate);
  }

  async createRoleSlotPeriod(data: InsertRoleSlotPeriod): Promise<RoleSlotPeriod> {
    const [row] = await db.insert(roleSlotPeriods).values(data).returning();
    await this.recomputeRoleSlotDates(data.roleSlotId);
    return row;
  }

  async updateRoleSlotPeriod(id: number, data: Partial<InsertRoleSlotPeriod>): Promise<RoleSlotPeriod | undefined> {
    const [row] = await db.update(roleSlotPeriods).set(data).where(eq(roleSlotPeriods.id, id)).returning();
    if (row) await this.recomputeRoleSlotDates(row.roleSlotId);
    return row;
  }

  async deleteRoleSlotPeriod(id: number): Promise<void> {
    const [row] = await db.select().from(roleSlotPeriods).where(eq(roleSlotPeriods.id, id)).limit(1);
    if (row) {
      await db.delete(roleSlotPeriods).where(eq(roleSlotPeriods.id, id));
      await this.recomputeRoleSlotDates(row.roleSlotId);
    }
  }

  /** Recompute the role slot's startDate/endDate cache from its periods */
  async recomputeRoleSlotDates(roleSlotId: number): Promise<void> {
    const periods = await this.getRoleSlotPeriods(roleSlotId);
    if (periods.length === 0) return;
    const earliest = periods.reduce((min, p) => p.startDate < min ? p.startDate : min, periods[0].startDate);
    const latest = periods.reduce((max, p) => p.endDate > max ? p.endDate : max, periods[0].endDate);
    await db.update(roleSlots)
      .set({ startDate: earliest, endDate: latest })
      .where(eq(roleSlots.id, roleSlotId));
  }

  /** Get all role slot periods where a worker is assigned and active on a given date */
  async getWorkerActivePeriodsOnDate(workerId: number, date: string): Promise<RoleSlotPeriod[]> {
    const workerAssignments = await this.getAssignmentsByWorker(workerId);
    const slotIds = workerAssignments
      .filter(a => a.roleSlotId && ['active','confirmed','pending_confirmation'].includes(a.status || ''))
      .map(a => a.roleSlotId!);
    if (slotIds.length === 0) return [];
    const allPeriods = await this.getAllRoleSlotPeriods();
    return allPeriods.filter(p =>
      slotIds.includes(p.roleSlotId) &&
      p.startDate <= date && p.endDate >= date
    );
  }

  // ── Public Holidays ───────────────────────────────────────────────────
  async getPublicHolidays(countryCode: string, year: number): Promise<PublicHoliday[]> {
    return db.select().from(publicHolidays)
      .where(and(eq(publicHolidays.countryCode, countryCode), eq(publicHolidays.year, year)))
      .orderBy(publicHolidays.date);
  }

  async isPublicHoliday(countryCode: string, date: string): Promise<boolean> {
    const [row] = await db.select().from(publicHolidays)
      .where(and(eq(publicHolidays.countryCode, countryCode), eq(publicHolidays.date, date)))
      .limit(1);
    return !!row;
  }

  async updateSupervisorReport(id: number, data: Partial<InsertSupervisorReport>): Promise<SupervisorReport | undefined> {
    const [row] = await db.update(supervisorReports).set(data).where(eq(supervisorReports.id, id)).returning();
    return row;
  }

  async getSupervisorReportReplies(reportId: number): Promise<SupervisorReportReply[]> {
    return db.select().from(supervisorReportReplies)
      .where(eq(supervisorReportReplies.reportId, reportId))
      .orderBy(supervisorReportReplies.createdAt);
  }

  async createSupervisorReportReply(data: { reportId: number; authorId: number; message: string }): Promise<SupervisorReportReply> {
    const [row] = await db.insert(supervisorReportReplies).values(data).returning();
    return row;
  }

  // ── Toolbox Talks ─────────────────────────────────────────────
  async getToolboxTalks(projectId: number): Promise<ToolboxTalk[]> {
    return db.select().from(toolboxTalks)
      .where(eq(toolboxTalks.projectId, projectId))
      .orderBy(desc(toolboxTalks.createdAt));
  }

  async createToolboxTalk(data: InsertToolboxTalk): Promise<ToolboxTalk> {
    const [row] = await db.insert(toolboxTalks).values(data).returning();
    return row;
  }

  async updateToolboxTalk(id: number, data: Partial<InsertToolboxTalk>): Promise<ToolboxTalk | undefined> {
    const [row] = await db.update(toolboxTalks).set(data).where(eq(toolboxTalks.id, id)).returning();
    return row;
  }

  async deleteToolboxTalk(id: number): Promise<void> {
    await db.delete(toolboxTalks).where(eq(toolboxTalks.id, id));
  }

  // ── Safety Observations ───────────────────────────────────────
  async getSafetyObservations(projectId: number): Promise<SafetyObservation[]> {
    return db.select().from(safetyObservations)
      .where(eq(safetyObservations.projectId, projectId))
      .orderBy(desc(safetyObservations.createdAt));
  }

  async createSafetyObservation(data: InsertSafetyObservation): Promise<SafetyObservation> {
    const [row] = await db.insert(safetyObservations).values(data).returning();
    return row;
  }

  async updateSafetyObservation(id: number, data: Partial<InsertSafetyObservation>): Promise<SafetyObservation | undefined> {
    const [row] = await db.update(safetyObservations).set(data).where(eq(safetyObservations.id, id)).returning();
    return row;
  }

  async deleteSafetyObservation(id: number): Promise<void> {
    await db.delete(safetyObservations).where(eq(safetyObservations.id, id));
  }

  // ── Incident Reports ──────────────────────────────────────────
  async getIncidentReports(projectId: number): Promise<IncidentReport[]> {
    return db.select().from(incidentReports)
      .where(eq(incidentReports.projectId, projectId))
      .orderBy(desc(incidentReports.createdAt));
  }

  async createIncidentReport(data: InsertIncidentReport): Promise<IncidentReport> {
    const [row] = await db.insert(incidentReports).values(data).returning();
    return row;
  }

  async updateIncidentReport(id: number, data: Partial<InsertIncidentReport>): Promise<IncidentReport | undefined> {
    const [row] = await db.update(incidentReports).set(data).where(eq(incidentReports.id, id)).returning();
    return row;
  }

  async deleteIncidentReport(id: number): Promise<void> {
    await db.delete(incidentReports).where(eq(incidentReports.id, id));
  }

  // ── Milestone Certificates ────────────────────────────────────
  async getMilestoneCertificates(projectId: number): Promise<MilestoneCertificate[]> {
    return db.select().from(milestoneCertificates)
      .where(eq(milestoneCertificates.projectId, projectId))
      .orderBy(desc(milestoneCertificates.createdAt));
  }

  async createMilestoneCertificate(data: InsertMilestoneCertificate): Promise<MilestoneCertificate> {
    const [row] = await db.insert(milestoneCertificates).values(data).returning();
    return row;
  }

  async updateMilestoneCertificate(id: number, data: Partial<InsertMilestoneCertificate>): Promise<MilestoneCertificate | undefined> {
    const [row] = await db.update(milestoneCertificates).set(data as any).where(eq(milestoneCertificates.id, id)).returning();
    return row;
  }

  async getMilestoneCertificateByToken(token: string): Promise<MilestoneCertificate | undefined> {
    const [row] = await db.select().from(milestoneCertificates)
      .where(eq(milestoneCertificates.approvalToken, token));
    return row;
  }

  // ── Survey Tokens ────────────────────────────────────────────
  async createSurveyToken(data: InsertSurveyToken): Promise<SurveyToken> {
    const [row] = await db.insert(surveyTokens).values(data).returning();
    return row;
  }

  async getSurveyTokenByToken(token: string): Promise<SurveyToken | undefined> {
    const [row] = await db.select().from(surveyTokens).where(eq(surveyTokens.token, token));
    return row;
  }

  async updateSurveyToken(id: number, data: Partial<SurveyToken>): Promise<SurveyToken | undefined> {
    const [row] = await db.update(surveyTokens).set(data as any).where(eq(surveyTokens.id, id)).returning();
    return row;
  }

  async getSurveyTokensByProject(projectId: number): Promise<SurveyToken[]> {
    return db.select().from(surveyTokens)
      .where(eq(surveyTokens.projectId, projectId))
      .orderBy(desc(surveyTokens.createdAt));
  }

  // ── Survey Responses ─────────────────────────────────────────
  async createSurveyResponse(data: InsertSurveyResponse): Promise<SurveyResponse> {
    const [row] = await db.insert(surveyResponses).values(data).returning();
    return row;
  }

  async getSurveyResponsesByProject(projectId: number): Promise<SurveyResponse[]> {
    return db.select().from(surveyResponses)
      .where(eq(surveyResponses.projectId, projectId))
      .orderBy(desc(surveyResponses.submittedAt));
  }

  async createSurveyIndividualFeedback(data: InsertSurveyIndividualFeedback): Promise<SurveyIndividualFeedback> {
    const [row] = await db.insert(surveyIndividualFeedback).values(data).returning();
    return row;
  }

  async getSurveyFeedbackByWorker(workerId: number): Promise<SurveyIndividualFeedback[]> {
    return db.select().from(surveyIndividualFeedback)
      .where(eq(surveyIndividualFeedback.workerId, workerId))
      .orderBy(desc(surveyIndividualFeedback.submittedAt));
  }

  // ── Lessons Learned ──────────────────────────────────────────
  async getLessonsLearned(projectId: number): Promise<LessonsLearned | undefined> {
    const [row] = await db.select().from(lessonsLearned)
      .where(eq(lessonsLearned.projectId, projectId));
    return row;
  }

  async upsertLessonsLearned(data: InsertLessonsLearned): Promise<LessonsLearned> {
    // Check if a record exists for this project
    const existing = await this.getLessonsLearned(data.projectId);
    if (existing) {
      const [row] = await db.update(lessonsLearned)
        .set({ ...data, completedAt: new Date() } as any)
        .where(eq(lessonsLearned.projectId, data.projectId))
        .returning();
      return row;
    }
    const [row] = await db.insert(lessonsLearned).values(data).returning();
    return row;
  }
}

export const storage: IStorage = new PostgresStorage();
