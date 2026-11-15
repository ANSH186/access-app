import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react';
import { supabase, errMsg } from '../lib/supabase';
import { loadProfiles, nameOf } from '../lib/profiles';
import { summariseLocation } from '../lib/location';
import { audioIsRunning, playAlertOnce, startAlarm, stopAlarm, unlockAudio } from '../lib/sound';
import { useAuth } from './useAuth';
import type { AlertStatus, EmergencyAlert, Profile } from '../types';

export const ACTIVE_STATUSES: AlertStatus[] = ['triggered', 'acknowledged', 'responding', 'unable_to_contact'];
export const ESCALATION_MS = 2 * 60 * 1000;
export type Connection = 'live' | 'reconnecting' | 'off';

interface Ctx {
  enabled: boolean;
  alerts: EmergencyAlert[];
  unacknowledged: EmergencyAlert[];
  /** unacknowledged for more than ESCALATION_MS */
  escalated: EmergencyAlert[];
  profiles: Record<string, Profile>;
  loading: boolean;
  error: string | null;
  connection: Connection;
  /** increments whenever alerts/events change; panels use it to refetch their timelines */
  tick: number;
  refresh: () => Promise<void>;
  muted: boolean;
  setMuted: (m: boolean) => void;
  audioReady: boolean;
  enableSound: () => Promise<void>;
  testSound: () => Promise<void>;
  notifPermission: NotificationPermission | 'unsupported';
  requestNotifications: () => Promise<void>;
  announcement: string;
}
const C = createContext<Ctx | null>(null);

const POLL_MS = 15_000;
const BASE_TITLE = 'AccessAble Admin';
const ageText = (iso: string) => {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  return s < 60 ? `${s} seconds ago` : `${Math.floor(s / 60)} minutes ago`;
};

export function sortAlerts(list: EmergencyAlert[]): EmergencyAlert[] {
  return [...list].sort((a, b) => {
    const ua = a.status === 'triggered' ? 0 : 1;
    const ub = b.status === 'triggered' ? 0 : 1;
    if (ua !== ub) return ua - ub;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });
}

export function EmergencyProvider({ children }: { children: ReactNode }) {
  const { institutionId, hasRole } = useAuth();
  const enabled = Boolean(institutionId) && hasRole('admin', 'responder');

  const [alerts, setAlerts] = useState<EmergencyAlert[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rtOk, setRtOk] = useState(false);
  const [pollOk, setPollOk] = useState(true);
  const [tick, setTick] = useState(0);
  const [muted, setMutedState] = useState(() => localStorage.getItem('aa.muted') === '1');
  const [audioReady, setAudioReady] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [clock, setClock] = useState(() => Date.now());
  const [notifPermission, setNotif] = useState<NotificationPermission | 'unsupported'>(
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  );

  const known = useRef(new Set<string>());
  const initialised = useRef(false);
  const inflight = useRef(false);
  const pending = useRef(false);

  const refresh = useCallback(async () => {
    if (!enabled || !institutionId) return;
    if (inflight.current) {
      pending.current = true;
      return;
    }
    inflight.current = true;
    try {
      const { data, error: err } = await supabase
        .from('emergency_alerts')
        .select('*')
        .eq('institution_id', institutionId)
        .in('status', ACTIVE_STATUSES);
      if (err) throw err;
      const list = sortAlerts((data ?? []) as EmergencyAlert[]);
      const profs = await loadProfiles(list.map((a) => a.user_id));
      setProfiles((p) => ({ ...p, ...profs }));

      const fresh = list.filter((a) => a.status === 'triggered' && !known.current.has(a.id));
      if (initialised.current && fresh.length > 0) {
        for (const a of fresh) {
          const loc = summariseLocation(a);
          const who = nameOf(profs, a.user_id, 'a user');
          setAnnouncement(`New SOS from ${who}. ${loc.headline}. ${ageText(a.created_at)}.`);
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            try {
              new Notification(`${a.is_test ? 'TEST ' : ''}SOS from ${who}`, {
                body: `${loc.headline} - ${loc.provenance}`,
                tag: a.id,
                requireInteraction: true,
              });
            } catch {
              /* some browsers refuse constructors; the in-app banner still shows */
            }
          }
        }
      }
      list.forEach((a) => known.current.add(a.id));
      initialised.current = true;
      setAlerts(list);
      setError(null);
      setPollOk(true);
      setTick((t) => t + 1);
    } catch (e) {
      setError(errMsg(e));
      setPollOk(false);
    } finally {
      inflight.current = false;
      setLoading(false);
      if (pending.current) {
        pending.current = false;
        void refresh();
      }
    }
  }, [enabled, institutionId]);

  // Realtime subscription + 15 s polling fallback.
  useEffect(() => {
    if (!enabled || !institutionId) {
      setLoading(false);
      return;
    }
    void refresh();
    const ch = supabase
      .channel(`emergency-${institutionId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'emergency_alerts', filter: `institution_id=eq.${institutionId}` },
        () => void refresh(),
      )
      // emergency_events has no institution_id column, so it cannot be filtered server-side; RLS still limits rows.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'emergency_events' }, () => void refresh())
      .subscribe((status) => setRtOk(status === 'SUBSCRIBED'));
    const poll = window.setInterval(() => void refresh(), POLL_MS);
    return () => {
      window.clearInterval(poll);
      void supabase.removeChannel(ch);
      setRtOk(false);
    };
  }, [enabled, institutionId, refresh]);

  const unacknowledged = useMemo(() => alerts.filter((a) => a.status === 'triggered'), [alerts]);

  useEffect(() => {
    const id = window.setInterval(() => setClock(Date.now()), 5000);
    return () => window.clearInterval(id);
  }, []);
  const escalated = useMemo(
    () => unacknowledged.filter((a) => clock - new Date(a.created_at).getTime() > ESCALATION_MS),
    [unacknowledged, clock],
  );
  const hasEscalated = escalated.length > 0;
  const prevEsc = useRef(0);
  useEffect(() => {
    if (escalated.length > prevEsc.current) setAnnouncement(`Escalation: ${escalated.length} SOS alert${escalated.length > 1 ? 's' : ''} unacknowledged for more than 2 minutes.`);
    prevEsc.current = escalated.length;
  }, [escalated.length]);

  // Repeating tone until acknowledged or muted.
  useEffect(() => {
    if (enabled && unacknowledged.length > 0 && !muted && audioReady) startAlarm(hasEscalated);
    else stopAlarm();
    return stopAlarm;
  }, [enabled, unacknowledged.length, muted, audioReady, hasEscalated]);

  // Flash the document title while an SOS is unacknowledged.
  useEffect(() => {
    if (!enabled || unacknowledged.length === 0) {
      document.title = BASE_TITLE;
      return;
    }
    let on = false;
    const id = window.setInterval(() => {
      on = !on;
      document.title = on ? `(!) ${unacknowledged.length} ${hasEscalated ? 'UNACKNOWLEDGED 2+ MIN' : 'NEW SOS'}` : BASE_TITLE;
    }, 900);
    return () => {
      window.clearInterval(id);
      document.title = BASE_TITLE;
    };
  }, [enabled, unacknowledged.length, hasEscalated]);

  const setMuted = useCallback((m: boolean) => {
    setMutedState(m);
    localStorage.setItem('aa.muted', m ? '1' : '0');
  }, []);

  const enableSound = useCallback(async () => {
    setAudioReady(await unlockAudio());
  }, []);

  const testSound = useCallback(async () => {
    const ok = audioIsRunning() || (await unlockAudio());
    setAudioReady(ok);
    if (ok) playAlertOnce();
  }, []);

  const requestNotifications = useCallback(async () => {
    if (typeof Notification === 'undefined') return;
    setNotif(await Notification.requestPermission());
  }, []);

  const connection: Connection = !enabled ? 'off' : rtOk && pollOk ? 'live' : 'reconnecting';

  const value: Ctx = {
    enabled, alerts, unacknowledged, escalated, profiles, loading, error, connection, tick, refresh,
    muted, setMuted, audioReady, enableSound, testSound, notifPermission, requestNotifications, announcement,
  };
  return <C.Provider value={value}>{children}</C.Provider>;
}

export function useEmergency(): Ctx {
  const v = useContext(C);
  if (!v) throw new Error('useEmergency outside provider');
  return v;
}
