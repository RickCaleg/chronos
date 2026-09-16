export function nowIso(): string {
  return new Date().toISOString();
}

function pad(n: number, width = 2): string {
  return n.toString().padStart(width, "0");
}

const DATE_TIME_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/;
const TIME_ONLY_RE = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/;

/** Formats an ISO string as plain, typeable local text: "2025-01-31 14:30:00". */
export function formatLocalDateTimeInput(iso: string): string {
  return `${formatLocalDate(iso)} ${formatLocalTimeLong(iso)}`;
}

/**
 * Parses plain local date/time text back into an ISO UTC string.
 * Accepts "yyyy-MM-dd HH:mm[:ss]" (also with a "T" separator), or just
 * "HH:mm[:ss]" to change the time while keeping `fallbackIso`'s date.
 * Returns null when the text doesn't match either shape.
 */
export function parseLocalDateTimeInput(text: string, fallbackIso: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  let m = trimmed.match(DATE_TIME_RE);
  if (m) {
    const [, y, mo, d, h, mi, s] = m;
    const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), s ? Number(s) : 0);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  m = trimmed.match(TIME_ONLY_RE);
  if (m) {
    const [, h, mi, s] = m;
    const date = new Date(fallbackIso);
    date.setHours(Number(h), Number(mi), s ? Number(s) : 0, 0);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  return null;
}

export function durationBetween(startIso: string, endIso: string): number {
  const seconds = Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 1000);
  return Math.max(0, seconds);
}

export function addSeconds(iso: string, seconds: number): string {
  return new Date(new Date(iso).getTime() + seconds * 1000).toISOString();
}

/** Live-timer style clock, e.g. 1:04:32 */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${pad(m)}:${pad(sec)}`;
}

/** Compact human duration for lists, e.g. 1h 23m */
export function formatDurationHuman(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h === 0 && m === 0) return `${s % 60}s`;
  if (h === 0) return `${m}m`;
  return `${h}h ${pad(m)}m`;
}

export function formatTimeShort(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(
    new Date(iso),
  );
}

export function formatDayLabel(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: "long", day: "2-digit", month: "long" }).format(
    new Date(iso),
  );
}

export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Parses a flexible duration string ("1:30:00", "1:30", "90") into whole seconds. Returns null if invalid. */
export function parseDurationInput(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const parts = trimmed.split(":").map((p) => p.trim());
  if (parts.length > 3 || parts.some((p) => p === "" || Number.isNaN(Number(p)))) return null;

  if (parts.length === 3) {
    const [h, m, s] = parts.map(Number);
    return h * 3600 + m * 60 + s;
  }
  if (parts.length === 2) {
    const [h, m] = parts.map(Number);
    return h * 3600 + m * 60;
  }
  // plain number => minutes
  return Math.round(Number(parts[0]) * 60);
}

/** Local date/time formatting for CSV export, kept locale-independent for reliable round-tripping. */
export function formatLocalDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatLocalTimeLong(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function combineLocalDateTime(dateStr: string, timeStr: string): string {
  return new Date(`${dateStr}T${timeStr || "00:00:00"}`).toISOString();
}

export function formatDurationInput(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}
