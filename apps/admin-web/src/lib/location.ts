import type { EmergencyAlert, LocationSource } from '../types';
import { fmtRough } from './format';

const SOURCE_TEXT: Record<LocationSource, string> = {
  qr_checkpoint: 'QR checkpoint',
  staff_confirmed: 'Confirmed by staff',
  route_progress: 'Estimated from route progress',
  gps: 'GPS',
  unknown: 'Unknown',
};

export interface LocationSummary {
  known: boolean;
  headline: string; // e.g. "Floor 2, near lift (QR)" or "Location unknown"
  provenance: string; // e.g. "QR checkpoint, confirmed 4 min before alert"
}

/** Never invents a location: unknown stays unknown. */
export function summariseLocation(a: EmergencyAlert): LocationSummary {
  const hasPlace = Boolean(a.node_id || a.location_label || (a.lat != null && a.lng != null));
  if (a.location_source === 'unknown' && !hasPlace) {
    return { known: false, headline: 'Location unknown', provenance: 'The user did not share a location, or none was available.' };
  }
  const src = SOURCE_TEXT[a.location_source];
  let fresh: string;
  if (!a.location_observed_at) {
    fresh = 'time of confirmation not recorded';
  } else {
    const diff = new Date(a.created_at).getTime() - new Date(a.location_observed_at).getTime();
    if (Math.abs(diff) < 30_000) fresh = 'confirmed at about the time of the alert';
    else if (diff > 0) fresh = `confirmed ${fmtRough(diff)} before alert`;
    else fresh = `confirmed ${fmtRough(-diff)} after alert`;
  }
  return {
    known: true,
    headline: a.location_label || (a.node_id ? 'Last known checkpoint (see map)' : 'Coordinates only'),
    provenance: `${src}, ${fresh}`,
  };
}
