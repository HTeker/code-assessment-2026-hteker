// All times are school-local wall-clock strings. No timezones on purpose.

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function toHHmm(minutes: number): string {
  const h = String(Math.floor(minutes / 60)).padStart(2, "0");
  const m = String(minutes % 60).padStart(2, "0");
  return `${h}:${m}`;
}

// True only for real calendar dates: "2026-02-30" is rejected.
export function isValidDate(date: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number) as [number, number, number];
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function localDate(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// "YYYY-MM-DD HH:mm" in local time. Fixed width, so plain string comparison orders it correctly.
export function localNow(now: Date): string {
  return `${localDate(now)} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}
