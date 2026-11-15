import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { CallButtons } from '../components/CallButtons';
import { BigButton, Body, Heading, LiveText, Screen, styles as ui } from '../components/ui';
import { haptic } from '../lib/haptics';
import { speak } from '../lib/speech';
import { loadLastAlertId, saveLastAlertId } from '../lib/storage';
import { STATUS_SPEECH, STATUS_TITLE, cancelSos } from '../lib/sos';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';
import {
  ACTIVE_ALERT_STATUSES,
  type EmergencyAlert,
  type EmergencyEvent,
} from '../lib/types';
import { useApp } from '../state/app';

export default function SosStatus() {
  const { id: idParam } = useLocalSearchParams<{ id?: string }>();
  const { session, refreshActiveAlert } = useApp();
  const [alertId, setAlertId] = useState<string | null>(idParam ?? null);
  const [alert, setAlert] = useState<EmergencyAlert | null>(null);
  const [events, setEvents] = useState<EmergencyEvent[]>([]);
  const [stale, setStale] = useState(false);
  const [lastOk, setLastOk] = useState<Date | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [msg, setMsg] = useState('');
  const lastStatus = useRef<string | null>(null);
  const spokenNotes = useRef<Set<number>>(new Set());
  const firstLoad = useRef(true);
  const notesPrimed = useRef(false);

  // Find the alert: param, else stored id, else the user's active alert.
  useEffect(() => {
    if (alertId || !session) return;
    (async () => {
      const stored = await loadLastAlertId();
      if (stored) return setAlertId(stored);
      const a = await refreshActiveAlert();
      if (a) setAlertId(a.id);
      else setMsg('You have no SOS alert.');
    })();
  }, [alertId, session, refreshActiveAlert]);

  const apply = useCallback(
    (a: EmergencyAlert) => {
      setAlert(a);
      if (lastStatus.current !== a.status) {
        lastStatus.current = a.status;
        const t = STATUS_SPEECH[a.status] ?? `Status: ${a.status}`;
        setMsg(t);
        speak(t);
        if (!firstLoad.current) haptic.warning();
        if (!ACTIVE_ALERT_STATUSES.includes(a.status)) {
          saveLastAlertId(null);
          refreshActiveAlert();
        }
      }
      firstLoad.current = false;
    },
    [refreshActiveAlert],
  );

  const pull = useCallback(async () => {
    if (!alertId) return;
    const [a, ev] = await Promise.all([
      supabase.from('emergency_alerts').select('*').eq('id', alertId).maybeSingle(),
      supabase
        .from('emergency_events')
        .select('*')
        .eq('alert_id', alertId)
        .eq('visible_to_user', true)
        .order('created_at', { ascending: true }),
    ]);
    if (a.error || ev.error) {
      setStale(true);
      return;
    }
    setStale(false);
    setLastOk(new Date());
    if (a.data) apply(a.data as EmergencyAlert);
    const list = (ev.data ?? []) as EmergencyEvent[];
    setEvents(list);
    for (const e of list) {
      if (e.note && !spokenNotes.current.has(e.id)) {
        spokenNotes.current.add(e.id);
        if (notesPrimed.current && e.event_type === 'note') {
          speak(`Message from campus staff: ${e.note}`);
          haptic.warning();
        }
      }
    }
    notesPrimed.current = true;
  }, [alertId, apply]);

  useEffect(() => {
    if (!alertId) return;
    pull();
    const poll = setInterval(pull, 10_000); // safety net if Realtime drops
    const ch = supabase
      .channel(`sos-${alertId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'emergency_alerts', filter: `id=eq.${alertId}` },
        (p) => {
          if (p.new && 'status' in p.new) apply(p.new as EmergencyAlert);
          pull();
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'emergency_events', filter: `alert_id=eq.${alertId}` },
        () => {
          pull();
        },
      )
      .subscribe();
    return () => {
      clearInterval(poll);
      supabase.removeChannel(ch);
    };
  }, [alertId, pull, apply]);

  async function doCancel() {
    if (!alert) return;
    try {
      const a = await cancelSos(alert.id, 'Cancelled by user in the app');
      setConfirmCancel(false);
      apply(a);
    } catch (e) {
      const t = `Could not cancel the alert. ${e instanceof Error ? e.message : ''}`;
      setMsg(t);
      speak(t);
    }
  }

  const active = alert ? ACTIVE_ALERT_STATUSES.includes(alert.status) : false;
  const notes = events.filter((e) => e.note && e.visible_to_user && e.event_type !== 'triggered');

  return (
    <Screen>
      <Heading>{alert ? STATUS_TITLE[alert.status] ?? alert.status : 'SOS status'}</Heading>
      <Text
        accessibilityLiveRegion="assertive"
        style={{ color: colors.text, fontSize: 30, fontWeight: '800', lineHeight: 40 }}
      >
        {alert ? STATUS_SPEECH[alert.status] ?? alert.status : msg || 'Loading…'}
      </Text>
      {alert?.is_test && <Body muted>Test alert. No real emergency service was contacted.</Body>}
      {alert?.location_label && (
        <Body muted>Location sent: {alert.location_label}</Body>
      )}
      {stale && (
        <LiveText style={{ color: colors.accent }}>
          Could not refresh the status. What you see may be out of date
          {lastOk ? ` (last updated ${lastOk.toLocaleTimeString()})` : ''}.
        </LiveText>
      )}

      {notes.length > 0 && (
        <View style={ui.card}>
          <Text style={{ color: colors.text, fontSize: 22, fontWeight: '800' }}>Messages from staff</Text>
          {notes.map((e) => (
            <Body key={e.id}>
              {new Date(e.created_at).toLocaleTimeString()}: {e.note}
            </Body>
          ))}
        </View>
      )}

      <CallButtons />

      {active && !confirmCancel && (
        <BigButton
          label="Cancel alert"
          hint="Asks you to confirm before cancelling"
          onPress={() => {
            setConfirmCancel(true);
            speak('Cancel your alert? Staff will be told you no longer need help. Choose Yes cancel alert, or Keep my alert.');
          }}
        />
      )}
      {active && confirmCancel && (
        <View style={ui.card}>
          <Body>Cancel your alert? Staff will be told you no longer need help.</Body>
          <BigButton label="Yes, cancel alert" variant="danger" onPress={doCancel} />
          <BigButton label="Keep my alert" variant="primary" onPress={() => setConfirmCancel(false)} />
        </View>
      )}
      {!active && <BigButton label="Back to home" variant="primary" onPress={() => router.replace('/')} />}
      {active && <BigButton label="Back to home" variant="ghost" onPress={() => router.replace('/')} />}
      <Body muted>AccessAble is not an emergency service.</Body>
    </Screen>
  );
}
