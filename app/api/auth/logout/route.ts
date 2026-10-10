import { NextResponse } from 'next/server';
import { api, closeLogin, COOKIE, currentSid } from '@/lib/auth';

export const POST = api(async () => {
  const sid = await currentSid(); if (sid) await closeLogin(sid, 'logout'); // the token stops working, not only the cookie
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
  return res;
});
