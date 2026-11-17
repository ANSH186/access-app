import { CameraView, useCameraPermissions } from 'expo-camera';
import { SaveFormat, manipulateAsync } from 'expo-image-manipulator';
import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { BigButton, Body, Field, Heading, LiveText, Screen, styles as ui } from '../components/ui';
import { useVoiceCapture } from '../hooks/useVoiceCapture';
import { api, errorToSpeech, type Coords } from '../lib/api';
import { getMyLocation } from '../lib/location';
import { haptic } from '../lib/haptics';
import { speak } from '../lib/speech';
import { colors } from '../lib/theme';
import type { OcrResult, PlaceInfo, VisionResult } from '../lib/types';

const MAX_SIDE = 1280;

async function prepareImage(uri: string, w: number, h: number): Promise<string> {
  const actions =
    Math.max(w, h) > MAX_SIDE
      ? [{ resize: w >= h ? { width: MAX_SIDE } : { height: MAX_SIDE } }]
      : [];
  const out = await manipulateAsync(uri, actions, { compress: 0.7, format: SaveFormat.JPEG });
  return out.uri;
}

export default function CameraScreen() {
  const { mode: modeParam } = useLocalSearchParams<{ mode?: string }>();
  const mode: 'sign' | 'scene' = modeParam === 'scene' ? 'scene' : 'sign';
  const focused = useIsFocused();
  const [perm, requestPerm] = useCameraPermissions();
  const cam = useRef<CameraView>(null);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [ocr, setOcr] = useState<OcrResult | null>(null);
  const [scene, setScene] = useState<VisionResult | null>(null);
  const [place, setPlace] = useState<PlaceInfo | null>(null);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [torch, setTorch] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const coordsRef = useRef<Coords | null>(null);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const spokenIntro = useRef(false);

  const say = (t: string) => {
    setStatus(t);
    speak(t);
  };

  useEffect(() => {
    if (spokenIntro.current) return;
    spokenIntro.current = true;
    if (mode === 'sign') {
      speak(
        'Read a sign. Point the camera at the sign, about an arm length away. Press Take photo, or press Take photo in 3 seconds to give yourself time.',
      );
    } else {
      speak(
        'Describe the scene. Point the camera ahead and press Take photo. I will also use your location to help name the place.',
      );
    }
  }, [mode]);

  useEffect(() => {
    return () => {
      if (countdownTimer.current) clearInterval(countdownTimer.current);
    };
  }, []);

  async function capture() {
    if (busy || !cam.current) return;
    setBusy(true);
    if (countdownTimer.current) clearInterval(countdownTimer.current);
    setCountdown(null);
    haptic.tap();
    say(mode === 'sign' ? 'Reading the sign…' : 'Looking at the scene…');
    try {
      const pic = await cam.current.takePictureAsync({ quality: 0.8 });
      const uri = await prepareImage(pic.uri, pic.width, pic.height);
      setImageUri(uri);
      await analyse(uri);
    } catch (e) {
      say(`${errorToSpeech(e)} Please try taking the photo again.`);
    } finally {
      setBusy(false);
    }
  }

  async function analyse(uri: string, q?: string) {
    setAnswer(null);
    if (mode === 'sign') {
      const r = await api.readSign(uri, q);
      setOcr(r);
      haptic.success();
      if (q) {
        const a = r.answer || 'I could not find the answer in the text of the sign.';
        setAnswer(a);
        setStatus(a);
        speak(a);
      } else {
        const parts: string[] = [];
        if (r.text.trim()) parts.push(r.spoken || r.text);
        if (r.confidence === 'low' || !r.text.trim()) {
          parts.push(r.advice || 'I am not sure I read this correctly. Hold the phone steady and try again.');
        }
        const t = parts.join(' ');
        setStatus(t);
        speak(t);
      }
      return;
    }

    // Scene mode: use location if the app already has permission. We never
    // prompt for location in the middle of taking a photo.
    let coords: Coords | null = coordsRef.current;
    if (!coords) {
      try {
        const c = await getMyLocation();
        if (c) {
          coords = { latitude: c.latitude, longitude: c.longitude };
          coordsRef.current = coords;
        }
      } catch {
        coords = null;
      }
    }
    const r = await api.describeScene(uri, q, coords);
    setScene(r);
    haptic.success();
    const main = q ? r.answer || r.description : r.description;
    if (q) setAnswer(r.answer || r.description);
    const t = `${main} ${r.caution}`;
    setStatus(t);
    speak(t);
  }

  async function ask(q: string) {
    if (!imageUri || !q.trim() || busy) return;
    setBusy(true);
    say('Thinking about your question…');
    try {
      await analyse(imageUri, q.trim());
    } catch (e) {
      say(errorToSpeech(e));
    } finally {
      setBusy(false);
    }
  }

  async function tellMeAboutPlace() {
    if (busy) return;
    setBusy(true);
    say('Looking up this place.');
    try {
      const c = coordsRef.current ?? (await getMyLocation().then((r) => (r ? { latitude: r.latitude, longitude: r.longitude } : null)));
      if (!c) {
        say('I do not have a location fix. Use the Where am I screen to get your GPS position first.');
        return;
      }
      coordsRef.current = c;
      const info = await api.locationContext(c);
      setPlace(info);
      say(`${info.description}${info.nearest ? ` The nearest mapped landmark is ${info.nearest.label}.` : ''}`);
    } catch (e) {
      say(`I could not look up this place. ${errorToSpeech(e)}`);
    } finally {
      setBusy(false);
    }
  }

  function startCountdown() {
    if (busy || countdown != null) return;
    setCountdown(3);
    speak('Three.');
    haptic.tap();
    let n = 3;
    countdownTimer.current = setInterval(() => {
      n -= 1;
      if (n > 0) {
        setCountdown(n);
        speak(String(n));
        haptic.tap();
      } else {
        setCountdown(null);
        if (countdownTimer.current) clearInterval(countdownTimer.current);
        speak('Taking photo.');
        haptic.strong();
        void capture();
      }
    }, 1000);
  }

  const voice = useVoiceCapture(async (uri) => {
    setBusy(true);
    setStatus('Listening to your question…');
    try {
      const cmd = await api.transcribeAudio(uri);
      if (!cmd.transcript.trim()) {
        say('I did not catch that. Please try again.');
        return;
      }
      setQuestion(cmd.transcript);
      setBusy(false);
      await ask(cmd.transcript);
    } catch (e) {
      say(errorToSpeech(e));
    } finally {
      setBusy(false);
    }
  });

  function reset() {
    setImageUri(null);
    setOcr(null);
    setScene(null);
    setPlace(null);
    setAnswer(null);
    setQuestion('');
    setCountdown(null);
    say('Ready. Point the camera and press Take photo, or press Take photo in 3 seconds.');
  }

  if (!perm) {
    return (
      <Screen>
        <Body>Checking camera permission…</Body>
      </Screen>
    );
  }
  if (!perm.granted) {
    return (
      <Screen>
        <Heading>Camera permission needed</Heading>
        <Body>AccessAble needs the camera to {mode === 'sign' ? 'read signs' : 'describe scenes'}.</Body>
        <BigButton label="Allow camera" variant="primary" onPress={requestPerm} />
        <BigButton label="Go back" onPress={() => router.back()} />
      </Screen>
    );
  }

  const hasResult = !!(ocr || scene);
  return (
    <Screen>
      <Heading>{mode === 'sign' ? 'Read a sign' : 'Describe the scene'}</Heading>
      {!hasResult && focused && (
        <View style={{ height: 300, borderRadius: 16, overflow: 'hidden', borderWidth: 2, borderColor: colors.border }}>
          <CameraView
            ref={cam}
            style={{ flex: 1 }}
            facing="back"
            enableTorch={torch}
            accessibilityLabel="Camera preview"
          />
        </View>
      )}
      {countdown != null && (
        <Text
          accessibilityLiveRegion="assertive"
          style={{ color: colors.accent, fontSize: 40, fontWeight: '900', textAlign: 'center' }}
        >
          {countdown}
        </Text>
      )}
      {!hasResult && (
        <>
          <BigButton
            label="Take photo"
            hint={mode === 'sign' ? 'Takes a photo and reads the text aloud' : 'Takes a photo and describes it aloud'}
            variant="primary"
            minHeight={96}
            disabled={busy || countdown != null}
            onPress={capture}
          />
          <BigButton
            label="Take photo in 3 seconds"
            hint="Gives you time to point the phone"
            minHeight={72}
            disabled={busy || countdown != null}
            onPress={startCountdown}
          />
          <BigButton
            label={torch ? 'Turn light off' : 'Turn light on'}
            hint="Useful for dark signs or rooms"
            onPress={() => setTorch((t) => !t)}
          />
        </>
      )}
      <LiveText>{status}</LiveText>

      {ocr && (
        <View style={ui.card}>
          <Text style={{ color: colors.muted, fontSize: 16 }}>Text found (confidence: {ocr.confidence})</Text>
          <Text selectable style={{ color: colors.text, fontSize: 34, fontWeight: '800', lineHeight: 44 }}>
            {ocr.text.trim() || 'No readable text found.'}
          </Text>
          {ocr.advice ? <Body>{ocr.advice}</Body> : null}
        </View>
      )}
      {scene && (
        <View style={ui.card}>
          <Text style={{ color: colors.text, fontSize: 28, fontWeight: '700', lineHeight: 38 }}>{scene.description}</Text>
          <Body muted>{scene.caution}</Body>
        </View>
      )}
      {place && (
        <View style={ui.card}>
          <Text style={{ color: colors.text, fontSize: 24, fontWeight: '800' }}>{place.place_name || 'This place'}</Text>
          <Body>{place.description}</Body>
          {place.display_name && <Body muted>{place.display_name}</Body>}
        </View>
      )}
      {answer && (
        <View style={ui.card}>
          <Text style={{ color: colors.muted, fontSize: 16 }}>Answer</Text>
          <Text style={{ color: colors.text, fontSize: 28, fontWeight: '700', lineHeight: 38 }}>{answer}</Text>
          {scene && <Body muted>{scene.caution}</Body>}
        </View>
      )}

      {hasResult && (
        <>
          <Field
            label="Ask about this"
            hint="Type a question about the photo"
            value={question}
            onChangeText={setQuestion}
            onSubmitEditing={() => ask(question)}
            returnKeyType="send"
          />
          <BigButton label="Ask" variant="primary" disabled={busy || !question.trim()} onPress={() => ask(question)} />
          <BigButton
            label={voice.state === 'recording' ? 'Tap to stop and ask' : 'Ask by voice'}
            hint="Tap, say your question, then tap again"
            disabled={busy || voice.state === 'processing'}
            onPress={() => voice.toggle()}
          />
          <BigButton label="Tell me about this place" disabled={busy} onPress={tellMeAboutPlace} />
          <BigButton label="Where am I" onPress={() => router.push('/where-am-i')} />
          <BigButton label="Repeat" onPress={() => speak(status)} />
          <BigButton label="Take another photo" onPress={reset} />
        </>
      )}
    </Screen>
  );
}
