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
  // Passport metadata
  passportExpiry: text("passport_expiry"),
  passportNumber: text("passport_number"),
  passportIssuingCountry: text("passport_issuing_country"),
  // Emergency contact
  emergencyContactName: text("emergency_contact_name"),
  emergencyContactPhone: text("emergency_contact_phone"),
  emergencyContactRelationship: text("emergency_contact_relationship"),
  // Profile / SQEP
  profileSummary: text("profile_summary"),
  // Employment type — clean separation from availability status
  employmentType: text("employment_type"), // 'FTE' | 'Temp'
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
  scopeOfWork: text("scope_of_work"),
  sourcingContact: text("sourcing_contact"),
  sourcingContactEmail: text("sourcing_contact_email"),
  customerProjectManager: text("customer_project_manager"),
  customerProjectManagerEmail: text("customer_project_manager_email"),
  siteManager: text("site_manager"),
  siteManagerEmail: text("site_manager_email"),
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
  // Populated by timesheet engine — drives real utilisation calc
  actualDaysWorked: integer("actual_days_worked"),
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

// ===== WORK EXPERIENCE =====
export const workExperience = pgTable("work_experience", {
  id: serial("id").primaryKey(),
  workerId: integer("worker_id").notNull().references(() => workers.id, { onDelete: "cascade" }),
  siteName: text("site_name").notNull(),
  startDate: text("start_date"),   // "2024" or "2024-06-01" — stored as text
  endDate: text("end_date"),
  role: text("role"),
  oem: text("oem"),
  equipmentType: text("equipment_type"),
  scopeOfWork: text("scope_of_work"),
  source: text("source").default("manual"),  // "manual" | "eid_import"
});

export const insertWorkExperienceSchema = createInsertSchema(workExperience).omit({ id: true });
export type InsertWorkExperience = z.infer<typeof insertWorkExperienceSchema>;
export type WorkExperience = typeof workExperience.$inferSelect;

// ===== OEM EXPERIENCE =====
// Proper relational table — enables fast queries like:
// "All Tech2+ available in April with GE STV experience and B1+ English"
export const oemExperience = pgTable("oem_experience", {
  id: serial("id").primaryKey(),
  workerId: integer("worker_id").notNull().references(() => workers.id, { onDelete: "cascade" }),
  oem: text("oem").notNull(),               // e.g. 'GE Vernova', 'Mitsubishi Power'
  equipmentType: text("equipment_type").notNull(), // e.g. 'GT', 'ST', 'STV'
  yearsExperience: real("years_experience"), // derived from work_experience entries
  notes: text("notes"),
});

export const insertOemExperienceSchema = createInsertSchema(oemExperience).omit({ id: true });
export type InsertOemExperience = z.infer<typeof insertOemExperienceSchema>;
export type OemExperience = typeof oemExperience.$inferSelect;

// ===== WORK PACKAGES =====
// Structured WP records per project — replaces scopeOfWork text blob for lump-sum projects
export const workPackages = pgTable("work_packages", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  plannedStart: text("planned_start"),
  plannedFinish: text("planned_finish"),
  contractedValue: real("contracted_value"),
  sortOrder: integer("sort_order").default(0),
});
export const insertWorkPackageSchema = createInsertSchema(workPackages).omit({ id: true });
export type WorkPackage = typeof workPackages.$inferSelect;
export type InsertWorkPackage = z.infer<typeof insertWorkPackageSchema>;

// ===== DAILY REPORTS =====
export const dailyReports = pgTable("daily_reports", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  reportDate: text("report_date").notNull(), // "YYYY-MM-DD"
  createdBy: integer("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  // 2.2 Completed Tasks (JSON array)
  completedTasks: jsonb("completed_tasks").default([]),
  // 2.3 Delays Log (JSON array)
  delaysLog: jsonb("delays_log").default([]),
  // 2.5 Outage Personnel daily notes (JSON: {workerId: note})
  personnelNotes: jsonb("personnel_notes").default({}),
  // 2.6 Tooling & Consumables (JSON array)
  toolingItems: jsonb("tooling_items").default([]),
  // 2.7 Financial summary variations (JSON: {wpId: variationAmount})
  wpVariations: jsonb("wp_variations").default({}),
  // Portal publish flag
  publishedToPortal: boolean("published_to_portal").default(false),
  emailNotificationSent: boolean("email_notification_sent").default(false),
});
export const insertDailyReportSchema = createInsertSchema(dailyReports).omit({ id: true });
export type DailyReport = typeof dailyReports.$inferSelect;
export type InsertDailyReport = z.infer<typeof insertDailyReportSchema>;

// ===== DAILY REPORT WP PROGRESS =====
// Per-WP actual dates + sign-off status per report
export const dailyReportWpProgress = pgTable("daily_report_wp_progress", {
  id: serial("id").primaryKey(),
  reportId: integer("report_id").notNull().references(() => dailyReports.id, { onDelete: "cascade" }),
  wpId: integer("wp_id").notNull().references(() => workPackages.id, { onDelete: "cascade" }),
  actualStart: text("actual_start"),
  actualFinish: text("actual_finish"),
  signOffStatus: text("sign_off_status").default("pending"), // "pending" | "signed_off"
  comments: text("comments"),
});
export const insertDailyReportWpProgressSchema = createInsertSchema(dailyReportWpProgress).omit({ id: true });
export type DailyReportWpProgress = typeof dailyReportWpProgress.$inferSelect;

// ===== COMMENTS & CONCERNS LOG =====
// Persistent project-level log — not per-report
export const commentsLog = pgTable("comments_log", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  reportId: integer("report_id").references(() => dailyReports.id, { onDelete: "set null" }),
  enteredAt: timestamp("entered_at").defaultNow(),
  enteredBy: integer("entered_by").notNull().references(() => users.id),
  entry: text("entry").notNull(),
});
export const insertCommentsLogSchema = createInsertSchema(commentsLog).omit({ id: true });
export type CommentsLog = typeof commentsLog.$inferSelect;
export type InsertCommentsLog = z.infer<typeof insertCommentsLogSchema>;

// ===== DELAY APPROVALS =====
// Verified email approval record for customer-approved delays
export const delayApprovals = pgTable("delay_approvals", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  reportId: integer("report_id").notNull().references(() => dailyReports.id, { onDelete: "cascade" }),
  delayIndex: integer("delay_index").notNull(), // index in delaysLog JSON array
  token: text("token").notNull().unique(),
  tokenExpiry: timestamp("token_expiry").notNull(),
  recipientEmail: text("recipient_email").notNull(),
  recipientName: text("recipient_name"),
  status: text("status").default("pending"), // "pending" | "approved" | "rejected" | "expired"
  respondedAt: timestamp("responded_at"),
  respondedIp: text("responded_ip"),
  createdAt: timestamp("created_at").defaultNow(),
});
export const insertDelayApprovalSchema = createInsertSchema(delayApprovals).omit({ id: true });
export type DelayApproval = typeof delayApprovals.$inferSelect;

// ===== SUPERVISOR REPORTS =====
export const supervisorReports = pgTable("supervisor_reports", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  workerId: integer("worker_id").references(() => workers.id, { onDelete: "set null" }), // null = unrecognised sender
  reportDate: text("report_date").notNull(),
  shift: text("shift"), // "day" | "night" | null
  submissionMethod: text("submission_method").notNull(), // "email" | "upload"
  senderEmail: text("sender_email"),
  filePath: text("file_path"),
  fileName: text("file_name"),
  documentType: text("document_type"), // "supervisor_report" | "tbt" | "safety_obs" | "incident" | "unknown"
  status: text("status").default("filed"), // "filed" | "pending_assignment"
  createdAt: timestamp("created_at").defaultNow(),
  pendingAssignmentNote: text("pending_assignment_note"),
});
export const insertSupervisorReportSchema = createInsertSchema(supervisorReports).omit({ id: true });
export type SupervisorReport = typeof supervisorReports.$inferSelect;
export type InsertSupervisorReport = z.infer<typeof insertSupervisorReportSchema>;

// ===== SUPERVISOR REPORT REPLIES =====
export const supervisorReportReplies = pgTable("supervisor_report_replies", {
  id: serial("id").primaryKey(),
  reportId: integer("report_id").notNull().references(() => supervisorReports.id, { onDelete: "cascade" }),
  authorId: integer("author_id").notNull().references(() => users.id),
  message: text("message").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});
export const insertSupervisorReportReplySchema = createInsertSchema(supervisorReportReplies).omit({ id: true });
export type SupervisorReportReply = typeof supervisorReportReplies.$inferSelect;

// ===== QHSE — TOOLBOX TALKS =====
export const toolboxTalks = pgTable("toolbox_talks", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  workerId: integer("worker_id").references(() => workers.id, { onDelete: "set null" }),
  reportDate: text("report_date").notNull(),
  shift: text("shift"),
  topic: text("topic"),
  attendeeCount: integer("attendee_count"),
  filePath: text("file_path"),
  fileName: text("file_name"),
  notes: text("notes"),
  submissionMethod: text("submission_method").default("upload"),
  createdAt: timestamp("created_at").defaultNow(),
});
export const insertToolboxTalkSchema = createInsertSchema(toolboxTalks).omit({ id: true });
export type ToolboxTalk = typeof toolboxTalks.$inferSelect;
export type InsertToolboxTalk = z.infer<typeof insertToolboxTalkSchema>;

// ===== QHSE — SAFETY OBSERVATIONS =====
export const safetyObservations = pgTable("safety_observations", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  reportedByWorkerId: integer("reported_by_worker_id").references(() => workers.id, { onDelete: "set null" }),
  relatesToWorkerIds: jsonb("relates_to_worker_ids").default([]),
  shiftSupervisorId: integer("shift_supervisor_id").references(() => workers.id, { onDelete: "set null" }),
  observationDate: text("observation_date").notNull(),
  observationTime: text("observation_time"),
  shift: text("shift"),
  observationType: text("observation_type").notNull(), // "positive" | "unsafe_condition" | "negative" | "stop_work"
  locationOnSite: text("location_on_site"),
  description: text("description"),
  actionsTaken: text("actions_taken"),
  filePath: text("file_path"),
  fileName: text("file_name"),
  status: text("status").default("open"), // "open" | "closed"
  submissionMethod: text("submission_method").default("upload"),
  createdAt: timestamp("created_at").defaultNow(),
});
export const insertSafetyObservationSchema = createInsertSchema(safetyObservations).omit({ id: true });
export type SafetyObservation = typeof safetyObservations.$inferSelect;
export type InsertSafetyObservation = z.infer<typeof insertSafetyObservationSchema>;

// ===== QHSE — INCIDENT REPORTS =====
export const incidentReports = pgTable("incident_reports", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  workerInvolvedId: integer("worker_involved_id").references(() => workers.id, { onDelete: "set null" }),
  reportedByWorkerId: integer("reported_by_worker_id").references(() => workers.id, { onDelete: "set null" }),
  shiftSupervisorId: integer("shift_supervisor_id").references(() => workers.id, { onDelete: "set null" }),
  incidentDate: text("incident_date").notNull(),
  incidentTime: text("incident_time"),
  shift: text("shift"),
  incidentType: text("incident_type").notNull(), // "near_miss" | "first_aid" | "medical_treatment" | "lost_time_injury" | "dangerous_occurrence"
  description: text("description"),
  lostTime: boolean("lost_time").default(false),
  lostTimeHours: real("lost_time_hours"),
  actionsTaken: text("actions_taken"),
  rootCause: text("root_cause"),
  filePath: text("file_path"),
  fileName: text("file_name"),
  status: text("status").default("open"), // "open" | "under_investigation" | "closed"
  submissionMethod: text("submission_method").default("upload"),
  createdAt: timestamp("created_at").defaultNow(),
});
export const insertIncidentReportSchema = createInsertSchema(incidentReports).omit({ id: true });
export type IncidentReport = typeof incidentReports.$inferSelect;
export type InsertIncidentReport = z.infer<typeof insertIncidentReportSchema>;

// ===== MILESTONE CERTIFICATES =====
export const milestoneCertificates = pgTable("milestone_certificates", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  wpId: integer("wp_id").references(() => workPackages.id, { onDelete: "set null" }),
  milestoneNumber: text("milestone_number"),
  status: text("status").default("draft"), // "draft" | "sent" | "approved" | "rejected"
  variationsClaimed: real("variations_claimed").default(0),
  comments: text("comments"),
  // Scope completion checkboxes
  mechanicalComplete: boolean("mechanical_complete").default(false),
  inspectionQaComplete: boolean("inspection_qa_complete").default(false),
  testingComplete: boolean("testing_complete").default(false),
  documentationComplete: boolean("documentation_complete").default(false),
  snagsClosed: boolean("snags_closed").default(false),
  // Approval fields
  approvalToken: text("approval_token").unique(),
  approvalTokenExpiry: timestamp("approval_token_expiry"),
  approvedAt: timestamp("approved_at"),
  approverEmail: text("approver_email"),
  approverName: text("approver_name"),
  approverIp: text("approver_ip"),
  // PDF paths
  draftPdfPath: text("draft_pdf_path"),
  signedPdfPath: text("signed_pdf_path"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  sentAt: timestamp("sent_at"),
});
export const insertMilestoneCertificateSchema = createInsertSchema(milestoneCertificates).omit({ id: true });
export type MilestoneCertificate = typeof milestoneCertificates.$inferSelect;
export type InsertMilestoneCertificate = z.infer<typeof insertMilestoneCertificateSchema>;

// ===== SURVEY TOKENS =====
export const surveyTokens = pgTable("survey_tokens", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  contactEmail: text("contact_email").notNull(),
  contactName: text("contact_name"),
  contactRole: text("contact_role"), // "pm" | "site_manager"
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  reminderSentAt: timestamp("reminder_sent_at"),
  finalReminderSentAt: timestamp("final_reminder_sent_at"),
  createdAt: timestamp("created_at").defaultNow(),
});
export const insertSurveyTokenSchema = createInsertSchema(surveyTokens).omit({ id: true });
export type SurveyToken = typeof surveyTokens.$inferSelect;
export type InsertSurveyToken = z.infer<typeof insertSurveyTokenSchema>;

// ===== SURVEY RESPONSES =====
export const surveyResponses = pgTable("survey_responses", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  tokenId: integer("token_id").references(() => surveyTokens.id, { onDelete: "set null" }),
  contactEmail: text("contact_email").notNull(),
  contactName: text("contact_name"),
  submittedAt: timestamp("submitted_at").defaultNow(),
  submitterIp: text("submitter_ip"),
  q1Planning: integer("q1_planning"),       // 1-5
  q2Quality: integer("q2_quality"),          // 1-5
  q3Hse: integer("q3_hse"),                  // 1-5
  q4Supervision: integer("q4_supervision"), // 1-5
  q5Pm: integer("q5_pm"),                    // 1-5
  q6Overall: integer("q6_overall"),          // 1-5
  averageScore: real("average_score"),       // computed: avg(q1-q6)
  nps: integer("nps"),                       // 0-10
  openFeedback: text("open_feedback"),
  individualFeedbackGiven: boolean("individual_feedback_given").default(false),
});
export const insertSurveyResponseSchema = createInsertSchema(surveyResponses).omit({ id: true });
export type SurveyResponse = typeof surveyResponses.$inferSelect;
export type InsertSurveyResponse = z.infer<typeof insertSurveyResponseSchema>;

// ===== SURVEY INDIVIDUAL FEEDBACK =====
export const surveyIndividualFeedback = pgTable("survey_individual_feedback", {
  id: serial("id").primaryKey(),
  surveyResponseId: integer("survey_response_id").notNull().references(() => surveyResponses.id, { onDelete: "cascade" }),
  workerId: integer("worker_id").notNull().references(() => workers.id, { onDelete: "cascade" }),
  comment: text("comment"),
  submittedAt: timestamp("submitted_at").defaultNow(),
});
export const insertSurveyIndividualFeedbackSchema = createInsertSchema(surveyIndividualFeedback).omit({ id: true });
export type SurveyIndividualFeedback = typeof surveyIndividualFeedback.$inferSelect;
export type InsertSurveyIndividualFeedback = z.infer<typeof insertSurveyIndividualFeedbackSchema>;

// ===== LESSONS LEARNED =====
export const lessonsLearned = pgTable("lessons_learned", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  completedBy: integer("completed_by").notNull().references(() => users.id),
  completedAt: timestamp("completed_at").defaultNow(),
  overallAssessment: text("overall_assessment"), // "excellent"|"good"|"satisfactory"|"below_expectations"|"poor"
  wentWell: text("went_well"),
  couldImprove: text("could_improve"),
  qhsePerformance: text("qhse_performance"),
  qhseNotes: text("qhse_notes"),
  commercialPerformance: text("commercial_performance"),
  commercialNotes: text("commercial_notes"),
  customerRelationship: text("customer_relationship"),
  customerRelationshipNotes: text("customer_relationship_notes"),
  sameTeamAgain: text("same_team_again"),
  sameTeamNotes: text("same_team_notes"),
  additionalNotes: text("additional_notes"),
  actionPoints: jsonb("action_points").default([]), // [{action, owner, dueDate, status}]
});
export const insertLessonsLearnedSchema = createInsertSchema(lessonsLearned).omit({ id: true });
export type LessonsLearned = typeof lessonsLearned.$inferSelect;
export type InsertLessonsLearned = z.infer<typeof insertLessonsLearnedSchema>;
