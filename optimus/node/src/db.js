'use strict';
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://optimus:optimus@localhost:5432/optimus',
  max: Number(process.env.PG_POOL_MAX || 10)
});

async function query(text, params) { return pool.query(text, params); }

async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await fn(client);
    await client.query('COMMIT');
    return r;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { client.release(); }
}

/* jalankan berkas db/NNN_*.sql yang belum pernah diterapkan */
async function migrate(dir) {
  dir = dir || process.env.DB_DIR || (fs.existsSync(path.join(__dirname, '..', '..', 'db')) ? path.join(__dirname, '..', '..', 'db') : '/db');
  const files = fs.readdirSync(dir).filter(f => /^\d+_.*\.sql$/.test(f)).sort();
  await query('CREATE TABLE IF NOT EXISTS schema_migrations (version INT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  const done = new Set((await query('SELECT version FROM schema_migrations')).rows.map(r => r.version));
  for (const f of files) {
    const v = parseInt(f, 10);
    if (done.has(v)) continue;
    await tx(c => c.query(fs.readFileSync(path.join(dir, f), 'utf8')));
    console.log('[db] migrasi diterapkan:', f);
  }
}

module.exports = { pool, query, tx, migrate };
