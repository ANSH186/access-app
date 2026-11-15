import { CameraView, useCameraPermissions } from 'expo-camera';
import { SaveFormat, manipulateAsync } from 'expo-image-manipulator';
import { useIsFocused, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { BigButton, Body, Field, Heading, LiveText, Screen, styles as ui } from '../components/ui';
import { useVoiceCapture } from '../hooks/useVoiceCapture';
import { api, errorToSpeech } from '../lib/api';
import { haptic } from '../lib/haptics';
import { speak } from '../lib/speech';
import { colors } from '../lib/theme';
import type { OcrResult, VisionResult } from '../lib/types';

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
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);

  const say = (t: string) => {
    setStatus(t);
    speak(t);
  };

  useEffect(() => {
    if (perm?.granted) {
      say(
        mode === 'sign'
          ? 'Point the camera at the sign and press Take photo. Hold the phone steady, about an arm length away.'
          : 'Point the camera ahead and press Take photo.',
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perm?.granted, mode]);

  async function capture() {
    if (busy || !cam.current) return;
    setBusy(true);
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
    } else {
      const r = await api.describeScene(uri, q);
      setScene(r);
      haptic.success();
      const main = q ? r.answer || r.description : r.description;
      if (q) setAnswer(r.answer || r.description);
      const t = `${main} ${r.caution}`;
      setStatus(t);
      speak(t);
    }
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

  const voice = useVoiceCapture(async (uri) => {
    setBusy(true);
    setStatus('Listening to your question…');
    try {
      const cmd = await api.commandAudio(uri);
      // Only the transcript is used here; any intent is ignored.
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
    setAnswer(null);
    setQuestion('');
    say('Ready. Point the camera and press Take photo.');
  }

  if (!perm) return <Screen><Body>Checking camera permission…</Body></Screen>;
  if (!perm.granted) {
    return (
      <Screen>
        <Heading>Camera permission needed</Heading>
        <Body>AccessAble needs the camera to {mode === 'sign' ? 'read signs' : 'describe scenes'}.</Body>
        <BigButton label="Allow camera" variant="primary" onPress={requestPerm} />
      </Screen>
    );
  }

  const hasResult = !!(ocr || scene);
  return (
    <Screen>
      <Heading>{mode === 'sign' ? 'Read a sign' : 'Describe the scene'}</Heading>
      {!hasResult && focused && (
        <View style={{ height: 320, borderRadius: 16, overflow: 'hidden', borderWidth: 2, borderColor: colors.border }}>
          <CameraView
            ref={cam}
            style={{ flex: 1 }}
            facing="back"
            accessibilityLabel="Camera preview"
          />
        </View>
      )}
      {!hasResult && (
        <BigButton
          label="Take photo"
          hint={mode === 'sign' ? 'Takes a photo and reads the text aloud' : 'Takes a photo and describes it aloud'}
          variant="primary"
          minHeight={96}
          disabled={busy}
          onPress={capture}
        />
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
          <BigButton label="Repeat" onPress={() => speak(status)} />
          <BigButton label="Take another photo" onPress={reset} />
        </>
      )}
    </Screen>
  );
}
