import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { SaveFormat, manipulateAsync } from 'expo-image-manipulator';
import { router, useIsFocused } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import {
  BigButton,
  Body,
  Field,
  Heading,
  LiveText,
  Screen,
  ToggleRow,
  styles as ui,
} from '../components/ui';
import { useVoiceCapture } from '../hooks/useVoiceCapture';
import { api, errorToSpeech } from '../lib/api';
import { haptic } from '../lib/haptics';
import { speak, speakMany, stopSpeaking } from '../lib/speech';
import { colors } from '../lib/theme';

const PAGES_KEY = 'aa.documentPages.v1';
const AUTO_READ_KEY = 'aa.documentAutoRead.v1';
const ASK_ALL_KEY = 'aa.documentAskAll.v1';
const MAX_SIDE = 1600;

async function prepareImage(uri: string, w: number, h: number): Promise<string> {
  const actions =
    Math.max(w, h) > MAX_SIDE
      ? [{ resize: w >= h ? { width: MAX_SIDE } : { height: MAX_SIDE } }]
      : [];
  const out = await manipulateAsync(uri, actions, { compress: 0.8, format: SaveFormat.JPEG });
  return out.uri;
}

export default function DocumentReader() {
  const focused = useIsFocused();
  const [perm, requestPerm] = useCameraPermissions();
  const cam = useRef<CameraView>(null);
  const [pages, setPages] = useState<string[]>([]);
  const [current, setCurrent] = useState(0); // 0-based; -1 means no page
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [autoRead, setAutoRead] = useState(true);
  const [askAll, setAskAll] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [torch, setTorch] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const loaded = useRef(false);

  const say = useCallback((t: string) => {
    setStatus(t);
    speak(t);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [raw, auto, all] = await Promise.all([
          AsyncStorage.getItem(PAGES_KEY),
          AsyncStorage.getItem(AUTO_READ_KEY),
          AsyncStorage.getItem(ASK_ALL_KEY),
        ]);
        const saved = raw ? (JSON.parse(raw) as string[]) : [];
        if (Array.isArray(saved) && saved.length) {
          setPages(saved.filter((p) => typeof p === 'string' && p.trim()));
          setCurrent(0);
        }
        if (auto != null) setAutoRead(auto === '1');
        if (all != null) setAskAll(all === '1');
      } catch {
        /* ignore */
      } finally {
        loaded.current = true;
        speak(
          'Document reader. Take one photo per page. I will read every line, and I keep the pages so you can hear them again. ' +
            'You can also ask a question about a page or the whole document.',
        );
      }
    })();
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    AsyncStorage.setItem(PAGES_KEY, JSON.stringify(pages)).catch(() => undefined);
  }, [pages]);

  useEffect(() => {
    return () => {
      if (countdownTimer.current) clearInterval(countdownTimer.current);
    };
  }, []);

  const readPage = useCallback(
    (index: number, prefix = true) => {
      if (index < 0 || index >= pages.length) return say('There is no page at that number.');
      const text = pages[index]!.trim();
      if (!text) return say('That page is empty.');
      setCurrent(index);
      const lineCount = text.split('\n').filter((l) => l.trim()).length;
      speak(`${prefix ? `Page ${index + 1}. ` : ''}${text}`);
      setStatus(`Reading page ${index + 1}, ${lineCount} lines.`);
    },
    [pages, say],
  );

  const readAll = useCallback(() => {
    if (!pages.length) return say('There are no pages yet.');
    const chunks = pages.map((p, i) => `Page ${i + 1}. ${p.trim()}`);
    setStatus(`Reading all ${pages.length} pages.`);
    speakMany([`Reading all ${pages.length} pages. Say stop to stop.`, ...chunks]);
  }, [pages, say]);

  async function capture() {
    if (busy || !cam.current) return;
    setBusy(true);
    if (countdownTimer.current) clearInterval(countdownTimer.current);
    setCountdown(null);
    haptic.tap();
    setStatus('Photographing the page…');
    try {
      const pic = await cam.current.takePictureAsync({ quality: 0.85, shutterSound: false });
      const uri = await prepareImage(pic.uri, pic.width, pic.height);
      setStatus('Reading the page. This can take a few seconds…');
      const r = await api.readDocument(uri);
      const text = (r.text || '').trim();
      if (!text) {
        say('I could not read this page. Hold the phone steady, fill the frame with the page, and try again.');
        return;
      }
      const index = pages.length;
      const next = [...pages, text];
      setPages(next);
      setCurrent(index);
      haptic.success();
      if (autoRead) {
        speak(`Page ${index + 1}. ${text}`);
        setStatus(`Page ${index + 1} read. ${r.lines} lines.`);
      } else {
        say(`Page ${index + 1} added, ${r.lines} lines. Press Read this page to hear it.`);
      }
    } catch (e) {
      say(`${errorToSpeech(e)} Hold the page flat, fill the frame, and try again.`);
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

  async function ask(q: string) {
    const text = askAll ? pages.join('\n\n') : pages[current] ?? '';
    if (!text.trim()) return say('Take a page photo first, or choose a page to ask about.');
    if (!q.trim()) return;
    setBusy(true);
    setAnswer('');
    say('Looking for the answer in the text.');
    try {
      const r = await api.answerText(text, q.trim());
      setAnswer(r.answer);
      speak(r.answer || 'I could not find that in the text.');
    } catch (e) {
      // Local fallback: keyword lines from the page.
      const words = q.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
      const lines = text.split(/\n+/).filter((line) => words.some((w) => line.toLowerCase().includes(w)));
      const local = lines.length
        ? `I found these lines: ${lines.slice(0, 3).join(' ')}`
        : `I could not find that in the text. ${errorToSpeech(e)}`;
      setAnswer(local);
      speak(local);
    } finally {
      setBusy(false);
    }
  }

  const voice = useVoiceCapture(async (uri) => {
    setBusy(true);
    try {
      const r = await api.transcribeAudio(uri);
      if (!r.transcript.trim()) {
        say('I did not catch the question. Please try again.');
        return;
      }
      setQuestion(r.transcript);
      setBusy(false);
      await ask(r.transcript);
    } catch (e) {
      say(errorToSpeech(e));
    } finally {
      setBusy(false);
    }
  });

  const currentText = pages[current] ?? '';
  const lineCount = currentText ? currentText.split('\n').filter((l) => l.trim()).length : 0;

  if (!perm) return <Screen><Body>Checking camera permission…</Body></Screen>;
  if (!perm.granted) {
    return (
      <Screen>
        <Heading>Camera permission needed</Heading>
        <Body>AccessAble needs the camera to photograph book and notebook pages.</Body>
        <BigButton label="Allow camera" variant="primary" onPress={requestPerm} />
        <BigButton label="Go back" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Heading>Document and book reader</Heading>
      <Body muted>
        One photo per page. I keep every page in this document so you can hear it again, ask questions, or read the
        whole thing.
      </Body>
      <LiveText>{status}</LiveText>

      {focused && (
        <View style={{ height: 260, borderRadius: 16, overflow: 'hidden', borderWidth: 2, borderColor: colors.border }}>
          <CameraView
            ref={cam}
            style={{ flex: 1 }}
            facing="back"
            enableTorch={torch}
            animateShutter={false}
            accessibilityLabel="Camera preview for document pages"
          />
        </View>
      )}
      {countdown != null && (
        <Text accessibilityLiveRegion="assertive" style={{ color: colors.accent, fontSize: 40, fontWeight: '900', textAlign: 'center' }}>
          {countdown}
        </Text>
      )}

      <BigButton
        label={busy ? 'Reading page…' : 'Take page photo'}
        hint="Fill the frame with the page, keep it flat, and hold still"
        variant="primary"
        minHeight={88}
        disabled={busy || countdown != null}
        onPress={capture}
      />
      <BigButton
        label="Take page photo in 3 seconds"
        disabled={busy || countdown != null}
        onPress={startCountdown}
      />
      <BigButton label={torch ? 'Turn light off' : 'Turn light on'} onPress={() => setTorch((t) => !t)} />

      <ToggleRow
        label="Read each page aloud automatically"
        hint="When on, the page is read as soon as it is photographed"
        value={autoRead}
        onChange={(v) => {
          setAutoRead(v);
          AsyncStorage.setItem(AUTO_READ_KEY, v ? '1' : '0').catch(() => undefined);
          speak(v ? 'Automatic page reading is on.' : 'Automatic page reading is off.');
        }}
      />

      {pages.length > 0 && (
        <View style={ui.card} accessible accessibilityLabel={`Page ${current + 1} of ${pages.length}, ${lineCount} lines`}>
          <Text style={{ color: colors.muted, fontSize: 17 }}>
            Page {current + 1} of {pages.length} — {lineCount} lines
          </Text>
          <Text selectable style={{ color: colors.text, fontSize: 22, lineHeight: 32 }}>
            {currentText || 'This page is empty.'}
          </Text>
        </View>
      )}

      <BigButton label="Read this page" variant={pages.length ? 'primary' : 'secondary'} disabled={!pages.length || busy} onPress={() => readPage(current, false)} />
      <BigButton
        label="Previous page"
        disabled={current <= 0}
        onPress={() => {
          const i = Math.max(0, current - 1);
          setCurrent(i);
          readPage(i);
        }}
      />
      <BigButton
        label="Next page"
        disabled={current >= pages.length - 1}
        onPress={() => {
          const i = Math.min(pages.length - 1, current + 1);
          setCurrent(i);
          readPage(i);
        }}
      />
      <BigButton label="Read all pages" disabled={!pages.length || busy} onPress={readAll} />
      <BigButton label="Stop reading" variant="ghost" onPress={() => stopSpeaking()} />
      <BigButton
        label="Delete last page"
        disabled={!pages.length || busy}
        onPress={() => {
          const next = pages.slice(0, -1);
          setPages(next);
          setCurrent(Math.max(0, Math.min(current, next.length - 1)));
          say(next.length ? `Last page deleted. ${next.length} pages left.` : 'All pages deleted.');
        }}
      />

      <Heading>Ask about the document</Heading>
      <ToggleRow
        label="Ask about all pages"
        hint="Off means ask about the current page only"
        value={askAll}
        onChange={(v) => {
          setAskAll(v);
          AsyncStorage.setItem(ASK_ALL_KEY, v ? '1' : '0').catch(() => undefined);
          speak(v ? 'Questions will use all pages.' : 'Questions will use the current page.');
        }}
      />
      <Field
        label="Your question"
        hint="For example: what is the date, or explain the second paragraph"
        value={question}
        onChangeText={setQuestion}
        onSubmitEditing={() => ask(question)}
        returnKeyType="send"
      />
      <BigButton label="Ask" variant="primary" disabled={busy || !question.trim() || !pages.length} onPress={() => ask(question)} />
      <BigButton
        label={voice.state === 'recording' ? 'Tap to stop and ask' : 'Ask by voice'}
        disabled={busy || voice.state === 'processing' || !pages.length}
        onPress={() => voice.toggle()}
      />
      {!!answer && (
        <View style={ui.card}>
          <Text style={{ color: colors.muted, fontSize: 16 }}>Answer</Text>
          <Text style={{ color: colors.text, fontSize: 24, fontWeight: '700', lineHeight: 33 }}>{answer}</Text>
        </View>
      )}

      {confirmClear ? (
        <View style={ui.card}>
          <Body>Delete all {pages.length} pages? This cannot be undone.</Body>
          <BigButton
            label="Yes, delete all pages"
            variant="danger"
            onPress={() => {
              setPages([]);
              setCurrent(0);
              setAnswer('');
              setConfirmClear(false);
              say('All pages deleted.');
            }}
          />
          <BigButton label="Keep my pages" variant="primary" onPress={() => setConfirmClear(false)} />
        </View>
      ) : (
        <BigButton label="Clear all pages" variant="ghost" disabled={!pages.length} onPress={() => setConfirmClear(true)} />
      )}
      <BigButton label="Back to home" onPress={() => router.replace('/')} />
      <Body muted>
        Photos are read on the server and are not kept by AccessAble. The text stays on this phone until you delete it.
        OCR can make mistakes; check names, dates and numbers.
      </Body>
    </Screen>
  );
}
