const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** "Scan 18 Oct 2026, 14:05" */
export function suggestTitle(date: Date = new Date(), prefix = 'Scan'): string {
  return `${prefix} ${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Normalises a user-entered title. Empty input falls back to the provided default. */
export function cleanTitle(input: string, fallback: string): string {
  const t = input.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
  return t || fallback;
}

/** Makes a title unique against existing ones: "Invoice" → "Invoice (2)". Comparison is case-insensitive. */
export function uniqueTitle(title: string, existing: Iterable<string>): string {
  const taken = new Set([...existing].map((t) => t.toLowerCase()));
  if (!taken.has(title.toLowerCase())) return title;
  const m = title.match(/^(.*) \((\d+)\)$/);
  const base = m ? m[1] : title;
  let n = m ? Number(m[2]) + 1 : 2;
  while (taken.has(`${base} (${n})`.toLowerCase())) n++;
  return `${base} (${n})`;
}

/** Safe cross-platform file name for exports. Never empty, no path separators or reserved characters. */
export function safeFileName(title: string, ext: string): string {
  let base = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\\/:*?"<>|#%&{}$!'@+`=\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 80)
    .trim();
  if (!base || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(base)) base = 'Document';
  return `${base}.${ext.replace(/^\./, '')}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function formatDate(ts: number, now: number = Date.now()): string {
  const d = new Date(ts);
  const n = new Date(now);
  const sameDay = d.toDateString() === n.toDateString();
  if (sameDay) return `Today, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const y = new Date(now - 86400000);
  if (d.toDateString() === y.toDateString()) return `Yesterday, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== n.getFullYear() ? ` ${d.getFullYear()}` : ''}`;
}

/** Compact date for cards: "14:05", "Yesterday", "18 Oct" or "18 Oct 2025". */
export function formatShortDate(ts: number, now: number = Date.now()): string {
  const d = new Date(ts);
  const n = new Date(now);
  if (d.toDateString() === n.toDateString()) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.toDateString() === new Date(now - 86400000).toDateString()) return 'Yesterday';
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== n.getFullYear() ? ` ${d.getFullYear()}` : ''}`;
}

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
