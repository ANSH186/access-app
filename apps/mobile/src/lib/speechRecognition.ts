/**
 * Optional on-device speech recognition.
 *
 * `expo-speech-recognition` is a native module, so it is present in an AccessAble
 * development/production build but NOT in Expo Go. We load it dynamically: in
 * Expo Go the app falls back to recording audio and asking the API to transcribe.
 * This keeps the app usable in both environments.
 *
 * Only one recognition session may be active at a time. Starting while a session
 * is already active is a no-op (it does NOT abort the active session); callers
 * must stop/abort explicitly. Every session has a generation number so delayed
 * events from an old session are ignored.
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

type Session = {
  active: boolean;
  generation: number;
};

const session: Session = { active: false, generation: 0 };

function isCurrent(generation: number) {
  return generation === session.generation;
}

export type ListenHandlers = {
  onPartial?: (text: string) => void;
  onFinal: (text: string) => void;
  onEnd?: () => void;
  onError?: (code: string, message?: string) => void;
};

export type ListenOptions = {
  /** Keep the native session open across utterances (used by hands-free mode). */
  continuous?: boolean;
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

export function isNativeListening(): boolean {
  return session.active;
}

export function startNativeListening(
  handlers: ListenHandlers,
  options: ListenOptions = {},
): boolean {
  const m = mod?.ExpoSpeechRecognitionModule;
  if (!m) return false;
  if (session.active) {
    // A session is already running. Never abort it here: the restart timer and
    // the screen effect can fire close together, and aborting an active session
    // makes Android log "User cancelled" and restart in a tight loop.
    return true;
  }

  clearSubs();
  const generation = ++session.generation;

  const finish = () => {
    if (!isCurrent(generation)) return;
    session.active = false;
    clearSubs();
  };

  try {
    subscriptions.push(
      m.addListener('result', (event: any) => {
        if (!isCurrent(generation)) return;
        const text = String(event?.results?.[0]?.transcript ?? '').trim();
        if (!text) return;
        if (event?.isFinal) handlers.onFinal(text);
        else handlers.onPartial?.(text);
      }),
    );
    subscriptions.push(
      m.addListener('error', (event: any) => {
        if (!isCurrent(generation)) return;
        finish();
        handlers.onError?.(String(event?.error ?? 'unknown'), String(event?.message ?? ''));
      }),
    );
    subscriptions.push(
      m.addListener('end', () => {
        if (!isCurrent(generation)) return;
        finish();
        handlers.onEnd?.();
      }),
    );
    m.start({
      lang: Platform.OS === 'android' ? 'en-IN' : 'en-US',
      interimResults: true,
      continuous: !!options.continuous,
      maxAlternatives: 1,
      addsPunctuation: false,
      requiresOnDeviceRecognition: false,
      iosTaskHint: 'confirmation',
      iosCategory: {
        category: 'playAndRecord',
        categoryOptions: ['defaultToSpeaker', 'allowBluetooth'],
        mode: 'measurement',
      },
    });
    session.active = true;
    return true;
  } catch {
    finish();
    return false;
  }
}

export function stopNativeListening() {
  session.active = false;
  session.generation += 1;
  clearSubs();
  try {
    mod?.ExpoSpeechRecognitionModule?.stop();
  } catch {
    /* ignore */
  }
}

export function abortNativeListening() {
  session.active = false;
  session.generation += 1;
  clearSubs();
  try {
    mod?.ExpoSpeechRecognitionModule?.abort();
  } catch {
    /* ignore */
  }
}
