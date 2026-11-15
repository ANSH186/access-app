import { Link } from 'react-router-dom';
import { Siren, Volume2 } from 'lucide-react';
import { useEmergency } from '../hooks/useEmergency';
import { Age, TestBadge } from './ui';
import { nameOf } from '../lib/profiles';
import { summariseLocation } from '../lib/location';

/** Full-width high-contrast banner shown on every page while any SOS is unacknowledged. */
export default function SosBanner() {
  const { unacknowledged, escalated, profiles, audioReady, enableSound, muted } = useEmergency();
  if (unacknowledged.length === 0) return null;
  // newest first in the banner
  const escIds = new Set(escalated.map((a) => a.id));
  // escalated first (oldest first), then newest first
  const list = [...unacknowledged].sort((a, b) => {
    const ea = escIds.has(a.id) ? 0 : 1;
    const eb = escIds.has(b.id) ? 0 : 1;
    if (ea !== eb) return ea - eb;
    return ea === 0 ? a.created_at.localeCompare(b.created_at) : b.created_at.localeCompare(a.created_at);
  });
  const shown = list.slice(0, 3);
  return (
    <div className="sos-banner border-b-4 border-white bg-[#B91C1C] px-4 py-3 text-white" role="region" aria-label="Unacknowledged SOS alerts">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <Siren size={28} aria-hidden="true" className="shrink-0" />
        <ul className="min-w-0 flex-1 space-y-1">
          {shown.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-base font-bold">
              <span>
                {escIds.has(a.id) && <span className="mr-2 rounded bg-white px-2 py-0.5 text-sm font-extrabold text-[#7F1D1D]">UNACKNOWLEDGED FOR 2+ MIN</span>}
                {escIds.has(a.id) ? 'SOS from' : 'New SOS from'} {nameOf(profiles, a.user_id, 'a user')} &mdash; {summariseLocation(a).headline} &mdash;{' '}
                <Age since={a.created_at} />
              </span>
              {a.is_test && <TestBadge />}
              <Link
                to={`/emergency?alert=${a.id}`}
                className="rounded-lg bg-white px-3 py-1 text-sm font-bold text-[#7F1D1D] hover:bg-red-100"
              >
                Open alert
              </Link>
            </li>
          ))}
          {list.length > shown.length && <li className="text-sm">and {list.length - shown.length} more unacknowledged</li>}
        </ul>
        {!audioReady && (
          <button onClick={() => void enableSound()} className="btn bg-white !text-[#7F1D1D] font-bold hover:bg-red-100">
            <Volume2 size={16} aria-hidden="true" /> Enable sound alerts
          </button>
        )}
        {audioReady && muted && <span className="text-sm font-semibold">Sound is muted</span>}
      </div>
    </div>
  );
}
