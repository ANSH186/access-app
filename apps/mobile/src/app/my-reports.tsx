import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Body, Heading, LiveText, Screen, styles as ui } from '../components/ui';
import { speak } from '../lib/speech';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';
import { REPORT_CATEGORIES, type ObstacleReport } from '../lib/types';
import { useApp } from '../state/app';

const STATUS_LABEL: Record<string, string> = {
  submitted: 'Submitted — waiting for review',
  under_review: 'Under review',
  verified: 'Verified by staff',
  assigned: 'Assigned for fixing',
  resolved: 'Resolved',
  closed: 'Closed',
  rejected: 'Not accepted',
  reopened: 'Reopened',
};
const catLabel = (v: string) => REPORT_CATEGORIES.find((c) => c.value === v)?.label ?? v;

export default function MyReports() {
  const { session } = useApp();
  const [reports, setReports] = useState<ObstacleReport[] | null>(null);
  const [msg, setMsg] = useState('');
  const known = useRef<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!session) return;
    const { data, error } = await supabase
      .from('obstacle_reports')
      .select('id,category,description,status,created_at,updated_at')
      .eq('reporter_id', session.user.id)
      .order('created_at', { ascending: false });
    if (error) {
      setMsg('Could not load your reports. Check your connection.');
      return;
    }
    const list = (data ?? []) as ObstacleReport[];
    for (const r of list) {
      const before = known.current[r.id];
      if (before && before !== r.status) {
        const t = `Report update: ${catLabel(r.category)} is now ${STATUS_LABEL[r.status] ?? r.status}.`;
        setMsg(t);
        speak(t);
      }
      known.current[r.id] = r.status;
    }
    setReports(list);
  }, [session]);

  useEffect(() => {
    load();
    if (!session) return;
    const ch = supabase
      .channel(`my-reports-${session.user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'obstacle_reports', filter: `reporter_id=eq.${session.user.id}` },
        () => {
          load();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [load, session]);

  useEffect(() => {
    if (reports) speak(reports.length === 0 ? 'You have no reports yet.' : `You have ${reports.length} reports.`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reports === null]);

  return (
    <Screen>
      <Heading>My reports</Heading>
      <LiveText>{msg}</LiveText>
      {reports === null && <Body>Loading…</Body>}
      {reports?.length === 0 && <Body>You have not reported anything yet.</Body>}
      {reports?.map((r) => (
        <View
          key={r.id}
          style={ui.card}
          accessible
          accessibilityLabel={`${catLabel(r.category)}. Status: ${STATUS_LABEL[r.status] ?? r.status}. ${r.description ?? ''}`}
        >
          <Text style={{ color: colors.text, fontSize: 24, fontWeight: '800' }}>{catLabel(r.category)}</Text>
          <Text style={{ color: colors.accent, fontSize: 20, fontWeight: '700' }}>
            Status: {STATUS_LABEL[r.status] ?? r.status}
          </Text>
          {r.description ? <Body>{r.description}</Body> : null}
          <Body muted>Sent {new Date(r.created_at).toLocaleString()}</Body>
        </View>
      ))}
    </Screen>
  );
}
