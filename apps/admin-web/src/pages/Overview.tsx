import { Link } from 'react-router-dom';
import { Ban, ClipboardList, Layers, Siren } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useEmergency } from '../hooks/useEmergency';
import { useMapData } from '../hooks/useMapData';
import { useLoad } from '../hooks/useLoad';
import { supabase } from '../lib/supabase';
import { loadProfiles, nameOf } from '../lib/profiles';
import { fmtDateTime, humanize } from '../lib/format';
import { Age, ErrorNote, PageHeader } from '../components/ui';
import type { EmergencyEvent, ReportEvent, ReportStatus } from '../types';

interface Activity { key: string; at: string; text: string; kind: 'Emergency' | 'Report' }

const REPORT_STATUSES: ReportStatus[] = ['submitted', 'under_review', 'verified', 'assigned', 'reopened'];

export default function Overview() {
  const { institutionId, hasRole, institution } = useAuth();
  const em = useEmergency();
  const map = useMapData();
  const canEm = hasRole('admin', 'responder');
  const canReports = hasRole('admin', 'maintenance', 'map_editor');

  const data = useLoad(async () => {
    const out: { statuses: Record<string, number> | null; activity: Activity[] } = { statuses: null, activity: [] };
    const act: Activity[] = [];
    if (canReports && institutionId) {
      const { data: rows, error } = await supabase.from('obstacle_reports').select('status').eq('institution_id', institutionId).limit(5000);
      if (error) throw error;
      const c: Record<string, number> = {};
      for (const r of (rows ?? []) as { status: string }[]) c[r.status] = (c[r.status] ?? 0) + 1;
      out.statuses = c;
      const { data: ev } = await supabase.from('report_events').select('*').order('created_at', { ascending: false }).limit(8);
      const evs = (ev ?? []) as ReportEvent[];
      const names = await loadProfiles(evs.map((e) => e.actor_id));
      for (const e of evs) {
        act.push({
          key: `r${e.id}`, at: e.created_at, kind: 'Report',
          text: `${nameOf(names, e.actor_id, 'Someone')}: report ${e.from_status ? `${humanize(e.from_status)} to ` : ''}${humanize(e.to_status)}`,
        });
      }
    }
    if (canEm) {
      const { data: ev } = await supabase.from('emergency_events').select('*').order('created_at', { ascending: false }).limit(8);
      const evs = (ev ?? []) as EmergencyEvent[];
      const names = await loadProfiles(evs.map((e) => e.actor_id));
      for (const e of evs) {
        act.push({
          key: `e${e.id}`, at: e.created_at, kind: 'Emergency',
          text: `${e.actor_id ? nameOf(names, e.actor_id, 'Staff') : 'System'}: ${humanize(e.event_type)}${e.to_status ? ` (${humanize(e.to_status)})` : ''}`,
        });
      }
    }
    out.activity = act.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 10);
    return out;
  }, [institutionId, canEm, canReports, em.tick]);

  const blocked = map.edges.filter((e) => e.status === 'blocked');
  const checkpoints = map.nodes.filter((n) => n.qr_token);
  const placeholder = map.buildings.some((b) => b.is_placeholder);
  const oldest = em.unacknowledged[0];
  const activeCount = em.alerts.length;

  return (
    <div>
      <PageHeader title="Overview" sub={institution?.name} />
      <ErrorNote message={data.error ?? map.error} />
      <div className="grid gap-4 md:grid-cols-6">
        {canEm && (
          <Link
            to="/emergency"
            className={`tile md:col-span-3 md:row-span-2 transition hover:brightness-110 ${
              activeCount > 0 ? '!border-red-400 !bg-red-950/70' : ''
            }`}
          >
            <p className="label flex items-center gap-2"><Siren size={14} aria-hidden="true" /> Active SOS alerts</p>
            <p className={`mt-2 text-8xl font-extrabold tabular-nums leading-none ${activeCount > 0 ? 'text-red-300' : ''}`}>{activeCount}</p>
            <p className="mt-4 text-sm text-muted">
              {oldest ? (
                <>Oldest unacknowledged: <b className="text-ink"><Age since={oldest.created_at} /></b> ({em.unacknowledged.length} waiting)</>
              ) : activeCount > 0 ? 'All active alerts have been acknowledged.' : 'No SOS alerts need attention.'}
            </p>
            <p className="mt-1 text-xs text-accent-strong">Open Emergency Management</p>
          </Link>
        )}

        {canReports && (
          <section className="tile md:col-span-3" aria-label="Open reports by status">
            <p className="label flex items-center gap-2"><ClipboardList size={14} aria-hidden="true" /> Open reports by status</p>
            <ul className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
              {REPORT_STATUSES.map((s) => (
                <li key={s} className="flex justify-between"><span className="text-muted">{humanize(s)}</span><b className="tabular-nums">{data.data?.statuses?.[s] ?? 0}</b></li>
              ))}
            </ul>
            <Link className="mt-3 inline-block text-xs text-accent-strong" to="/reports">Open reports</Link>
          </section>
        )}

        <section className="tile md:col-span-3" aria-label="Blocked corridors">
          <p className="label flex items-center gap-2"><Ban size={14} aria-hidden="true" /> Blocked corridors</p>
          <p className={`mt-1 text-4xl font-extrabold tabular-nums ${blocked.length > 0 ? 'text-red-300' : ''}`}>{blocked.length}</p>
          <p className="text-xs text-muted">{blocked.length > 0 ? 'Routes avoid these automatically.' : 'No corridors are blocked.'}</p>
        </section>

        <section className="tile md:col-span-3" aria-label="Mapped campus">
          <p className="label flex items-center gap-2"><Layers size={14} aria-hidden="true" /> Mapped</p>
          <p className="mt-1 text-sm">
            <b className="text-2xl tabular-nums">{map.floors.length}</b> floors &middot; <b className="text-2xl tabular-nums">{map.nodes.length}</b> nodes &middot;{' '}
            <b className="text-2xl tabular-nums">{checkpoints.length}</b> QR checkpoints
          </p>
          {placeholder && <span className="chip mt-2 border-warn/70 bg-warn/15 text-warn">Placeholder layout</span>}
        </section>

        <section className="tile md:col-span-6" aria-label="Recent activity">
          <p className="label">Recent activity</p>
          {(data.data?.activity ?? []).length === 0 && <p className="text-sm text-muted">Nothing yet.</p>}
          <ul className="divide-y divide-line/50">
            {(data.data?.activity ?? []).map((a) => (
              <li key={a.key} className="flex flex-wrap items-baseline gap-x-3 py-2 text-sm">
                <span className="w-24 shrink-0 text-xs font-semibold uppercase text-muted">{a.kind}</span>
                <span className="min-w-0 flex-1">{a.text}</span>
                <span className="text-xs text-muted">{fmtDateTime(a.at)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
