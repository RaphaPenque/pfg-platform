/**
 * Data migration: JSON export → PostgreSQL
 * Run: DATABASE_URL=... npx tsx server/migrate-to-postgres.ts
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { sql } from "drizzle-orm";
import {
  workers, projects, assignments, documents, oemTypes, roleSlots,
  users, sessions, magicLinks, auditLogs, projectLeads,
} from "@shared/schema";
import fs from "fs";
import path from "path";

function createPool(url: string) {
  return new Pool({
    connectionString: url,
    ssl: url.includes("render.com") || url.includes("postgres.render") ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 30000,
  });
}

// Called on server startup — only migrates if DB is empty
// Always runs on every boot — creates new tables added after initial migration
export async function runSchemaUpdates() {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) return;
  const pool = createPool(DATABASE_URL);
  const db = drizzle(pool);
  try {
    // payroll_rules table — added after initial migration, must always be created if missing
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS payroll_rules (
        id SERIAL PRIMARY KEY,
        cost_centre TEXT NOT NULL UNIQUE,
        country_code TEXT NOT NULL,
        country_name TEXT NOT NULL,
        weekly_ot_threshold_hours INTEGER,
        annual_ot_threshold_hours INTEGER,
        night_shift_start TEXT,
        night_shift_end TEXT,
        track_sunday_hours BOOLEAN NOT NULL DEFAULT FALSE,
        standby_day_hours INTEGER NOT NULL DEFAULT 8,
        notes TEXT,
        updated_at TIMESTAMP DEFAULT NOW(),
        updated_by INTEGER REFERENCES users(id)
      )
    `);
    // Seed default rules (safe to run repeatedly)
    await db.execute(sql`
      INSERT INTO payroll_rules (cost_centre, country_code, country_name, weekly_ot_threshold_hours, night_shift_start, night_shift_end, track_sunday_hours, standby_day_hours, notes)
      VALUES ('Powerforce Maintenance d.o.o.', 'HR', 'Croatia', 40, '22:00', '06:00', TRUE, 8, 'Croatian Labour Law: OT above 40hrs/week, night shift 22:00-06:00, Sunday hours tracked separately')
      ON CONFLICT (cost_centre) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO payroll_rules (cost_centre, country_code, country_name, annual_ot_threshold_hours, track_sunday_hours, standby_day_hours, notes)
      VALUES ('Powerforce Global S.L', 'ES', 'Spain', 1600, FALSE, 8, 'Spanish Labour Law: OT tracked annually above 1,600 hrs/calendar year')
      ON CONFLICT (cost_centre) DO NOTHING
    `);
    // Project hub fields — added Phase 1
    await db.execute(sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS contract_type TEXT`);
    await db.execute(sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS site_name TEXT`);
    await db.execute(sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS site_address TEXT`);
    await db.execute(sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS sourcing_contact TEXT`);
    await db.execute(sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS customer_project_manager TEXT`);
    await db.execute(sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS site_manager TEXT`);
    await db.execute(sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS day_shift_signatory_name TEXT`);
    await db.execute(sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS day_shift_signatory_email TEXT`);
    await db.execute(sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS night_shift_signatory_name TEXT`);
    await db.execute(sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS night_shift_signatory_email TEXT`);

    console.log("Schema updates applied.");
  } catch (e: any) {
    console.error("Schema update error:", e.message);
  } finally {
    await pool.end();
  }
}

export async function runMigrationIfNeeded() {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    console.log("No DATABASE_URL — skipping migration check");
    return;
  }
  const pool = createPool(DATABASE_URL);
  const db = drizzle(pool);
  try {
    // Check if workers table exists and has data
    const result = await db.execute(sql`SELECT COUNT(*) as cnt FROM workers`);
    const count = parseInt((result.rows?.[0] as any)?.cnt ?? '0');
    if (count > 0) {
      console.log(`Database already has ${count} workers — skipping migration`);
      await pool.end();
      return;
    }
    console.log("Empty database detected — running data migration...");
    await migrate(db);
  } catch (e: any) {
    // Table may not exist yet
    if (e.message?.includes('does not exist') || e.message?.includes('relation')) {
      console.log("Tables not found — running full migration...");
      await migrate(db);
    } else {
      console.error("Migration check error:", e.message);
    }
  } finally {
    await pool.end();
  }
}

async function migrate(db: ReturnType<typeof drizzle>) {
  // Load seed data — try file first, fall back to embedded
  let data: any;
  const exportPaths = [
    path.resolve(process.cwd(), "pfg-data-export.json"),
    path.resolve(process.cwd(), "pfg-seed-data-compact.json"),
  ];
  for (const p of exportPaths) {
    if (fs.existsSync(p)) {
      data = JSON.parse(fs.readFileSync(p, "utf-8"));
      console.log(`Loaded seed data from ${p}`);
      break;
    }
  }
  if (!data) throw new Error("No seed data file found");

  console.log(`Migrating: ${data.workers?.length} workers, ${data.projects?.length} projects, ${data.assignments?.length} assignments, ${data.role_slots?.length} role slots, ${data.oem_types?.length} OEM types`);

  // Create tables
  console.log("Creating tables...");
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS oem_types (
      id SERIAL PRIMARY KEY,
      oem TEXT NOT NULL,
      equipment_type TEXT NOT NULL,
      brand_color TEXT
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS workers (
      id SERIAL PRIMARY KEY,
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
      oem_experience TEXT,
      date_of_birth TEXT,
      cost_centre TEXT,
      roles TEXT,
      profile_photo_path TEXT,
      passport_path TEXT,
      drivers_license TEXT,
      drivers_license_uploaded INTEGER,
      personal_email TEXT,
      work_email TEXT,
      phone TEXT,
      phone_secondary TEXT,
      address TEXT,
      coverall_size TEXT,
      boot_size TEXT,
      local_airport TEXT
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS projects (
      id SERIAL PRIMARY KEY,
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
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS role_slots (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id),
      role TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      shift TEXT DEFAULT 'Day'
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS assignments (
      id SERIAL PRIMARY KEY,
      worker_id INTEGER NOT NULL REFERENCES workers(id),
      project_id INTEGER NOT NULL REFERENCES projects(id),
      role_slot_id INTEGER REFERENCES role_slots(id),
      task TEXT,
      role TEXT,
      shift TEXT,
      start_date TEXT,
      end_date TEXT,
      duration INTEGER,
      status TEXT DEFAULT 'active'
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS documents (
      id SERIAL PRIMARY KEY,
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
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      last_login_at TIMESTAMP,
      is_active BOOLEAN DEFAULT TRUE
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS magic_links (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMP NOT NULL,
      used_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      token TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      user_agent TEXT,
      ip_address TEXT
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      entity_name TEXT,
      changes JSONB,
      metadata JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS project_leads (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      assigned_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Payroll rules table (additive — never truncated)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS payroll_rules (
      id SERIAL PRIMARY KEY,
      cost_centre TEXT NOT NULL UNIQUE,
      country_code TEXT NOT NULL,
      country_name TEXT NOT NULL,
      weekly_ot_threshold_hours INTEGER,
      annual_ot_threshold_hours INTEGER,
      night_shift_start TEXT,
      night_shift_end TEXT,
      track_sunday_hours BOOLEAN NOT NULL DEFAULT FALSE,
      standby_day_hours INTEGER NOT NULL DEFAULT 8,
      notes TEXT,
      updated_at TIMESTAMP DEFAULT NOW(),
      updated_by INTEGER REFERENCES users(id)
    )
  `);

  // Seed the two known payroll rule sets (upsert-safe)
  await db.execute(sql`
    INSERT INTO payroll_rules (cost_centre, country_code, country_name, weekly_ot_threshold_hours, night_shift_start, night_shift_end, track_sunday_hours, standby_day_hours, notes)
    VALUES (
      'Powerforce Maintenance d.o.o.',
      'HR',
      'Croatia',
      40,
      '22:00',
      '06:00',
      TRUE,
      8,
      'Croatian Labour Law: OT above 40hrs/week, night shift 22:00–06:00, Sunday hours tracked separately'
    )
    ON CONFLICT (cost_centre) DO NOTHING
  `);

  await db.execute(sql`
    INSERT INTO payroll_rules (cost_centre, country_code, country_name, annual_ot_threshold_hours, track_sunday_hours, standby_day_hours, notes)
    VALUES (
      'Powerforce Global S.L',
      'ES',
      'Spain',
      1600,
      FALSE,
      8,
      'Spanish Labour Law: OT tracked annually above 1,600 hrs/calendar year'
    )
    ON CONFLICT (cost_centre) DO NOTHING
  `);

  // Truncate in reverse dependency order (idempotent)
  console.log("Clearing existing data...");
  await db.execute(sql`TRUNCATE project_leads, audit_logs, sessions, magic_links, assignments, role_slots, documents, projects, workers, oem_types, users RESTART IDENTITY CASCADE`);

  // Insert OEM types
  console.log("Inserting OEM types...");
  for (const row of data.oem_types) {
    await db.execute(sql`
      INSERT INTO oem_types (id, oem, equipment_type, brand_color)
      VALUES (${row.id}, ${row.oem}, ${row.equipment_type}, ${row.brand_color})
    `);
  }

  // Insert workers
  console.log("Inserting workers...");
  for (const w of data.workers) {
    await db.execute(sql`
      INSERT INTO workers (
        id, name, role, status, nationality, age, joined, ctc,
        english_level, tech_level, measuring_skills, country_code, comments,
        experience_score, technical_score, attitude_score, oem_focus, oem_experience,
        date_of_birth, cost_centre, roles, profile_photo_path, passport_path,
        drivers_license, drivers_license_uploaded, personal_email, work_email,
        phone, phone_secondary, address, coverall_size, boot_size, local_airport
      ) VALUES (
        ${w.id}, ${w.name}, ${w.role}, ${w.status}, ${w.nationality}, ${w.age}, ${w.joined}, ${w.ctc},
        ${w.english_level}, ${w.tech_level}, ${w.measuring_skills}, ${w.country_code}, ${w.comments},
        ${w.experience_score}, ${w.technical_score}, ${w.attitude_score}, ${w.oem_focus}, ${w.oem_experience},
        ${w.date_of_birth}, ${w.cost_centre}, ${w.roles}, ${w.profile_photo_path}, ${w.passport_path},
        ${w.drivers_license}, ${w.drivers_license_uploaded}, ${w.personal_email}, ${w.work_email},
        ${w.phone}, ${w.phone_secondary}, ${w.address}, ${w.coverall_size}, ${w.boot_size}, ${w.local_airport}
      )
    `);
  }

  // Insert projects
  console.log("Inserting projects...");
  for (const p of data.projects) {
    await db.execute(sql`
      INSERT INTO projects (id, code, name, customer, location, equipment_type, start_date, end_date, shift, headcount, notes, status)
      VALUES (${p.id}, ${p.code}, ${p.name}, ${p.customer}, ${p.location}, ${p.equipment_type}, ${p.start_date}, ${p.end_date}, ${p.shift}, ${p.headcount}, ${p.notes}, ${p.status})
    `);
  }

  // Insert role_slots
  console.log("Inserting role slots...");
  for (const s of data.role_slots) {
    await db.execute(sql`
      INSERT INTO role_slots (id, project_id, role, start_date, end_date, quantity, shift)
      VALUES (${s.id}, ${s.project_id}, ${s.role}, ${s.start_date}, ${s.end_date}, ${s.quantity}, ${s.shift})
    `);
  }

  // Insert assignments
  console.log("Inserting assignments...");
  for (const a of data.assignments) {
    await db.execute(sql`
      INSERT INTO assignments (id, worker_id, project_id, role_slot_id, task, role, shift, start_date, end_date, duration, status)
      VALUES (${a.id}, ${a.worker_id}, ${a.project_id}, ${a.role_slot_id}, ${a.task}, ${a.role}, ${a.shift}, ${a.start_date}, ${a.end_date}, ${a.duration}, ${a.status})
    `);
  }

  // Insert documents
  if (data.documents && data.documents.length > 0) {
    console.log("Inserting documents...");
    for (const d of data.documents) {
      await db.execute(sql`
        INSERT INTO documents (id, worker_id, type, name, file_name, file_path, file_size, mime_type, expiry_date, issued_date, status, uploaded_at, notes)
        VALUES (${d.id}, ${d.worker_id}, ${d.type}, ${d.name}, ${d.file_name}, ${d.file_path}, ${d.file_size}, ${d.mime_type}, ${d.expiry_date}, ${d.issued_date}, ${d.status}, ${d.uploaded_at}, ${d.notes})
      `);
    }
  }

  // Reset sequences to max id + 1
  console.log("Resetting sequences...");
  const tables = ["oem_types", "workers", "projects", "role_slots", "assignments", "documents"];
  for (const t of tables) {
    await db.execute(sql.raw(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 0) + 1, false)`));
  }

  // Seed admin user
  console.log("Seeding admin user...");
  await db.execute(sql`
    INSERT INTO users (email, name, role, is_active)
    VALUES ('raphael@powerforce.global', 'Raphael', 'admin', true)
    ON CONFLICT (email) DO NOTHING
  `);

  // Reset users sequence
  await db.execute(sql.raw(`SELECT setval(pg_get_serial_sequence('users', 'id'), COALESCE((SELECT MAX(id) FROM users), 0) + 1, false)`));

  console.log("Migration complete!");
}

// Allow running directly: DATABASE_URL=... npx tsx server/migrate-to-postgres.ts
if (process.argv[1]?.includes('migrate-to-postgres')) {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL required"); process.exit(1); }
  const pool = createPool(url);
  const db = drizzle(pool);
  migrate(db).then(() => pool.end()).catch(err => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
}
