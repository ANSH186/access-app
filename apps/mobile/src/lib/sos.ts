import { supabase } from './supabase';
import type { ConfirmedLocation, EmergencyAlert, Profile } from './types';
import { locationText } from './format';
import { randomUUID } from './uuid';

// One client_request_id per SOS attempt (the flow started by pressing "Send SOS").
// "Try again" after a failure reuses it: create_emergency is idempotent on
// (user, client_request_id), so a lost response can never create a duplicate.
let currentRequestId: string | null = null;
export function startSosAttempt() {
  currentRequestId = randomUUID();
  return currentRequestId;
}
export function currentSosRequestId() {
  if (!currentRequestId) currentRequestId = randomUUID();
  return currentRequestId;
}
export function endSosAttempt() {
  currentRequestId = null;
}

const RETRIES = 3;
const BACKOFF_MS = [1000, 2000, 4000];
const ATTEMPT_TIMEOUT_MS = 15_000;

type RpcErr = { message?: string; code?: string; details?: string; status?: number } | null;

function isNetworkError(e: RpcErr, aborted: boolean): boolean {
  if (aborted) return true;
  if (!e) return false;
  if (e.status === 0) return true;
  if (typeof e.status === 'number' && e.status >= 500) return true;
  const m = (e.message ?? '').toLowerCase();
  if (/network|fetch|timeout|timed out|failed to|connection|aborted/.test(m) && !e.code) return true;
  return false;
}
function isAuthError(e: RpcErr) {
  return !!e && (e.code === 'PGRST301' || /jwt|expired/i.test(e.message ?? ''));
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type SosArgs = {
  emergencyType: string; // 'unspecified' | 'medical' | ...
  profile: Profile | null;
  location: ConfirmedLocation | null;
};

export type SosResult = { ok: true; alert: EmergencyAlert } | { ok: false; error: string };

export async function sendSos({ emergencyType, profile, location }: SosArgs): Promise<SosResult> {
  const share = profile?.share_location_in_sos !== false;
  // Argument names match CONTRACT §2 create_emergency exactly.
  const args: Record<string, unknown> = {
    p_client_request_id: currentSosRequestId(),
    p_emergency_type: emergencyType || 'unspecified',
    p_is_test: true,
  };
  if (share && location) {
    const campus = location.floor_name.toLowerCase().includes('campus') || location.source === 'gps';
    if (!campus) args.p_node_id = location.node_id;
    args.p_location_source = location.source;
    const suffix =
      location.source === 'qr_checkpoint' ? ' (QR)' : location.source === 'gps' ? ' (GPS)' : ' (chosen by hand)';
    args.p_location_label = `${locationText(location)}${suffix}`;
    args.p_location_observed_at = location.observed_at; // when confirmed, NOT now
    if (location.lat != null) args.p_lat = location.lat;
    if (location.lng != null) args.p_lng = location.lng;
    if (location.accuracy_m != null) args.p_accuracy_m = location.accuracy_m;
  }

  let lastError = 'Could not reach the server.';
  let refreshed = false;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ATTEMPT_TIMEOUT_MS);
    try {
      const { data, error } = await supabase.rpc('create_emergency', args).abortSignal(ctrl.signal);
      clearTimeout(timer);
      if (!error && data) {
        const row = (Array.isArray(data) ? data[0] : data) as EmergencyAlert;
        return { ok: true, alert: row };
      }
      lastError = error?.message ?? 'No response.';
      if (error && isAuthError(error) && !refreshed) {
        refreshed = true;
        await supabase.auth.refreshSession();
        attempt--; // does not consume a retry
        continue;
      }
      if (!isNetworkError(error as RpcErr, false)) return { ok: false, error: lastError };
    } catch (e) {
      clearTimeout(timer);
      lastError = e instanceof Error ? e.message : 'Network error.';
    }
    if (attempt < RETRIES) await sleep(BACKOFF_MS[attempt] ?? 4000);
  }
  return { ok: false, error: lastError };
}

export async function cancelSos(alertId: string, reason: string) {
  // Argument names match CONTRACT §2 cancel_emergency.
  const { data, error } = await supabase.rpc('cancel_emergency', {
    p_alert_id: alertId,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
  return (Array.isArray(data) ? data[0] : data) as EmergencyAlert;
}

export const STATUS_SPEECH: Record<string, string> = {
  triggered: 'Alert sent. Waiting for campus staff to respond. Help is not confirmed yet.',
  acknowledged: 'Campus staff have seen your alert.',
  responding: 'A responder is on the way.',
  unable_to_contact: 'Staff could not reach you. Call the emergency number if you can.',
  resolved: 'Campus staff marked this alert as resolved.',
  cancelled: 'This alert was cancelled.',
};

export const STATUS_TITLE: Record<string, string> = {
  triggered: 'Alert sent — not yet seen',
  acknowledged: 'Staff have seen your alert',
  responding: 'Responder on the way',
  unable_to_contact: 'Staff could not reach you',
  resolved: 'Resolved',
  cancelled: 'Cancelled',
};
