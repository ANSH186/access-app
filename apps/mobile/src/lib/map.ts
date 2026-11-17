/**
 * Offline-safe campus map and deterministic route planner.
 *
 * The app ships a bundled copy of the Lab Block map and the NIE North Campus
 * schematic, so navigation keeps working when the API or the database is down.
 * When Supabase is reachable we refresh edge statuses from the live map.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import type { DestinationResult, RoutePlan, RouteStep } from './types';

type RawFloor = { id: string; code: string; level: number; name: string };
type RawNode = {
  id: string;
  code: string;
  floor_code: string;
  kind: string;
  label: string;
  aliases?: string[] | null;
  x: number;
  y: number;
  lat?: number | null;
  lng?: number | null;
  searchable?: boolean;
  qr_token?: string | null;
  verified?: boolean;
  notes?: string | null;
};
type RawEdge = {
  id: string;
  code?: string;
  from_code: string;
  to_code: string;
  kind: string;
  length_m: number;
  step_free: boolean;
  status?: string;
  blocked_reason?: string | null;
  verified?: boolean;
};
type RawMap = { floors: RawFloor[]; nodes: RawNode[]; edges: RawEdge[] };

export type MapNode = RawNode & {
  floor_level: number;
  floor_name: string;
  aliases: string[];
  searchable: boolean;
};
export type MapEdge = RawEdge & {
  from_id: string;
  to_id: string;
  status: 'open' | 'blocked';
};
export type CampusMap = {
  floors: Record<string, RawFloor>;
  nodes: Record<string, MapNode>;
  edges: Record<string, MapEdge>;
  source: 'live' | 'bundled';
};

import labBlockRaw from '../data/labBlock.json';
import campusRaw from '../data/nieNorthCampus.json';

const LAB_BLOCK = labBlockRaw as unknown as RawMap;
const CAMPUS = campusRaw as unknown as RawMap;
const CACHE_KEY = 'aa.mapCache.v2';
const LIVE_TTL_MS = 30_000;

type CacheShape = {
  at: number;
  floors: RawFloor[];
  nodes: RawNode[];
  edges: RawEdge[];
};

let liveCache: { at: number; map: CampusMap } | null = null;
let bundledCache: CampusMap | null = null;

function buildMap(floors: RawFloor[], nodes: RawNode[], edges: RawEdge[], source: 'live' | 'bundled'): CampusMap {
  const floorById: Record<string, RawFloor> = {};
  const floorByCode: Record<string, RawFloor> = {};
  for (const f of floors) {
    floorById[f.id] = f;
    floorByCode[f.code] = f;
  }
  const outNodes: Record<string, MapNode> = {};
  const idByCode: Record<string, string> = {};
  for (const n of nodes) {
    const f = floorByCode[n.floor_code] ?? floorById[(n as unknown as { floor_id?: string }).floor_id ?? ''];
    const floor = f ?? { id: 'unknown', code: n.floor_code, level: 0, name: '' };
    idByCode[n.code] = n.id;
    outNodes[n.id] = {
      ...n,
      aliases: (n.aliases ?? []).map((a) => a.toLowerCase()),
      searchable: !!n.searchable,
      floor_level: floor.level,
      floor_name: floor.name || n.floor_code,
    };
  }
  const outEdges: Record<string, MapEdge> = {};
  for (const e of edges) {
    const from = idByCode[e.from_code];
    const to = idByCode[e.to_code];
    if (!from || !to) continue;
    outEdges[e.id] = {
      ...e,
      from_id: from,
      to_id: to,
      status: e.status === 'blocked' ? 'blocked' : 'open',
    };
  }
  return { floors: floorByCode, nodes: outNodes, edges: outEdges, source };
}

function mergeRaw(parts: RawMap[]): RawMap {
  const floors: RawFloor[] = [];
  const nodes: RawNode[] = [];
  const edges: RawEdge[] = [];
  const floorSeen = new Set<string>();
  const nodeSeen = new Set<string>();
  const edgeSeen = new Set<string>();
  for (const p of parts) {
    for (const f of p.floors) {
      if (floorSeen.has(f.id)) continue;
      floorSeen.add(f.id);
      floors.push(f);
    }
    for (const n of p.nodes) {
      if (nodeSeen.has(n.id)) continue;
      nodeSeen.add(n.id);
      nodes.push(n);
    }
    for (const e of p.edges) {
      if (edgeSeen.has(e.id)) continue;
      edgeSeen.add(e.id);
      edges.push(e);
    }
  }
  return { floors, nodes, edges };
}

export function bundledMap(): CampusMap {
  if (!bundledCache) {
    const merged = mergeRaw([LAB_BLOCK, CAMPUS]);
    bundledCache = buildMap(merged.floors, merged.nodes, merged.edges, 'bundled');
  }
  return bundledCache;
}

/** Read the live map directly from Supabase. Cached for 30 seconds. */
export async function liveMap(force = false): Promise<CampusMap> {
  const now = Date.now();
  if (!force && liveCache && now - liveCache.at < LIVE_TTL_MS) return liveCache.map;
  const [floorsRes, nodesRes, edgesRes] = await Promise.all([
    supabase.from('floors').select('id,code,level,name'),
    supabase
      .from('route_nodes')
      .select('id,floor_id,code,kind,label,aliases,x,y,searchable,qr_token,verified,notes'),
    supabase
      .from('route_edges')
      .select('id,code,from_node_id,to_node_id,kind,length_m,step_free,status,blocked_reason,verified'),
  ]);
  if (floorsRes.error || nodesRes.error || edgesRes.error) {
    throw new Error(floorsRes.error?.message || nodesRes.error?.message || edgesRes.error?.message || 'map');
  }
  const floors = (floorsRes.data ?? []) as RawFloor[];
  const rawNodes = (nodesRes.data ?? []) as Array<Record<string, unknown>>;
  const idByCode: Record<string, string> = {};
  const codeById: Record<string, string> = {};
  const nodes: RawNode[] = rawNodes.map((n) => {
    const floor = floors.find((f) => f.id === n.floor_id);
    const node: RawNode = {
      id: String(n.id),
      code: String(n.code),
      floor_code: floor?.code ?? '',
      kind: String(n.kind),
      label: String(n.label),
      aliases: (n.aliases as string[]) ?? [],
      x: Number(n.x),
      y: Number(n.y),
      searchable: !!n.searchable,
      qr_token: (n.qr_token as string) ?? null,
      verified: !!n.verified,
      notes: (n.notes as string) ?? null,
    };
    idByCode[node.code] = node.id;
    codeById[node.id] = node.code;
    return node;
  });
  const edges: RawEdge[] = ((edgesRes.data ?? []) as Array<Record<string, unknown>>).map((e) => ({
    id: String(e.id),
    code: String(e.code ?? ''),
    from_code: codeById[String(e.from_node_id)] ?? '',
    to_code: codeById[String(e.to_node_id)] ?? '',
    kind: String(e.kind),
    length_m: Number(e.length_m),
    step_free: !!e.step_free,
    status: e.status === 'blocked' ? 'blocked' : 'open',
    blocked_reason: (e.blocked_reason as string) ?? null,
    verified: !!e.verified,
  }));
  const campusNodes = CAMPUS.nodes;
  const campusEdges = CAMPUS.edges;
  const merged = mergeRaw([
    { floors, nodes, edges },
    { floors: CAMPUS.floors, nodes: campusNodes, edges: campusEdges },
  ]);
  const map = buildMap(merged.floors, merged.nodes, merged.edges, 'live');
  liveCache = { at: now, map };
  AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ at: now, floors, nodes, edges })).catch(() => undefined);
  return map;
}

/** Best-effort local cache used when Supabase is unreachable. */
export async function cachedOrBundledMap(): Promise<CampusMap> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (raw) {
      const c = JSON.parse(raw) as CacheShape;
      if (c.nodes?.length) {
        const merged = mergeRaw([
          { floors: c.floors, nodes: c.nodes, edges: c.edges },
          { floors: CAMPUS.floors, nodes: CAMPUS.nodes, edges: CAMPUS.edges },
        ]);
        return buildMap(merged.floors, merged.nodes, merged.edges, 'bundled');
      }
    }
  } catch {
    /* ignore */
  }
  return bundledMap();
}

export async function loadMap(): Promise<CampusMap> {
  try {
    return await liveMap();
  } catch {
    return cachedOrBundledMap();
  }
}

// ---------------------------------------------------------------------------
// Distance and search
// ---------------------------------------------------------------------------
export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = 6_371_000;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function bearingText(fromLat: number, fromLng: number, toLat: number, toLng: number): string {
  const dLng = ((toLng - fromLng) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos((toLat * Math.PI) / 180);
  const x =
    Math.cos((fromLat * Math.PI) / 180) * Math.sin((toLat * Math.PI) / 180) -
    Math.sin((fromLat * Math.PI) / 180) * Math.cos((toLat * Math.PI) / 180) * Math.cos(dLng);
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  const dirs = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  return dirs[Math.floor(((deg + 360) % 360 + 22.5) / 45) % 8] ?? 'north';
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'to', 'take', 'me', 'go', 'find', 'where', 'is', 'are', 'i', 'want', 'need',
  'please', 'show', 'navigate', 'my', 'near', 'nearest', 'of', 'in', 'at', 'for', 'get', 'way',
]);

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim();
}
function tokens(s: string): string[] {
  return norm(s).split(/\s+/).filter(Boolean);
}
function ratio(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const m = a.length;
  const n = b.length;
  const dp = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j]!;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return 1 - dp[n]! / Math.max(m, n);
}
function tokenMatch(qt: string, ct: string): number {
  if (qt === ct) return 1;
  if (/[0-9]/.test(qt) || /[0-9]/.test(ct)) return 0;
  return ratio(qt, ct);
}
export function scoreText(query: string, candidate: string): number {
  const q = norm(query);
  const c = norm(candidate);
  if (!q || !c) return 0;
  if (q === c) return 1;
  const qtoks = tokens(q).filter((t) => !STOPWORDS.has(t));
  const ctoks = tokens(c);
  const qj = (qtoks.length ? qtoks : tokens(q)).join(' ');
  if (qj === c) return 1;
  let best = 0;
  if (qtoks.every((t) => ctoks.includes(t))) best = 0.9 + (0.1 * qj.length) / Math.max(c.length, 1);
  const per = (qtoks.length ? qtoks : tokens(q)).map((qt) => Math.max(...ctoks.map((ct) => tokenMatch(qt, ct))));
  best = Math.max(best, (per.reduce((a, b) => a + b, 0) / Math.max(per.length, 1)) * 0.97);
  best = Math.max(best, ratio(qj, c));
  return Math.min(best, 1);
}

export function searchDestinations(map: CampusMap, query: string, limit = 10): DestinationResult[] {
  const q = query.trim();
  if (!q) return [];
  const rows: DestinationResult[] = [];
  for (const n of Object.values(map.nodes)) {
    if (!n.searchable) continue;
    const score = Math.max(scoreText(q, n.label), ...n.aliases.map((a) => scoreText(q, a)));
    if (score < 0.6) continue;
    rows.push({
      node_id: n.id,
      code: n.code,
      label: n.label,
      kind: n.kind,
      floor_level: n.floor_level,
      floor_name: n.floor_name,
      score: Math.round(score * 1000) / 1000,
    });
  }
  rows.sort((a, b) => b.score - a.score || a.floor_level - b.floor_level || a.label.localeCompare(b.label));
  return rows.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------
const STAIR_FACTOR = 2;
const LIFT_PENALTY = 20;
const LIFT_TIE = 0.01;

function edgeWeight(e: MapEdge): number {
  if (e.kind === 'stairs') return e.length_m * STAIR_FACTOR;
  if (e.kind === 'lift') return e.length_m + LIFT_PENALTY + LIFT_TIE;
  return e.length_m;
}

type PathResult = { nodes: string[]; edges: string[] } | null;

function shortest(map: CampusMap, src: string, dst: string, avoidStairs: boolean, ignoreBlocks: boolean): PathResult {
  const adj = new Map<string, Array<{ to: string; edge: MapEdge }>>();
  for (const e of Object.values(map.edges)) {
    if (!ignoreBlocks && e.status === 'blocked') continue;
    if (avoidStairs && !e.step_free) continue;
    if (!adj.has(e.from_id)) adj.set(e.from_id, []);
    if (!adj.has(e.to_id)) adj.set(e.to_id, []);
    adj.get(e.from_id)!.push({ to: e.to_id, edge: e });
    adj.get(e.to_id)!.push({ to: e.from_id, edge: e });
  }
  if (!adj.has(src) || !adj.has(dst)) return null;
  const dist = new Map<string, number>();
  const prev = new Map<string, { node: string; edge: string }>();
  const visited = new Set<string>();
  dist.set(src, 0);
  while (visited.size < adj.size) {
    let u: string | null = null;
    let best = Infinity;
    for (const [k, v] of dist) {
      if (visited.has(k)) continue;
      if (v < best) {
        best = v;
        u = k;
      }
    }
    if (u === null) break;
    if (u === dst) break;
    visited.add(u);
    for (const { to, edge } of adj.get(u) ?? []) {
      if (visited.has(to)) continue;
      const nd = best + edgeWeight(edge);
      if (nd < (dist.get(to) ?? Infinity)) {
        dist.set(to, nd);
        prev.set(to, { node: u, edge: edge.id });
      }
    }
  }
  if (!dist.has(dst)) return null;
  const nodes: string[] = [];
  const edges: string[] = [];
  let cur = dst;
  while (cur !== src) {
    const p = prev.get(cur);
    if (!p) return null;
    nodes.unshift(cur);
    edges.unshift(p.edge);
    cur = p.node;
  }
  nodes.unshift(src);
  return { nodes, edges };
}

function np(label: string, capital = false): string {
  const clean = label.replace(/\s*\([^)]*\)/g, '').trim();
  if (/^(lab|room)\b/i.test(clean)) return clean;
  return (capital ? 'The ' : 'the ') + clean;
}
function metres(n: number): string {
  const r = Math.max(1, Math.round(n));
  return `about ${r} metre${r === 1 ? '' : 's'}`;
}
function unit(dx: number, dy: number): [number, number] {
  const n = Math.hypot(dx, dy);
  return n === 0 ? [0, 0] : [dx / n, dy / n];
}
function heading(a: MapNode, b: MapNode): [number, number] {
  return unit(b.x - a.x, b.y - a.y);
}
function turnOf(prev: [number, number], next: [number, number]): 'straight' | 'left' | 'right' | 'around' {
  const cross = prev[0] * next[1] - prev[1] * next[0];
  const dot = prev[0] * next[0] + prev[1] * next[1];
  const ang = (Math.atan2(cross, dot) * 180) / Math.PI;
  if (Math.abs(ang) < 25) return 'straight';
  if (Math.abs(ang) > 155) return 'around';
  return ang > 0 ? 'left' : 'right';
}
function isRoom(kind: string): boolean {
  return ['room', 'lab', 'office', 'library', 'washroom', 'help_desk'].includes(kind);
}
function mergeable(a: MapNode, b: MapNode): boolean {
  return a.floor_level === b.floor_level && a.kind === 'corridor' && b.kind === 'corridor';
}

function buildSteps(map: CampusMap, nodeIds: string[], edgeIds: string[]): [RouteStep[], string | null] {
  const nodes = nodeIds.map((id) => map.nodes[id]).filter(Boolean) as MapNode[];
  const edges = edgeIds.map((id) => map.edges[id]).filter(Boolean) as MapEdge[];
  if (!nodes.length) return [[], null];
  const dest = nodes[nodes.length - 1]!;
  if (!edges.length) return [[], `You are already at ${np(dest.label)}.`];
  const start = nodes[0]!;
  const onCampus = start.floor_name.toLowerCase().includes('campus');
  let headingVec: [number, number] | null = onCampus ? null : start.kind === 'entrance' ? [0, 1] : null;
  let orient = onCampus
    ? `You are at ${np(start.label)}. `
    : start.kind === 'entrance'
      ? `You are at the ${start.label.toLowerCase()}, facing into the building. `
      : '';
  const steps: RouteStep[] = [];
  let arrivalSide: 'left' | 'right' | 'straight' | null = null;
  let doorFinal = false;
  let prevVertical = false;

  const add = (fromIdx: number, toIdx: number, text: string, length: number, kind: string) => {
    const toNode = nodes[toIdx]!;
    let t = text;
    if (toNode.qr_token) t += ' There is a checkpoint here. Scan it to confirm where you are.';
    steps.push({
      index: steps.length,
      instruction: (orient + t).trim(),
      from_node_id: nodes[fromIdx]!.id,
      to_node_id: toNode.id,
      floor_level: nodes[fromIdx]!.floor_level,
      length_m: Math.round(length * 10) / 10,
      kind,
      checkpoint_qr: toNode.qr_token ?? null,
      to_label: toNode.label,
      to_lat: toNode.lat ?? undefined,
      to_lng: toNode.lng ?? undefined,
    });
    orient = '';
  };

  let i = 0;
  while (i < edges.length) {
    const e = edges[i]!;
    const a = nodes[i]!;
    const b = nodes[i + 1]!;
    let text = '';

    if (a.floor_level !== b.floor_level) {
      let j = i;
      const sign = b.floor_level > a.floor_level ? 1 : -1;
      while (
        j + 1 < edges.length &&
        edges[j + 1]!.kind === e.kind &&
        nodes[j + 1]!.floor_level !== nodes[j + 2]!.floor_level &&
        (nodes[j + 2]!.floor_level > nodes[j + 1]!.floor_level ? 1 : -1) === sign &&
        !nodes[j + 1]!.qr_token
      ) {
        j++;
      }
      const end = nodes[j + 1]!;
      const levels = Math.abs(end.floor_level - a.floor_level);
      const dir = sign > 0 ? 'up' : 'down';
      const what = e.kind === 'lift' ? 'the lift' : 'the staircase';
      const count = levels === 1 ? '' : `${levels} floors `;
      let text = `Take ${what} ${dir} ${count}to ${/ground/i.test(end.floor_name) ? 'the ground floor' : end.floor_name}.`;
      if (e.kind !== 'lift') text += ' Hold the handrail.';
      add(i, j + 1, text, edges.slice(i, j + 1).reduce((s, x) => s + x.length_m, 0), e.kind);
      headingVec = null;
      prevVertical = true;
      i = j + 1;
      continue;
    }

    if (e.kind === 'corridor' && mergeable(a, b)) {
      const h0 = heading(a, b);
      let j = i;
      while (
        j + 1 < edges.length &&
        edges[j + 1]!.kind === 'corridor' &&
        mergeable(nodes[j + 1]!, nodes[j + 2]!) &&
        !nodes[j + 1]!.qr_token &&
        h0[0] * heading(nodes[j + 1]!, nodes[j + 2]!)[0] + h0[1] * heading(nodes[j + 1]!, nodes[j + 2]!)[1] > 0 &&
        Math.abs(h0[0] * heading(nodes[j + 1]!, nodes[j + 2]!)[1] - h0[1] * heading(nodes[j + 1]!, nodes[j + 2]!)[0]) < 0.1
      ) {
        j++;
      }
      const end = nodes[j + 1]!;
      const length = edges.slice(i, j + 1).reduce((s, x) => s + x.length_m, 0);
      const t = headingVec ? turnOf(headingVec, h0) : 'straight';
      let text: string;
      if (!headingVec) text = `Walk ${metres(length)} along the corridor.`;
      else if (t === 'straight') text = `Continue straight for ${metres(length)}.`;
      else if (t === 'around') text = `Turn around and walk ${metres(length)} along the corridor.`;
      else text = `Turn ${t} and walk ${metres(length)} along the corridor.`;
      add(i, j + 1, text, length, 'corridor');
      headingVec = h0;
      prevVertical = false;
      i = j + 1;
      continue;
    }

    if (e.kind === 'outdoor' && a.kind === 'corridor' && b.kind === 'corridor') {
      const h0 = heading(a, b);
      let j = i;
      while (
        j + 1 < edges.length &&
        edges[j + 1]!.kind === 'outdoor' &&
        nodes[j + 1]!.kind === 'corridor' &&
        nodes[j + 2]!.kind === 'corridor' &&
        nodes[j + 1]!.floor_level === a.floor_level &&
        !nodes[j + 1]!.qr_token &&
        h0[0] * heading(nodes[j + 1]!, nodes[j + 2]!)[0] + h0[1] * heading(nodes[j + 1]!, nodes[j + 2]!)[1] > 0 &&
        Math.abs(h0[0] * heading(nodes[j + 1]!, nodes[j + 2]!)[1] - h0[1] * heading(nodes[j + 1]!, nodes[j + 2]!)[0]) < 0.1
      ) {
        j++;
      }
      const length = edges.slice(i, j + 1).reduce((s, x) => s + x.length_m, 0);
      const t = headingVec ? turnOf(headingVec, h0) : 'straight';
      let text: string;
      if (!headingVec) text = `Walk ${metres(length)} along the path.`;
      else if (t === 'straight') text = `Continue straight for ${metres(length)}.`;
      else if (t === 'around') text = `Turn around and walk ${metres(length)} along the path.`;
      else text = `Turn ${t} and walk ${metres(length)} along the path.`;
      add(i, j + 1, text, length, 'outdoor');
      headingVec = h0;
      prevVertical = false;
      i = j + 1;
      continue;
    }

    const h = heading(a, b);
    const n = metres(e.length_m);
    const last = i === edges.length - 1;
    const turn = headingVec ? turnOf(headingVec, h) : null;
    if (last && isRoom(b.kind) && (e.kind === 'door' || e.kind === 'outdoor')) {
      const target = np(b.label, true);
      if (turn === 'left' || turn === 'right') {
        text = `${target} is on your ${turn}. Turn ${turn} and walk ${n} to the entrance.`;
        arrivalSide = turn;
      } else if (turn === 'straight') {
        text = `${target} is straight ahead. Walk ${n} to the entrance.`;
        arrivalSide = 'straight';
      } else {
        text = `Walk ${n} to ${np(b.label)}.`;
      }
      doorFinal = true;
    } else if (e.kind === 'outdoor' && isRoom(a.kind)) {
      text = `Leave ${np(a.label)} and walk ${n} along the path.`;
    } else if (e.kind === 'outdoor' && b.kind === 'corridor') {
      const target = 'the next path junction';
      if (turn === 'left' || turn === 'right') text = `Turn ${turn} and walk ${n} to ${target}.`;
      else if (turn === 'around') text = `Turn around and walk ${n} to ${target}.`;
      else text = `Walk ${n} to ${target}.`;
    } else if (prevVertical) {
      const what = a.kind === 'lift' ? 'lift' : 'staircase';
      text = `Leave the ${what} and walk ${n} to the corridor.`;
    } else if (!headingVec && isRoom(a.kind)) {
      text = `Leave ${np(a.label)} through its door and walk ${n} to the corridor.`;
    } else {
      const target =
        b.kind === 'stairs' || b.kind === 'lift'
          ? b.kind === 'lift'
            ? 'the lift'
            : 'the staircase'
          : b.kind === 'corridor'
            ? 'the corridor'
            : np(b.label);
      if (turn === 'left' || turn === 'right') text = `Turn ${turn} and walk ${n} to ${target}.`;
      else if (turn === 'around') text = `Turn around and walk ${n} to ${target}.`;
      else text = `Walk ${n} to ${target}.`;
    }
    add(i, i + 1, text, e.length_m, e.kind);
    if (h[0] !== 0 || h[1] !== 0) headingVec = h;
    prevVertical = false;
    i++;
  }

  let arrival: string;
  if (doorFinal && (arrivalSide === 'left' || arrivalSide === 'right')) {
    arrival = `${np(dest.label, true)} should be on your ${arrivalSide}. Use Read sign or a checkpoint to confirm.`;
  } else if (doorFinal) {
    arrival = `You should now be at ${np(dest.label)}. Use Read sign or a checkpoint to confirm.`;
  } else if (dest.floor_name.toLowerCase().includes('campus')) {
    arrival = `You should now be near ${np(dest.label)}. Check the building name or ask someone if you are unsure.`;
  } else {
    arrival = `You have arrived at ${np(dest.label)}.`;
  }
  return [steps, arrival];
}

export function planRoute(
  map: CampusMap,
  fromId: string,
  toId: string,
  avoidStairs = false,
): RoutePlan {
  const from = map.nodes[fromId];
  const to = map.nodes[toId];
  if (!from || !to) {
    return { found: false, explanation: 'That place is not on the current map.', steps: [] };
  }
  if (fromId === toId) {
    return {
      found: true,
      total_length_m: 0,
      node_ids: [fromId],
      edge_ids: [],
      steps: [],
      arrival_message: `You are already at ${np(to.label)}.`,
    };
  }
  const actual = shortest(map, fromId, toId, avoidStairs, false);
  if (!actual) {
    return {
      found: false,
      explanation: avoidStairs
        ? `There is no step-free path to ${np(to.label)} right now. Ask someone nearby for help, or turn off avoid stairs.`
        : `I could not find a path to ${np(to.label)} right now. Ask someone nearby for help.`,
      steps: [],
      warnings: [],
    };
  }
  const [steps, arrival] = buildSteps(map, actual.nodes, actual.edges);
  const total = actual.edges.reduce((s, id) => s + (map.edges[id]?.length_m ?? 0), 0);
  const warnings: string[] = [];
  for (const id of actual.nodes) {
    const n = map.nodes[id]!;
    if (n.verified) continue;
    if (n.floor_name.toLowerCase().includes('campus')) {
      warnings.push('This campus route is a schematic from satellite imagery and has not been verified on site.');
      break;
    }
    if (n.kind === 'lift') warnings.push('This route uses the lift. Its position has not been verified yet.');
    else if (n.kind === 'stairs') warnings.push('This route uses a staircase. Its position has not been verified yet.');
    else if (n.kind === 'entrance') warnings.push('The entrance position has not been verified yet, so the first steps are an estimate.');
  }
  return {
    found: true,
    total_length_m: Math.round(total * 10) / 10,
    node_ids: actual.nodes,
    edge_ids: actual.edges,
    steps,
    explanation: null,
    blocked_edges_avoided: [],
    warnings: [...new Set(warnings)],
    arrival_message: arrival,
  };
}

export function nearestNode(
  map: CampusMap,
  lat: number,
  lng: number,
  opts: { searchableOnly?: boolean; maxDistanceM?: number } = {},
): { node: MapNode; distance: number } | null {
  let best: { node: MapNode; distance: number } | null = null;
  for (const n of Object.values(map.nodes)) {
    if (n.lat == null || n.lng == null) continue;
    if (opts.searchableOnly && !n.searchable) continue;
    const d = haversineM(lat, lng, n.lat, n.lng);
    if (!best || d < best.distance) best = { node: n, distance: d };
  }
  if (best && opts.maxDistanceM != null && best.distance > opts.maxDistanceM) return null;
  return best;
}

export function nearbyLandmarks(
  map: CampusMap,
  lat: number,
  lng: number,
  limit = 4,
): Array<{ node: MapNode; distance: number; bearing: string }> {
  const rows: Array<{ node: MapNode; distance: number; bearing: string }> = [];
  for (const n of Object.values(map.nodes)) {
    if (!n.searchable || n.lat == null || n.lng == null) continue;
    rows.push({ node: n, distance: haversineM(lat, lng, n.lat, n.lng), bearing: bearingText(lat, lng, n.lat, n.lng) });
  }
  rows.sort((a, b) => a.distance - b.distance);
  return rows.slice(0, limit);
}

export function nodeByCode(map: CampusMap, code: string): MapNode | null {
  return Object.values(map.nodes).find((n) => n.code === code) ?? null;
}

export function campusDisclaimer(): string {
  return 'The NIE North Campus map is a schematic traced from satellite imagery and has not been verified on site. Ask campus staff if a building is unclear.';
}
