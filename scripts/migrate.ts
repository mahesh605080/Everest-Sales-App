import fs from 'fs';
import path from 'path';
import { pool } from '../lib/db';

async function main() {
  await pool.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  const dir = path.join(process.cwd(), 'db', 'migrations');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    const done = await pool.query('select 1 from schema_migrations where name=$1', [f]);
    if (done.rowCount) continue;
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query(fs.readFileSync(path.join(dir, f), 'utf8'));
      await c.query('insert into schema_migrations(name) values($1)', [f]);
      await c.query('commit');
      console.log('applied', f);
    } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
  }
  console.log('migrations up to date');
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
