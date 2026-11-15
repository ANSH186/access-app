import { useEffect, useMemo, useState } from 'react';
import { Route as RouteIcon, TriangleAlert } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useMapData } from '../hooks/useMapData';
import { errMsg, supabase } from '../lib/supabase';
import { planRoute, apiConfigured } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import MapSvg, { MapLegend } from '../components/MapSvg';
import { EdgeStatusChip, ErrorNote, KV, PageHeader, SidePanel } from '../components/ui';
import type { RouteEdge, RouteNode, RoutePlanResponse } from '../types';

type PanelState = { kind: 'node'; id: string } | { kind: 'edge'; id: string } | { kind: 'route' } | null;

function EdgePanel({ edge, canEdit, onClose }: { edge: RouteEdge; canEdit: boolean; onClose: () => void }) {
  const { nodeById, reloadEdges } = useMapData();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blocking = edge.status === 'open';

  async function toggle() {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.rpc('set_edge_status', {
      p_edge_id: edge.id,
      p_status: blocking ? 'blocked' : 'open',
      p_reason: reason.trim() === '' ? null : reason.trim(),
    });
    if (err) setError(errMsg(err));
    else {
      setReason('');
      await reloadEdges();
    }
    setBusy(false);
  }

  return (
    <SidePanel label="Corridor" onClose={onClose}>
      <div className="flex items-center gap-2"><h3 className="text-lg font-bold">{edge.code}</h3><EdgeStatusChip status={edge.status} /></div>
      <dl className="grid grid-cols-2 gap-3">
        <KV k="From">{nodeById.get(edge.from_node_id)?.label ?? '?'}</KV>
        <KV k="To">{nodeById.get(edge.to_node_id)?.label ?? '?'}</KV>
        <KV k="Kind">{edge.kind}</KV>
        <KV k="Length">{edge.length_m.toFixed(1)} m</KV>
        <KV k="Step-free">{edge.step_free ? 'Yes' : 'No'}</KV>
        <KV k="Verified">{edge.verified ? `Yes (${fmtDateTime(edge.verified_at)})` : 'No'}</KV>
      </dl>
      {edge.status === 'blocked' && (
        <KV k="Blocked because">{edge.blocked_reason || 'No reason recorded'}{edge.blocked_by_report_id && <><br /><span className="text-muted">Linked to a report</span></>}</KV>
      )}
      {canEdit ? (
        <div className="space-y-2">
          <ErrorNote message={error} />
          <label htmlFor="reason" className="label">{blocking ? 'Reason for blocking (required)' : 'Note for reopening (optional)'}</label>
          <input id="reason" className="field" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button className={blocking ? 'btn-danger' : 'btn-primary'} disabled={busy || (blocking && reason.trim() === '')} onClick={() => void toggle()}>
            {busy ? 'Saving…' : blocking ? 'Block this corridor' : 'Reopen this corridor'}
          </button>
        </div>
      ) : <p className="text-sm text-muted">Only admins and map editors can change corridor status.</p>}
    </SidePanel>
  );
}

function NodePanel({ node, canEdit, onClose }: { node: RouteNode; canEdit: boolean; onClose: () => void }) {
  const { reload } = useMapData();
  const [label, setLabel] = useState(node.label);
  const [aliases, setAliases] = useState(node.aliases.join(', '));
  const [qr, setQr] = useState(node.qr_token ?? '');
  const [verified, setVerified] = useState(node.verified);
  const [notes, setNotes] = useState(node.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    const { error: err } = await supabase.from('route_nodes').update({
      label: label.trim(),
      aliases: aliases.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
      qr_token: qr.trim() === '' ? null : qr.trim(),
      verified,
      verified_at: verified ? (node.verified && node.verified_at ? node.verified_at : new Date().toISOString()) : null,
      notes: notes.trim() === '' ? null : notes.trim(),
    }).eq('id', node.id);
    if (err) setError(err.message.includes('duplicate') ? 'That QR token is already used by another node.' : errMsg(err));
    else {
      setSaved(true);
      await reload();
    }
    setBusy(false);
  }

  return (
    <SidePanel label="Map node" onClose={onClose}>
      <div><h3 className="text-lg font-bold">{node.label}</h3><p className="text-sm text-muted">{node.code} &middot; {node.kind} &middot; x {node.x}, y {node.y} m</p></div>
      <ErrorNote message={error} />
      <div><label className="label" htmlFor="n-label">Spoken label</label>
        <input id="n-label" className="field" value={label} disabled={!canEdit} onChange={(e) => setLabel(e.target.value)} /></div>
      <div><label className="label" htmlFor="n-alias">Aliases (comma separated, lowercase)</label>
        <input id="n-alias" className="field" value={aliases} disabled={!canEdit} onChange={(e) => setAliases(e.target.value)} /></div>
      <div><label className="label" htmlFor="n-qr">QR token (empty = not a checkpoint)</label>
        <input id="n-qr" className="field" value={qr} disabled={!canEdit} onChange={(e) => setQr(e.target.value)} /></div>
      <div><label className="label" htmlFor="n-notes">Notes</label>
        <textarea id="n-notes" rows={2} className="field" value={notes} disabled={!canEdit} onChange={(e) => setNotes(e.target.value)} /></div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="h-4 w-4 accent-sky-400" checked={verified} disabled={!canEdit} onChange={(e) => setVerified(e.target.checked)} />
        Verified on site
      </label>
      {canEdit ? (
        <div className="flex items-center gap-3">
          <button className="btn-primary" disabled={busy || label.trim() === ''} onClick={() => void save()}>{busy ? 'Saving…' : 'Save node'}</button>
          {saved && <span className="text-sm text-ok" role="status">Saved</span>}
        </div>
      ) : <p className="text-sm text-muted">Only admins and map editors can edit nodes.</p>}
    </SidePanel>
  );
}

function RoutePanel({ onClose, onResult }: { onClose: () => void; onResult: (r: RoutePlanResponse | null) => void }) {
  const { nodes, floorById } = useMapData();
  const options = useMemo(
    () => nodes.filter((n) => n.kind !== 'corridor' || n.qr_token)
      .map((n) => ({ n, f: floorById.get(n.floor_id) }))
      .sort((a, b) => (a.f?.level ?? 0) - (b.f?.level ?? 0) || a.n.label.localeCompare(b.n.label)),
    [nodes, floorById],
  );
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [avoid, setAvoid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<RoutePlanResponse | null>(null);

  async function plan() {
    setBusy(true);
    setError(null);
    try {
      const r = await planRoute({ from_node_id: from, to_node_id: to, avoid_stairs: avoid });
      setRes(r);
      onResult(r);
    } catch (e) {
      setError(errMsg(e));
      setRes(null);
      onResult(null);
    } finally {
      setBusy(false);
    }
  }

  const opt = (o: (typeof options)[number]) => (
    <option key={o.n.id} value={o.n.id}>{o.f?.name ?? '?'} - {o.n.label}{o.n.qr_token ? ' (QR)' : ''}</option>
  );

  return (
    <SidePanel label="Preview route" onClose={() => { onResult(null); onClose(); }} width="w-full sm:w-[480px]">
      {!apiConfigured && <ErrorNote message="VITE_API_URL is not set, so route preview is unavailable." />}
      <div><label className="label" htmlFor="r-from">From</label>
        <select id="r-from" className="field" value={from} onChange={(e) => setFrom(e.target.value)}><option value="">Choose start&hellip;</option>{options.map(opt)}</select></div>
      <div><label className="label" htmlFor="r-to">To</label>
        <select id="r-to" className="field" value={to} onChange={(e) => setTo(e.target.value)}><option value="">Choose destination&hellip;</option>{options.map(opt)}</select></div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-sky-400" checked={avoid} onChange={(e) => setAvoid(e.target.checked)} /> Avoid stairs</label>
      <button className="btn-primary" disabled={!from || !to || busy || !apiConfigured} onClick={() => void plan()}>
        <RouteIcon size={16} aria-hidden="true" /> {busy ? 'Planning (the server may be waking up)…' : 'Plan route'}
      </button>
      <ErrorNote message={error} />
      {res && (
        <div className="space-y-3" aria-live="polite">
          {!res.found && <p className="rounded-lg border border-orange-400/50 bg-orange-500/10 p-3 text-sm">{res.explanation ?? 'No route was found.'}</p>}
          {res.found && (
            <>
              <p className="text-sm">Total length about <b>{Math.round(res.total_length_m ?? 0)} m</b>.</p>
              {res.explanation && <p className="rounded-lg border border-accent/40 bg-accent/10 p-3 text-sm">{res.explanation}</p>}
              {(res.warnings ?? []).length > 0 && (
                <ul className="space-y-1">
                  {res.warnings!.map((w) => <li key={w} className="flex gap-2 text-sm text-warn"><TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />{w}</li>)}
                </ul>
              )}
              {(res.blocked_edges_avoided ?? []).length > 0 && (
                <div><p className="label">Blocked corridors avoided</p>
                  <ul className="list-disc pl-5 text-sm">{res.blocked_edges_avoided!.map((b) => <li key={b.edge_id}>{b.label}: {b.reason}</li>)}</ul></div>
              )}
              <ol className="space-y-2">
                {(res.steps ?? []).map((s) => (
                  <li key={s.index} className="rounded-lg bg-base/60 p-2 text-sm">
                    <span className="font-semibold">{s.index + 1}.</span> {s.instruction}
                    <span className="block text-xs text-muted">Floor {s.floor_level} &middot; {Math.round(s.length_m)} m{s.checkpoint_qr ? ` · checkpoint ${s.checkpoint_qr}` : ''}</span>
                  </li>
                ))}
              </ol>
              {res.arrival_message && <p className="text-sm text-muted">{res.arrival_message}</p>}
            </>
          )}
        </div>
      )}
    </SidePanel>
  );
}

export default function MapPage() {
  const { hasRole } = useAuth();
  const canEdit = hasRole('admin', 'map_editor');
  const { floors, buildings, nodes, edges, nodeById, floorById, loading, error } = useMapData();
  const [floorId, setFloorId] = useState<string | null>(null);
  const [panel, setPanel] = useState<PanelState>(null);
  const [route, setRoute] = useState<RoutePlanResponse | null>(null);

  const sorted = useMemo(() => [...floors].sort((a, b) => a.level - b.level), [floors]);
  useEffect(() => {
    if (!floorId && sorted.length > 0) setFloorId(sorted[0].id);
  }, [sorted, floorId]);

  const floor = floorId ? floorById.get(floorId) : undefined;
  const building = buildings.find((b) => b.id === floor?.building_id);
  const pathNodeIds = useMemo(() => new Set(route?.found ? route.node_ids ?? [] : []), [route]);
  const pathEdgeIds = useMemo(() => new Set(route?.found ? route.edge_ids ?? [] : []), [route]);
  const routeFloors = useMemo(() => {
    const s = new Set<string>();
    for (const id of pathNodeIds) {
      const n = nodeById.get(id);
      if (n) s.add(n.floor_id);
    }
    return s;
  }, [pathNodeIds, nodeById]);

  const floorNodes = nodes.filter((n) => n.floor_id === floorId);
  const floorNodeIds = new Set(floorNodes.map((n) => n.id));
  const floorEdges = edges.filter((e) => floorNodeIds.has(e.from_node_id) && floorNodeIds.has(e.to_node_id));
  const blockedHere = floorEdges.filter((e) => e.status === 'blocked').length;

  function onRoute(r: RoutePlanResponse | null) {
    setRoute(r);
    const first = r?.found && r.node_ids?.[0] ? nodeById.get(r.node_ids[0]) : undefined;
    if (first) setFloorId(first.floor_id);
  }

  const selNode = panel?.kind === 'node' ? nodeById.get(panel.id) : undefined;
  const selEdge = panel?.kind === 'edge' ? edges.find((e) => e.id === panel.id) : undefined;
  const panelOpen = panel !== null;

  return (
    <div className={panelOpen ? 'sm:pr-[480px]' : ''}>
      <PageHeader title="Campus map" sub={building ? `${building.name} - ${floor?.name ?? ''}` : undefined}>
        <button className="btn-primary" onClick={() => setPanel({ kind: 'route' })}><RouteIcon size={16} aria-hidden="true" /> Preview route</button>
      </PageHeader>
      <ErrorNote message={error} />
      {building?.is_placeholder && (
        <p className="mb-4 flex items-center gap-2 rounded-lg border border-warn bg-warn/15 px-4 py-2 text-sm font-bold text-warn" role="note">
          <TriangleAlert size={16} aria-hidden="true" /> PLACEHOLDER layout &mdash; verify on site
        </p>
      )}
      {loading && <p className="text-muted" role="status">Loading map&hellip;</p>}

      <div role="tablist" aria-label="Floors" className="mb-3 flex flex-wrap gap-2">
        {sorted.map((f) => (
          <button key={f.id} role="tab" aria-selected={f.id === floorId} className={f.id === floorId ? 'btn-primary' : 'btn-soft'} onClick={() => setFloorId(f.id)}>
            {f.name}{routeFloors.has(f.id) ? ' (route)' : ''}
          </button>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div><label className="label" htmlFor="pick-node">Select a node (keyboard alternative)</label>
          <select id="pick-node" className="field" value={panel?.kind === 'node' ? panel.id : ''} onChange={(e) => e.target.value && setPanel({ kind: 'node', id: e.target.value })}>
            <option value="">Choose&hellip;</option>{floorNodes.map((n) => <option key={n.id} value={n.id}>{n.label} ({n.code})</option>)}
          </select></div>
        <div><label className="label" htmlFor="pick-edge">Select a corridor</label>
          <select id="pick-edge" className="field" value={panel?.kind === 'edge' ? panel.id : ''} onChange={(e) => e.target.value && setPanel({ kind: 'edge', id: e.target.value })}>
            <option value="">Choose&hellip;</option>{floorEdges.map((e) => <option key={e.id} value={e.id}>{e.code}{e.status === 'blocked' ? ' - BLOCKED' : ''}</option>)}
          </select></div>
        <p className="text-sm text-muted" role="status">{blockedHere} blocked on this floor. Changes appear live.</p>
      </div>

      <div className="tile !p-3">
        <MapSvg
          floor={floor}
          className="max-h-[70vh]"
          selectedNodeId={panel?.kind === 'node' ? panel.id : null}
          selectedEdgeId={panel?.kind === 'edge' ? panel.id : null}
          pathNodeIds={pathNodeIds}
          pathEdgeIds={pathEdgeIds}
          onNodeClick={(n) => setPanel({ kind: 'node', id: n.id })}
          onEdgeClick={(e) => setPanel({ kind: 'edge', id: e.id })}
        />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <MapLegend />
          {route && <button className="btn-soft !min-h-0 !py-1 !text-xs" onClick={() => setRoute(null)}>Clear route preview</button>}
        </div>
      </div>

      {selNode && <NodePanel key={selNode.id} node={selNode} canEdit={canEdit} onClose={() => setPanel(null)} />}
      {selEdge && <EdgePanel key={selEdge.id + selEdge.status} edge={selEdge} canEdit={canEdit} onClose={() => setPanel(null)} />}
      {panel?.kind === 'route' && <RoutePanel onClose={() => setPanel(null)} onResult={onRoute} />}
    </div>
  );
}
