import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { apiConfigured, checkHealth, type HealthResult } from '../lib/api';

export type ApiStatus = 'unconfigured' | 'checking' | 'ok' | 'waking' | 'down';

interface Ctx {
  status: ApiStatus;
  latencyMs: number | null;
  lastError: string | null;
  check: () => Promise<HealthResult>;
}
const C = createContext<Ctx | null>(null);

const KEEP_ALIVE_MS = 10 * 60 * 1000;
const SLOW_MS = 3000;

/** Pings GET /health every 10 minutes while the dashboard is open (Render free tier sleeps after 15). */
export function ApiHealthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ApiStatus>(apiConfigured ? 'checking' : 'unconfigured');
  const [latencyMs, setLatency] = useState<number | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const inflight = useRef(false);

  const check = useCallback(async (): Promise<HealthResult> => {
    if (!apiConfigured) return { ok: false, latencyMs: 0, error: 'VITE_API_URL is not set.' };
    inflight.current = true;
    const slow = window.setTimeout(() => {
      if (inflight.current) setStatus('waking');
    }, SLOW_MS);
    const res = await checkHealth();
    window.clearTimeout(slow);
    inflight.current = false;
    setLatency(res.latencyMs);
    setLastError(res.ok ? null : res.error ?? 'Unknown error');
    setStatus(res.ok ? 'ok' : 'down');
    return res;
  }, []);

  useEffect(() => {
    if (!apiConfigured) return;
    void check();
    const id = window.setInterval(() => void check(), KEEP_ALIVE_MS);
    return () => window.clearInterval(id);
  }, [check]);

  return <C.Provider value={{ status, latencyMs, lastError, check }}>{children}</C.Provider>;
}

export function useApiHealth(): Ctx {
  const v = useContext(C);
  if (!v) throw new Error('useApiHealth outside provider');
  return v;
}
