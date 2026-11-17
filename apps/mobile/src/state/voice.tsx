import React, { createContext, useCallback, useContext, useMemo, useRef } from 'react';

export type VoiceAction = {
  id: string;
  label: string;
  run: () => void;
  disabled?: boolean;
  order: number;
};

type VoiceCtx = {
  register: (action: Omit<VoiceAction, 'order'>) => () => void;
  list: () => VoiceAction[];
  pressByVoice: (utterance: string) => VoiceAction | null;
};

const Ctx = createContext<VoiceCtx | null>(null);

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
};

function clean(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(button|the|please|tap|press|select|choose|open|click|option)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const m = a.length;
  const n = b.length;
  const row = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return 1 - row[n]! / Math.max(m, n);
}

export function VoiceActionsProvider({ children }: { children: React.ReactNode }) {
  const actions = useRef(new Map<string, VoiceAction>());
  const order = useRef(0);

  const register = useCallback((action: Omit<VoiceAction, 'order'>) => {
    const existing = actions.current.get(action.id);
    actions.current.set(action.id, { ...action, order: existing?.order ?? order.current++ });
    return () => {
      actions.current.delete(action.id);
    };
  }, []);

  const list = useCallback(() => {
    return Array.from(actions.current.values())
      .filter((a) => !a.disabled)
      .sort((a, b) => a.order - b.order);
  }, []);

  const pressByVoice = useCallback((utterance: string): VoiceAction | null => {
    const enabled = list();
    if (!enabled.length) return null;
    const u = clean(utterance);
    if (!u) return null;

    // "one", "press 2", "open three"
    const numberWord = u.replace(/\b(number|option|button)\b/g, '').trim();
    const n = NUMBER_WORDS[numberWord];
    if (n && enabled[n - 1]) return enabled[n - 1]!;
    const numMatch = /\b(\d{1,2})\b/.exec(u);
    if (numMatch) {
      const idx = Number(numMatch[1]) - 1;
      if (enabled[idx]) return enabled[idx]!;
    }

    // Exact label, then contains, then fuzzy.
    const labels = enabled.map((a) => ({ a, c: clean(a.label) }));
    const exact = labels.find((x) => x.c === u);
    if (exact) return exact.a;
    const contains = labels
      .filter((x) => x.c.includes(u) || u.includes(x.c))
      .sort((a, b) => Math.abs(a.c.length - u.length) - Math.abs(b.c.length - u.length))[0];
    if (contains) return contains.a;
    let best: { a: VoiceAction; score: number } | null = null;
    for (const x of labels) {
      const score = similarity(u, x.c);
      if (!best || score > best.score) best = { a: x.a, score };
    }
    return best && best.score >= 0.62 ? best.a : null;
  }, [list]);

  const value = useMemo<VoiceCtx>(() => ({ register, list, pressByVoice }), [register, list, pressByVoice]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useVoiceActions(): VoiceCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useVoiceActions outside VoiceActionsProvider');
  return v;
}

export function useVoiceActionsOptional(): VoiceCtx | null {
  return useContext(Ctx);
}

/** Register a screen-level action (for controls that are not <BigButton/>). */
export function useVoiceAction(
  id: string,
  label: string,
  run: (() => void) | undefined,
  disabled = false,
) {
  const voice = useVoiceActionsOptional();
  const latest = useRef({ run, label, disabled });
  latest.current = { run, label, disabled };
  React.useEffect(() => {
    if (!voice || !run) return;
    return voice.register({
      id,
      label,
      disabled,
      run: () => latest.current.run?.(),
    });
  }, [voice, id, label, disabled, run]);
}

export function numberWords(): Record<string, number> {
  return NUMBER_WORDS;
}
