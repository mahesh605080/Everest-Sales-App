'use client';
import { ApiError, call } from './ui';

export type StoredFile = { id: string; name: string; folder: string; size: number; content_type: string; owner_id: number; created_at: string; mine: boolean };
export const fileSize = (n: number) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B');
export const downloadUrl = (id: string, inline = false) => `/api/v1/files/${id}/download${inline ? '?inline=true' : ''}`;

/** Sends one file to the platform's file store. Type and size are checked on the server; its message is shown as it is. */
export async function uploadFile(file: File, opts: { folder?: string; ref_type?: string; ref_id?: string } = {}): Promise<StoredFile> {
  const fd = new FormData(); fd.append('file', file);
  for (const [k, v] of Object.entries(opts)) if (v) fd.append(k, v);
  let res: Response;
  try { res = await fetch('/api/v1/files', { method: 'POST', body: fd }); } catch { throw new ApiError('No connection to the server. Check your internet and try again.', 0); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || 'The file could not be saved.', res.status);
  return data;
}
export const listFiles = (scope: 'mine' | 'shared' | 'all' = 'mine', q = '') => call<{ files: StoredFile[]; total: number; quota: { limit_bytes: number; used_bytes: number; free_bytes: number; files: number } }>(`/api/v1/files?scope=${scope}&limit=200${q ? `&q=${encodeURIComponent(q)}` : ''}`);
export const deleteFile = (id: string) => call(`/api/v1/files/${id}`, { method: 'DELETE' });
export const shareFile = (id: string, body: { user_ids?: number[]; role_key?: string | null; everyone?: boolean }) => call(`/api/v1/files/${id}/shares`, { method: 'PUT', json: body });
/** A link that opens the file without login for a limited time, to send to someone outside. */
export const fileLink = async (id: string, seconds = 3600) => location.origin + (await call<{ path: string }>(`/api/v1/files/${id}/link`, { method: 'POST', json: { seconds } })).path;
