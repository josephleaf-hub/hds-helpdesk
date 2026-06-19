// Date/number formatting — ported from shared.js (fmtDate/fmtShort) + admin (fmtDur/median).

export function fmtDate(s?: string | null): string {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function fmtShort(s?: string | null): string {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Human duration from milliseconds: <1m, 18m, 3h 20m, 3d 4h
export function fmtDur(ms: number | null): string {
  if (ms == null || isNaN(ms) || ms < 0) return '—';
  const m = Math.round(ms / 60000);
  if (m < 1) return '<1m';
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60), rm = m % 60;
  if (h < 24) return rm ? `${h}h ${rm}m` : `${h}h`;
  const d = Math.floor(h / 24), rh = h % 24;
  return rh ? `${d}d ${rh}h` : `${d}d`;
}

export function median(nums: number[]): number | null {
  const a = (nums || []).filter((n) => n != null && !isNaN(n)).sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}
