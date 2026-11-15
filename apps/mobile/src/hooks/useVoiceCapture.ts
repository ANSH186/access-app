import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  type RecordingOptions,
} from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import { haptic } from '../lib/haptics';
import { speak, stopSpeaking } from '../lib/speech';

// Small mono AAC clip: keeps uploads well under the 2 MB server limit.
const OPTIONS: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 32000,
};
const MAX_MS = 20_000;
const MIN_MS = 500;

export type CaptureState = 'idle' | 'starting' | 'recording' | 'processing';

/**
 * Records a short clip. `onAudio` receives the file uri when recording ends.
 * Two ways to use it: hold (start on press in, finish on press out) or toggle.
 */
export function useVoiceCapture(onAudio: (uri: string) => Promise<void> | void) {
  const recorder = useAudioRecorder(OPTIONS);
  const [state, setState] = useState<CaptureState>('idle');
  const stateRef = useRef<CaptureState>('idle');
  const startedAt = useRef(0);
  const stopRequested = useRef(false);
  const maxTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cb = useRef(onAudio);
  cb.current = onAudio;

  const set = (s: CaptureState) => {
    stateRef.current = s;
    setState(s);
  };

  const finish = useCallback(async () => {
    if (stateRef.current === 'starting') {
      stopRequested.current = true; // stop as soon as recording has started
      return;
    }
    if (stateRef.current !== 'recording') return;
    if (maxTimer.current) clearTimeout(maxTimer.current);
    const duration = Date.now() - startedAt.current;
    set('processing');
    haptic.tap();
    try {
      await recorder.stop();
    } catch {
      /* ignore */
    }
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
    const uri = recorder.uri;
    if (!uri || duration < MIN_MS) {
      set('idle');
      speak('That was too short. Hold the button while you speak, or use the tap to talk button.');
      return;
    }
    try {
      await cb.current(uri);
    } finally {
      set('idle');
    }
  }, [recorder]);

  const start = useCallback(async () => {
    if (stateRef.current !== 'idle') return;
    set('starting');
    stopRequested.current = false;
    stopSpeaking();
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        set('idle');
        speak('Microphone permission is needed for voice commands. You can type a command instead.');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      startedAt.current = Date.now();
      set('recording');
      haptic.strong();
      maxTimer.current = setTimeout(() => {
        finish();
      }, MAX_MS);
      if (stopRequested.current) await finish();
    } catch {
      set('idle');
      speak('I could not start the microphone. You can type a command instead.');
    }
  }, [finish, recorder]);

  const toggle = useCallback(async () => {
    if (stateRef.current === 'idle') await start();
    else if (stateRef.current === 'recording') await finish();
  }, [start, finish]);

  useEffect(
    () => () => {
      if (maxTimer.current) clearTimeout(maxTimer.current);
    },
    [],
  );

  return { state, start, finish, toggle };
}
