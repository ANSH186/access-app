import { useEffect, useMemo, useState } from 'react';
import { Ban, Check, CircleSlash, ClipboardCheck, RotateCcw, Search, UserCheck, X } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useLoad } from '../hooks/useLoad';
import { useMapData } from '../hooks/useMapData';
import { errMsg, supabase } from '../lib/supabase';
import { loadProfiles, nameOf } from '../lib/profiles';
import { listStaff } from '../lib/staff';
import { fmtDateTime, humanize } from '../lib/format';
import MapSvg from '../components/MapSvg';
import { ErrorNote, KV, PageHeader, ReportStatusChip, SidePanel } from '../components/ui';
import type { ObstacleReport, Profile, ReportCategory, ReportEvent, ReportStatus } from '../types';

const STATUSES: ReportStatus[] = ['submitted', 'under_review', 'verified', 'assigned', 'resolved', 'closed', 'rejected', 'reopened'];
const CATEGORIES: ReportCategory[] = ['blocked_path', 'closed_door', 'broken_lift', 'wet_floor', 'missing_sign', 'construction', 'other'];

// CONTRACT section 2: allowed report_transition moves.
const ALLOWED: Record<ReportStatus, ReportStatus[]> = {
  submitted: ['under_review', 'verified', 'rejected'],
  under_review: ['verified', 'rejected'],
  verified: ['assigned', 'resolved'],
  assigned: ['resolved'],
  resolved: ['closed', 'reopened'],
  closed: ['reopened'],
  rejected: ['reopened'],
  reopened: ['under_review', 'verified'],
};

const ACTION: Record<ReportStatus, { label: string; icon: typeof Check; cls: string }> = {
  submitted: { label: '', icon: Check, cls: '' },
  under_review: { label: 'Start review', icon: Search, cls: 'btn-primary' },
  verified: { label: 'Verify', icon: ClipboardCheck, cls: 'btn-primary' },
  assigned: { label: 'Assign', icon: UserCheck, cls: 'btn-soft' },
  resolved: { label: 'Resolve', icon: Check, cls: 'btn-soft' },
  closed: { label: 'Close', icon: X, cls: 'btn-soft' },
  rejected: { label: 'Reject', icon: CircleSlash, cls: 'btn-soft' },
  reopened: { label: 'Reopen', icon: RotateCcw, cls: 'btn-soft' },
};

function ReportDetail({ report, onClose, onChanged }: { report: ObstacleReport; onClose: () => void; onChanged: () => Promise<void> }) {
  const { institutionId, hasRole } = useAuth();
  const { nodeById, edgeById, floorById, edges, nodes, floors } = useMapData();
  const [note, setNote] = useState('');
  const [assignee, setAssignee] = useState('');
  const [blockEdgeId, setBlockEdgeId] = useState(report.edge_id ?? '');
  const [pickFloorId, setPickFloorId] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, Profile>>({});

  const canBlock = hasRole('admin', 'map_editor');
  const edge = report.edge_id ? edgeById.get(report.edge_id) : undefined;
  const node = report.node_id ? nodeById.get(report.node_id) : undefined;
  const anchorNode = node ?? (edge ? nodeById.get(edge.from_node_id) : undefined);
  const chosenEdge = blockEdgeId ? edgeById.get(blockEdgeId) : undefined;
  const chosenFloorNode = chosenEdge ? nodeById.get(chosenEdge.from_node_id) : undefined;
  const floor = anchorNode
    ? floorById.get(anchorNode.floor_id)
    : chosenFloorNode ? floorById.get(chosenFloorNode.floor_id) : pickFloorId ? floorById.get(pickFloorId) : undefined;

  // Candidate corridors to block: those touching the report's node, else the report's own edge, else all edges on a chosen floor.
  const edgeCandidates = useMemo(() => {
    let list: typeof edges = [];
    if (report.node_id) {
      list = edges.filter((e) => e.from_node_id === report.node_id || e.to_node_id === report.node_id);
      if (report.edge_id && !list.some((e) => e.id === report.edge_id) && edgeById.get(report.edge_id)) list = [...list, edgeById.get(report.edge_id)!];
    } else if (report.edge_id) {
      list = edges.filter((e) => e.id === report.edge_id);
    } else if (pickFloorId) {
      const ids = new Set(nodes.filter((n) => n.floor_id === pickFloorId).map((n) => n.id));
      list = edges.filter((e) => ids.has(e.from_node_id) && ids.has(e.to_node_id));
    } else list = [];
    return list;
  }, [edges, nodes, report.node_id, report.edge_id, pickFloorId, edgeById]);

  const edgeLabel = (e: (typeof edges)[number]) => {
    const other = report.node_id
      ? nodeById.get(e.from_node_id === report.node_id ? e.to_node_id : e.from_node_id)
      : undefined;
    if (other) return `${floorById.get(other.floor_id)?.name ?? '?'} - to ${other.label}${e.status === 'blocked' ? ' (already blocked)' : ''}`;
    const a = nodeById.get(e.from_node_id);
    const b = nodeById.get(e.to_node_id);
    return `${a ? floorById.get(a.floor_id)?.name ?? '?' : '?'} - ${a?.label ?? '?'} to ${b?.label ?? '?'}${e.status === 'blocked' ? ' (already blocked)' : ''}`;
  };
  const sortedFloors = useMemo(() => [...floors].sort((a, b) => a.level - b.level), [floors]);

  const photo = useLoad<string | null>(async () => {
    if (!report.photo_path) return null;
    const { data, error: err } = await supabase.storage.from('report-photos').createSignedUrl(report.photo_path, 600);
    if (err) throw err;
    return data.signedUrl;
  }, [report.photo_path]);

  const events = useLoad<ReportEvent[]>(async () => {
    const { data, error: err } = await supabase.from('report_events').select('*').eq('report_id', report.id).order('created_at').order('id');
    if (err) throw err;
    return (data ?? []) as ReportEvent[];
  }, [report.id, report.updated_at]);

  const maint = useLoad<{ id: string; name: string }[]>(async () => {
    const rows = await listStaff(['maintenance', 'map_editor', 'admin']);
    return rows.map((r) => ({ id: r.user_id, name: `${r.display_name || `User ${r.user_id.slice(0, 8)}`} (${r.roles.join(', ')})` }));
  }, [institutionId]);

  const evList = events.data ?? [];
  useEffect(() => {
    let live = true;
    void loadProfiles([report.reporter_id, report.assignee_id, ...evList.map((e) => e.actor_id)]).then((p) => live && setNames((c) => ({ ...c, ...p })));
    return () => { live = false; };
  }, [report.reporter_id, report.assignee_id, evList]);

  async function go(to: ReportStatus, opts: { block?: boolean } = {}) {
    setBusy(opts.block ? 'block' : to);
    setError(null);
    try {
      const args: Record<string, unknown> = {
        p_report_id: report.id,
        p_to_status: to,
        p_note: note.trim() === '' ? null : note.trim(),
        p_block_edge: Boolean(opts.block),
        p_assignee_id: to === 'assigned' ? assignee : null,
        p_edge_id: opts.block ? blockEdgeId : null,
      };
      const { error: err } = await supabase.rpc('report_transition', args);
      if (err) throw err;
      setNote('');
      await onChanged();
      await events.reload();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  const options = ALLOWED[report.status];
  const noteRequired = (to: ReportStatus) => (to === 'resolved' || to === 'rejected') && note.trim() === '';

  return (
    <SidePanel label="Report details" onClose={onClose}>
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-xl font-bold">{humanize(report.category)}</h3>
          <ReportStatusChip status={report.status} />
        </div>
        <p className="text-sm text-muted">Reported {fmtDateTime(report.created_at)} by {report.reporter_id ? nameOf(names, report.reporter_id, 'a student') : 'unknown'}</p>
        <p className="text-sm">{report.description || <span className="text-muted">No description.</span>}</p>
      </header>
      <ErrorNote message={error} />

      <section aria-label="Photo">
        <h4 className="mb-2 text-sm font-bold">Photo</h4>
        {!report.photo_path && <p className="text-sm text-muted">No photo attached.</p>}
        {photo.loading && report.photo_path && <p className="text-sm text-muted" role="status">Loading photo&hellip;</p>}
        {photo.error && <p className="text-sm text-red-300">Could not load the photo: {photo.error}</p>}
        {photo.data && <img src={photo.data} alt={`Photo attached to the report: ${report.description ?? humanize(report.category)}`} className="max-h-72 w-full rounded-xl object-contain bg-base" />}
      </section>

      <section aria-label="Location" className="space-y-2">
        <h4 className="text-sm font-bold">Location</h4>
        <dl className="grid grid-cols-2 gap-3">
          <KV k="Place">{node ? `${node.label} (${node.code})` : '-'}</KV>
          <KV k="Corridor">{edge ? `${nodeById.get(edge.from_node_id)?.label ?? '?'} to ${nodeById.get(edge.to_node_id)?.label ?? '?'}${edge.status === 'blocked' ? ' (currently blocked)' : ''}` : '-'}</KV>
        </dl>
        {floor ? (
          <MapSvg floor={floor} compact highlightNodeId={node?.id ?? null} highlightEdgeId={chosenEdge?.id ?? edge?.id ?? null} highlightLabel="Reported here" className="max-h-72" />
        ) : (
          <p className="text-sm text-muted">The reporter did not pick a place on the map.</p>
        )}
      </section>

      <section aria-label="Actions" className="space-y-3">
        <h4 className="text-sm font-bold">Actions</h4>
        {options.length === 0 && <p className="text-sm text-muted">No further actions.</p>}
        {report.assignee_id && <KV k="Assigned to">{nameOf(names, report.assignee_id, 'Maintenance staff')}</KV>}
        {report.resolution_notes && <KV k="Resolution note">{report.resolution_notes}</KV>}
        <div>
          <label htmlFor="rnote" className="label">Note {options.some((o) => o === 'resolved' || o === 'rejected') && '(required to resolve or reject)'}</label>
          <textarea id="rnote" rows={2} className="field" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {options.includes('assigned') && (
          <div>
            <label htmlFor="assign" className="label">Assign to maintenance user</label>
            <select id="assign" className="field" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">Choose a person&hellip;</option>
              {(maint.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            {maint.data && maint.data.length === 0 && <p className="mt-1 text-xs text-muted">No maintenance users visible to your role.</p>}
          </div>
        )}
        {options.includes('verified') && canBlock && (
          <div className="space-y-2">
            {!report.node_id && !report.edge_id && (
              <div>
                <label htmlFor="blockfloor" className="label">Floor (the report has no place)</label>
                <select id="blockfloor" className="field" value={pickFloorId} onChange={(e) => { setPickFloorId(e.target.value); setBlockEdgeId(''); }}>
                  <option value="">Choose a floor&hellip;</option>
                  {sortedFloors.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>
            )}
            <div>
              <label htmlFor="blockedge" className="label">Corridor to block with &ldquo;Verify + block corridor&rdquo;</label>
              <select id="blockedge" className="field" value={blockEdgeId} onChange={(e) => setBlockEdgeId(e.target.value)}>
                <option value="">Choose a corridor&hellip;</option>
                {edgeCandidates.map((e) => <option key={e.id} value={e.id}>{edgeLabel(e)}</option>)}
              </select>
              {edgeCandidates.length === 0 && <p className="mt-1 text-xs text-muted">No corridors to choose from yet.</p>}
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {options.map((to) => {
            const a = ACTION[to];
            const disabled = busy !== null || noteRequired(to) || (to === 'assigned' && !assignee);
            return (
              <button key={to} className={a.cls} disabled={disabled} onClick={() => void go(to)}>
                <a.icon size={16} aria-hidden="true" /> {busy === to ? 'Saving…' : a.label}
              </button>
            );
          })}
          {options.includes('verified') && canBlock && (
            <button className="btn-danger" disabled={busy !== null || !blockEdgeId} onClick={() => void go('verified', { block: true })}>
              <Ban size={16} aria-hidden="true" /> {busy === 'block' ? 'Saving…' : 'Verify + block corridor'}
            </button>
          )}
        </div>
        {options.some(noteRequired) && <p className="text-xs text-muted">Add a note to enable Resolve or Reject.</p>}
      </section>

      <section aria-label="History" className="space-y-2">
        <h4 className="text-sm font-bold">History</h4>
        <ErrorNote message={events.error} />
        {evList.length === 0 && !events.loading && <p className="text-sm text-muted">No history yet.</p>}
        <ol className="space-y-3 border-l border-line pl-4">
          {evList.map((e) => (
            <li key={e.id} className="relative">
              <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-accent" aria-hidden="true" />
              <p className="text-sm font-semibold">{e.from_status ? `${humanize(e.from_status)} to ${humanize(e.to_status)}` : humanize(e.to_status)}</p>
              {e.note && <p className="text-sm">{e.note}</p>}
              <p className="text-xs text-muted">{nameOf(names, e.actor_id, 'Staff member')} &middot; {fmtDateTime(e.created_at)}</p>
            </li>
          ))}
        </ol>
      </section>
    </SidePanel>
  );
}

export default function Reports() {
  const { institutionId } = useAuth();
  const { nodeById, edgeById } = useMapData();
  const [status, setStatus] = useState<'all' | ReportStatus>('all');
  const [category, setCategory] = useState<'all' | ReportCategory>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const res = useLoad<ObstacleReport[]>(async () => {
    const { data, error } = await supabase.from('obstacle_reports').select('*').eq('institution_id', institutionId!).order('created_at', { ascending: false }).limit(500);
    if (error) throw error;
    return (data ?? []) as ObstacleReport[];
  }, [institutionId]);

  useEffect(() => {
    if (!institutionId) return;
    const ch = supabase.channel(`reports-${institutionId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'obstacle_reports', filter: `institution_id=eq.${institutionId}` }, () => void res.reload())
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [institutionId]);

  const list = useMemo(
    () => (res.data ?? []).filter((r) => (status === 'all' || r.status === status) && (category === 'all' || r.category === category)),
    [res.data, status, category],
  );
  const selected = (res.data ?? []).find((r) => r.id === selectedId) ?? null;

  const where = (r: ObstacleReport) => {
    if (r.edge_id) {
      const e = edgeById.get(r.edge_id);
      if (e) return `${nodeById.get(e.from_node_id)?.label ?? '?'} to ${nodeById.get(e.to_node_id)?.label ?? '?'}`;
    }
    if (r.node_id) return nodeById.get(r.node_id)?.label ?? 'Unknown place';
    return 'Not specified';
  };

  return (
    <div className={selected ? 'sm:pr-[480px]' : ''}>
      <PageHeader title="Accessibility Reports" sub="Obstacles reported by students." />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div><label className="label" htmlFor="f-status">Status</label>
          <select id="f-status" className="field" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="all">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
          </select></div>
        <div><label className="label" htmlFor="f-cat">Category</label>
          <select id="f-cat" className="field" value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>
            <option value="all">All categories</option>{CATEGORIES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
          </select></div>
      </div>
      <ErrorNote message={res.error} />
      <div className="overflow-x-auto rounded-2xl border border-line/70 bg-surface">
        <table className="w-full min-w-[640px]">
          <caption className="sr-only">Accessibility reports</caption>
          <thead><tr className="border-b border-line/70">
            <th className="th" scope="col">Reported</th><th className="th" scope="col">Category</th><th className="th" scope="col">Where</th><th className="th" scope="col">Status</th><th className="th" scope="col">Photo</th>
          </tr></thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id} className={`border-b border-line/40 last:border-0 ${selectedId === r.id ? 'bg-raised' : ''}`}>
                <td className="td"><button className="font-semibold text-accent-strong hover:underline" onClick={() => setSelectedId(r.id)}>{fmtDateTime(r.created_at)}</button></td>
                <td className="td">{humanize(r.category)}</td>
                <td className="td">{where(r)}</td>
                <td className="td"><ReportStatusChip status={r.status} /></td>
                <td className="td">{r.photo_path ? 'Yes' : 'No'}</td>
              </tr>
            ))}
            {list.length === 0 && !res.loading && <tr><td className="td text-muted" colSpan={5}>No reports match.</td></tr>}
          </tbody>
        </table>
      </div>
      {selected && <ReportDetail key={selected.id} report={selected} onClose={() => setSelectedId(null)} onChanged={res.reload} />}
    </div>
  );
}
