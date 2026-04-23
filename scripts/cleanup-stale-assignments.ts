/**
 * Clean up stale assignments on completed/cancelled projects.
 *
 * Finds all assignments with status IN ('active', 'confirmed', 'flagged', 'pending_confirmation')
 * where the assignment's role_slot belongs to a project with status IN ('completed', 'cancelled')
 * and marks them as 'completed'.
 *
 * Stale assignments poison downstream views: Person Schedule bars, Workforce Table utilisation,
 * Timesheet worker lists. This script normalises them in one pass.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/cleanup-stale-assignments.ts
 */

import { Pool } from "pg";

const STALE_STATUSES = ["active", "confirmed", "flagged", "pending_confirmation"];
const CLOSED_PROJECT_STATUSES = ["completed", "cancelled"];

async function main() {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    console.error("ERROR: DATABASE_URL not set");
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes("render.com") || DATABASE_URL.includes("neon.tech")
      ? { rejectUnauthorized: false }
      : false,
    connectionTimeoutMillis: 30_000,
  });

  const client = await pool.connect();

  try {
    console.log(`\n── Stale assignment cleanup ─────────────────────────`);
    console.log(`Started: ${new Date().toISOString()}`);

    // Resolve affected assignments via role_slot → project chain.
    // Assignments without a role_slot fall back to assignment.project_id.
    const affected = await client.query(
      `
      SELECT a.id, a.status AS assignment_status, a.start_date, a.end_date,
             w.name AS worker_name,
             p.code AS project_code, p.status AS project_status,
             a.role_slot_id
        FROM assignments a
        JOIN workers w ON w.id = a.worker_id
        LEFT JOIN role_slots rs ON rs.id = a.role_slot_id
        JOIN projects p ON p.id = COALESCE(rs.project_id, a.project_id)
       WHERE a.status = ANY($1::text[])
         AND p.status = ANY($2::text[])
       ORDER BY p.code, w.name, a.start_date
      `,
      [STALE_STATUSES, CLOSED_PROJECT_STATUSES]
    );

    console.log(`\nAffected assignments: ${affected.rowCount}`);
    if (affected.rowCount === 0) {
      console.log(`Nothing to clean up. Exiting.`);
      return;
    }

    console.log(`\nDetail:`);
    for (const row of affected.rows) {
      console.log(
        `  [${row.project_code} / ${row.project_status}] ${row.worker_name} — ` +
        `status=${row.assignment_status}, ${row.start_date ?? "?"} → ${row.end_date ?? "?"}`
      );
    }

    // Counts before
    const beforeByStatus = await client.query(
      `SELECT status, COUNT(*)::int AS n FROM assignments GROUP BY status ORDER BY status`
    );
    console.log(`\nAssignment counts by status BEFORE:`);
    for (const row of beforeByStatus.rows) console.log(`  ${row.status}: ${row.n}`);

    // Update atomically
    await client.query("BEGIN");
    const ids = affected.rows.map((r: any) => r.id);
    const updated = await client.query(
      `UPDATE assignments SET status = 'completed' WHERE id = ANY($1::int[]) RETURNING id`,
      [ids]
    );
    await client.query("COMMIT");

    console.log(`\nUpdated ${updated.rowCount} assignment(s) to status='completed'.`);

    // Counts after
    const afterByStatus = await client.query(
      `SELECT status, COUNT(*)::int AS n FROM assignments GROUP BY status ORDER BY status`
    );
    console.log(`\nAssignment counts by status AFTER:`);
    for (const row of afterByStatus.rows) console.log(`  ${row.status}: ${row.n}`);

    console.log(`\nFinished: ${new Date().toISOString()}`);
  } catch (err: any) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error(`\nERROR: ${err.message}`);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
