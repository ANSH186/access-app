import { useMemo, type KeyboardEvent } from 'react';
import { useMapData } from '../hooks/useMapData';
import type { Floor, NodeKind, RouteEdge, RouteNode } from '../types';

interface Props {
  floor: Floor | undefined;
  compact?: boolean;
  highlightNodeId?: string | null;
  highlightEdgeId?: string | null;
  /** wording next to the highlighted node, e.g. "Last known position" */
  highlightLabel?: string;
  selectedNodeId?: string | null;
  selectedEdgeId?: string | null;
  pathNodeIds?: Set<string>;
  pathEdgeIds?: Set<string>;
  onNodeClick?: (n: RouteNode) => void;
  onEdgeClick?: (e: RouteEdge) => void;
  className?: string;
}

const MARGIN = 6;
const ROOM_KINDS: NodeKind[] = ['room', 'lab', 'office', 'library', 'washroom', 'help_desk'];

const C = {
  corridor: '#8FA3C4',
  door: '#5C7099',
  blocked: '#F87171',
  path: '#38BDF8',
  node: '#64748B',
  room: '#1B3358',
  roomStroke: '#7DD3FC',
  text: '#E8EEF8',
  halo: '#0B1220',
  qr: '#FBBF24',
  sel: '#FDE68A',
};

function activate(e: KeyboardEvent, fn: () => void) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fn();
  }
}

/** Renders one floor of route_nodes/route_edges in building coordinates (metres, y up = north). */
export default function MapSvg(p: Props) {
  const { nodes, edges, floors, nodeById } = useMapData();
  const interactive = Boolean(p.onNodeClick || p.onEdgeClick);

  const view = useMemo(() => {
    const sibling = new Set(floors.filter((f) => f.building_id === p.floor?.building_id).map((f) => f.id));
    const pts = nodes.filter((n) => sibling.has(n.floor_id));
    const xs = pts.map((n) => n.x).concat([0, 30]);
    const ys = pts.map((n) => n.y).concat([0, 45]);
    const minX = Math.min(...xs) - MARGIN;
    const maxX = Math.max(...xs) + MARGIN;
    const minY = Math.min(...ys) - MARGIN;
    const maxY = Math.max(...ys) + MARGIN;
    return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
  }, [nodes, floors, p.floor?.building_id]);

  const sy = (y: number) => view.minY + view.maxY - y; // flip: building y is up = north

  const floorNodes = useMemo(() => nodes.filter((n) => n.floor_id === p.floor?.id), [nodes, p.floor?.id]);
  const floorNodeIds = useMemo(() => new Set(floorNodes.map((n) => n.id)), [floorNodes]);
  const floorEdges = useMemo(
    () => edges.filter((e) => floorNodeIds.has(e.from_node_id) && floorNodeIds.has(e.to_node_id)),
    [edges, floorNodeIds],
  );

  if (!p.floor) return <p className="text-sm text-muted">No floor selected.</p>;

  const fs = p.compact ? 1.9 : 1.25; // label size in metres
  const sw = p.compact ? 0.5 : 0.36;
  const highlighted = p.highlightNodeId ? nodeById.get(p.highlightNodeId) : undefined;
  const onThisFloor = highlighted && highlighted.floor_id === p.floor.id;

  return (
    <svg
      viewBox={`${view.minX} ${view.minY} ${view.w} ${view.h}`}
      className={`block w-full rounded-xl bg-[#0D1730] ${p.className ?? ''}`}
      role="group"
      aria-label={`Map of ${p.floor.name}`}
      preserveAspectRatio="xMidYMid meet"
    >
      <desc>
        Floor plan in metres. North is up. Blocked corridors are drawn as red dashed lines with the word BLOCKED.
      </desc>

      {/* courtyard */}
      <rect x={4} y={sy(41)} width={22} height={37} rx={1.5} fill="#10223F" stroke="#1D3257" strokeWidth={0.2} strokeDasharray="1 1" />
      {!p.compact && (
        <text x={15} y={sy(22.5)} textAnchor="middle" fontSize={1.3} fill="#4B5F84">courtyard</text>
      )}

      {/* edges */}
      {floorEdges.map((e) => {
        const a = nodeById.get(e.from_node_id)!;
        const b = nodeById.get(e.to_node_id)!;
        const blocked = e.status === 'blocked';
        const onPath = p.pathEdgeIds?.has(e.id);
        const sel = p.selectedEdgeId === e.id || p.highlightEdgeId === e.id;
        const stroke = blocked ? C.blocked : e.kind === 'door' ? C.door : C.corridor;
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        return (
          <g key={e.id}>
            {sel && <line x1={a.x} y1={sy(a.y)} x2={b.x} y2={sy(b.y)} stroke={C.sel} strokeWidth={sw * 3.4} strokeLinecap="round" opacity={0.45} />}
            <line
              x1={a.x} y1={sy(a.y)} x2={b.x} y2={sy(b.y)}
              stroke={stroke}
              strokeWidth={e.kind === 'door' ? sw * 0.6 : sw}
              strokeLinecap="round"
              strokeDasharray={blocked ? '1 0.7' : e.kind === 'outdoor' ? '0.6 0.8' : undefined}
            />
            {onPath && (
              <line x1={a.x} y1={sy(a.y)} x2={b.x} y2={sy(b.y)} stroke={C.path} strokeWidth={sw * 2.6} strokeLinecap="round" opacity={0.9} />
            )}
            {blocked && !p.compact && (
              <text
                x={mx} y={sy(my) - 0.8} textAnchor="middle" fontSize={fs * 0.9} fontWeight={700} fill={C.blocked}
                stroke={C.halo} strokeWidth={0.35} paintOrder="stroke"
              >
                BLOCKED
              </text>
            )}
            {p.onEdgeClick && (
              <line
                x1={a.x} y1={sy(a.y)} x2={b.x} y2={sy(b.y)}
                stroke="transparent" strokeWidth={2} strokeLinecap="round"
                style={{ cursor: 'pointer' }}
                role="button" tabIndex={0}
                aria-label={`Corridor ${e.code}, ${e.status}`}
                onClick={() => p.onEdgeClick?.(e)}
                onKeyDown={(ev) => activate(ev, () => p.onEdgeClick?.(e))}
              />
            )}
          </g>
        );
      })}

      {/* nodes */}
      {floorNodes.map((n) => {
        const cx = n.x;
        const cy = sy(n.y);
        const sel = p.selectedNodeId === n.id;
        const onPath = p.pathNodeIds?.has(n.id);
        const isRoom = ROOM_KINDS.includes(n.kind);
        const showLabel = !p.compact && (isRoom || n.kind === 'entrance' || n.kind === 'emergency_point' || n.kind === 'stairs' || n.kind === 'lift');
        const west = n.x < 15;
        let shape: JSX.Element;
        if (n.kind === 'stairs') {
          shape = (
            <g>
              <rect x={cx - 1.1} y={cy - 1.1} width={2.2} height={2.2} fill="#3B2A6B" stroke="#C4B5FD" strokeWidth={0.2} />
              <path d={`M${cx - 0.8} ${cy + 0.7} h0.5 v-0.5 h0.5 v-0.5 h0.5 v-0.5 h0.5`} stroke="#C4B5FD" strokeWidth={0.18} fill="none" />
            </g>
          );
        } else if (n.kind === 'lift') {
          shape = (
            <g>
              <rect x={cx - 1.1} y={cy - 1.1} width={2.2} height={2.2} rx={0.5} fill="#0C3B52" stroke="#67E8F9" strokeWidth={0.2} />
              <path d={`M${cx} ${cy - 0.6} l0.5 0.6 h-1 z M${cx} ${cy + 0.6} l0.5 -0.6 h-1 z`} fill="#67E8F9" />
            </g>
          );
        } else if (n.kind === 'entrance') {
          shape = <polygon points={`${cx},${cy - 1.3} ${cx + 1.2},${cy + 0.9} ${cx - 1.2},${cy + 0.9}`} fill="#14532D" stroke="#86EFAC" strokeWidth={0.2} />;
        } else if (n.kind === 'emergency_point') {
          shape = (
            <g>
              <circle cx={cx} cy={cy} r={1.2} fill="#14532D" stroke="#86EFAC" strokeWidth={0.2} />
              <path d={`M${cx - 0.6} ${cy} h1.2 M${cx} ${cy - 0.6} v1.2`} stroke="#86EFAC" strokeWidth={0.22} />
            </g>
          );
        } else if (isRoom) {
          shape = <circle cx={cx} cy={cy} r={1.05} fill={C.room} stroke={C.roomStroke} strokeWidth={0.2} strokeDasharray={n.verified ? undefined : '0.5 0.35'} />;
        } else {
          shape = <circle cx={cx} cy={cy} r={0.5} fill={C.node} />;
        }
        return (
          <g key={n.id}>
            {onPath && <circle cx={cx} cy={cy} r={1.5} fill="none" stroke={C.path} strokeWidth={0.35} />}
            {n.qr_token && <circle cx={cx} cy={cy} r={1.75} fill="none" stroke={C.qr} strokeWidth={0.22} strokeDasharray="0.5 0.4" />}
            {sel && <circle cx={cx} cy={cy} r={2.3} fill="none" stroke={C.sel} strokeWidth={0.3} />}
            {shape}
            {showLabel && (
              <text
                x={west ? cx - 1.7 : cx + 1.7} y={cy + fs * 0.35}
                textAnchor={west ? 'end' : 'start'} fontSize={fs} fill={C.text}
                stroke={C.halo} strokeWidth={0.35} paintOrder="stroke"
              >
                {n.label}
              </text>
            )}
            {p.onNodeClick && (
              <circle
                cx={cx} cy={cy} r={1.6} fill="transparent" style={{ cursor: 'pointer' }}
                role="button" tabIndex={0} aria-label={`${n.label} (${n.kind})`}
                onClick={() => p.onNodeClick?.(n)}
                onKeyDown={(ev) => activate(ev, () => p.onNodeClick?.(n))}
              />
            )}
          </g>
        );
      })}

      {/* highlighted position (emergency / report) */}
      {onThisFloor && highlighted && (
        <g>
          <circle cx={highlighted.x} cy={sy(highlighted.y)} r={3.4} fill="#EF4444" opacity={0.22} />
          <circle cx={highlighted.x} cy={sy(highlighted.y)} r={1.7} fill="none" stroke="#F87171" strokeWidth={0.45} />
          <circle cx={highlighted.x} cy={sy(highlighted.y)} r={0.8} fill="#F87171" />
          <text
            x={highlighted.x < 15 ? highlighted.x - 2.8 : highlighted.x + 2.8}
            y={sy(highlighted.y) - 2.4}
            textAnchor={highlighted.x < 15 ? 'end' : 'start'}
            fontSize={p.compact ? 2 : 1.4} fontWeight={700} fill="#FECACA"
            stroke={C.halo} strokeWidth={0.4} paintOrder="stroke"
          >
            {p.highlightLabel ?? highlighted.label}
          </text>
        </g>
      )}

      {/* north marker */}
      <g aria-hidden="true">
        <text x={view.maxX - 2.2} y={view.minY + 3.6} textAnchor="middle" fontSize={2.2} fill="#A3B3CC" fontWeight={700}>N</text>
        <path d={`M${view.maxX - 2.2} ${view.minY + 4.4} v2.6 m0 -2.6 l-0.7 0.9 m0.7 -0.9 l0.7 0.9`} stroke="#A3B3CC" strokeWidth={0.25} fill="none" />
      </g>
      {!interactive && <title>{`Floor plan: ${p.floor.name}`}</title>}
    </svg>
  );
}

export function MapLegend() {
  const items: [string, string][] = [
    ['Corridor', 'bg-[#8FA3C4]'],
    ['Blocked (red dashed)', 'bg-[#F87171]'],
    ['Room / lab (dashed = unverified)', 'bg-[#1B3358] border border-[#7DD3FC]'],
    ['Stairs', 'bg-[#3B2A6B] border border-[#C4B5FD]'],
    ['Lift', 'bg-[#0C3B52] border border-[#67E8F9]'],
    ['QR checkpoint (amber ring)', 'bg-transparent border border-dashed border-[#FBBF24]'],
    ['Route preview', 'bg-[#38BDF8]'],
  ];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Map legend">
      {items.map(([t, c]) => (
        <li key={t} className="flex items-center gap-1.5">
          <span className={`inline-block h-3 w-3 rounded-sm ${c}`} aria-hidden="true" />
          {t}
        </li>
      ))}
    </ul>
  );
}
