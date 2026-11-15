import { useEffect, useState } from 'react';
import { Phone, Check, UserCheck, PhoneOff, Navigation, StickyNote, ShieldCheck } from 'lucide-react';
import { errMsg, supabase } from '../lib/supabase';
import { loadProfiles, nameOf } from '../lib/profiles';
import { listStaff } from '../lib/staff';
import { summariseLocation } from '../lib/location';
import { fmtDateTime, fmtDuration, humanize } from '../lib/format';
import { useLoad } from '../hooks/useLoad';
import { useMapData } from '../hooks/useMapData';
import { useAuth } from '../hooks/useAuth';
import { useEmergency } from '../hooks/useEmergency';
import MapSvg from './MapSvg';
import { Age, AlertStatusChip, Disclaimer, ErrorNote, KV, SidePanel, TestBadge } from './ui';
import type { AlertStatus, EmergencyAlert, EmergencyEvent, Profile } from '../types';

const NEXT: Record<AlertStatus, AlertStatus[]> = {
  triggered: [],
  acknowledged: ['responding', 'unable_to_contact', 'resolved'],
  responding: ['unable_to_contact', 'resolved'],
  unable_to_contact: ['responding', 'resolved'],
  resolved: [],
  cancelled: [],
};

interface Responder { id: string; name: string; roles: string[] }

function describeEvent(e: EmergencyEvent): string {
  switch (e.event_type) {
    case 'triggered': return 'SOS triggered';
    case 'acknowledged': return 'Acknowledged';
    case 'assigned': return 'Responder assigned';
    case 'status_changed': return `Status changed${e.from_status ? ` from ${humanize(e.from_status)}` : ''}${e.to_status ? ` to ${humanize(e.to_status)}` : ''}`;
    case 'note': return e.visible_to_user ? 'Note (visible to user)' : 'Internal note';
    case 'cancelled': return 'Cancelled by user';
    case 'deduplicated': return 'Repeat SOS press merged into this alert';
    default: return humanize(e.event_type);
  }
}

export default function AlertDetail({ alert, onClose }: { alert: EmergencyAlert; onClose: () => void }) {
  const { institutionId, userId } = useAuth();
  const { refresh, tick } = useEmergency();
  const { nodeById, floorById } = useMapData();
  const [names, setNames] = useState<Record<string, Profile>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState('');
  const [noteText, setNoteText] = useState('');
  const [noteVisible, setNoteVisible] = useState(false);
  const [assignee, setAssignee] = useState('');

  const events = useLoad<EmergencyEvent[]>(async () => {
    const { data, error: err } = await supabase
      .from('emergency_events').select('*').eq('alert_id', alert.id).order('created_at').order('id');
    if (err) throw err;
    return (data ?? []) as EmergencyEvent[];
  }, [alert.id, alert.updated_at, tick]);

  const responders = useLoad<Responder[]>(async () => {
    const rows = await listStaff(['responder', 'admin']);
    return rows.map((r) => ({ id: r.user_id, name: r.display_name || `User ${r.user_id.slice(0, 8)}`, roles: r.roles }));
  }, [institutionId]);

  const evList = events.data ?? [];
  useEffect(() => {
    let live = true;
    void loadProfiles([alert.user_id, alert.assigned_responder_id, alert.acknowledged_by, ...evList.map((e) => e.actor_id)]).then(
      (p) => live && setNames((cur) => ({ ...cur, ...p })),
    );
    return () => { live = false; };
  }, [alert.user_id, alert.assigned_responder_id, alert.acknowledged_by, evList]);

  const user = names[alert.user_id];
  const loc = summariseLocation(alert);
  const node = alert.node_id ? nodeById.get(alert.node_id) : undefined;
  const floor = node ? floorById.get(node.floor_id) : undefined;
  const next = NEXT[alert.status];
  const noteTrim = statusNote.trim();

  async function run(label: string, fn: () => PromiseLike<{ error: unknown }>) {
    setBusy(label);
    setError(null);
    try {
      const { error: err } = await fn();
      if (err) throw err;
      await refresh();
      await events.reload();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  const acknowledge = () =>
    run('ack', () => supabase.rpc('emergency_acknowledge', { p_alert_id: alert.id }));
  const assign = () =>
    run('assign', () => supabase.rpc('emergency_assign', { p_alert_id: alert.id, p_responder_id: assignee }));
  const setStatus = (to: AlertStatus) =>
    run(to, async () => {
      const r = await supabase.rpc('emergency_set_status', {
        p_alert_id: alert.id, p_status: to, p_note: noteTrim === '' ? null : noteTrim,
      });
      if (!r.error) setStatusNote('');
      return r;
    });
  const addNote = () =>
    run('note', async () => {
      const r = await supabase.rpc('emergency_add_note', {
        p_alert_id: alert.id, p_note: noteText.trim(), p_visible_to_user: noteVisible,
      });
      if (!r.error) setNoteText('');
      return r;
    });

  const STATUS_BTN: Record<string, { label: string; icon: typeof Check; cls: string }> = {
    responding: { label: 'Mark responding', icon: Navigation, cls: 'btn-primary' },
    unable_to_contact: { label: 'Unable to contact', icon: PhoneOff, cls: 'btn-soft' },
    resolved: { label: 'Resolve', icon: ShieldCheck, cls: 'btn-soft' },
  };

  return (
    <SidePanel label="Alert details" onClose={onClose}>
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-xl font-bold">{nameOf(names, alert.user_id, 'Unknown user')}</h3>
          <AlertStatusChip status={alert.status} />
          {alert.is_test && <TestBadge />}
        </div>
        <p className="text-sm text-muted">
          {humanize(alert.emergency_type)} &middot; raised {fmtDateTime(alert.created_at)}
          {['triggered', 'acknowledged', 'responding', 'unable_to_contact'].includes(alert.status) && (
            <> &middot; open for <Age since={alert.created_at} /></>
          )}
        </p>
        {alert.message && <p className="rounded-lg bg-base/60 p-3 text-sm">&ldquo;{alert.message}&rdquo;</p>}
      </header>

      <ErrorNote message={error} />

      <section aria-label="Location" className="space-y-3">
        <h4 className="text-sm font-bold">Location</h4>
        <div>
          <p className={`text-base font-semibold ${loc.known ? '' : 'text-orange-300'}`}>{loc.headline}</p>
          <p className="text-sm text-muted">{loc.provenance}</p>
          {alert.lat != null && alert.lng != null && (
            <p className="text-sm text-muted">
              GPS reading: {alert.lat.toFixed(5)}, {alert.lng.toFixed(5)}
              {alert.accuracy_m != null && <> (accuracy about {Math.round(alert.accuracy_m)} m)</>}. GPS is unreliable indoors.
            </p>
          )}
        </div>
        {node && floor ? (
          <div>
            <MapSvg floor={floor} compact highlightNodeId={node.id} highlightLabel="Last known position" className="max-h-72" />
            <p className="mt-1 text-xs text-muted">
              Last known position: {node.label}, {floor.name}. The user may have moved since then.
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted">No checkpoint was recorded with this alert, so no map position is shown.</p>
        )}
      </section>

      <section aria-label="Contact" className="space-y-2">
        <h4 className="text-sm font-bold">Contact</h4>
        <div className="flex flex-wrap gap-2">
          {user?.phone ? (
            <a className="btn-primary" href={`tel:${user.phone}`}><Phone size={16} aria-hidden="true" /> Call user ({user.phone})</a>
          ) : (
            <span className="text-sm text-muted">No phone number on file for the user.</span>
          )}
          {user?.emergency_contact_phone && (
            <a className="btn-soft" href={`tel:${user.emergency_contact_phone}`}>
              <Phone size={16} aria-hidden="true" /> Call {user.emergency_contact_name || 'emergency contact'} ({user.emergency_contact_phone})
            </a>
          )}
        </div>
      </section>

      <section aria-label="Response" className="space-y-3">
        <h4 className="text-sm font-bold">Response</h4>
        <dl className="grid grid-cols-2 gap-3">
          <KV k="Acknowledged">
            {alert.acknowledged_at ? (
              <>{fmtDateTime(alert.acknowledged_at)}<br /><span className="text-muted">by {nameOf(names, alert.acknowledged_by, 'staff')} after {fmtDuration(new Date(alert.acknowledged_at).getTime() - new Date(alert.created_at).getTime())}</span></>
            ) : 'Not yet'}
          </KV>
          <KV k="Assigned responder">{alert.assigned_responder_id ? nameOf(names, alert.assigned_responder_id, 'Responder') : 'Nobody yet'}</KV>
        </dl>

        {alert.status === 'triggered' && (
          <button className="btn-danger w-full" disabled={busy !== null} onClick={() => void acknowledge()}>
            <Check size={16} aria-hidden="true" /> {busy === 'ack' ? 'Acknowledging…' : 'Acknowledge this SOS'}
          </button>
        )}

        {(alert.status === 'triggered' || NEXT[alert.status].length > 0) && (
          <div>
            <label htmlFor="assignee" className="label">Assign responder</label>
            <div className="flex gap-2">
              <select id="assignee" className="field" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                <option value="">Choose a responder&hellip;</option>
                {(responders.data ?? []).map((r) => (
                  <option key={r.id} value={r.id}>{r.name}{r.id === userId ? ' (you)' : ''} - {r.roles.join(', ')}</option>
                ))}
              </select>
              <button className="btn-soft shrink-0" disabled={!assignee || busy !== null} onClick={() => void assign()}>
                <UserCheck size={16} aria-hidden="true" /> Assign
              </button>
            </div>
            {alert.status === 'triggered' && <p className="mt-1 text-xs text-muted">Assigning also acknowledges the alert.</p>}
            {responders.error && <p className="mt-1 text-xs text-red-300">Could not load responders: {responders.error}</p>}
          </div>
        )}

        {next.length > 0 && (
          <div className="space-y-2">
            <div>
              <label htmlFor="statusNote" className="label">Status note {next.includes('resolved') && '(required to resolve)'}</label>
              <textarea id="statusNote" rows={2} className="field" value={statusNote} onChange={(e) => setStatusNote(e.target.value)}
                placeholder="What happened / what was done" />
            </div>
            <div className="flex flex-wrap gap-2">
              {next.map((s) => {
                const b = STATUS_BTN[s];
                const needsNote = s === 'resolved' && noteTrim === '';
                return (
                  <button key={s} className={b.cls} disabled={busy !== null || needsNote} onClick={() => void setStatus(s)}
                    aria-describedby={needsNote ? 'resolve-hint' : undefined}>
                    <b.icon size={16} aria-hidden="true" /> {busy === s ? 'Saving…' : b.label}
                  </button>
                );
              })}
            </div>
            {next.includes('resolved') && noteTrim === '' && (
              <p id="resolve-hint" className="text-xs text-muted">Write a note above to enable Resolve.</p>
            )}
          </div>
        )}

        {alert.resolution_notes && (
          <KV k="Resolution note">{alert.resolution_notes}</KV>
        )}
      </section>

      <section aria-label="Add note" className="space-y-2">
        <h4 className="text-sm font-bold">Add a note</h4>
        <label htmlFor="noteText" className="sr-only">Note text</label>
        <textarea id="noteText" rows={2} className="field" value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Write a note" />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-sky-400" checked={noteVisible} onChange={(e) => setNoteVisible(e.target.checked)} />
            Visible to the user (otherwise internal)
          </label>
          <button className="btn-soft" disabled={busy !== null || noteText.trim() === ''} onClick={() => void addNote()}>
            <StickyNote size={16} aria-hidden="true" /> {busy === 'note' ? 'Saving…' : 'Add note'}
          </button>
        </div>
      </section>

      <section aria-label="Timeline" className="space-y-2">
        <h4 className="text-sm font-bold">Timeline</h4>
        {events.error && <ErrorNote message={events.error} />}
        {evList.length === 0 && !events.loading && <p className="text-sm text-muted">No events recorded.</p>}
        <ol className="space-y-3 border-l border-line pl-4">
          {evList.map((e) => (
            <li key={e.id} className="relative">
              <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-accent" aria-hidden="true" />
              <p className="text-sm font-semibold">
                {describeEvent(e)}
                {e.event_type === 'note' && !e.visible_to_user && (
                  <span className="chip ml-2 border-slate-500 bg-slate-500/15 text-slate-200">Internal</span>
                )}
              </p>
              {e.note && <p className="text-sm">{e.note}</p>}
              <p className="text-xs text-muted">{e.actor_id ? nameOf(names, e.actor_id, 'Staff member') : 'System'} &middot; {fmtDateTime(e.created_at)}</p>
            </li>
          ))}
        </ol>
      </section>

      <Disclaimer />
    </SidePanel>
  );
}
