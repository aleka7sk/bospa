export const DAY_MS = 86_400_000;

export function uid(prefix = 'id') {
  const token = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${token}`;
}

export function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

export function toDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function fromDateKey(key, time = '00:00') { return new Date(`${key}T${time}:00`); }

export function addDays(value, amount) {
  const date = value instanceof Date ? new Date(value) : fromDateKey(value);
  date.setDate(date.getDate() + amount);
  return date;
}

export function dayDiff(start, end) {
  return Math.round((fromDateKey(toDateKey(end)) - fromDateKey(toDateKey(start))) / DAY_MS);
}

export function dateRange(start, count) { return Array.from({length: count}, (_, index) => addDays(start, index)); }

export function formatMoney(value, compact = false) {
  const number = Number(value || 0);
  if (compact && Math.abs(number) >= 1_000_000) return `${(number / 1_000_000).toFixed(number >= 10_000_000 ? 0 : 1)} млн ₸`;
  if (compact && Math.abs(number) >= 1_000) return `${Math.round(number / 1_000)} тыс. ₸`;
  return `${new Intl.NumberFormat('ru-KZ', {maximumFractionDigits: 0}).format(number)} ₸`;
}

export function formatPhone(phone = '') {
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))) {
    const n = `7${digits.slice(1)}`;
    return `+${n[0]} ${n.slice(1, 4)} ${n.slice(4, 7)} ${n.slice(7, 9)} ${n.slice(9, 11)}`;
  }
  return phone;
}

export function formatDate(value, options = {}) {
  const date = value instanceof Date ? value : fromDateKey(value);
  return new Intl.DateTimeFormat('ru-RU', {day: 'numeric', month: options.month || 'short', year: options.year, weekday: options.weekday}).format(date).replace('.', '');
}

export function formatPeriod(checkIn, checkOut) { return `${formatDate(checkIn)} — ${formatDate(checkOut)}`; }
export function isWeekend(value, weekendDays = [5, 6]) { return weekendDays.includes((value instanceof Date ? value : fromDateKey(value)).getDay()); }
export function isToday(value) { return toDateKey(value) === toDateKey(new Date()); }
export function overlaps(aStart, aEnd, bStart, bEnd) { return fromDateKey(aStart) < fromDateKey(bEnd) && fromDateKey(bStart) < fromDateKey(aEnd); }
export function nights(checkIn, checkOut) { return Math.max(1, dayDiff(checkIn, checkOut)); }
export function initials(name = '') { return String(name).split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '—'; }

export function relativeTime(value) {
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat('ru', {numeric: 'auto'});
  const units = [['year',31536000],['month',2592000],['week',604800],['day',86400],['hour',3600],['minute',60],['second',1]];
  for (const [unit, size] of units) if (Math.abs(seconds) >= size || unit === 'second') return formatter.format(Math.round(seconds / size), unit);
  return 'сейчас';
}

export function debounce(fn, delay = 180) { let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); }; }

export function downloadText(filename, content, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], {type});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

export function csvEscape(value) { const text = String(value ?? ''); return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }

export function apartmentArtwork(apartment, index = 0) {
  const key = `${apartment.code}-${index}`;
  const a = (Math.abs([...key].reduce((sum, c) => sum + c.charCodeAt(0), 0)) % 240) + 120;
  const b = (a + 54) % 360;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 900 600'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop stop-color='hsl(${a} 55% 36%)'/><stop offset='1' stop-color='hsl(${b} 70% 19%)'/></linearGradient><filter id='n'><feTurbulence baseFrequency='.75' numOctaves='3'/><feColorMatrix values='1 0 0 0 0 0 1 0 0 0 1 0 0 0 0 0 0 .12 0'/></filter></defs><rect width='900' height='600' fill='url(#g)'/><rect width='900' height='600' filter='url(#n)' opacity='.35'/><rect x='110' y='150' width='680' height='340' rx='28' fill='rgba(255,255,255,.12)' stroke='rgba(255,255,255,.25)' stroke-width='4'/><rect x='145' y='205' width='250' height='210' rx='18' fill='rgba(255,255,255,.16)'/><rect x='435' y='205' width='315' height='120' rx='18' fill='rgba(255,255,255,.2)'/><rect x='435' y='350' width='145' height='65' rx='16' fill='rgba(255,255,255,.14)'/><rect x='605' y='350' width='145' height='65' rx='16' fill='rgba(255,255,255,.14)'/><text x='145' y='470' fill='white' font-family='system-ui,sans-serif' font-size='36' font-weight='700'>${escapeHtml(apartment.complex)}</text><text x='145' y='520' fill='rgba(255,255,255,.78)' font-family='system-ui,sans-serif' font-size='24'>bospa · ${escapeHtml(apartment.code)}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function safeJsonParse(value, fallback) { try { return JSON.parse(value); } catch { return fallback; } }
