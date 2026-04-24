import { Pool } from "pg";
const DATABASE_URL = process.env.DATABASE_URL!;
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes("render.com") ? { rejectUnauthorized: false } : false,
});

const before = await pool.query("SELECT id, name, status, employment_type FROM workers WHERE id = 178");
console.log("BEFORE:", before.rows[0]);

await pool.query("UPDATE workers SET employment_type = 'Temp' WHERE id = 178");

const after = await pool.query("SELECT id, name, status, employment_type FROM workers WHERE id = 178");
console.log("AFTER:", after.rows[0]);

await pool.end();
