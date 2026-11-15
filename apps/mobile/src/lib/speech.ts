import * as Speech from 'expo-speech';

let rate = 1.0;
let lastSpoken: string | null = null;
let lastInstruction: string | null = null;

export function setSpeechRate(r: number) {
  rate = Math.min(2, Math.max(0.5, r));
}
export function getSpeechRate() {
  return rate;
}

/** Stops any previous speech, then speaks. All app speech goes through here. */
export function speak(text: string | null | undefined, opts?: { instruction?: boolean }) {
  const t = (text ?? '').trim();
  if (!t) return;
  Speech.stop();
  lastSpoken = t;
  if (opts?.instruction) lastInstruction = t;
  Speech.speak(t, { language: 'en-US', rate });
}

export function stopSpeaking() {
  Speech.stop();
}

/** Text of the last navigation instruction, or the last thing spoken. */
export function getLastInstruction(): string | null {
  return lastInstruction ?? lastSpoken;
}
export function clearLastInstruction() {
  lastInstruction = null;
}
