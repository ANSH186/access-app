import { supabase } from './supabase';
import type { RoutePlanRequest, RoutePlanResponse } from '../types';

export const API_URL: string = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');
export const apiConfigured = API_URL.length > 0;

export interface HealthResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

/** GET /health - no auth, no database. Used as keep-alive and for the Settings check. */
export async function checkHealth(timeoutMs = 70_000): Promise<HealthResult> {
  if (!apiConfigured) return { ok: false, latencyMs: 0, error: 'VITE_API_URL is not set.' };
  const started = performance.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_URL}/health`, { signal: ctrl.signal, cache: 'no-store' });
    const latencyMs = Math.round(performance.now() - started);
    if (!res.ok) return { ok: false, latencyMs, error: `The API answered with status ${res.status}.` };
    return { ok: true, latencyMs };
  } catch (e) {
    const latencyMs = Math.round(performance.now() - started);
    const aborted = e instanceof DOMException && e.name === 'AbortError';
    return {
      ok: false,
      latencyMs,
      error: aborted ? 'The API did not answer in time.' : 'The API could not be reached (network or CORS error).',
    };
  } finally {
    clearTimeout(t);
  }
}

/** POST /v1/routes/plan with the Supabase access token as Bearer. */
export async function planRoute(req: RoutePlanRequest): Promise<RoutePlanResponse> {
  if (!apiConfigured) throw new Error('VITE_API_URL is not set, so route preview is unavailable.');
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('You are signed out. Please sign in again.');
  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1/routes/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(req),
    });
  } catch {
    throw new Error('The route service could not be reached. It may be waking up; try again in a minute.');
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (body as { error?: { message?: string } } | null)?.error?.message;
    throw new Error(msg ?? `The route service answered with status ${res.status}.`);
  }
  return body as RoutePlanResponse;
}
