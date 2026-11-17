import { router, usePathname } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useVoiceCapture } from '../hooks/useVoiceCapture';
import { api, errorToSpeech } from '../lib/api';
import { haptic } from '../lib/haptics';
import { getLastInstruction, speak, stopSpeaking, subscribeSpeech } from '../lib/speech';
import {
  abortNativeListening,
  nativeSpeechAvailable,
  requestVoicePermission,
  startNativeListening,
  stopNativeListening,
} from '../lib/speechRecognition';
import { colors, sizes } from '../lib/theme';
import type { CommandResult } from '../lib/types';
import { useApp } from '../state/app';
import { useNav } from '../state/nav';
import { useVoiceActions } from '../state/voice';
import { BigButton } from './ui';

const HIDDEN = ['/auth', '/sos', '/sos-status'];

const HELP =
  'You can say: help. Take me to the library. Where am I. Read this sign. Describe the scene. News. Report a problem. ' +
  'Next. Previous. Repeat. Stop. Or press a button by number, for example, press two.';

const EMERGENCY =
  /\b(sos|emergency|i need help|i am hurt|i'm hurt|i have fallen|i fell|i am in danger|i'm in danger|call 112|ambulance)\b/i;

const GLOBAL_HELP = /\b(help|what can i say|what can i do|voice commands|what can i press|read the screen|what is on the screen)\b/i;
const REPEAT = /\b(repeat|say that again|say it again|again please)\b/i;
const STOP = /\b(stop|quiet|be quiet|stop talking|shut up)\b/i;
const NEXT = /\b(next|next step|continue|go on|carry on)\b/i;
const PREVIOUS = /\b(previous|previous step|back a step|go back a step)\b/i;
const GO_BACK = /\b(go back|back|return)\b/i;
const HOME = /\b(home|main menu|go home|start screen)\b/i;
const WHERE = /\b(where am i|where am i now|my location|what is around me|what's around me)\b/i;
const NEWS = /\b(news|headlines|brief me|latest news|what is happening|what's happening|current affairs)\b/i;
const READ_SIGN = /\b(read (this |the )?sign|read a sign|read text|read this|what does this say)\b/i;
const DESCRIBE = /\b(describe (the )?scene|describe what is in front of me|what is in front of me|what's in front of me|what do you see|describe this)\b/i;
const REPORT = /\b(report a problem|report an issue|report a blocked|report a broken|report problem)\b/i;
const MY_REPORTS = /\b(my reports|my report|report status|status of my reports)\b/i;
const SETTINGS = /\b(settings|preferences|options)\b/i;
const NAVIGATE_TO = /^(?:please\s+)?(?:take me to|navigate to|go to|walk me to|directions to|find|where is|where's)\s+(.+)$/i;
const SOS_OPEN = /\b(sos|emergency|send sos|open sos)\b/i;

export function VoiceBar() {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { session, handsFree, setHandsFree } = useApp();
  const nav = useNav();
  const { list, pressByVoice } = useVoiceActions();
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const listeningRef = useRef(false);
  const speechActive = useRef(false);
  const handsFreeRef = useRef(handsFree);
  const restartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warnedNoNative = useRef(false);

  handsFreeRef.current = handsFree;

  const setListeningState = useCallback((value: boolean) => {
    listeningRef.current = value;
    setListening(value);
  }, []);

  const say = useCallback((text: string) => {
    setStatus(text);
    speak(text);
  }, []);

  const handleRef = useRef<((text: string) => Promise<void>) | null>(null);
  const voiceRef = useRef<ReturnType<typeof useVoiceCapture> | null>(null);
  const startListeningRef = useRef<((auto?: boolean) => Promise<void>) | null>(null);

  const scheduleRestart = useCallback((ms = 900) => {
    if (restartTimer.current) clearTimeout(restartTimer.current);
    restartTimer.current = setTimeout(() => {
      if (handsFreeRef.current && !speechActive.current && !busyRef.current) {
        void startListeningRef.current?.(true);
      }
    }, ms);
  }, []);

  const handleCommandResult = useCallback(
    (res: CommandResult) => {
      if (res.transcript) setStatus(`I heard: “${res.transcript}”`);
      switch (res.intent) {
        case 'navigate': {
          const params: Record<string, string> = {};
          if (res.destination) {
            params.destId = res.destination.node_id;
            params.destLabel = res.destination.label;
          } else if (res.destination_query) {
            params.q = res.destination_query;
          }
          if (res.reply) params.intro = res.reply;
          router.push({ pathname: '/navigate', params });
          break;
        }
        case 'read_sign':
          router.push({ pathname: '/camera', params: { mode: 'sign' } });
          break;
        case 'describe_scene':
          router.push({ pathname: '/camera', params: { mode: 'scene' } });
          break;
        case 'report_problem':
          router.push('/report');
          break;
        case 'where_am_i':
          router.push('/where-am-i');
          break;
        case 'news':
          router.push('/news');
          break;
        case 'sos':
          router.push('/sos');
          break;
        case 'repeat':
          speak(getLastInstruction() ?? 'There is nothing to repeat yet.');
          break;
        case 'cancel':
          nav.stop();
          setStatus('Navigation stopped.');
          break;
        case 'help':
        case 'unknown':
        default:
          say(HELP);
      }
    },
    [nav, say],
  );

  const handleUtterance = useCallback(
    async (text: string) => {
      const raw = text.trim();
      if (!raw) return;
      const lower = raw.toLowerCase();
      haptic.tap();
      setStatus(`I heard: “${raw}”`);

      // Everything that can be handled locally is handled without the network.
      if (EMERGENCY.test(lower)) {
        setStatus('Opening emergency help. Confirm on the screen to send an alert.');
        router.push('/sos');
        return;
      }
      if (GLOBAL_HELP.test(lower) && !/^help me$/i.test(lower)) {
        const actions = list().slice(0, 6);
        const numbered = actions.map((a, i) => `${i + 1}, ${a.label}`).join('. ');
        say(`${numbered ? `You can press: ${numbered}. ` : ''}${HELP}`);
        return;
      }
      if (REPEAT.test(lower)) {
        speak(getLastInstruction() ?? 'There is nothing to repeat yet.');
        return;
      }
      if (NEXT.test(lower) && nav.dest) {
        nav.next();
        return;
      }
      if (PREVIOUS.test(lower) && nav.dest) {
        nav.prev();
        return;
      }
      if (WHERE.test(lower)) {
        router.push('/where-am-i');
        return;
      }
      if (READ_SIGN.test(lower)) {
        router.push({ pathname: '/camera', params: { mode: 'sign' } });
        return;
      }
      if (DESCRIBE.test(lower)) {
        router.push({ pathname: '/camera', params: { mode: 'scene' } });
        return;
      }
      if (MY_REPORTS.test(lower)) {
        router.push('/my-reports');
        return;
      }
      if (REPORT.test(lower)) {
        router.push('/report');
        return;
      }
      if (NEWS.test(lower)) {
        router.push('/news');
        return;
      }
      if (SETTINGS.test(lower)) {
        router.push('/settings');
        return;
      }
      if (STOP.test(lower)) {
        if (/\b(stop listening|hands free off|hands-free off|turn off voice|turn off hands free)\b/i.test(lower)) {
          setHandsFree(false);
          say('Hands-free voice is off.');
          return;
        }
        if (/navigation|route/i.test(lower)) nav.stop();
        else {
          stopSpeaking();
          setStatus('Stopped.');
        }
        return;
      }
      if (SOS_OPEN.test(lower)) {
        router.push('/sos');
        return;
      }
      if (GO_BACK.test(lower)) {
        router.back();
        return;
      }
      if (HOME.test(lower)) {
        router.replace('/');
        return;
      }

      const dest = NAVIGATE_TO.exec(raw);
      if (dest?.[1]) {
        const q = dest[1].trim();
        router.push({ pathname: '/navigate', params: { q, intro: `Looking for ${q}.` } });
        return;
      }

      // "press two", "open settings", "button repeat", or just a button label.
      const action = pressByVoice(raw);
      if (action) {
        try {
          action.run();
        } catch {
          say('That button could not be used right now.');
        }
        return;
      }

      // A bare place name such as "library" or "canteen" should start a search,
      // not require the user to press another button.
      if (
        raw.split(/\s+/).length <= 4 &&
        !/^(what|who|why|how|when|where|is|are|can|could|should|would|do|does)\b/i.test(raw)
      ) {
        router.push({ pathname: '/navigate', params: { q: raw, intro: `Looking for ${raw}.` } });
        return;
      }

      // Last resort: ask the server to understand the sentence.
      setBusy(true);
      busyRef.current = true;
      try {
        const res = await api.commandText(raw);
        handleCommandResult(res);
      } catch (e) {
        say(`${errorToSpeech(e)} You can also press a button by number. Say: read the screen.`);
      } finally {
        setBusy(false);
        busyRef.current = false;
        if (handsFreeRef.current) scheduleRestart(1200);
      }
    },
    [handleCommandResult, list, nav, pressByVoice, say, scheduleRestart, setHandsFree],
  );

  handleRef.current = handleUtterance;

  const voice = useVoiceCapture(async (uri) => {
    setBusy(true);
    busyRef.current = true;
    setStatus('Sending your voice command…');
    try {
      const res = await api.transcribeAudio(uri);
      if (res.intent === 'navigate' && res.destination_query) {
        router.push({
          pathname: '/navigate',
          params: { q: res.destination_query, intro: `Looking for ${res.destination_query}.` },
        });
      } else if (res.intent === 'sos') {
        router.push('/sos');
      } else if (res.transcript?.trim()) {
        await handleRef.current?.(res.transcript);
      } else {
        say('I did not catch that. Please try again.');
      }
    } catch (e) {
      say(`${errorToSpeech(e)} You can type a command or press a button.`);
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  });
  voiceRef.current = voice;

  const startListening = useCallback(async (auto = false) => {
    if (busyRef.current || speechActive.current || listeningRef.current) return;
    if (!nativeSpeechAvailable) {
      if (auto) {
        if (!warnedNoNative.current) {
          warnedNoNative.current = true;
          say(
            'Hands-free voice needs the installed AccessAble app. In this preview, hold the Talk button and speak, or type your command.',
          );
        }
        return;
      }
      await voiceRef.current?.toggle();
      return;
    }
    const allowed = await requestVoicePermission();
    if (!allowed) {
      say('Microphone and speech recognition permission are needed for voice control. You can type your command instead.');
      if (auto) setHandsFree(false);
      return;
    }
    setListeningState(true);
    setStatus('Listening. Say a command.');
    const started = startNativeListening({
      onPartial: (partial) => setStatus(`I hear: “${partial}”`),
      onFinal: (finalText) => {
        setListeningState(false);
        void handleRef.current?.(finalText);
        if (handsFreeRef.current) scheduleRestart(1400);
      },
      onEnd: () => {
        setListeningState(false);
        if (handsFreeRef.current) scheduleRestart(800);
      },
      onError: (code, message) => {
        setListeningState(false);
        if (code === 'no-speech' || code === 'aborted' || code === 'speech-timeout') {
          if (handsFreeRef.current) scheduleRestart(900);
          return;
        }
        if (code === 'not-allowed' || code === 'service-not-allowed') {
          setHandsFree(false);
          say('Speech recognition is not available. Check microphone and speech recognition permissions in phone settings.');
          return;
        }
        if (code === 'network') {
          setStatus('Speech recognition needs an internet connection. You can type your command.');
        } else {
          setStatus(message ? `Voice error: ${message}` : 'I did not catch that. Please try again.');
        }
        if (handsFreeRef.current) scheduleRestart(1500);
      },
    });
    if (!started) {
      setListeningState(false);
      say('Voice recognition could not start. You can type your command below.');
    }
  }, [say, scheduleRestart, setHandsFree, setListeningState]);

  startListeningRef.current = startListening;

  useEffect(() => {
    return subscribeSpeech((event) => {
      speechActive.current = event === 'start';
      if (event === 'start') {
        abortNativeListening();
        setListeningState(false);
      } else if (handsFreeRef.current && !busyRef.current) {
        scheduleRestart(700);
      }
    });
  }, [scheduleRestart]);

  useEffect(() => {
    if (!handsFree || !session || HIDDEN.includes(pathname)) {
      abortNativeListening();
      setListeningState(false);
      return;
    }
    if (!nativeSpeechAvailable) {
      return;
    }
    const t = setTimeout(() => {
      void startListening(true);
    }, 900);
    return () => {
      clearTimeout(t);
      abortNativeListening();
      if (restartTimer.current) clearTimeout(restartTimer.current);
    };
  }, [handsFree, session, pathname, startListening]);

  useEffect(() => {
    return () => {
      if (restartTimer.current) clearTimeout(restartTimer.current);
      abortNativeListening();
    };
  }, []);

  if (!session || HIDDEN.includes(pathname)) return null;

  const label = listening
    ? 'Listening — tap to stop'
    : busy || voice.state === 'processing'
      ? 'Working…'
      : voice.state === 'recording'
        ? 'Tap to stop and send'
        : nativeSpeechAvailable
          ? 'Talk to AccessAble'
          : 'Tap to talk';

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 6) }]}>
      {!!status && (
        <Text style={styles.status} accessibilityLiveRegion="polite" numberOfLines={2}>
          {status}
        </Text>
      )}
      <BigButton
        label={label}
        accessibilityLabel={label}
        hint="Say a command, or say: press one, to use the numbered buttons. Say help to hear the choices."
        variant="primary"
        minHeight={64}
        silentHaptic
        voiceHidden
        disabled={busy || voice.state === 'processing'}
        onPress={() => {
          haptic.strong();
          if (listening) {
            stopNativeListening();
            setListeningState(false);
            setStatus('Stopped listening.');
            return;
          }
          if (voice.state === 'recording') {
            void voice.finish();
            return;
          }
          void startListening(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.bg,
    borderTopWidth: 2,
    borderTopColor: colors.border,
    paddingHorizontal: sizes.pad,
    paddingTop: 6,
  },
  status: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 21,
    marginBottom: 4,
    textAlign: 'center',
  },
});
