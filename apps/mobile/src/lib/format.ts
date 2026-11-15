import type { ConfirmedLocation } from './types';

export const STALE_MINUTES = 15;

export function minutesSince(iso: string, now = Date.now()): number {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
}

export function ageText(iso: string, now = Date.now()): string {
  const m = minutesSince(iso, now);
  if (m < 1) return 'just now';
  if (m === 1) return '1 min ago';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return h === 1 ? '1 hour ago' : `${h} hours ago`;
}

export function isStale(loc: ConfirmedLocation, now = Date.now()): boolean {
  return minutesSince(loc.observed_at, now) > STALE_MINUTES;
}

/** "Floor 2, Lift lobby" */
export function locationText(loc: Pick<ConfirmedLocation, 'floor_name' | 'label'>): string {
  const label = loc.label ?? '';
  if (!loc.floor_name) return label;
  if (label.toLowerCase().startsWith(loc.floor_name.toLowerCase())) return label;
  return `${loc.floor_name}, ${label}`;
}

export function locationLine(loc: ConfirmedLocation | null, now = Date.now()): string {
  if (!loc) return 'Location not confirmed — scan a checkpoint';
  const base = `Last confirmed: ${locationText(loc)} — ${ageText(loc.observed_at, now)}`;
  return loc.source === 'staff_confirmed' ? `${base} (chosen by hand, less certain)` : base;
}

export function newerThanMinutes(iso: string, minutes: number) {
  return minutesSince(iso) <= minutes;
}
