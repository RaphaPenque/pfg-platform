/**
 * Migrate multi-quantity role_slots into individual quantity=1 slots.
 *
 * For each role_slot with quantity > 1:
 *   - create (quantity - 1) new role_slots with identical fields and quantity=1
 *   - copy all role_slot_periods from the original to each new slot
 *   - set the original slot's quantity to 1
 *
 * Runs atomically in a single transaction.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/migrate-multi-qty-slots.ts
 */

import { Pool } from "pg";

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
    console.log(`\n── Multi-quantity role_slot migration ─────────────────────`);
    console.log(`Started: ${new Date().toISOString()}`);

    const beforeTotal = await client.query(`SELECT COUNT(*)::int AS n FROM role_slots`);
    console.log(`\nTotal role_slots before: ${beforeTotal.rows[0].n}`);

    const multiSlotsPreview = await client.query(
      `SELECT id, project_id, role, shift, start_date, end_date, quantity
         FROM role_slots
        WHERE quantity > 1
        ORDER BY id`
    );
    console.log(`Slots with quantity > 1: ${multiSlotsPreview.rowCount}`);
    if (multiSlotsPreview.rowCount === 0) {
      console.log(`\nNothing to migrate. Exiting.`);
      return;
    }
    for (const s of multiSlotsPreview.rows) {
      console.log(
        `  - slot id=${s.id} project_id=${s.project_id} role=${s.role} shift=${s.shift} ` +
        `qty=${s.quantity} ${s.start_date}..${s.end_date}`
      );
    }

    await client.query("BEGIN");

    let newSlotsCreated = 0;
    let newPeriodsCreated = 0;

    for (const slot of multiSlotsPreview.rows) {
      const qty = slot.quantity as number;
      const extras = qty - 1;

      console.log(`\n→ slot id=${slot.id} qty=${qty} — creating ${extras} extra slot(s)`);

      const periodsRes = await client.query(
        `SELECT role_slot_id, project_id, start_date, end_date, period_type, notes
           FROM role_slot_periods
          WHERE role_slot_id = $1`,
        [slot.id]
      );
      const periods = periodsRes.rows;
      console.log(`   original slot has ${periods.length} period(s)`);

      for (let i = 0; i < extras; i++) {
        const insertSlot = await client.query(
          `INSERT INTO role_slots (project_id, role, start_date, end_date, quantity, shift)
           VALUES ($1, $2, $3, $4, 1, $5)
           RETURNING id`,
          [slot.project_id, slot.role, slot.start_date, slot.end_date, slot.shift]
        );
        const newSlotId = insertSlot.rows[0].id as number;
        newSlotsCreated++;
        console.log(`   + created new slot id=${newSlotId}`);

        for (const p of periods) {
          await client.query(
            `INSERT INTO role_slot_periods (role_slot_id, project_id, start_date, end_date, period_type, notes)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [newSlotId, p.project_id, p.start_date, p.end_date, p.period_type, p.notes]
          );
          newPeriodsCreated++;
        }
        if (periods.length > 0) {
          console.log(`     copied ${periods.length} period(s) to slot ${newSlotId}`);
        }
      }

      await client.query(`UPDATE role_slots SET quantity = 1 WHERE id = $1`, [slot.id]);
      console.log(`   ✓ original slot id=${slot.id} quantity set to 1`);
    }

    await client.query("COMMIT");
    console.log(`\n✓ Transaction committed.`);
    console.log(`  New slots created:   ${newSlotsCreated}`);
    console.log(`  New periods created: ${newPeriodsCreated}`);

    const afterTotal = await client.query(`SELECT COUNT(*)::int AS n FROM role_slots`);
    const stillMulti = await client.query(`SELECT COUNT(*)::int AS n FROM role_slots WHERE quantity > 1`);

    console.log(`\n── Verification ─────────────────────────────────────────────`);
    console.log(`Total role_slots before: ${beforeTotal.rows[0].n}`);
    console.log(`Total role_slots after:  ${afterTotal.rows[0].n}`);
    console.log(`Slots still with quantity > 1: ${stillMulti.rows[0].n}`);
    if (stillMulti.rows[0].n !== 0) {
      console.error(`ERROR: ${stillMulti.rows[0].n} slot(s) still have quantity > 1`);
      process.exit(1);
    }
    console.log(`\n✓ Migration complete.`);
  } catch (err: any) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(`\n✗ Migration failed, rolled back: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
