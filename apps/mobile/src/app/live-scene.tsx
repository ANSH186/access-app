import { CameraView, useCameraPermissions } from 'expo-camera';
import { SaveFormat, manipulateAsync } from 'expo-image-manipulator';
import { router, useIsFocused } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { BigButton, Body, Heading, LiveText, Screen, styles as ui } from '../components/ui';
import { api, errorToSpeech, type Coords } from '../lib/api';
import { haptic } from '../lib/haptics';
import { getMyLocation, hasLocationPermission } from '../lib/location';
import { isSpeaking, speak, stopSpeaking } from '../lib/speech';
import { colors } from '../lib/theme';

const MAX_SIDE = 900;

async function prepareImage(uri: string, w: number, h: number): Promise<string> {
  const actions =
    Math.max(w, h) > MAX_SIDE
      ? [{ resize: w >= h ? { width: MAX_SIDE } : { height: MAX_SIDE } }]
      : [];
  const out = await manipulateAsync(uri, actions, { compress: 0.62, format: SaveFormat.JPEG });
  return out.uri;
}

export default function LiveScene() {
  const focused = useIsFocused();
  const [perm, requestPerm] = useCameraPermissions();
  const cam = useRef<CameraView>(null);
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [last, setLast] = useState('');
  const [torch, setTorch] = useState(false);
  const [intervalMs, setIntervalMs] = useState(5000);
  const [errors, setErrors] = useState(0);
  const coords = useRef<Coords | null>(null);
  const activeRef = useRef(false);
  const busyRef = useRef(false);

  activeRef.current = active;
  busyRef.current = busy;

  useEffect(() => {
    return () => {
      activeRef.current = false;
      stopSpeaking();
    };
  }, []);

  const describeFrame = useCallback(async () => {
    if (!activeRef.current || busyRef.current || !cam.current) return;
    if (isSpeaking()) return; // let the previous description finish
    busyRef.current = true;
    setBusy(true);
    try {
      const pic = await cam.current.takePictureAsync({ quality: 0.55, shutterSound: false });
      const uri = await prepareImage(pic.uri, pic.width, pic.height);
      const r = await api.describeScene(uri, undefined, coords.current, null, undefined, 'live');
      const text = (r.description || '').trim();
      if (text) {
        setLast(text);
        setStatus(text);
        setErrors(0);
        haptic.success();
        speak(text);
      }
    } catch (e) {
      setErrors((n) => {
        const next = n + 1;
        if (next === 1) speak(`I could not describe that frame. ${errorToSpeech(e)} I will keep trying.`);
        else if (next === 3) speak('I am having trouble seeing. I will keep trying. Press Stop describing to stop.');
        return next;
      });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!active || !focused) return;
    const boot = setTimeout(() => {
      void describeFrame();
    }, 500);
    const id = setInterval(() => {
      void describeFrame();
    }, intervalMs);
    return () => {
      clearTimeout(boot);
      clearInterval(id);
    };
  }, [active, focused, intervalMs, describeFrame]);

  async function start() {
    if (!perm?.granted) {
      const r = await requestPerm();
      if (!r.granted) {
        speak('Camera permission is needed for continuous description.');
        return;
      }
    }
    const ok = await hasLocationPermission();
    if (ok) {
      getMyLocation()
        .then((c) => {
          if (c) coords.current = { latitude: c.latitude, longitude: c.longitude };
        })
        .catch(() => undefined);
    }
    setActive(true);
    setErrors(0);
    haptic.strong();
    speak(
      'Continuous description is on. I will look ahead and describe everything I can see, about every ' +
        `${Math.round(intervalMs / 1000)} seconds. I cannot judge distances or whether a path is safe. Say stop, or press Stop describing, to stop.`,
    );
  }

  function stop() {
    setActive(false);
    stopSpeaking();
    setStatus('Continuous description stopped.');
    speak('Continuous description stopped.');
    haptic.tap();
  }

  if (!perm) return <Screen><Body>Checking camera permission…</Body></Screen>;
  if (!perm.granted) {
    return (
      <Screen>
        <Heading>Camera permission needed</Heading>
        <Body>AccessAble needs the camera for continuous scene description.</Body>
        <BigButton label="Allow camera" variant="primary" onPress={requestPerm} />
        <BigButton label="Go back" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Heading>Continuous scene description</Heading>
      <Body muted>
        The camera stays on and describes what is in front of you: people, walls, doors, barriers, steps, vehicles, trees,
        furniture, signs, the ground and the sky. It pauses while it is speaking so you can hear each description.
      </Body>
      <LiveText style={{ fontSize: 22, lineHeight: 31 }}>{status || (active ? 'Watching and describing…' : 'Stopped.')}</LiveText>

      {focused && (
        <View style={{ height: 280, borderRadius: 16, overflow: 'hidden', borderWidth: 2, borderColor: colors.border }}>
          <CameraView
            ref={cam}
            style={{ flex: 1 }}
            facing="back"
            enableTorch={torch}
            animateShutter={false}
            accessibilityLabel="Live camera preview for continuous description"
          />
        </View>
      )}

      <BigButton
        label={active ? 'Stop describing' : 'Start continuous description'}
        variant={active ? 'danger' : 'primary'}
        minHeight={92}
        onPress={active ? stop : start}
      />
      <BigButton label="Repeat last description" disabled={!last} onPress={() => speak(last)} />
      <BigButton label={torch ? 'Turn light off' : 'Turn light on'} onPress={() => setTorch((t) => !t)} />
      <BigButton
        label={`Describe every ${Math.round(intervalMs / 1000)} seconds — faster`}
        disabled={intervalMs <= 3500}
        onPress={() => {
          const next = Math.max(3500, intervalMs - 1500);
          setIntervalMs(next);
          speak(`I will describe every ${Math.round(next / 1000)} seconds.`);
        }}
      />
      <BigButton
        label={`Describe every ${Math.round(intervalMs / 1000)} seconds — slower`}
        disabled={intervalMs >= 11000}
        onPress={() => {
          const next = Math.min(11000, intervalMs + 1500);
          setIntervalMs(next);
          speak(`I will describe every ${Math.round(next / 1000)} seconds.`);
        }}
      />
      {!!last && (
        <View style={ui.card}>
          <Text style={{ color: colors.muted, fontSize: 16 }}>Last description</Text>
          <Text selectable style={{ color: colors.text, fontSize: 22, lineHeight: 32 }}>{last}</Text>
        </View>
      )}
      <BigButton label="Read a sign instead" onPress={() => router.push({ pathname: '/camera', params: { mode: 'sign' } })} />
      <BigButton label="Where am I" onPress={() => router.push('/where-am-i')} />
      <BigButton label="Back to home" onPress={() => router.replace('/')} />
      <Body muted>
        This is a description, not a substitute for a cane, guide dog or sighted assistant. It cannot detect every
        obstacle and it cannot judge distance or safety.
      </Body>
    </Screen>
  );
}
