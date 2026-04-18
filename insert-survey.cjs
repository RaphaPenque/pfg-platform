const { Pool } = require('pg');

// Use the same internal connection string the platform uses
// But we need external - use the frankfurt external URL
const pool = new Pool({
  connectionString: 'postgresql://pfg_platform_db_user:zo7EyN89I4Dg1soyxv7X96QyeVarhqOP@dpg-d7b3hnkvjg8s73erao8g-a.frankfurt-postgres.render.com:5432/pfg_platform_db',
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20000,
  query_timeout: 10000,
});

async function main() {
  console.log('Attempting connection...');
  const client = await pool.connect();
  console.log('Connected to DB!');

  try {
    // Check survey tables structure
    const tables = await client.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_name LIKE 'survey%' ORDER BY table_name
    `);
    console.log('Survey tables:', tables.rows.map(r => r.table_name));

    // Check existing tokens for project 10 (Saltend)
    const existing = await client.query(`SELECT id, respondent_email, status, created_at FROM survey_tokens WHERE project_id = 10`);
    console.log('Existing Saltend tokens:', existing.rows);

    // Get survey_tokens columns
    const cols = await client.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'survey_tokens' ORDER BY ordinal_position
    `);
    console.log('survey_tokens cols:', cols.rows.map(r => r.column_name));

    const rcols = await client.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'survey_responses' ORDER BY ordinal_position
    `);
    console.log('survey_responses cols:', rcols.rows.map(r => r.column_name));

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => {
  console.error('Failed:', e.message);
  process.exit(1);
});
