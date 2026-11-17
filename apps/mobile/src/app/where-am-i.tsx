import { router } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { BigButton, Body, Heading, LiveText, Screen, styles as ui } from '../components/ui';
import { api, errorToSpeech } from '../lib/api';
import { locationText } from '../lib/format';
import {
  accuracyText,
  ensureLocationPermission,
  getMyLocation,
  hasLocationPermission,
  reverseGeocode,
  type MyAddress,
  type MyCoords,
} from '../lib/location';
import {
  bearingText,
  campusDisclaimer,
  loadMap,
  nearbyLandmarks,
  nearestNode,
  type CampusMap,
  type MapNode,
} from '../lib/map';
import { speak } from '../lib/speech';
import { colors } from '../lib/theme';
import type { ConfirmedLocation, PlaceInfo } from '../lib/types';
import { useApp } from '../state/app';

type Landmark = { node: MapNode; distance: number; bearing: string };

export default function WhereAmI() {
  const { location, setLocation } = useApp();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [coords, setCoords] = useState<MyCoords | null>(null);
  const [address, setAddress] = useState<MyAddress | null>(null);
  const [node, setNode] = useState<{ node: MapNode; distance: number } | null>(null);
  const [landmarks, setLandmarks] = useState<Landmark[]>([]);
  const [aiInfo, setAiInfo] = useState<PlaceInfo | null>(null);
  const [map, setMap] = useState<CampusMap | null>(null);

  const say = useCallback((t: string) => {
    setMsg(t);
    speak(t);
  }, []);

  useEffect(() => {
    loadMap().then(setMap).catch(() => undefined);
    speak(
      'Where am I. Press the first button to use GPS, or scan a checkpoint. You can also ask me to tell you about this place.',
    );
  }, []);

  const locate = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setAiInfo(null);
    say('Checking your GPS location. Allow location access if your phone asks.');
    try {
      const perm = await ensureLocationPermission();
      if (!perm.granted) {
        say(
          perm.canAskAgain
            ? 'Location permission was not granted. You can allow it in phone settings, scan a checkpoint, or choose from the list.'
            : 'Location permission is blocked. Open phone settings to allow location, or scan a checkpoint.',
        );
        return;
      }
      const c = await getMyLocation();
      if (!c) {
        say('I could not get a GPS fix. Move outdoors or near a window, then try again. You can also scan a checkpoint.');
        return;
      }
      setCoords(c);
      const m = map ?? (await loadMap());
      setMap(m);
      let addr = await reverseGeocode(c);
      if (!addr) {
        try {
          const r = await api.reverse(c);
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
          /* keep null */
        }
      }
      setAddress(addr);
      const hit = nearestNode(m, c.latitude, c.longitude, { searchableOnly: true, maxDistanceM: 900 });
      setNode(hit);
      const around = nearbyLandmarks(m, c.latitude, c.longitude, 4);
      setLandmarks(around);

      if (hit && hit.distance <= 700) {
        const n = hit.node;
        const metres = Math.max(1, Math.round(hit.distance));
        const dir = n.lat != null && n.lng != null ? bearingText(c.latitude, c.longitude, n.lat, n.lng) : 'nearby';
        const loc: ConfirmedLocation = {
          node_id: n.id,
          label: `near ${n.label}`,
          floor_level: n.floor_level,
          floor_name: n.floor_name || 'NIE North Campus',
          source: 'gps',
          observed_at: new Date().toISOString(),
          lat: c.latitude,
          lng: c.longitude,
          accuracy_m: c.accuracy,
        };
        setLocation(loc);
        const addressText = addr?.short ? ` The address is ${addr.short}.` : '';
        say(
          `You are on ${n.floor_name || 'NIE North Campus'}, about ${metres} metres ${dir} of ${n.label}.` +
            `${addressText} GPS is ${accuracyText(c.accuracy)}.`,
        );
      } else {
        const place = addr?.short ? `You appear to be near ${addr.short}.` : 'I could not look up this address.';
        const nearest = hit ? ` The nearest mapped campus place is ${hit.node.label}, ${Math.round(hit.distance)} metres away.` : '';
        say(
          `${place}${nearest} You are ${accuracyText(c.accuracy)}. ` +
            'I cannot confirm that you are on the mapped NIE North Campus. Scan a checkpoint or ask campus staff if you need help.',
        );
      }
    } catch (e) {
      say(`I could not check your location. ${errorToSpeech(e)}`);
    } finally {
      setBusy(false);
    }
  }, [busy, map, say, setLocation]);

  const locateRef = useRef(locate);
  locateRef.current = locate;

  // If the student has already allowed location, do the useful thing without
  // making them find another button.
  useEffect(() => {
    let mounted = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    hasLocationPermission().then((ok) => {
      if (ok && mounted) {
        timer = setTimeout(() => {
          if (mounted) void locateRef.current();
        }, 1200);
      }
    });
    return () => {
      mounted = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  async function tellMeMore() {
    if (!coords) return say('Use GPS first, then I can tell you about this place.');
    const local =
      node && node.distance <= 700
        ? `You are on ${node.node.floor_name || 'NIE North Campus'}, about ${Math.round(node.distance)} metres from ${node.node.label}.`
        : address?.short
          ? `You appear to be near ${address.short}.`
          : 'I am looking up this place.';
    setMsg(local);
    speak(local);
    setBusy(true);
    try {
      const info = await api.locationContext(coords);
      setAiInfo(info);
      const nearest = info.nearest ? ` The nearest mapped landmark is ${info.nearest.label}.` : '';
      speak(`${info.description}${nearest} ${info.confidence === 'low' ? 'I am not fully certain about this place.' : ''}`);
    } catch (e) {
      say(
        `I could not get an AI description. ${
          address?.short ? `The address is ${address.short}.` : errorToSpeech(e)
        }`,
      );
    } finally {
      setBusy(false);
    }
  }

  const campusText = node && node.distance <= 700
    ? `${node.node.floor_name || 'NIE North Campus'}, about ${Math.round(node.distance)} metres from ${node.node.label}`
    : null;

  return (
    <Screen>
      <Heading>Where am I?</Heading>
      <LiveText style={{ fontSize: 22, lineHeight: 31 }}>{msg}</LiveText>

      <BigButton
        label="Use my GPS and tell me where I am"
        variant="primary"
        minHeight={84}
        disabled={busy}
        onPress={locate}
      />
      <BigButton label="Tell me more about this place" disabled={busy || !coords} onPress={tellMeMore} />
      <BigButton
        label="Describe what I can see"
        hint="Opens the camera and describes the scene, using your location as context."
        onPress={() => router.push({ pathname: '/camera', params: { mode: 'scene' } })}
      />
      <BigButton
        label="Read a sign"
        onPress={() => router.push({ pathname: '/camera', params: { mode: 'sign' } })}
      />
      <BigButton label="Scan a QR checkpoint" onPress={() => router.push('/scan')} />
      <BigButton
        label="Choose my location from a list"
        onPress={() => router.push({ pathname: '/scan', params: { mode: 'list' } })}
      />

      {(coords || location) && (
        <View style={ui.card} accessible>
          <Text style={{ color: colors.muted, fontSize: 16 }}>Your position</Text>
          <Text style={{ color: colors.text, fontSize: 24, fontWeight: '800', lineHeight: 32 }}>
            {campusText ?? (location ? locationText(location) : 'Location not confirmed')}
          </Text>
          {address?.short && <Body>{address.short}</Body>}
          {coords && <Body muted>GPS {accuracyText(coords.accuracy)}.</Body>}
          {!node && location?.source === 'qr_checkpoint' && <Body>Last confirmed by scanning a checkpoint.</Body>}
        </View>
      )}

      {landmarks.length > 0 && (
        <View style={ui.card}>
          <Text style={{ color: colors.text, fontSize: 22, fontWeight: '800' }}>What is around me</Text>
          {landmarks.map((l) => (
            <Body key={l.node.id}>
              {l.node.label}: about {Math.round(l.distance)} metres to the {l.bearing}.
            </Body>
          ))}
        </View>
      )}

      {aiInfo && (
        <View style={ui.card}>
          <Text style={{ color: colors.text, fontSize: 22, fontWeight: '800' }}>
            {aiInfo.place_name || 'This place'}
          </Text>
          <Body>{aiInfo.description}</Body>
          {aiInfo.display_name && <Body muted>{aiInfo.display_name}</Body>}
        </View>
      )}

      <Body muted>{campusDisclaimer()}</Body>
      <Body muted>GPS can be off by several metres, especially indoors or between buildings.</Body>
    </Screen>
  );
}
