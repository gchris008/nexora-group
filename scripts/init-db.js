import 'node:process';
import fs from 'node:fs/promises';
import pg from 'pg';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL est obligatoire.');
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false });

try {
  const schema = await fs.readFile(new URL('../src/schema.sql', import.meta.url), 'utf8');
  const commerce = await fs.readFile(new URL('../src/commerce.sql', import.meta.url), 'utf8');
  await pool.query(schema);
  await pool.query(commerce);
  console.log('Base NEXORA initialisée.');
} finally {
  await pool.end();
}
