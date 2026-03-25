import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ===== WORKERS =====
export const workers = sqliteTable("workers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  role: text("role").notNull(), // Supervisor, Mechanical Technician, General Operative, etc.
  status: text("status").notNull(), // FTE or Temp
  nationality: text("nationality"),
  age: text("age"),
  joined: text("joined"), // ISO date
  ctc: text("ctc"), // Yes/No
  englishLevel: text("english_level"), // A1-C2 or TBC
  techLevel: text("tech_level"), // Tech 1, Tech 2, Tech 3
  measuringSkills: text("measuring_skills"), // Yes/No/TBC
  countryCode: text("country_code"), // e.g. PFG PO CTC, PFG SP, CO, etc.
  comments: text("comments"),
  experienceScore: real("experience_score"),
  technicalScore: real("technical_score"),
  attitudeScore: real("attitude_score"),
  oemFocus: text("oem_focus"),
  // OEM experience stored as JSON array: ["GE Vernova - ST", "Arabelle Solutions - STV"]
  oemExperience: text("oem_experience"), // JSON string array
  dateOfBirth: text("date_of_birth"), // ISO date
  costCentre: text("cost_centre"), // only for FTE workers
  roles: text("roles"), // JSON array of role strings
  profilePhotoPath: text("profile_photo_path"), // file path for uploaded photo
  passportPath: text("passport_path"), // file path for passport scan
  driversLicense: text("drivers_license"), // expiry date ISO string or null
  driversLicenseUploaded: integer("drivers_license_uploaded"), // 0 or 1
});

export const insertWorkerSchema = createInsertSchema(workers).omit({ id: true });
export type InsertWorker = z.infer<typeof insertWorkerSchema>;
export type Worker = typeof workers.$inferSelect;

// ===== PROJECTS =====
export const projects = sqliteTable("projects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  customer: text("customer"), // Arabelle Solutions, GE Vernova, Mitsubishi Power, etc.
  location: text("location"),
  equipmentType: text("equipment_type"), // GT, ST, STV, GEN, COMP
  startDate: text("start_date"), // ISO date
  endDate: text("end_date"), // ISO date
  shift: text("shift"), // Day, Night, Day + Night
  headcount: integer("headcount"),
  notes: text("notes"),
  status: text("status").default("active"), // active, completed, cancelled
});

export const insertProjectSchema = createInsertSchema(projects).omit({ id: true });
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projects.$inferSelect;

// ===== ROLE SLOTS =====
// Defines the roles needed on a project with specific dates and quantities
export const roleSlots = sqliteTable("role_slots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").notNull().references(() => projects.id),
  role: text("role").notNull(), // Superintendent, Foreman, Lead Technician, etc.
  startDate: text("start_date").notNull(), // ISO date
  endDate: text("end_date").notNull(), // ISO date
  quantity: integer("quantity").notNull().default(1),
  shift: text("shift").default("Day"), // Day, Night
});

export const insertRoleSlotSchema = createInsertSchema(roleSlots).omit({ id: true });
export type InsertRoleSlot = z.infer<typeof insertRoleSlotSchema>;
export type RoleSlot = typeof roleSlots.$inferSelect;

// ===== ASSIGNMENTS =====
// Links workers to specific role slots (not directly to projects)
export const assignments = sqliteTable("assignments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workerId: integer("worker_id").notNull().references(() => workers.id),
  projectId: integer("project_id").notNull().references(() => projects.id),
  roleSlotId: integer("role_slot_id").references(() => roleSlots.id), // null for legacy data
  task: text("task"),
  role: text("role"), // the role they're filling
  shift: text("shift"), // Day, Night, TBC
  startDate: text("start_date"), // ISO date — from the role slot, not the project
  endDate: text("end_date"), // ISO date — from the role slot, not the project
  duration: integer("duration"), // calendar days
  status: text("status").default("active"), // active, completed, removed
});

export const insertAssignmentSchema = createInsertSchema(assignments).omit({ id: true });
export type InsertAssignment = z.infer<typeof insertAssignmentSchema>;
export type Assignment = typeof assignments.$inferSelect;

// ===== DOCUMENTS =====
// Files attached to workers: passports, certs, diplomas, timesheets, etc.
export const documents = sqliteTable("documents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workerId: integer("worker_id").notNull().references(() => workers.id),
  type: text("type").notNull(), // passport, visa, safety_cert, diploma, timesheet, other
  name: text("name").notNull(), // Display name
  fileName: text("file_name"), // Original file name
  filePath: text("file_path"), // Storage path (R2/local)
  fileSize: integer("file_size"), // bytes
  mimeType: text("mime_type"),
  expiryDate: text("expiry_date"), // ISO date (for certs)
  issuedDate: text("issued_date"), // ISO date
  status: text("status").default("valid"), // valid, expiring, expired
  uploadedAt: text("uploaded_at"), // ISO datetime
  notes: text("notes"),
});

export const insertDocumentSchema = createInsertSchema(documents).omit({ id: true });
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type Document = typeof documents.$inferSelect;

// ===== OEM TAXONOMY =====
// Reference table for the standardised OEM + Equipment Type combinations
export const oemTypes = sqliteTable("oem_types", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  oem: text("oem").notNull(), // GE Vernova, Mitsubishi Power, etc.
  equipmentType: text("equipment_type").notNull(), // GT, ST, STV, GEN, COMP
  brandColor: text("brand_color"), // hex colour for UI
});

export const insertOemTypeSchema = createInsertSchema(oemTypes).omit({ id: true });
export type InsertOemType = z.infer<typeof insertOemTypeSchema>;
export type OemType = typeof oemTypes.$inferSelect;
