import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { errMsg, supabase } from '../lib/supabase';
import type { Building, Floor, RouteEdge, RouteNode } from '../types';

interface MapCtx {
  buildings: Building[];
  floors: Floor[];
  nodes: RouteNode[];
  edges: RouteEdge[];
  nodeById: Map<string, RouteNode>;
  edgeById: Map<string, RouteEdge>;
  floorById: Map<string, Floor>;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  reloadEdges: () => Promise<void>;
}
const C = createContext<MapCtx | null>(null);

export function MapDataProvider({ children }: { children: ReactNode }) {
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [floors, setFloors] = useState<Floor[]>([]);
  const [nodes, setNodes] = useState<RouteNode[]>([]);
  const [edges, setEdges] = useState<RouteEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [b, f, n, e] = await Promise.all([
      supabase.from('buildings').select('*'),
      supabase.from('floors').select('*').order('level'),
      supabase.from('route_nodes').select('*').limit(5000),
      supabase.from('route_edges').select('*').limit(10000),
    ]);
    const firstErr = b.error ?? f.error ?? n.error ?? e.error;
    if (firstErr) setError(errMsg(firstErr));
    else setError(null);
    setBuildings((b.data ?? []) as Building[]);
    setFloors((f.data ?? []) as Floor[]);
    setNodes((n.data ?? []) as RouteNode[]);
    setEdges((e.data ?? []) as RouteEdge[]);
    setLoading(false);
  }, []);

  const reloadEdges = useCallback(async () => {
    const { data, error: err } = await supabase.from('route_edges').select('*').limit(10000);
    if (!err) setEdges((data ?? []) as RouteEdge[]);
  }, []);

  useEffect(() => {
    void reload();
    // Realtime: blocked corridors appear live.
    const ch = supabase
      .channel('map-route-edges')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'route_edges' }, () => void reloadEdges())
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [reload, reloadEdges]);

  const value = useMemo<MapCtx>(
    () => ({
      buildings, floors, nodes, edges,
      nodeById: new Map(nodes.map((n) => [n.id, n])),
      edgeById: new Map(edges.map((e) => [e.id, e])),
      floorById: new Map(floors.map((f) => [f.id, f])),
      loading, error, reload, reloadEdges,
    }),
    [buildings, floors, nodes, edges, loading, error, reload, reloadEdges],
  );
  return <C.Provider value={value}>{children}</C.Provider>;
}

export function useMapData(): MapCtx {
  const v = useContext(C);
  if (!v) throw new Error('useMapData outside provider');
  return v;
}
