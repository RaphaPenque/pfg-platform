const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://pfg_platform_db_user:zo7EyN89I4Dg1soyxv7X96QyeVarhqOP@dpg-d7b3hnkvjg8s73erao8g-a.frankfurt-postgres.render.com:5432/pfg_platform_db',
  ssl: { rejectUnauthorized: false }
});

async function main() {
  const client = await pool.connect();
  try {
    // 1. Check survey tables
    const tables = await client.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_name LIKE 'survey%' ORDER BY table_name
    `);
    console.log('Survey tables:', tables.rows.map(r => r.table_name));

    // 2. Check columns on survey_tokens and survey_responses
    const cols = await client.query(`
      SELECT table_name, column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name IN ('survey_tokens', 'survey_responses', 'survey_score_details')
      ORDER BY table_name, ordinal_position
    `);
    console.log('\nColumns:');
    cols.rows.forEach(r => console.log(`  ${r.table_name}.${r.column_name} (${r.data_type})`));

    // 3. Check existing survey data for project 10 (Saltend)
    const existing = await client.query(`
      SELECT id, project_id, respondent_email, status, created_at 
      FROM survey_tokens WHERE project_id = 10
    `);
    console.log('\nExisting survey tokens for Saltend (project 10):', existing.rows);

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
