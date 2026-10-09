import { Pool, types } from 'pg';

// Keep DATE columns as plain 'YYYY-MM-DD' text and NUMERIC as numbers.
types.setTypeParser(1082, v => v);
types.setTypeParser(1700, v => parseFloat(v));

const g = globalThis as any;
export const pool: Pool = g.__sfaPool || (g.__sfaPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 }));

export async function q<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const r = await pool.query(sql, params);
  return r.rows as T[];
}
export async function q1<T = any>(sql: string, params: any[] = []): Promise<T | null> {
  const r = await q<T>(sql, params);
  return r[0] ?? null;
}
