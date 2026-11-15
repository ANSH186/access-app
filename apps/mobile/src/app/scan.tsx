import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { BigButton, Body, Heading, LiveText, Screen } from '../components/ui';
import { locationText } from '../lib/format';
import { haptic } from '../lib/haptics';
import { speak } from '../lib/speech';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';
import type { ConfirmedLocation } from '../lib/types';
import { useApp } from '../state/app';
import { useNav } from '../state/nav';

type CheckpointRow = { id: string; label: string; floor_level: number; floor_name: string };

export default function ScanScreen() {
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const focused = useIsFocused();
  const { setLocation } = useApp();
  const nav = useNav();
  const [perm, requestPerm] = useCameraPermissions();
  const [listMode, setListMode] = useState(mode === 'list');
  const [status, setStatus] = useState('');
  const [confirmed, setConfirmed] = useState<ConfirmedLocation | null>(null);
  const [rows, setRows] = useState<CheckpointRow[] | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const busy = useRef(false);
  const lastIgnored = useRef<{ token: string; at: number } | null>(null);
  const sawCode = useRef(false);

  const say = useCallback((t: string) => {
    setStatus(t);
    speak(t);
  }, []);

  useEffect(() => {
    if (confirmed) return;
    if (listMode) say('Choose where you are from the list.');
    else if (perm?.granted)
      say('Hold the phone up and move it slowly. You will feel a vibration when a code is in view.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perm?.granted, listMode]);

  async function finish(loc: ConfirmedLocation, lead: string) {
    setLocation(loc);
    setConfirmed(loc);
    let extra: string | null = null;
    try {
      extra = await nav.onCheckpoint(loc);
    } catch {
      extra = null;
    }
    const text = [lead, extra].filter(Boolean).join(' ');
    setStatus(text);
    speak(text, { instruction: !!extra });
  }

  async function onScanned(token: string) {
    if (busy.current || confirmed) return;
    const ign = lastIgnored.current;
    if (ign && ign.token === token && Date.now() - ign.at < 5000) return;
    busy.current = true;
    if (!sawCode.current) {
      sawCode.current = true;
      haptic.strong();
      speak('Code found.');
    }
    try {
      const { data, error } = await supabase.rpc('resolve_checkpoint', { p_qr_token: token });
      if (error) {
        lastIgnored.current = { token, at: Date.now() };
        say('I could not check that code. Check your connection, or choose your location from the list.');
        haptic.error();
        return;
      }
      const row = (Array.isArray(data) ? data[0] : data) as
        | { node_id: string; label: string; floor_level: number; floor_name: string }
        | undefined;
      if (!row) {
        lastIgnored.current = { token, at: Date.now() };
        say('That code is not an AccessAble checkpoint. Keep scanning.');
        haptic.warning();
        return;
      }
      const loc: ConfirmedLocation = {
        node_id: row.node_id,
        label: token === 'AA-CP-G-LIFT' ? 'near the lift' : row.label,
        floor_level: row.floor_level,
        floor_name: row.floor_name,
        source: 'qr_checkpoint',
        observed_at: new Date().toISOString(),
      };
      haptic.strong();
      setTimeout(haptic.success, 200);
      await finish(loc, `Checkpoint confirmed: ${locationText(loc)}.`);
    } finally {
      sawCode.current = false;
      busy.current = false;
    }
  }

  async function openList() {
    setListMode(true);
    if (rows) return;
    setLoadingList(true);
    const { data, error } = await supabase
      .from('route_nodes')
      .select('id,label,floors(level,name)')
      .not('qr_token', 'is', null);
    setLoadingList(false);
    if (error || !data) {
      say('I could not load the checkpoint list. Check your connection and try again.');
      return;
    }
    const list: CheckpointRow[] = data.map((d) => {
      const f = Array.isArray(d.floors) ? d.floors[0] : d.floors;
      return {
        id: d.id as string,
        label: d.label as string,
        floor_level: (f?.level as number) ?? 0,
        floor_name: (f?.name as string) ?? '',
      };
    });
    list.sort((a, b) => a.floor_level - b.floor_level || a.label.localeCompare(b.label));
    setRows(list);
    say(`${list.length} places to choose from. Swipe to browse.`);
  }

  useEffect(() => {
    if (mode === 'list') openList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pick(r: CheckpointRow) {
    const loc: ConfirmedLocation = {
      node_id: r.id,
      label: r.label,
      floor_level: r.floor_level,
      floor_name: r.floor_name,
      source: 'staff_confirmed',
      observed_at: new Date().toISOString(),
    };
    haptic.success();
    await finish(
      loc,
      `Location set to ${locationText(loc)}. This is less certain than scanning a checkpoint, because it depends on what you chose.`,
    );
  }

  // ---- render ---------------------------------------------------------------
  if (confirmed) {
    return (
      <Screen>
        <Heading>{confirmed.source === 'qr_checkpoint' ? 'Checkpoint confirmed' : 'Location set by hand'}</Heading>
        <Body style={{ fontSize: 30, lineHeight: 40, fontWeight: '800' }}>{locationText(confirmed)}</Body>
        <LiveText>{status}</LiveText>
        <BigButton label="Done" variant="primary" onPress={() => router.back()} />
      </Screen>
    );
  }

  if (listMode) {
    return (
      <Screen>
        <Heading>Choose my location</Heading>
        <Body muted>This is less certain than scanning a checkpoint.</Body>
        <LiveText>{status}</LiveText>
        {loadingList && <Body>Loading…</Body>}
        {rows?.map((r) => (
          <BigButton
            key={r.id}
            label={`${r.floor_name}: ${r.label}`}
            hint="Double tap to set this as your location"
            minHeight={80}
            onPress={() => pick(r)}
          />
        ))}
        <BigButton label="Back to scanning" variant="ghost" onPress={() => setListMode(false)} />
      </Screen>
    );
  }

  if (!perm) return <Screen><Body>Checking camera permission…</Body></Screen>;
  if (!perm.granted) {
    return (
      <Screen>
        <Heading>Camera permission needed</Heading>
        <Body>AccessAble needs the camera to scan checkpoint codes.</Body>
        <BigButton label="Allow camera" variant="primary" onPress={requestPerm} />
        <BigButton label="I can't scan — choose my location" onPress={openList} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Heading>Scan a checkpoint</Heading>
      {focused && (
        <View style={{ height: 340, borderRadius: 16, overflow: 'hidden', borderWidth: 2, borderColor: colors.border }}>
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            accessibilityLabel="Camera preview for scanning checkpoint codes"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={(e) => onScanned(e.data)}
          />
        </View>
      )}
      <LiveText>{status}</LiveText>
      <BigButton
        label="I can't scan — choose my location"
        hint="Pick your location from a list of checkpoints. Less certain than scanning."
        variant="primary"
        onPress={openList}
      />
    </Screen>
  );
}
