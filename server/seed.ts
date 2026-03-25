/**
 * Seed the database with existing PFG data
 * Run with: npx tsx server/seed.ts
 */
import { db } from "./storage";
import { workers, projects, assignments, oemTypes } from "@shared/schema";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read existing data files
const workforceData = JSON.parse(readFileSync(resolve(__dirname, "../../pfg_workforce_data.json"), "utf-8"));
const scheduleData = JSON.parse(readFileSync(resolve(__dirname, "../../pfg_schedule_data.json"), "utf-8"));

console.log(`Loaded ${workforceData.length} workers, ${scheduleData.projects.length} projects, ${scheduleData.assignments.length} assignments`);

// Create tables (Drizzle push)
import Database from "better-sqlite3";
const sqlite = new Database("pfg.db");

// Create tables manually since we can't use drizzle-kit push in seed
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS workers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    status TEXT NOT NULL,
    nationality TEXT,
    age TEXT,
    joined TEXT,
    ctc TEXT,
    english_level TEXT,
    tech_level TEXT,
    measuring_skills TEXT,
    country_code TEXT,
    comments TEXT,
    experience_score REAL,
    technical_score REAL,
    attitude_score REAL,
    oem_focus TEXT,
    oem_experience TEXT
  );

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    customer TEXT,
    location TEXT,
    equipment_type TEXT,
    start_date TEXT,
    end_date TEXT,
    shift TEXT,
    headcount INTEGER,
    notes TEXT,
    status TEXT DEFAULT 'active'
  );

  CREATE TABLE IF NOT EXISTS assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    worker_id INTEGER NOT NULL REFERENCES workers(id),
    project_id INTEGER NOT NULL REFERENCES projects(id),
    task TEXT,
    shift TEXT,
    start_date TEXT,
    end_date TEXT,
    duration INTEGER,
    status TEXT DEFAULT 'active'
  );

  CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    worker_id INTEGER NOT NULL REFERENCES workers(id),
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    file_name TEXT,
    file_path TEXT,
    file_size INTEGER,
    mime_type TEXT,
    expiry_date TEXT,
    issued_date TEXT,
    status TEXT DEFAULT 'valid',
    uploaded_at TEXT,
    notes TEXT
  );

  CREATE TABLE IF NOT EXISTS oem_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    oem TEXT NOT NULL,
    equipment_type TEXT NOT NULL,
    brand_color TEXT
  );
`);

// Clear existing data
sqlite.exec("DELETE FROM assignments; DELETE FROM projects; DELETE FROM workers; DELETE FROM oem_types;");

// Customer mapping for projects
const customerMap: Record<string, { customer: string; location: string; equipType: string }> = {
  'FSAP': { customer: 'Fosap Logistics', location: 'Kumasi, Ghana', equipType: 'GT' },
  'HYSHM': { customer: 'Arabelle Solutions', location: 'Heysham, UK', equipType: 'STV' },
  'TRNS': { customer: 'Arabelle Solutions', location: 'Torness, UK', equipType: 'ST' },
  'NOMAC': { customer: 'NOMAC', location: 'Dubai, UAE', equipType: 'ST' },
  'SVRN': { customer: 'Siemens Energy', location: 'Severn, UK', equipType: 'ST' },
  'TRNZN': { customer: 'Sulzer', location: 'Terneuzen, Netherlands', equipType: 'GT' },
  'NMES': { customer: 'NMES', location: 'Philippines', equipType: 'ST' },
  'GNT': { customer: 'GE Vernova', location: 'Gent, Belgium', equipType: 'ST' },
  'SALT': { customer: 'Mitsubishi Power', location: 'Saltend, UK', equipType: 'GT' },
  'OSKSHM': { customer: 'Arabelle Solutions', location: 'Oskarshamn, Sweden', equipType: 'ST' },
  'OLKL2': { customer: 'Arabelle Solutions', location: 'Olkiluoto, Finland', equipType: 'GEN' },
  'GRTY': { customer: 'GE Vernova', location: 'Great Yarmouth, UK', equipType: 'ST' },
  'OLKL1': { customer: 'Arabelle Solutions', location: 'Olkiluoto, Finland', equipType: 'ST' },
  'GMKD': { customer: 'Geman', location: 'Macedonia', equipType: 'GT' },
  'GIL': { customer: 'Mitsubishi Power', location: 'Great Island, Ireland', equipType: 'GT' },
  'SZWL': { customer: 'Arabelle Solutions', location: 'Sizewell, UK', equipType: 'ST' },
  'DHC': { customer: 'Mitsubishi Power', location: 'Damhead Creek, UK', equipType: 'STV' },
};

// 1. Insert workers
console.log("Inserting workers...");
const workerIdMap = new Map<string, number>();

for (const w of workforceData) {
  const result = db.insert(workers).values({
    name: w.name,
    role: w.role || 'Mechanical Technician',
    status: w.status || 'Temp',
    nationality: w.nationality || null,
    age: w.age || null,
    joined: w.joined || null,
    ctc: w.ctc || null,
    englishLevel: w.english_level || null,
    techLevel: w.tech_level || null,
    measuringSkills: w.measuring_skills || null,
    countryCode: w.country_code || null,
    comments: w.comments || null,
    experienceScore: w.experience_score ? parseFloat(w.experience_score) : null,
    technicalScore: w.technical_score ? parseFloat(w.technical_score) : null,
    attitudeScore: w.attitude_score ? parseFloat(w.attitude_score) : null,
    oemFocus: w.oem_focus || null,
    oemExperience: JSON.stringify(w.oem_experience || []),
  }).returning().get();

  workerIdMap.set(w.name, result.id);
}
console.log(`  Inserted ${workerIdMap.size} workers`);

// 2. Insert projects from schedule data
console.log("Inserting projects...");
const projectIdMap = new Map<string, number>();

for (const p of scheduleData.projects) {
  const info = customerMap[p.project_code] || {};
  const result = db.insert(projects).values({
    code: p.project_code,
    name: p.project_name,
    customer: info.customer || p.customer || null,
    location: info.location || p.location || null,
    equipmentType: info.equipType || null,
    startDate: p.start,
    endDate: p.end,
    headcount: p.total_positions,
    status: 'active',
  }).returning().get();

  projectIdMap.set(p.project_code, result.id);
}
console.log(`  Inserted ${projectIdMap.size} projects`);

// 3. Insert assignments from schedule data
console.log("Inserting assignments...");
let assignmentCount = 0;

for (const a of scheduleData.assignments) {
  const workerId = workerIdMap.get(a.resource);
  const projectId = projectIdMap.get(a.project_code);

  if (!projectId) continue; // Skip if no project match
  if (!workerId && !a.resource) continue; // Skip unassigned slots

  // For named resources, create the assignment
  if (workerId) {
    db.insert(assignments).values({
      workerId,
      projectId,
      task: a.task || null,
      shift: a.shift || 'Day',
      startDate: a.start,
      endDate: a.end,
      duration: a.duration,
      status: 'active',
    }).run();
    assignmentCount++;
  }
}
console.log(`  Inserted ${assignmentCount} assignments`);

// 4. Insert OEM taxonomy
console.log("Inserting OEM types...");
const oemData = [
  { oem: 'GE Vernova', types: ['GT', 'ST', 'STV', 'GEN'], color: '#005E60' },
  { oem: 'Mitsubishi Power', types: ['GT', 'ST', 'STV', 'GEN'], color: '#E60012' },
  { oem: 'Arabelle Solutions', types: ['ST', 'STV', 'GEN'], color: '#FE5716' },
  { oem: 'Siemens Energy', types: ['GT', 'ST', 'STV', 'GEN'], color: '#009999' },
  { oem: 'Alstom', types: ['GT', 'ST', 'STV', 'GEN'], color: '#0066CC' },
  { oem: 'Ansaldo Energia', types: ['GT', 'ST', 'STV', 'GEN'], color: '#003399' },
  { oem: 'Doosan Skoda', types: ['ST', 'STV', 'GEN'], color: '#004C99' },
  { oem: 'Elliot Ebara', types: ['COMP', 'ST'], color: '#336699' },
  { oem: 'Solar', types: ['GT'], color: '#CC6600' },
];

for (const entry of oemData) {
  for (const t of entry.types) {
    db.insert(oemTypes).values({
      oem: entry.oem,
      equipmentType: t,
      brandColor: entry.color,
    }).run();
  }
}
console.log(`  Inserted OEM types`);

// Summary
const finalWorkers = sqlite.prepare("SELECT COUNT(*) as c FROM workers").get() as any;
const finalProjects = sqlite.prepare("SELECT COUNT(*) as c FROM projects").get() as any;
const finalAssignments = sqlite.prepare("SELECT COUNT(*) as c FROM assignments").get() as any;
const finalOem = sqlite.prepare("SELECT COUNT(*) as c FROM oem_types").get() as any;

console.log("\n=== SEED COMPLETE ===");
console.log(`  Workers:     ${finalWorkers.c}`);
console.log(`  Projects:    ${finalProjects.c}`);
console.log(`  Assignments: ${finalAssignments.c}`);
console.log(`  OEM Types:   ${finalOem.c}`);
