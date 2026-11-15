import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bell, MapPin, Phone, Volume2, VolumeX } from 'lucide-react';
import { sortAlerts, useEmergency } from '../hooks/useEmergency';
import { useAuth } from '../hooks/useAuth';
import { useLoad } from '../hooks/useLoad';
import { supabase } from '../lib/supabase';
import { loadProfiles, nameOf } from '../lib/profiles';
import { summariseLocation } from '../lib/location';
import { fmtDateTime, fmtDuration, humanize, median } from '../lib/format';
import AlertDetail from '../components/AlertDetail';
import { Age, AlertStatusChip, Disclaimer, ErrorNote, PageHeader, TestBadge } from '../components/ui';
import type { EmergencyAlert, Profile } from '../types';

type Tab = 'queue' | 'history';

function QueueCard({ a, profile, selected, onSelect, escalated }: {
  escalated: boolean; a: EmergencyAlert; profile?: Profile; selected: boolean; onSelect: () => void;
}) {
  const loc = summariseLocation(a);
  const unack = a.status === 'triggered';
  return (
    <li>
      <button
        onClick={onSelect}
        aria-pressed={selected}
        className={`w-full rounded-2xl border p-4 text-left transition focus-visible:outline-offset-4 ${
          unack ? 'border-red-400 bg-red-950/60 shadow-[inset_6px_0_0_#EF4444]' : 'border-line/70 bg-surface hover:bg-raised'
        } ${selected ? 'ring-2 ring-accent' : ''}`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-lg font-bold">{profile?.display_name || 'Unknown user'}</span>
          <AlertStatusChip status={a.status} />
          {escalated && <span className="chip border-white bg-white text-[#7F1D1D]">UNACKNOWLEDGED FOR 2+ MIN</span>}
          {a.is_test && <TestBadge />}
          <span className="ml-auto text-sm font-semibold"><Age since={a.created_at} /></span>
        </div>
        <div className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <p className="flex items-center gap-1.5 text-muted">
            <Phone size={14} aria-hidden="true" /> {profile?.phone || 'No phone on file'}
          </p>
          <p className="text-muted">Type: <span className="text-ink">{humanize(a.emergency_type)}</span></p>
          <p className={`flex items-start gap-1.5 sm:col-span-2 ${loc.known ? '' : 'text-orange-300'}`}>
            <MapPin size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span><span className="font-semibold">{loc.headline}</span> <span className="text-muted">&mdash; {loc.provenance}</span></span>
          </p>
          {a.message && <p className="sm:col-span-2">&ldquo;{a.message}&rdquo;</p>}
        </div>
      </button>
    </li>
  );
}

function History({ selectedId, onSelect }: { selectedId: string | null; onSelect: (a: EmergencyAlert) => void }) {
  const { institutionId } = useAuth();
  const { tick } = useEmergency();
  const [status, setStatus] = useState<'all' | 'resolved' | 'cancelled'>('all');
  const [kind, setKind] = useState<'all' | 'test' | 'real'>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [names, setNames] = useState<Record<string, Profile>>({});

  const res = useLoad<EmergencyAlert[]>(async () => {
    let q = supabase
      .from('emergency_alerts').select('*').eq('institution_id', institutionId!)
      .in('status', status === 'all' ? ['resolved', 'cancelled'] : [status])
      .order('created_at', { ascending: false }).limit(200);
    if (from) q = q.gte('created_at', new Date(`${from}T00:00:00`).toISOString());
    if (to) q = q.lte('created_at', new Date(`${to}T23:59:59.999`).toISOString());
    if (kind === 'test') q = q.eq('is_test', true);
    if (kind === 'real') q = q.eq('is_test', false);
    const { data, error } = await q;
    if (error) throw error;
    const list = (data ?? []) as EmergencyAlert[];
    setNames(await loadProfiles(list.map((a) => a.user_id)));
    return list;
  }, [institutionId, status, kind, from, to, tick]);

  const list = res.data ?? [];
  const metrics = useMemo(() => {
    const ack = list.filter((a) => a.acknowledged_at).map((a) => new Date(a.acknowledged_at!).getTime() - new Date(a.created_at).getTime());
    const resv = list.filter((a) => a.status === 'resolved' && a.resolved_at).map((a) => new Date(a.resolved_at!).getTime() - new Date(a.created_at).getTime());
    return { ack: median(ack), ackN: ack.length, resolve: median(resv), resolveN: resv.length };
  }, [list]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div><label className="label" htmlFor="h-status">Status</label>
          <select id="h-status" className="field" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="all">Resolved and cancelled</option><option value="resolved">Resolved</option><option value="cancelled">Cancelled</option>
          </select></div>
        <div><label className="label" htmlFor="h-kind">Test or real</label>
          <select id="h-kind" className="field" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="all">Test and real</option><option value="test">Test only</option><option value="real">Real only</option>
          </select></div>
        <div><label className="label" htmlFor="h-from">From date</label>
          <input id="h-from" type="date" className="field" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><label className="label" htmlFor="h-to">To date</label>
          <input id="h-to" type="date" className="field" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      </div>

      <dl className="grid gap-3 sm:grid-cols-3">
        <div className="tile"><dt className="label">Alerts in this list</dt><dd className="text-2xl font-bold tabular-nums">{list.length}</dd></div>
        <div className="tile"><dt className="label">Median time to acknowledge</dt>
          <dd className="text-2xl font-bold tabular-nums">{metrics.ack == null ? 'No data' : fmtDuration(metrics.ack)}</dd>
          <dd className="text-xs text-muted">from {metrics.ackN} acknowledged alert(s)</dd></div>
        <div className="tile"><dt className="label">Median time to resolve</dt>
          <dd className="text-2xl font-bold tabular-nums">{metrics.resolve == null ? 'No data' : fmtDuration(metrics.resolve)}</dd>
          <dd className="text-xs text-muted">from {metrics.resolveN} resolved alert(s)</dd></div>
      </dl>

      <ErrorNote message={res.error} />
      <div className="overflow-x-auto rounded-2xl border border-line/70 bg-surface">
        <table className="w-full min-w-[640px]">
          <caption className="sr-only">Resolved and cancelled alerts</caption>
          <thead><tr className="border-b border-line/70"><th className="th" scope="col">Raised</th><th className="th" scope="col">User</th><th className="th" scope="col">Type</th><th className="th" scope="col">Status</th><th className="th" scope="col">Time to acknowledge</th><th className="th" scope="col">Open for</th></tr></thead>
          <tbody>
            {list.map((a) => (
              <tr key={a.id} className={`border-b border-line/40 last:border-0 ${selectedId === a.id ? 'bg-raised' : ''}`}>
                <td className="td">
                  <button className="font-semibold text-accent-strong underline-offset-2 hover:underline" onClick={() => onSelect(a)}>{fmtDateTime(a.created_at)}</button>
                </td>
                <td className="td">{nameOf(names, a.user_id)} {a.is_test && <TestBadge className="ml-1" />}</td>
                <td className="td">{humanize(a.emergency_type)}</td>
                <td className="td"><AlertStatusChip status={a.status} /></td>
                <td className="td tabular-nums">{a.acknowledged_at ? fmtDuration(new Date(a.acknowledged_at).getTime() - new Date(a.created_at).getTime()) : '-'}</td>
                <td className="td tabular-nums">{(a.resolved_at ?? (a.status === 'cancelled' ? a.updated_at : null)) ? fmtDuration(new Date(a.resolved_at ?? a.updated_at).getTime() - new Date(a.created_at).getTime()) : '-'}</td>
              </tr>
            ))}
            {list.length === 0 && !res.loading && <tr><td className="td text-muted" colSpan={6}>No alerts match these filters.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Emergency() {
  const em = useEmergency();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>('queue');
  const [snapshot, setSnapshot] = useState<EmergencyAlert | null>(null);
  const selectedId = params.get('alert');

  const fresher = em.alerts.find((a) => a.id === selectedId);
  const selected = fresher ?? (snapshot && snapshot.id === selectedId ? snapshot : null);

  // Deep links and alerts that leave the active list (e.g. just resolved) are fetched by id and kept fresh.
  useEffect(() => {
    if (!selectedId || fresher) return;
    void supabase.from('emergency_alerts').select('*').eq('id', selectedId).maybeSingle().then(({ data }) => {
      if (data) setSnapshot(data as EmergencyAlert);
    });
  }, [em.tick, selectedId, fresher]);

  function select(a: EmergencyAlert | null) {
    setSnapshot(a);
    const next = new URLSearchParams(params);
    if (a) next.set('alert', a.id); else next.delete('alert');
    setParams(next, { replace: true });
  }

  // escalated alerts pinned first, then unacknowledged, then the rest (sortAlerts)
  const escIds = new Set(em.escalated.map((x) => x.id));
  const queue = sortAlerts(em.alerts).sort((a, b) => Number(escIds.has(b.id)) - Number(escIds.has(a.id)));
  const oldestUnack = em.unacknowledged[0];

  return (
    <div className={selected ? 'sm:pr-[480px]' : ''}>
      <PageHeader title="Emergency Management" sub="Live SOS queue for campus responders.">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`chip ${em.connection === 'live' ? 'border-ok/60 bg-ok/10 text-ok' : 'border-warn/70 bg-warn/15 text-warn'}`} role="status">
            <span className={`h-2 w-2 rounded-full ${em.connection === 'live' ? 'bg-ok' : 'bg-warn'}`} aria-hidden="true" />
            {em.connection === 'live' ? 'Live' : 'Reconnecting…'}
          </span>
          {!em.audioReady && <button className="btn-primary" onClick={() => void em.enableSound()}><Volume2 size={16} aria-hidden="true" /> Enable sound alerts</button>}
          <button className="btn-soft" aria-pressed={em.muted} onClick={() => em.setMuted(!em.muted)}>
            {em.muted ? <VolumeX size={16} aria-hidden="true" /> : <Volume2 size={16} aria-hidden="true" />}
            {em.muted ? 'Unmute alert sound' : 'Mute alert sound'}
          </button>
          {em.notifPermission === 'default' && (
            <button className="btn-soft" onClick={() => void em.requestNotifications()}><Bell size={16} aria-hidden="true" /> Enable browser notifications</button>
          )}
          {em.notifPermission === 'denied' && <span className="text-xs text-muted">Browser notifications are blocked in this browser.</span>}
        </div>
      </PageHeader>

      <p className="-mt-3 mb-5"><Disclaimer /></p>

      {!em.audioReady && (
        <p className="mb-4 rounded-lg border border-warn/50 bg-warn/10 px-3 py-2 text-sm text-warn" role="note">
          Sound alerts are off until you click &ldquo;Enable sound alerts&rdquo;. Browsers do not allow sound before a click. The red banner still appears without sound.
        </p>
      )}

      <div role="tablist" aria-label="Emergency views" className="mb-4 flex gap-2">
        {(['queue', 'history'] as Tab[]).map((t) => (
          <button key={t} role="tab" id={`tab-${t}`} aria-selected={tab === t} aria-controls={`panel-${t}`}
            onClick={() => setTab(t)}
            className={tab === t ? 'btn-primary' : 'btn-soft'}>
            {t === 'queue' ? `Active queue (${queue.length})` : 'History'}
          </button>
        ))}
      </div>

      <ErrorNote message={em.error} />

      {tab === 'queue' ? (
        <div role="tabpanel" id="panel-queue" aria-labelledby="tab-queue" className="space-y-3">
          {oldestUnack && (
            <p className="text-sm text-muted">Oldest unacknowledged: <b className="text-ink"><Age since={oldestUnack.created_at} /></b></p>
          )}
          {em.loading && <p className="text-muted" role="status">Loading alerts&hellip;</p>}
          {!em.loading && queue.length === 0 && (
            <div className="tile text-center">
              <p className="text-lg font-semibold">No active SOS alerts</p>
              <p className="text-sm text-muted">New alerts appear here instantly. This page also checks every 15 seconds.</p>
            </div>
          )}
          <ul className="space-y-3">
            {queue.map((a) => (
              <QueueCard key={a.id} escalated={em.escalated.some((x) => x.id === a.id)} a={a} profile={em.profiles[a.user_id]} selected={selected?.id === a.id} onSelect={() => select(a)} />
            ))}
          </ul>
        </div>
      ) : (
        <div role="tabpanel" id="panel-history" aria-labelledby="tab-history">
          <History selectedId={selected?.id ?? null} onSelect={select} />
        </div>
      )}

      {selected && <AlertDetail key={selected.id} alert={selected} onClose={() => select(null)} />}
    </div>
  );
}
