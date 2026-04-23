import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  const r = await db.execute(sql`
    SELECT log_date, entry
    FROM comments_log
    WHERE project_id = 12
      AND log_date >= '2026-04-13'
      AND log_date <= '2026-04-19'
      AND entry != ''
      AND entry IS NOT NULL
    ORDER BY log_date
  `);

  const comments = r.rows.map((row: any) => ({
    date: row.log_date,
    entry: row.entry,
    userName: '',
  }));

  console.log(`Found ${comments.length} comment(s) for GRTY w/c 13 Apr:`);
  for (const c of comments) {
    console.log(`  - ${c.date}: ${c.entry}`);
  }

  const patch = JSON.stringify({ comments });
  await db.execute(sql`
    UPDATE weekly_reports
    SET aggregated_data = aggregated_data || ${patch}::jsonb
    WHERE id = 1
  `);

  console.log('Updated weekly_reports id=1 with fresh comments array.');
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
