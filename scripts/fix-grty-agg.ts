import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  const r = await db.execute(sql`SELECT aggregated_data FROM weekly_reports WHERE id = 1`);
  const agg = r.rows[0].aggregated_data as any;

  const fixed = {
    ...agg,
    safetyStats: agg.safetyData || agg.safetyStats,
    delays: agg.delays || agg.delaysLog,
    comments: agg.comments || agg.commentsEntries,
  };
  delete fixed.safetyData;
  delete fixed.delaysLog;
  delete fixed.commentsEntries;

  await db.execute(sql`UPDATE weekly_reports SET aggregated_data = ${JSON.stringify(fixed)}::jsonb WHERE id = 1`);
  console.log('Done. safetyStats:', fixed.safetyStats, 'delays count:', fixed.delays?.length, 'comments count:', fixed.comments?.length);
  await pool.end();
}
main().catch(console.error);
