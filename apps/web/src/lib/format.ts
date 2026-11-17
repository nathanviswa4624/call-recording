export function fmtDuration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || Number.isNaN(sec)) return '—';
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

export function fmtHours(sec: number): string {
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  return `${(sec / 3600).toFixed(sec < 36000 ? 1 : 0)} h`;
}

export function fmtBytes(n: number | null | undefined): string {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}

const dtf = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const df = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
const tf = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export const fmtDateTime = (v: string | number | Date | null | undefined) => (v ? dtf.format(new Date(v)) : '—');
export const fmtDate = (v: string | number | Date | null | undefined) => (v ? df.format(new Date(v)) : '—');
export const fmtTime = (v: string | number | Date | null | undefined) => (v ? tf.format(new Date(v)) : '—');

export function fmtNumber(n: number | null | undefined): string {
  return n === null || n === undefined ? '—' : new Intl.NumberFormat().format(n);
}

/** Value for <input type="datetime-local"> in local time. */
export function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** CSV export of rows currently displayed (client-side; RFC 4180 quoting, formula-injection safe). */
export function toCsv(rows: Array<Record<string, unknown>>, columns: Array<{ key: string; label: string }>): string {
  const esc = (v: unknown) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // neutralise spreadsheet formulas
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map((c) => esc(c.label)).join(','), ...rows.map((r) => columns.map((c) => esc(r[c.key])).join(','))].join('\r\n');
}

export function downloadText(filename: string, text: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob(['﻿', text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
