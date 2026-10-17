const timeFmt = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
const dayFmt = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });

export function rupees(paise: number): string {
  const r = paise / 100;
  return `₹${Number.isInteger(r) ? r : r.toFixed(2)}`;
}

export function clock(ms: number): string {
  return timeFmt.format(ms);
}

export function day(ms: number): string {
  return dayFmt.format(ms);
}

export function minutesFromNow(ms: number, now = Date.now()): number {
  return Math.round((ms - now) / 60_000);
}

export function crowdWord(level: 'quiet' | 'moderate' | 'busy'): string {
  return level === 'quiet' ? 'Quiet' : level === 'moderate' ? 'Moderate' : 'Busy';
}

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function pct(x: number | null): string {
  return x === null ? '—' : `${Math.round(x * 100)}%`;
}
