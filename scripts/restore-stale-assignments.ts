/**
 * Restore assignments that were incorrectly marked 'completed' by the
 * cleanup-stale-assignments script (commit f131699).
 *
 * Historical assignments on completed/cancelled projects must retain their
 * original statuses so the Person Schedule continues to show historical
 * deployment bars.
 *
 * The cleanup script logged 27 affected assignments identified by:
 *   - worker name
 *   - project code
 *   - original status
 *   - start_date / end_date
 *
 * This script matches those rows and restores their original status.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/restore-stale-assignments.ts
 */

import { Pool } from "pg";

type Restore = {
  project_code: string;
  worker_name: string;
  original_status: string;
  start_date: string;
  end_date: string;
};

// Source of truth: the 27 rows logged by commit f131699's cleanup script run.
const ROWS: Restore[] = [
  { project_code: "SALT", worker_name: "Carlos Julio Rodriguez Gervacio", original_status: "active",    start_date: "2026-04-05", end_date: "2026-04-15" },
  { project_code: "SALT", worker_name: "Connor McGringer",                  original_status: "confirmed", start_date: "2026-04-05", end_date: "2026-04-16" },
  { project_code: "SALT", worker_name: "Felix Gomez Fernandez",             original_status: "active",    start_date: "2026-04-05", end_date: "2026-04-15" },
  { project_code: "SALT", worker_name: "Goran Banjavcic",                   original_status: "active",    start_date: "2026-04-05", end_date: "2026-04-15" },
  { project_code: "SALT", worker_name: "Leonel Jose Silva Almeida",         original_status: "active",    start_date: "2026-04-05", end_date: "2026-04-16" },
  { project_code: "SALT", worker_name: "Luis Manuel Meireles Figueiredo",   original_status: "active",    start_date: "2026-04-05", end_date: "2026-04-15" },
  { project_code: "SALT", worker_name: "Manuel Rabano Carretero",           original_status: "active",    start_date: "2026-04-03", end_date: "2026-04-16" },
  { project_code: "SALT", worker_name: "Natanael Janeiro Monteirinho",      original_status: "active",    start_date: "2026-04-05", end_date: "2026-04-16" },
  { project_code: "SALT", worker_name: "Nikola Vucelic",                    original_status: "active",    start_date: "2026-04-05", end_date: "2026-04-15" },
  { project_code: "SALT", worker_name: "Ramon Alcaine",                     original_status: "confirmed", start_date: "2026-04-05", end_date: "2026-04-16" },
  { project_code: "SALT", worker_name: "Vitor Perez Vasquez",               original_status: "confirmed", start_date: "2026-04-05", end_date: "2026-04-15" },
  { project_code: "TRNS", worker_name: "Adolfo Martin Rodriguez",           original_status: "confirmed", start_date: "2026-01-19", end_date: "2026-03-21" },
  { project_code: "TRNS", worker_name: "Angel Pedro Gomez Beltran",         original_status: "active",    start_date: "2026-01-19", end_date: "2026-03-07" },
  { project_code: "TRNS", worker_name: "Bruno Manuel da Silva Neves",       original_status: "active",    start_date: "2026-01-19", end_date: "2026-03-27" },
  { project_code: "TRNS", worker_name: "Bruno Matan",                        original_status: "active",    start_date: "2026-01-19", end_date: "2026-03-27" },
  { project_code: "TRNS", worker_name: "Cesar Gallut Garcia",                original_status: "active",    start_date: "2026-01-19", end_date: "2026-03-07" },
  { project_code: "TRNS", worker_name: "Joao Paulo da Rocha Pegas",          original_status: "active",    start_date: "2026-01-19", end_date: "2026-03-21" },
  { project_code: "TRNS", worker_name: "Juan Carlos Rodriguez Lopez",        original_status: "confirmed", start_date: "2026-01-19", end_date: "2026-03-07" },
  { project_code: "TRNS", worker_name: "Juan Jose Armario Prado",            original_status: "active",    start_date: "2026-01-19", end_date: "2026-03-27" },
  { project_code: "TRNS", worker_name: "Luka Belavic",                       original_status: "active",    start_date: "2026-01-19", end_date: "2026-03-27" },
  { project_code: "TRNS", worker_name: "Luka Stefanac",                      original_status: "active",    start_date: "2026-01-19", end_date: "2026-03-07" },
  { project_code: "TRNS", worker_name: "Mario Crnkovic",                     original_status: "active",    start_date: "2026-01-19", end_date: "2026-03-07" },
  { project_code: "TRNS", worker_name: "Mario Luis Muñiz Garcia",            original_status: "active",    start_date: "2026-01-19", end_date: "2026-03-27" },
  { project_code: "TRNS", worker_name: "Mateo Muze",                         original_status: "active",    start_date: "2026-01-19", end_date: "2026-03-27" },
  { project_code: "TRNS", worker_name: "Nuno Miguel Oliveira Guerreiro da Luz", original_status: "active", start_date: "2026-01-19", end_date: "2026-03-21" },
  { project_code: "TRNS", worker_name: "Pedro Jose Beltran Simarro",         original_status: "active",    start_date: "2026-01-26", end_date: "2026-03-21" },
  { project_code: "TRNS", worker_name: "Vitor Manuel Martins Machado",       original_status: "confirmed", start_date: "2026-01-19", end_date: "2026-03-21" },
];

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
    console.log(`\n── Restore stale assignments (revert f131699) ─────────────`);
    console.log(`Started: ${new Date().toISOString()}`);

    const beforeByStatus = await client.query(
      `SELECT status, COUNT(*)::int AS n FROM assignments GROUP BY status ORDER BY status`
    );
    console.log(`\nAssignment counts by status BEFORE:`);
    for (const row of beforeByStatus.rows) console.log(`  ${row.status}: ${row.n}`);

    await client.query("BEGIN");

    let restored = 0;
    let skippedNotFound = 0;
    let skippedAmbiguous = 0;

    console.log(`\nPer-row restore log:`);

    for (const r of ROWS) {
      // Match: worker by name, project by code (via role_slots or direct project_id),
      // start_date/end_date match, current status is 'completed'.
      // When multiple rows match, the cleanup script (f131699) targeted the newest row —
      // the older row was already historically 'completed'. Order by created_at DESC, id DESC
      // and pick the first.
      const matches = await client.query(
        `
        SELECT a.id, a.created_at
          FROM assignments a
          JOIN workers w ON w.id = a.worker_id
          LEFT JOIN role_slots rs ON rs.id = a.role_slot_id
          JOIN projects p ON p.id = COALESCE(rs.project_id, a.project_id)
         WHERE w.name = $1
           AND p.code = $2
           AND a.start_date = $3
           AND a.end_date = $4
           AND a.status = 'completed'
         ORDER BY a.created_at DESC NULLS LAST, a.id DESC
        `,
        [r.worker_name, r.project_code, r.start_date, r.end_date]
      );

      if (matches.rowCount === 0) {
        skippedNotFound++;
        console.log(
          `  ⚠ NOT FOUND: [${r.project_code}] ${r.worker_name} ${r.start_date}→${r.end_date} (target=${r.original_status})`
        );
        continue;
      }

      const pickedId = matches.rows[0].id;
      const extraNote = (matches.rowCount ?? 0) > 1
        ? ` (picked newest of ${matches.rowCount}: ${matches.rows.map((x: any) => x.id).join(",")})`
        : "";

      await client.query(
        `UPDATE assignments SET status = $1 WHERE id = $2`,
        [r.original_status, pickedId]
      );
      restored++;
      console.log(
        `  ✓ RESTORED id=${pickedId}: [${r.project_code}] ${r.worker_name} ${r.start_date}→${r.end_date} → ${r.original_status}${extraNote}`
      );
    }

    await client.query("COMMIT");

    console.log(
      `\nSummary: restored=${restored}, not_found=${skippedNotFound}, ambiguous=${skippedAmbiguous}, total_input=${ROWS.length}`
    );

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
