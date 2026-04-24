import { Pool } from "pg";
const DATABASE_URL = process.env.DATABASE_URL!;
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes("render.com") ? { rejectUnauthorized: false } : false,
});
const before = await pool.query("SELECT id, name, status, employment_type FROM workers WHERE name ILIKE '%joao%paulo%'");
console.log("BEFORE:", before.rows);
await pool.query("UPDATE workers SET status = 'Temp', employment_type = 'Temp' WHERE name ILIKE '%joao%paulo%'");
const after = await pool.query("SELECT id, name, status, employment_type FROM workers WHERE name ILIKE '%joao%paulo%'");
console.log("AFTER:", after.rows);
await pool.end();
