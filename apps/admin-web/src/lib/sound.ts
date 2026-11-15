// Alert tone generated with the Web Audio API (no audio files).
// Browsers keep an AudioContext suspended until a user gesture, so unlockAudio()
// must be called from a click/keypress handler.

type AudioCtor = typeof AudioContext;
let ctx: AudioContext | null = null;
let timer: number | null = null;
let timerEscalated = false;

function ctor(): AudioCtor | undefined {
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return w.AudioContext ?? w.webkitAudioContext;
}

export async function unlockAudio(): Promise<boolean> {
  const C = ctor();
  if (!C) return false;
  if (!ctx) ctx = new C();
  try {
    await ctx.resume();
  } catch {
    return false;
  }
  // Play a silent tick so the browser registers audio as user-initiated.
  const g = ctx.createGain();
  g.gain.value = 0;
  const o = ctx.createOscillator();
  o.connect(g).connect(ctx.destination);
  o.start();
  o.stop(ctx.currentTime + 0.02);
  return ctx.state === 'running';
}

export function audioIsRunning(): boolean {
  return ctx?.state === 'running';
}

function tone(freq: number, start: number, dur: number, peak = 0.22) {
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'square';
  o.frequency.value = freq;
  const t0 = ctx.currentTime + start;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

/** One two-tone alert pattern. */
export function playAlertOnce(escalated = false) {
  if (!audioIsRunning()) return;
  const peak = escalated ? 0.45 : 0.22;
  tone(escalated ? 1175 : 988, 0, 0.18, peak);
  tone(escalated ? 880 : 740, 0.22, 0.18, peak);
  tone(escalated ? 1175 : 988, 0.44, 0.18, peak);
  if (escalated) tone(880, 0.66, 0.18, peak);
}

export function startAlarm(escalated = false) {
  if (!audioIsRunning()) return;
  if (timer !== null && timerEscalated === escalated) return;
  stopAlarm();
  timerEscalated = escalated;
  playAlertOnce(escalated);
  timer = window.setInterval(() => playAlertOnce(escalated), escalated ? 1300 : 2200);
}

export function stopAlarm() {
  if (timer !== null) {
    window.clearInterval(timer);
    timer = null;
  }
}
