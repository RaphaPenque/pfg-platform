const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://pfg_platform_db_user:zo7EyN89I4Dg1soyxv7X96QyeVarhqOP@dpg-d7b3hnkvjg8s73erao8g-a.frankfurt-postgres.render.com:5432/pfg_platform_db',
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20000,
});

async function main() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT id, name, role, status, cost_centre, nationality
      FROM workers 
      ORDER BY name ASC
    `);
    console.log(`Total workers: ${result.rows.length}`);
    result.rows.forEach(w => {
      console.log(`${w.id}|${w.name}|${w.role}|${w.status}|${w.cost_centre}`);
    });
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
