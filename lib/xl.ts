import ExcelJS from 'exceljs';
import { q } from './db';
import { Entity, Field, relInfo } from './entities';
import { listRows, saveRow } from './crud';
import { HttpError } from './auth';
import { Session } from './perm';

const header = (f: Field) => (f.type === 'rel' ? `${f.label} code` : f.label);
const cols = (ent: Entity) => ent.fields.filter(f => f.type !== 'password' || ent.key === 'employees');

export async function exportXlsx(ent: Entity, s: Session, templateOnly: boolean) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(ent.label);
  const fs = cols(ent);
  ws.columns = fs.map(f => ({ header: header(f), key: f.key, width: Math.max(14, header(f).length + 4) }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  if (!templateOnly) {
    const { rows } = await listRows(ent, s, { size: 5000, inactive: true });
    for (const r of rows) {
      const o: any = {};
      for (const f of fs) o[f.key] = f.type === 'password' ? '' : f.type === 'rel' ? (r[f.key + '__code'] ?? '') : (r[f.key] ?? '');
      ws.addRow(o);
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function parseCsv(text: string): string[][] {
  const out: string[][] = []; let row: string[] = [], cur = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += c; }
    else if (c === '"') inQ = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; out.push(row); row = []; }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); out.push(row); }
  return out.filter(r => r.some(x => x.trim() !== ''));
}

function cellValue(v: any): any {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('result' in v) return cellValue(v.result);
    if ('text' in v) return String(v.text);
    if (Array.isArray(v.richText)) return v.richText.map((x: any) => x.text).join('');
    return '';
  }
  return v;
}

async function readGrid(file: File): Promise<any[][]> {
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length > 5 * 1024 * 1024) throw new HttpError(413, 'File is larger than 5 MB.');
  if (/\.csv$/i.test(file.name)) return parseCsv(buf.toString('utf8').replace(/^﻿/, ''));
  if (!/\.xlsx$/i.test(file.name)) throw new HttpError(422, 'Upload an .xlsx or .csv file.');
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buf as any); } catch { throw new HttpError(422, 'This file could not be read as Excel. Save it as .xlsx and try again.'); }
  const ws = wb.worksheets[0];
  if (!ws) throw new HttpError(422, 'The file has no sheet.');
  const grid: any[][] = [];
  ws.eachRow({ includeEmpty: false }, row => {
    const vals: any[] = [];
    for (let c = 1; c <= ws.columnCount; c++) vals.push(cellValue(row.getCell(c).value));
    grid.push(vals);
  });
  return grid.filter(r => r.some(x => String(x).trim() !== ''));
}

export async function importFile(ent: Entity, s: Session, file: File, ip: string | null) {
  const grid = await readGrid(file);
  if (grid.length < 2) throw new HttpError(422, 'The file has a header row but no data rows.');
  if (grid.length > 5001) throw new HttpError(422, 'Import at most 5,000 rows at a time.');
  const fs = cols(ent);
  const norm = (x: any) => String(x).trim().toLowerCase();
  const head = grid[0].map(norm);
  const map: { f: Field; idx: number }[] = [];
  for (const f of fs) {
    const idx = head.findIndex(h => h === norm(header(f)) || h === norm(f.label) || h === f.key);
    if (idx >= 0) map.push({ f, idx });
  }
  if (!map.some(m => m.f.key === 'code')) throw new HttpError(422, 'The file must have a "Code" column. Download the template to see the expected columns.');

  const lookups: Record<string, Map<string, number>> = {};
  for (const { f } of map) if (f.type === 'rel' && !lookups[f.rel!]) {
    const r = relInfo(f.rel!);
    lookups[f.rel!] = new Map((await q(`select id, ${r.code} as code from ${r.table}`)).map((x: any) => [String(x.code).toUpperCase(), x.id]));
  }
  const existing = new Map((await q(`select id, code from ${ent.table}`)).map((x: any) => [String(x.code).toUpperCase(), x.id]));

  let created = 0, updated = 0, unchanged = 0; const errors: { row: number; message: string }[] = [];
  for (let i = 1; i < grid.length; i++) {
    const body: any = {}; let bad = '';
    for (const { f, idx } of map) {
      const raw = grid[i][idx];
      const blank = raw === '' || raw == null || String(raw).trim() === '';
      if (f.type === 'rel') {
        if (blank) { body[f.key] = null; continue; }
        const id = lookups[f.rel!].get(String(raw).trim().toUpperCase());
        if (!id) { bad = `${header(f)} "${raw}" was not found.`; break; }
        body[f.key] = id;
      } else if (f.type === 'password') { if (!blank) body.password = String(raw); }
      else body[f.key] = blank ? null : raw;
    }
    const codeKey = String(body.code ?? '').trim().toUpperCase();
    if (!bad && !codeKey) bad = 'Code is empty.';
    if (bad) { errors.push({ row: i + 1, message: bad }); continue; }
    try {
      const id = existing.get(codeKey) ?? null;
      const r = await saveRow(ent, s, id, body, ip);
      if ((r as any).unchanged) unchanged++; else if (id) updated++; else { created++; existing.set(codeKey, r.id); if (lookups[ent.key]) lookups[ent.key].set(codeKey, r.id); }
    } catch (e: any) {
      if (e instanceof HttpError) errors.push({ row: i + 1, message: e.message }); else throw e;
    }
  }
  return { created, updated, unchanged, failed: errors.length, errors: errors.slice(0, 200), columns: map.map(m => header(m.f)) };
}
