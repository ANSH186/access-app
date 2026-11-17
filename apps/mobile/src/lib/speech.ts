import * as Speech from 'expo-speech';

let rate = 1.0;
let lastSpoken: string | null = null;
let lastInstruction: string | null = null;
let speaking = false;
let speakSeq = 0;

type SpeechEvent = 'start' | 'end';
const listeners = new Set<(event: SpeechEvent) => void>();

export function setSpeechRate(r: number) {
  rate = Math.min(2, Math.max(0.5, r));
}
export function getSpeechRate() {
  return rate;
}
export function isSpeaking() {
  return speaking;
}

/** Notified when TTS starts or finishes, so hands-free listening can pause. */
export function subscribeSpeech(cb: (event: SpeechEvent) => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function emit(event: SpeechEvent) {
  speaking = event === 'start';
  listeners.forEach((cb) => {
    try {
      cb(event);
    } catch {
      /* ignore */
    }
  });
}

type SpeakOptions = {
  instruction?: boolean;
  /** Do not interrupt speech that is already playing. */
  queue?: boolean;
  onDone?: () => void;
};

/** Stops any previous speech, then speaks. All app speech goes through here. */
export function speak(text: string | null | undefined, opts: SpeakOptions = {}) {
  const t = (text ?? '').trim();
  if (!t) return;
  const seq = ++speakSeq;
  if (!opts.queue) Speech.stop();
  lastSpoken = t;
  if (opts.instruction) lastInstruction = t;
  emit('start');
  Speech.speak(t, {
    language: 'en-US',
    rate,
    onDone: () => {
      if (seq !== speakSeq) return;
      emit('end');
      opts.onDone?.();
    },
    onStopped: () => {
      if (seq === speakSeq) emit('end');
    },
    onError: () => {
      if (seq === speakSeq) emit('end');
    },
  });
}

export function stopSpeaking() {
  speakSeq += 1;
  Speech.stop();
  emit('end');
}

/** Queue several utterances and treat them as one speech event. */
export function speakMany(texts: string[], opts: SpeakOptions = {}) {
  const clean = texts.map((t) => (t ?? '').trim()).filter(Boolean);
  if (!clean.length) return;
  const seq = ++speakSeq;
  Speech.stop();
  emit('start');
  lastSpoken = clean.join(' ');
  clean.forEach((t, i) => {
    Speech.speak(t, {
      language: 'en-US',
      rate,
      onDone: () => {
        if (seq !== speakSeq) return;
        if (i === clean.length - 1) {
          emit('end');
          opts.onDone?.();
        }
      },
      onStopped: () => {
        if (seq === speakSeq && i === clean.length - 1) emit('end');
      },
      onError: () => {
        if (seq === speakSeq && i === clean.length - 1) emit('end');
      },
    });
  });
}

/** Text of the last navigation instruction, or the last thing spoken. */
export function getLastInstruction(): string | null {
  return lastInstruction ?? lastSpoken;
}
export function clearLastInstruction() {
  lastInstruction = null;
}
