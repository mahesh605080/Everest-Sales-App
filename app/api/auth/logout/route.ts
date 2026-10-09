import { NextResponse } from 'next/server';
import { api, COOKIE } from '@/lib/auth';

export const POST = api(async () => {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
  return res;
});
