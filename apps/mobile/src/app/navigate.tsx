import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { BigButton, Body, Field, Heading, LiveText, Screen, styles as ui } from '../components/ui';
import { useVoiceCapture } from '../hooks/useVoiceCapture';
import { api, errorToSpeech } from '../lib/api';
import { isStale, locationText } from '../lib/format';
import { haversineM, loadMap, nearestNode, searchDestinations, type CampusMap } from '../lib/map';
import { accuracyText, ensureLocationPermission, getMyLocation, reverseGeocode, watchMyLocation } from '../lib/location';
import { speak } from '../lib/speech';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';
import type { ConfirmedLocation, DestinationResult } from '../lib/types';
import { useApp } from '../state/app';
import { useNav } from '../state/nav';

const CAMPUS_QUICK: Array<{ label: string; q: string }> = [
  { label: 'Central Library', q: 'library' },
  { label: 'A Block, CSE', q: 'A block cse' },
  { label: 'Canteen and Mess', q: 'canteen' },
  { label: 'Sports Ground', q: 'sports ground' },
  { label: 'Main Gate', q: 'main gate' },
  { label: 'Boys Hostel', q: 'boys hostel' },
];

export default function NavigateScreen() {
  const params = useLocalSearchParams<{ destId?: string; destLabel?: string; q?: string; intro?: string }>();
  const { location, setLocation } = useApp();
  const nav = useNav();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DestinationResult[] | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [map, setMap] = useState<CampusMap | null>(null);
  const handled = useRef<string>('');
  const autoGpsTried = useRef(false);
  const advancedForStep = useRef<string>('');

  const say = useCallback((t: string) => {
    setMsg(t);
    speak(t);
  }, []);

  const fresh = location && !isStale(location) && !!location.node_id ? location : null;

  useEffect(() => {
    loadMap().then(setMap).catch(() => undefined);
  }, []);

  const choose = useCallback(
    async (d: { node_id: string; label: string }, intro?: string) => {
      setResults(null);
      if (fresh) {
        await nav.selectDestination({ node_id: d.node_id, label: d.label }, fresh.node_id);
      } else {
        await nav.selectDestination({ node_id: d.node_id, label: d.label });
        speak(
          `${intro ? intro + ' ' : ''}To start, I need to know where you are. I am checking your GPS now. You can also scan a checkpoint or choose a location from the list.`,
        );
      }
    },
    [fresh, nav],
  );

  const search = useCallback(
    async (q: string, autoChoose = false) => {
      const term = q.trim();
      if (!term) return say('Type or say where you want to go.');
      setBusy(true);
      setMsg('Searching…');
      let r: DestinationResult[] = [];
      try {
        r = searchDestinations(map ?? (await loadMap()), term);
      } catch {
        r = [];
      }
      if (!r.length) {
        try {
          r = (await api.searchDestinations(term)).results;
        } catch {
          r = [];
        }
      }
      setResults(r);
      if (r.length === 0) {
        say(`I found nothing for ${term}. Try another name, like library, canteen, hostel, or main gate.`);
      } else {
        const top = r[0]!;
        say(`I found ${r.length} ${r.length === 1 ? 'place' : 'places'}. The first is ${top.label}, ${top.floor_name}.`);
        if (autoChoose) {
          setResults(null);
          await choose({ node_id: top.node_id, label: top.label });
        }
      }
      setBusy(false);
    },
    [choose, map, say],
  );

  const startGps = useCallback(
    async (auto = false) => {
      if (locating) return;
      setLocating(true);
      say('Checking your location. Allow location access if your phone asks.');
      try {
        const perm = await ensureLocationPermission();
        if (!perm.granted) {
          say(
            perm.canAskAgain
              ? 'Location permission was not granted. You can allow it in phone settings, scan a checkpoint, or choose your location from the list.'
              : 'Location permission is blocked. Open phone settings to allow location, or scan a checkpoint.',
          );
          return;
        }
        const coords = await getMyLocation();
        if (!coords) {
          say('I could not get a location fix. Move near a window or outdoors, then try again. You can also scan a checkpoint.');
          return;
        }
        const m = map ?? (await loadMap());
        setMap(m);
        const hit = nearestNode(m, coords.latitude, coords.longitude, { searchableOnly: true, maxDistanceM: 700 });
        let addr = await reverseGeocode(coords);
        if (!addr) {
          try {
            const r = await api.reverse(coords);
            if (r.short && r.short !== 'an unknown place') {
              addr = {
                short: r.short,
                street: r.road,
                district: r.suburb,
                city: r.city,
                state: r.state,
                country: null,
                formatted: r.display_name,
              };
            }
          } catch {
            /* ignore */
          }
        }
        if (!hit) {
          const place = addr?.short ? ` You appear to be near ${addr.short}.` : '';
          say(
            `I could not match you to the mapped campus.${place} You are ${accuracyText(coords.accuracy)}. ` +
              'Scan a checkpoint or choose your location from the list.',
          );
          return;
        }
        const node = hit.node;
        const loc: ConfirmedLocation = {
          node_id: node.id,
          label: `near ${node.label}`,
          floor_level: node.floor_level,
          floor_name: node.floor_name || 'NIE North Campus',
          source: 'gps',
          observed_at: new Date().toISOString(),
          lat: coords.latitude,
          lng: coords.longitude,
          accuracy_m: coords.accuracy,
        };
        setLocation(loc);
        const metres = Math.max(1, Math.round(hit.distance));
        say(
          `You are on ${node.floor_name || 'NIE North Campus'}, about ${metres} metres from ${node.label}. ` +
            `GPS is ${accuracyText(coords.accuracy)}. Using this as your starting point.`,
        );
      } catch (e) {
        say(`I could not check your location. ${errorToSpeech(e)}`);
      } finally {
        setLocating(false);
        if (auto) autoGpsTried.current = true;
      }
    },
    [locating, map, say, setLocation],
  );

  // Handle a destination handed over by the voice command.
  useEffect(() => {
    const key = `${params.destId ?? ''}|${params.q ?? ''}`;
    if (key === '|' || handled.current === key) return;
    handled.current = key;
    if (params.destId && params.destLabel) {
      choose({ node_id: params.destId, label: params.destLabel }, params.intro);
    } else if (params.q) {
      setQuery(params.q);
      search(params.q, true);
    }
  }, [params.destId, params.destLabel, params.q, params.intro, choose, search]);

  // Once a start point appears (scan / GPS / manual choice) and we are waiting for one, plan.
  useEffect(() => {
    if (nav.dest && nav.status === 'idle' && fresh) {
      nav.planFromLocation(fresh);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav.dest?.node_id, nav.status, fresh?.observed_at]);

  // If a destination is waiting and the user has no fresh position, try GPS once.
  useEffect(() => {
    if (nav.dest && !fresh && nav.status === 'idle' && !autoGpsTried.current) {
      autoGpsTried.current = true;
      void startGps(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav.dest?.node_id, nav.status, fresh?.observed_at]);

  // Outdoor auto-advance: use GPS to move to the next step when close enough.
  const stepRef = useRef(nav.currentStep);
  stepRef.current = nav.currentStep;
  useEffect(() => {
    if (nav.status !== 'active') return;
    const step = nav.currentStep;
    if (!step || step.to_lat == null || step.to_lng == null) return;
    const stepKey = `${nav.stepIndex}:${step.to_node_id}`;
    let stopped = false;
    const sub = watchMyLocation((coords) => {
      if (stopped) return;
      const cur = stepRef.current;
      if (!cur || cur.to_lat == null || cur.to_lng == null) return;
      const key = `${nav.stepIndex}:${cur.to_node_id}`;
      if (advancedForStep.current === key) return;
      const d = haversineM(coords.latitude, coords.longitude, cur.to_lat, cur.to_lng);
      if (d <= 14 && (coords.accuracy == null || coords.accuracy <= 35)) {
        advancedForStep.current = key;
        speak('You have reached the next point.');
        nav.next();
      }
    });
    return () => {
      stopped = true;
      sub?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav.status, nav.stepIndex, nav.currentStep?.to_node_id]);

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
        await search(q, true);
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
        <Body muted>AccessAble cannot be certain you have arrived. Use Read sign, Describe this place, or scan a checkpoint to confirm.</Body>
        <BigButton label="Read the sign" variant="primary" onPress={() => router.push({ pathname: '/camera', params: { mode: 'sign' } })} />
        <BigButton
          label="Describe this place"
          onPress={() => router.push({ pathname: '/camera', params: { mode: 'scene' } })}
        />
        <BigButton label="Where am I" onPress={() => router.push('/where-am-i')} />
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
        <Body muted>To {nav.dest.label}</Body>
        {nav.savedMap && (
          <View style={ui.card} accessible>
            <Body>Working from a saved map. Live obstacle updates may be missing.</Body>
          </View>
        )}
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
        {step?.to_lat != null && (
          <Body muted>Automatic GPS progress is on while you are outdoors. It is approximate.</Body>
        )}
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
        <BigButton label="I have arrived" onPress={nav.finish} />
        <BigButton label="Where am I" onPress={() => router.push('/where-am-i')} />
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
        {fresh && (
          <BigButton label="Try again" variant="primary" onPress={() => nav.planFromLocation(fresh)} />
        )}
        <BigButton label="Use my GPS location" disabled={locating} onPress={() => startGps()} />
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
            ? `Your last confirmed location, ${locationText(location)}, is more than 15 minutes old. Let me check your GPS, or scan a checkpoint to update it.`
            : 'To start, I need to know where you are. I am checking your GPS. You can also scan a checkpoint or choose from a list.'}
        </LiveText>
        <BigButton label="Use my GPS location" variant="primary" disabled={locating} onPress={() => startGps()} />
        <BigButton label="Scan a checkpoint" onPress={() => router.push('/scan')} />
        <BigButton
          label="Choose my location from a list"
          onPress={() => router.push({ pathname: '/scan', params: { mode: 'list' } })}
        />
        <BigButton
          label="Demo: I'm at the ground-floor lift checkpoint"
          hint="Use this only if you cannot scan. It is an assumed position in the Lab Block."
          disabled={busy}
          onPress={useDemoLiftCheckpoint}
        />
        <BigButton label="Choose another destination" variant="ghost" onPress={() => nav.stop(true)} />
        <LiveText>{msg}</LiveText>
      </Screen>
    );
  }

  return (
    <Screen>
      <Heading>Where do you want to go?</Heading>
      <Body muted>
        On NIE North Campus or inside the Lab Block. Say a place, or press one of the popular places.
      </Body>
      <Field
        label="Destination"
        hint="For example library, canteen, main gate, lab 201, or washroom"
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

      <Heading>Popular places</Heading>
      {CAMPUS_QUICK.map((p) => (
        <BigButton
          key={p.q}
          label={p.label}
          minHeight={72}
          disabled={busy}
          onPress={() => {
            setQuery(p.q);
            search(p.q, true);
          }}
        />
      ))}

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
