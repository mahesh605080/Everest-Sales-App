'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { call } from '@/lib/ui';
import { realtime } from '@/lib/realtime';

const time = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kathmandu' });

export default function Chat({ me }: { me: number }) {
  const [rooms, setRooms] = useState<any[]>([]); const [room, setRoom] = useState<string | null>(null); const [d, setD] = useState<any>(null); const [text, setText] = useState('');
  const [err, setErr] = useState(''); const [live, setLive] = useState('closed'); const [find, setFind] = useState(''); const [people, setPeople] = useState<any[] | null>(null);
  const end = useRef<HTMLDivElement>(null); const cur = useRef<string | null>(null); cur.current = room;
  const loadRooms = useCallback(() => call('/api/v1/chat/rooms').then(r => setRooms(r.rooms)).catch(e => setErr(e.message)), []);
  const openRoom = useCallback((id: string) => { setRoom(id); setD(null); call(`/api/v1/chat/rooms/${id}/messages`).then(r => { setD(r); call(`/api/v1/chat/rooms/${id}/read`, { method: 'POST' }).then(loadRooms).catch(() => {}); }).catch(e => setErr(e.message)); }, [loadRooms]);
  useEffect(() => {
    loadRooms(); realtime.start(); const offS = realtime.onState(setLive);
    const off = realtime.on(e => {
      if (e.event === 'chat.message') {
        if (e.payload.room === cur.current) { setD((x: any) => x && !x.messages.some((m: any) => m.id === e.payload.id) ? { ...x, messages: [...x.messages, e.payload] } : x); if (e.payload.sender_id !== me) call(`/api/v1/chat/rooms/${e.payload.room}/read`, { method: 'POST' }).catch(() => {}); }
        loadRooms();
      } else if (e.event === 'chat.receipt' && e.payload.room === cur.current) setD((x: any) => x ? { ...x, members: x.members.map((m: any) => m.user_id === e.payload.user_id ? { ...m, last_delivered_id: e.payload.delivered_id, last_read_id: e.payload.read_id } : m) } : x);
      else if (e.event === 'chat.room') loadRooms();
    });
    return () => { off(); offS(); };
  }, [loadRooms, me]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [d?.messages?.length]);
  useEffect(() => { if (people === null) return; const t = setTimeout(() => call(`/api/v1/chat/people?q=${encodeURIComponent(find)}`).then(r => setPeople(r.people)).catch(() => {}), 200); return () => clearTimeout(t); }, [find, people === null]); // eslint-disable-line react-hooks/exhaustive-deps
  async function send(e: React.FormEvent) {
    e.preventDefault(); const body = text.trim(); if (!body || !room) return; setErr(''); setText('');
    const client_id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; // lets the server store it once even if it has to be sent again
    try { await call(`/api/v1/chat/rooms/${room}/messages`, { method: 'POST', json: { text: body, client_id } }); } catch (x: any) { setErr(x.message); setText(body); }
  }
  async function start(u: any) { try { const r = await call('/api/v1/chat/rooms', { method: 'POST', json: { user_ids: [u.id] } }); setPeople(null); setFind(''); await loadRooms(); openRoom(r.id); } catch (x: any) { setErr(x.message); } }
  const others = d ? d.members.filter((m: any) => m.user_id !== me) : [];
  const tick = (id: number) => !others.length ? '' : others.every((m: any) => m.last_read_id >= id) ? 'Read' : others.every((m: any) => m.last_delivered_id >= id) ? 'Delivered' : 'Sent';
  return <div className="g" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', alignItems: 'start' }}>
    <section className="card">
      <div className="hd"><h2>Conversations</h2><span className={`pill ${live === 'open' ? 'good' : 'warn'}`}>{live === 'open' ? 'Live' : 'Reconnecting…'}</span></div>
      <button className="btn" onClick={() => setPeople(people === null ? [] : null)}>{people === null ? 'New conversation' : 'Cancel'}</button>
      {people !== null && <><input type="text" aria-label="Find a colleague" placeholder="Name or code" value={find} onChange={e => setFind(e.target.value)} autoFocus />
        <div className="feed">{people.map(u => <div key={u.id} style={{ alignItems: 'center' }}><div className="t"><b>{u.name}</b> <span className="code">{u.code} · {u.role}</span> {u.online && <span className="pill good">online</span>}</div><button className="btn sm primary" onClick={() => start(u)}>Write</button></div>)}
          {!people.length && <p className="sub">No colleague matches.</p>}</div></>}
      <div className="feed">{rooms.map(r => <div key={r.id} style={{ alignItems: 'center', cursor: 'pointer', background: r.id === room ? 'var(--accent-soft)' : undefined, borderRadius: 8, padding: '9px 8px' }} onClick={() => openRoom(r.id)}>
        <div className="t" style={{ minWidth: 0 }}><b>{r.title}</b> {r.members.some((m: any) => m.id !== me && m.online) && <span className="pill good">online</span>}<br /><span className="sub">{r.last ? `${r.last.sender_id === me ? 'You: ' : ''}${r.last.text}` : 'No messages yet'}</span></div>
        {r.unread > 0 && <span className="pill crit">{r.unread}</span>}</div>)}
        {!rooms.length && people === null && <p className="sub">No conversations yet. Start one with "New conversation".</p>}</div>
    </section>
    <section className="card" style={{ minHeight: 420 }}>
      {err && <div className="errbox" role="alert">{err}</div>}
      {!room ? <p className="sub">Choose a conversation.</p> : !d ? <p className="sub">Loading…</p> : <>
        <div className="hd"><h2>{d.room.name || others.map((m: any) => m.name).join(', ')}</h2><span className="sub">{d.members.length} people</span></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '55vh', overflowY: 'auto', padding: '4px 2px' }} aria-live="polite">
          {d.messages.map((m: any, i: number) => { const mine = m.sender_id === me, lastMine = mine && !d.messages.slice(i + 1).some((x: any) => x.sender_id === me);
            return <div key={m.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '82%' }}>
              {!mine && d.members.length > 2 && <div className="code">{d.members.find((x: any) => x.user_id === m.sender_id)?.name}</div>}
              <div style={{ background: mine ? 'var(--accent)' : 'var(--sunk)', color: mine ? '#fff' : 'var(--ink)', borderRadius: 12, padding: '8px 12px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{m.text}</div>
              <div className="code" style={{ textAlign: mine ? 'right' : 'left' }}>{time(m.at)}{lastMine ? ` · ${tick(m.id)}` : ''}</div></div>; })}
          {!d.messages.length && <p className="sub">Say hello.</p>}<div ref={end} /></div>
        <form className="toolbar" onSubmit={send}><div className="l" style={{ flex: 1 }}><input type="text" aria-label="Message" placeholder="Write a message" value={text} maxLength={4000} onChange={e => setText(e.target.value)} style={{ flex: 1, minWidth: 0 }} /></div>
          <div className="r"><button className="btn primary" disabled={!text.trim()}>Send</button></div></form></>}
    </section>
  </div>;
}
