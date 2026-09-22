import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import crypto from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false });

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

const rl = readline.createInterface({ input, output });
try {
  const email = (await rl.question('E-mail administrateur : ')).trim().toLowerCase();
  const password = await rl.question('Mot de passe administrateur : ');
  if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 12) {
    throw new Error('E-mail invalide ou mot de passe trop court (12 caractères minimum).');
  }
  await pool.query(
    'INSERT INTO admins(email,password_hash,role) VALUES($1,$2,$3) ON CONFLICT(email) DO UPDATE SET password_hash=EXCLUDED.password_hash, role=EXCLUDED.role',
    [email, hashPassword(password), 'admin']
  );
  console.log('Administrateur créé/mis à jour.');
} finally {
  rl.close();
  await pool.end();
}
