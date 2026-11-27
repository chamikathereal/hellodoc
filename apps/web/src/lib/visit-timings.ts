const CLINIC_TZ = 'Asia/Colombo';

/** Exact clinic-local date and time, e.g. "27 Nov 2026, 09:05 AM". "—" when not recorded. */
export function formatClinicDateTime(iso: string | null | undefined, timeZone = CLINIC_TZ): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso));
}

/** Clinic-local time only, e.g. "09:05 AM". "—" when not recorded. */
export function formatClinicTime(iso: string | null | undefined, timeZone = CLINIC_TZ): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

/** Whole minutes between two timestamps, e.g. "12 min". "—" when either is missing or out of order. */
export function minutesBetween(fromIso: string | null | undefined, toIso: string | null | undefined): string {
  if (!fromIso || !toIso) return '—';
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  return `${Math.round(ms / 60_000)} min`;
}
