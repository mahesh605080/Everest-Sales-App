import { NextResponse } from 'next/server';
import { q1 } from '@/lib/db';

/** For uptime monitors: 200 when the app can reach its database. */
export async function GET() {
  try { await q1('select 1'); return NextResponse.json({ ok: true }); }
  catch { return NextResponse.json({ ok: false, error: 'database unreachable' }, { status: 503 }); }
}
