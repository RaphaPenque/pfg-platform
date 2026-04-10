const { Pool } = require('pg');

// Try with SSL disabled first
async function tryConnect(opts) {
  const pool = new Pool(opts);
  try {
    const client = await pool.connect();
    const r = await client.query('SELECT 1 as ok');
    console.log('Connected! Result:', r.rows[0]);
    client.release();
    return pool;
  } catch(e) {
    console.log(`Failed with ${JSON.stringify(opts.ssl)}: ${e.message}`);
    await pool.end().catch(()=>{});
    return null;
  }
}

const BASE = 'postgresql://pfg_platform_db_user:zo7EyN89I4Dg1soyxv7X96QyeVarhqOP@dpg-d7b3hnkvjg8s73erao8g-a.frankfurt-postgres.render.com:5432/pfg_platform_db';

async function run() {
  // Try multiple SSL configs
  for (const ssl of [
    false,
    true,
    { rejectUnauthorized: false },
    { rejectUnauthorized: true },
  ]) {
    const pool = await tryConnect({ connectionString: BASE, ssl, connectionTimeoutMillis: 15000 });
    if (pool) {
      console.log('Working SSL config:', ssl);
      await pool.end();
      return;
    }
  }
  console.log('All configs failed');
}

run();
