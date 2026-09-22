import 'node:process';
import fs from 'node:fs/promises';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false });

try {
  const sql = await fs.readFile(new URL('../src/schema.sql', import.meta.url), 'utf8');
  await pool.query(sql);
  console.log('Base NEXORA initialisée.');
} finally {
  await pool.end();
}
