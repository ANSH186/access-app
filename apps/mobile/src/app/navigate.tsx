import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { BigButton, Body, Field, Heading, LiveText, Screen, styles as ui } from '../components/ui';
import { useVoiceCapture } from '../hooks/useVoiceCapture';
import { api, errorToSpeech } from '../lib/api';
import { isStale, locationText } from '../lib/format';
import { speak } from '../lib/speech';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';
import type { ConfirmedLocation, DestinationResult } from '../lib/types';
import { useApp } from '../state/app';
import { useNav } from '../state/nav';

export default function NavigateScreen() {
  const params = useLocalSearchParams<{ destId?: string; destLabel?: string; q?: string; intro?: string }>();
  const { location, setLocation } = useApp();
  const nav = useNav();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DestinationResult[] | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const handled = useRef<string>('');

  const say = useCallback((t: string) => {
    setMsg(t);
    speak(t);
  }, []);

  const fresh = location && !isStale(location) ? location : null;

  const search = useCallback(
    async (q: string) => {
      const term = q.trim();
      if (!term) return say('Type or say where you want to go.');
      setBusy(true);
      setMsg('Searching…');
      try {
        const { results: r } = await api.searchDestinations(term);
        setResults(r);
        if (r.length === 0) say(`I found nothing for ${term}. Try another name, like library, lab, or washroom.`);
        else say(`I found ${r.length} ${r.length === 1 ? 'place' : 'places'}. The first is ${r[0].label}, ${r[0].floor_name}.`);
      } catch (e) {
        say(errorToSpeech(e));
      } finally {
        setBusy(false);
      }
    },
    [say],
  );

  const choose = useCallback(
    async (d: { node_id: string; label: string }, intro?: string) => {
      setResults(null);
      if (fresh) {
        await nav.selectDestination({ node_id: d.node_id, label: d.label }, fresh.node_id);
      } else {
        await nav.selectDestination({ node_id: d.node_id, label: d.label });
        speak(
          `${intro ? intro + ' ' : ''}To start, I need to know where you are. Scan a checkpoint, or choose the demo ground floor lift checkpoint.`,
        );
      }
    },
    [fresh, nav],
  );

  // Handle destination handed over by the voice command.
  useEffect(() => {
    const key = `${params.destId ?? ''}|${params.q ?? ''}`;
    if (key === '|' || handled.current === key) return;
    handled.current = key;
    if (params.destId && params.destLabel) {
      choose({ node_id: params.destId, label: params.destLabel }, params.intro);
    } else if (params.q) {
      setQuery(params.q);
      search(params.q);
    }
  }, [params.destId, params.destLabel, params.q, params.intro, choose, search]);

  // Once a start point appears (scan / manual choice) and we are waiting for one, plan.
  useEffect(() => {
    if (nav.dest && nav.status === 'idle' && fresh) {
      nav.planFromLocation(fresh);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav.dest?.node_id, nav.status, fresh?.observed_at]);

  const voice = useVoiceCapture(async (uri) => {
    setBusy(true);
    setMsg('Listening to what you said…');
    try {
      const res = await api.commandAudio(uri);
      if (res.destination) {
        await choose({ node_id: res.destination.node_id, label: res.destination.label }, res.reply);
      } else {
        const q = res.destination_query || res.transcript;
        setQuery(q);
        await search(q);
      }
    } catch (e) {
      say(errorToSpeech(e));
    } finally {
      setBusy(false);
    }
  });

  async function useDemoLiftCheckpoint() {
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc('resolve_checkpoint', { p_qr_token: 'AA-CP-G-LIFT' });
      const row = (Array.isArray(data) ? data[0] : data) as
        | { node_id: string; label: string; floor_level: number; floor_name: string }
        | undefined;
      if (error || !row) {
        say('I could not find the ground floor lift checkpoint on the map. Try scanning a checkpoint instead.');
        return;
      }
      const loc: ConfirmedLocation = {
        node_id: row.node_id,
        label: 'near the lift',
        floor_level: row.floor_level,
        floor_name: row.floor_name || 'Ground floor',
        source: 'staff_confirmed',
        observed_at: new Date().toISOString(),
      };
      setLocation(loc);
      speak('Starting from the ground floor lift checkpoint. This was chosen by hand, so it is less certain than scanning.');
    } catch (e) {
      say(errorToSpeech(e));
    } finally {
      setBusy(false);
    }
  }

  // ---- render ---------------------------------------------------------------
  if (nav.dest && nav.status === 'arrived') {
    return (
      <Screen>
        <Heading>You should be arriving</Heading>
        <Text style={{ color: colors.text, fontSize: 32, fontWeight: '800', lineHeight: 42 }} accessibilityLiveRegion="polite">
          {nav.plan?.arrival_message || `You should be near ${nav.dest.label}. Check the sign to be sure.`}
        </Text>
        <Body muted>AccessAble cannot be certain you have arrived. Use Read sign or scan a checkpoint to confirm.</Body>
        <BigButton label="Read the sign" variant="primary" onPress={() => router.push({ pathname: '/camera', params: { mode: 'sign' } })} />
        <BigButton label="Repeat" onPress={nav.repeat} />
        <BigButton
          label="Done"
          onPress={() => {
            nav.stop(true);
            router.replace('/');
          }}
        />
      </Screen>
    );
  }

  if (nav.dest && nav.status === 'active' && nav.plan) {
    const steps = nav.plan.steps ?? [];
    const step = nav.currentStep;
    return (
      <Screen>
        <Body muted>
          To {nav.dest.label}
        </Body>
        {nav.notice && (
          <View style={ui.card} accessible>
            <Body>{nav.notice}</Body>
          </View>
        )}
        <Heading>
          Step {nav.stepIndex + 1} of {steps.length}
        </Heading>
        <Text style={{ color: colors.text, fontSize: 34, fontWeight: '800', lineHeight: 44 }} accessibilityLiveRegion="polite">
          {step?.instruction}
        </Text>
        {step?.checkpoint_qr && (
          <BigButton
            label="Scan checkpoint"
            hint="Scan the QR checkpoint at the end of this step to confirm where you are"
            variant="primary"
            onPress={() => router.push('/scan')}
          />
        )}
        <BigButton
          label="Next"
          hint={nav.stepIndex === steps.length - 1 ? 'Hears the arrival message' : 'Goes to the next instruction'}
          variant={step?.checkpoint_qr ? 'secondary' : 'primary'}
          onPress={nav.next}
        />
        <BigButton label="Repeat" hint="Says this instruction again" onPress={nav.repeat} />
        <BigButton label="Previous" disabled={nav.stepIndex === 0} onPress={nav.prev} />
        <BigButton label="Stop navigation" variant="ghost" onPress={() => nav.stop()} />
      </Screen>
    );
  }

  if (nav.dest && nav.status === 'planning') {
    return (
      <Screen>
        <Heading>Planning your route to {nav.dest.label}</Heading>
        <LiveText>Planning your route…</LiveText>
      </Screen>
    );
  }

  if (nav.dest && (nav.status === 'noroute' || nav.status === 'error')) {
    return (
      <Screen>
        <Heading>{nav.status === 'noroute' ? 'No route found' : 'Could not plan the route'}</Heading>
        <LiveText style={{ fontSize: 26, lineHeight: 36 }}>{nav.message}</LiveText>
        {nav.status === 'error' && fresh && (
          <BigButton label="Try again" variant="primary" onPress={() => nav.planFromLocation(fresh)} />
        )}
        <BigButton
          label="Choose another destination"
          onPress={() => {
            nav.stop(true);
            setResults(null);
          }}
        />
      </Screen>
    );
  }

  if (nav.dest) {
    // Destination chosen but no usable start point yet.
    return (
      <Screen>
        <Heading>Going to {nav.dest.label}</Heading>
        <LiveText style={{ fontSize: 24, lineHeight: 34 }}>
          {location
            ? `Your last confirmed location, ${locationText(location)}, is more than 15 minutes old. Scan a checkpoint to update it.`
            : 'To start, I need to know where you are. Scan a checkpoint, or choose the demo ground floor lift checkpoint.'}
        </LiveText>
        <BigButton label="Scan a checkpoint" variant="primary" onPress={() => router.push('/scan')} />
        <BigButton
          label="Demo: I'm at the ground-floor lift checkpoint"
          hint="Use this if you cannot scan. It is an assumed position."
          disabled={busy}
          onPress={useDemoLiftCheckpoint}
        />
        <BigButton
          label="Choose my location from a list"
          onPress={() => router.push({ pathname: '/scan', params: { mode: 'list' } })}
        />
        <BigButton label="Choose another destination" variant="ghost" onPress={() => nav.stop(true)} />
        <LiveText>{msg}</LiveText>
      </Screen>
    );
  }

  return (
    <Screen>
      <Heading>Where do you want to go?</Heading>
      <Field
        label="Destination"
        hint="For example library, lab 201, or washroom"
        value={query}
        onChangeText={setQuery}
        onSubmitEditing={() => search(query)}
        returnKeyType="search"
        autoCapitalize="none"
      />
      <BigButton label="Search" variant="primary" disabled={busy} onPress={() => search(query)} />
      <BigButton
        label={voice.state === 'recording' ? 'Tap to stop and search' : 'Say a destination'}
        hint="Tap, say the place, then tap again"
        disabled={busy || voice.state === 'processing'}
        onPress={() => voice.toggle()}
      />
      <LiveText>{msg}</LiveText>
      {results?.map((r) => (
        <BigButton
          key={r.node_id}
          label={`${r.label} — ${r.floor_name}`}
          hint="Double tap to start navigation to this place"
          minHeight={80}
          onPress={() => choose({ node_id: r.node_id, label: r.label })}
        />
      ))}
    </Screen>
  );
}
