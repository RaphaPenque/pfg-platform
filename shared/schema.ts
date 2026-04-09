import { pgTable, serial, text, integer, real, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ===== WORKERS =====
export const workers = pgTable("workers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  status: text("status").notNull(),
  nationality: text("nationality"),
  age: text("age"),
  joined: text("joined"),
  ctc: text("ctc"),
  englishLevel: text("english_level"),
  techLevel: text("tech_level"),
  measuringSkills: text("measuring_skills"),
  countryCode: text("country_code"),
  comments: text("comments"),
  experienceScore: real("experience_score"),
  technicalScore: real("technical_score"),
  attitudeScore: real("attitude_score"),
  oemFocus: text("oem_focus"),
  oemExperience: text("oem_experience"),
  dateOfBirth: text("date_of_birth"),
  costCentre: text("cost_centre"),
  roles: text("roles"),
  profilePhotoPath: text("profile_photo_path"),
  passportPath: text("passport_path"),
  driversLicense: text("drivers_license"),
  driversLicenseUploaded: integer("drivers_license_uploaded"),
  personalEmail: text("personal_email"),
  workEmail: text("work_email"),
  phone: text("phone"),
  phoneSecondary: text("phone_secondary"),
  address: text("address"),
  coverallSize: text("coverall_size"),
  bootSize: text("boot_size"),
  localAirport: text("local_airport"),
});

export const insertWorkerSchema = createInsertSchema(workers).omit({ id: true });
export type InsertWorker = z.infer<typeof insertWorkerSchema>;
export type Worker = typeof workers.$inferSelect;

// ===== PROJECTS =====
export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  customer: text("customer"),
  location: text("location"),
  equipmentType: text("equipment_type"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  shift: text("shift"),
  headcount: integer("headcount"),
  notes: text("notes"),
  status: text("status").default("active"),
  contractType: text("contract_type"),
  siteName: text("site_name"),
  siteAddress: text("site_address"),
  sourcingContact: text("sourcing_contact"),
  customerProjectManager: text("customer_project_manager"),
  siteManager: text("site_manager"),
  timesheetSignatoryName: text("timesheet_signatory_name"),
  timesheetSignatoryEmail: text("timesheet_signatory_email"),
});

export const insertProjectSchema = createInsertSchema(projects).omit({ id: true });
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projects.$inferSelect;

// ===== ROLE SLOTS =====
export const roleSlots = pgTable("role_slots", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id),
  role: text("role").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  quantity: integer("quantity").notNull().default(1),
  shift: text("shift").default("Day"),
});

export const insertRoleSlotSchema = createInsertSchema(roleSlots).omit({ id: true });
export type InsertRoleSlot = z.infer<typeof insertRoleSlotSchema>;
export type RoleSlot = typeof roleSlots.$inferSelect;

// ===== ASSIGNMENTS =====
export const assignments = pgTable("assignments", {
  id: serial("id").primaryKey(),
  workerId: integer("worker_id").notNull().references(() => workers.id),
  projectId: integer("project_id").notNull().references(() => projects.id),
  roleSlotId: integer("role_slot_id").references(() => roleSlots.id),
  task: text("task"),
  role: text("role"),
  shift: text("shift"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  duration: integer("duration"),
  status: text("status").default("active"),
  confirmationToken: text("confirmation_token"),
  confirmationSentAt: text("confirmation_sent_at"),
  confirmedAt: text("confirmed_at"),
  declinedAt: text("declined_at"),
});

export const insertAssignmentSchema = createInsertSchema(assignments).omit({ id: true });
export type InsertAssignment = z.infer<typeof insertAssignmentSchema>;
export type Assignment = typeof assignments.$inferSelect;

// ===== DOCUMENTS =====
export const documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  workerId: integer("worker_id").notNull().references(() => workers.id),
  type: text("type").notNull(),
  name: text("name").notNull(),
  fileName: text("file_name"),
  filePath: text("file_path"),
  fileSize: integer("file_size"),
  mimeType: text("mime_type"),
  expiryDate: text("expiry_date"),
  issuedDate: text("issued_date"),
  status: text("status").default("valid"),
  uploadedAt: text("uploaded_at"),
  notes: text("notes"),
});

export const insertDocumentSchema = createInsertSchema(documents).omit({ id: true });
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type Document = typeof documents.$inferSelect;

// ===== OEM TAXONOMY =====
export const oemTypes = pgTable("oem_types", {
  id: serial("id").primaryKey(),
  oem: text("oem").notNull(),
  equipmentType: text("equipment_type").notNull(),
  brandColor: text("brand_color"),
});

export const insertOemTypeSchema = createInsertSchema(oemTypes).omit({ id: true });
export type InsertOemType = z.infer<typeof insertOemTypeSchema>;
export type OemType = typeof oemTypes.$inferSelect;

// ===== USERS (Auth) =====
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: text("role").notNull(), // admin | resource_manager | project_manager | finance | observer
  createdAt: timestamp("created_at").defaultNow(),
  lastLoginAt: timestamp("last_login_at"),
  isActive: boolean("is_active").default(true),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// ===== MAGIC LINKS =====
export const magicLinks = pgTable("magic_links", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type MagicLink = typeof magicLinks.$inferSelect;

// ===== SESSIONS =====
export const sessions = pgTable("sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  userAgent: text("user_agent"),
  ipAddress: text("ip_address"),
});

export type Session = typeof sessions.$inferSelect;

// ===== AUDIT LOGS =====
export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  entityName: text("entity_name"),
  changes: jsonb("changes"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type AuditLog = typeof auditLogs.$inferSelect;

// ===== PROJECT LEADS =====
export const projectLeads = pgTable("project_leads", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id),
  userId: integer("user_id").notNull().references(() => users.id),
  assignedAt: timestamp("assigned_at").defaultNow(),
});

export type ProjectLead = typeof projectLeads.$inferSelect;

// ===== PAYROLL RULES =====
// One rule set per Cost Centre — drives payroll breakdown in the timesheet engine
export const payrollRules = pgTable("payroll_rules", {
  id: serial("id").primaryKey(),
  costCentre: text("cost_centre").notNull().unique(), // must match COST_CENTRES constant
  countryCode: text("country_code").notNull(),        // ISO 3166-1 alpha-2, e.g. "HR", "ES"
  countryName: text("country_name").notNull(),

  // Weekly OT threshold (null = no weekly OT tracking)
  weeklyOtThresholdHours: integer("weekly_ot_threshold_hours"),

  // Annual OT threshold (null = no annual OT tracking)
  // For Spain: 1600 hrs/calendar year, hours above = OT
  annualOtThresholdHours: integer("annual_ot_threshold_hours"),

  // Night shift tracking (null start/end = not tracked)
  nightShiftStart: text("night_shift_start"),  // "22:00"
  nightShiftEnd: text("night_shift_end"),      // "06:00"

  // Sunday hours tracked separately
  trackSundayHours: boolean("track_sunday_hours").default(false).notNull(),

  // Standby day rate (hours equivalent, default 8)
  standbyDayHours: integer("standby_day_hours").default(8).notNull(),

  notes: text("notes"),
  updatedAt: timestamp("updated_at").defaultNow(),
  updatedBy: integer("updated_by").references(() => users.id),
});

export const insertPayrollRulesSchema = createInsertSchema(payrollRules).omit({ id: true });
export type PayrollRule = typeof payrollRules.$inferSelect;
export type InsertPayrollRule = typeof insertPayrollRulesSchema._type;
