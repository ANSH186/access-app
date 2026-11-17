/**
 * Optional on-device speech recognition.
 *
 * `expo-speech-recognition` is a native module, so it is present in an AccessAble
 * development/production build but NOT in Expo Go. We load it dynamically: in
 * Expo Go the app falls back to recording audio and asking the API to transcribe.
 * This keeps the app usable in both environments.
 */
import { Platform } from 'react-native';

type AnyModule = {
  ExpoSpeechRecognitionModule?: {
    start: (opts: Record<string, unknown>) => void;
    stop: () => void;
    abort: () => void;
    requestPermissionsAsync: () => Promise<{ granted: boolean; status?: string }>;
    getPermissionsAsync: () => Promise<{ granted: boolean; status?: string }>;
    addListener: (event: string, cb: (e: any) => void) => { remove: () => void };
    isRecognitionAvailable?: () => boolean;
  };
};

let mod: AnyModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  mod = require('expo-speech-recognition') as AnyModule;
} catch {
  mod = null;
}

export const nativeSpeechAvailable = !!mod?.ExpoSpeechRecognitionModule;

const subscriptions: Array<{ remove: () => void }> = [];

function clearSubs() {
  while (subscriptions.length) subscriptions.pop()?.remove();
}

export type ListenHandlers = {
  onPartial?: (text: string) => void;
  onFinal: (text: string) => void;
  onEnd?: () => void;
  onError?: (code: string, message?: string) => void;
};

export async function requestVoicePermission(): Promise<boolean> {
  const m = mod?.ExpoSpeechRecognitionModule;
  if (!m) return false;
  try {
    const current = await m.getPermissionsAsync();
    if (current.granted) return true;
    const asked = await m.requestPermissionsAsync();
    return !!asked.granted;
  } catch {
    return false;
  }
}

export function startNativeListening(handlers: ListenHandlers): boolean {
  const m = mod?.ExpoSpeechRecognitionModule;
  if (!m) return false;
  clearSubs();
  try {
    m.abort();
  } catch {
    /* ignore */
  }
  try {
    subscriptions.push(
      m.addListener('result', (event: any) => {
        const text = String(event?.results?.[0]?.transcript ?? '').trim();
        if (!text) return;
        if (event?.isFinal) handlers.onFinal(text);
        else handlers.onPartial?.(text);
      }),
    );
    subscriptions.push(
      m.addListener('error', (event: any) => {
        handlers.onError?.(String(event?.error ?? 'unknown'), String(event?.message ?? ''));
      }),
    );
    subscriptions.push(
      m.addListener('end', () => {
        clearSubs();
        handlers.onEnd?.();
      }),
    );
    m.start({
      lang: Platform.OS === 'android' ? 'en-IN' : 'en-US',
      interimResults: true,
      continuous: false,
      maxAlternatives: 1,
      addsPunctuation: false,
      requiresOnDeviceRecognition: false,
      androidIntentOptions: { EXTRA_LANGUAGE_MODEL: 'web_search' },
      iosTaskHint: 'confirmation',
      iosCategory: {
        category: 'playAndRecord',
        categoryOptions: ['defaultToSpeaker', 'allowBluetooth'],
        mode: 'measurement',
      },
    });
    return true;
  } catch {
    clearSubs();
    return false;
  }
}

export function stopNativeListening() {
  try {
    mod?.ExpoSpeechRecognitionModule?.stop();
  } catch {
    /* ignore */
  }
}

export function abortNativeListening() {
  try {
    mod?.ExpoSpeechRecognitionModule?.abort();
  } catch {
    /* ignore */
  }
  clearSubs();
}
