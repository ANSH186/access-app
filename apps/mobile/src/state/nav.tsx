import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, errorToSpeech } from '../lib/api';
import { haptic } from '../lib/haptics';
import { clearLastInstruction, speak } from '../lib/speech';
import { supabase } from '../lib/supabase';
import type { ConfirmedLocation, RoutePlan, RouteStep } from '../lib/types';
import { useApp } from './app';

export type Destination = { node_id: string; label: string };
export type NavStatus = 'idle' | 'planning' | 'active' | 'arrived' | 'noroute' | 'error';

type NavState = {
  dest: Destination | null;
  plan: RoutePlan | null;
  stepIndex: number;
  status: NavStatus;
  /** Explanation + warnings, shown on screen above the first step of a (re)planned route. */
  notice: string | null;
  message: string | null;
};

type NavApi = NavState & {
  /** Choose a destination; plans immediately if `fromNodeId` is given. */
  selectDestination: (dest: Destination, fromNodeId?: string) => Promise<void>;
  planFromLocation: (loc: ConfirmedLocation) => Promise<void>;
  next: () => void;
  prev: () => void;
  repeat: () => void;
  stop: (silent?: boolean) => void;
  /** Called after a checkpoint is confirmed. Returns extra text to speak (or null). */
  onCheckpoint: (loc: ConfirmedLocation) => Promise<string | null>;
  currentStep: RouteStep | null;
};

const initial: NavState = { dest: null, plan: null, stepIndex: 0, status: 'idle', notice: null, message: null };
const Ctx = createContext<NavApi | null>(null);

export function useNav(): NavApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useNav outside NavProvider');
  return v;
}

function stepSpeech(plan: RoutePlan, i: number): string {
  const steps = plan.steps ?? [];
  const s = steps[i];
  if (!s) return '';
  let t = `Step ${i + 1} of ${steps.length}. ${s.instruction}`;
  if (s.checkpoint_qr && !/checkpoint/i.test(s.instruction)) {
    t += ' You can scan the checkpoint here to confirm where you are.';
  }
  return t;
}

export function NavProvider({ children }: { children: React.ReactNode }) {
  const { profile, location } = useApp();
  const [state, setState] = useState<NavState>(initial);
  const ref = useRef<NavState>(initial);
  const locRef = useRef<ConfirmedLocation | null>(location);
  const avoidRef = useRef(false);
  const planningRef = useRef(false);

  useEffect(() => {
    locRef.current = location;
  }, [location]);
  useEffect(() => {
    avoidRef.current = !!profile?.avoid_stairs;
  }, [profile?.avoid_stairs]);

  const commit = useCallback((patch: Partial<NavState>) => {
    ref.current = { ...ref.current, ...patch };
    setState(ref.current);
  }, []);

  const arrive = useCallback(
    (plan: RoutePlan | null, destLabel: string | undefined, say = true) => {
      commit({ status: 'arrived', notice: null, message: null });
      haptic.success();
      const msg =
        plan?.arrival_message ||
        `You should be near ${destLabel ?? 'your destination'}. Check the sign or scan a checkpoint to be sure.`;
      if (say) speak(msg, { instruction: true });
      return msg;
    },
    [commit],
  );

  /** Plans from a node and speaks. Returns the spoken text. */
  const planFrom = useCallback(
    async (fromNodeId: string, prefix?: string, silent = false): Promise<string | null> => {
      const dest = ref.current.dest;
      if (!dest) return null;
      if (planningRef.current) return null;
      planningRef.current = true;
      commit({ status: 'planning', message: null });
      try {
        const plan = await api.planRoute({
          from_node_id: fromNodeId,
          to_node_id: dest.node_id,
          avoid_stairs: avoidRef.current,
        });
        if (!plan.found) {
          const msg =
            plan.explanation ||
            'I could not find a route right now. Try a different destination or scan a checkpoint.';
          commit({ plan: null, status: 'noroute', message: msg, notice: null, stepIndex: 0 });
          if (!silent) speak(msg);
          return msg;
        }
        const steps = plan.steps ?? [];
        const noticeParts = [plan.explanation, ...(plan.warnings ?? [])].filter(
          (x): x is string => !!x && x.trim().length > 0,
        );
        if (steps.length === 0) {
          commit({ plan, stepIndex: 0 });
          return arrive(plan, dest.label, !silent);
        }
        commit({
          plan,
          stepIndex: 0,
          status: 'active',
          notice: noticeParts.length ? noticeParts.join(' ') : null,
          message: null,
        });
        const text = [prefix, ...noticeParts, stepSpeech(plan, 0)].filter(Boolean).join(' ');
        if (!silent) speak(text, { instruction: true });
        return text;
      } catch (e) {
        const msg = errorToSpeech(e);
        commit({ status: 'error', message: msg });
        if (!silent) speak(msg);
        return msg;
      } finally {
        planningRef.current = false;
      }
    },
    [arrive, commit],
  );

  const selectDestination = useCallback(
    async (dest: Destination, fromNodeId?: string) => {
      clearLastInstruction();
      commit({ ...initial, dest });
      if (fromNodeId) await planFrom(fromNodeId, `Finding a route to ${dest.label}.`);
    },
    [commit, planFrom],
  );

  const planFromLocation = useCallback(
    async (loc: ConfirmedLocation) => {
      const d = ref.current.dest;
      if (!d) return;
      if (loc.node_id === d.node_id) {
        arrive(null, d.label);
        return;
      }
      await planFrom(loc.node_id, `Finding a route to ${d.label}.`);
    },
    [arrive, planFrom],
  );

  const goTo = useCallback(
    (i: number) => {
      const { plan, dest } = ref.current;
      const steps = plan?.steps ?? [];
      if (!plan) return;
      if (i >= steps.length) {
        arrive(plan, dest?.label);
        return;
      }
      const idx = Math.max(0, i);
      commit({ stepIndex: idx, notice: idx === 0 ? ref.current.notice : null, status: 'active' });
      haptic.tap();
      speak(stepSpeech(plan, idx), { instruction: true });
    },
    [arrive, commit],
  );

  const next = useCallback(() => goTo(ref.current.stepIndex + 1), [goTo]);
  const prev = useCallback(() => goTo(Math.max(0, ref.current.stepIndex - 1)), [goTo]);
  const repeat = useCallback(() => {
    const { plan, stepIndex, status, dest } = ref.current;
    if (status === 'arrived') {
      speak(plan?.arrival_message || `You should be near ${dest?.label ?? 'your destination'}.`);
    } else if (plan) {
      speak(stepSpeech(plan, stepIndex), { instruction: true });
    }
  }, []);

  const stop = useCallback(
    (silent?: boolean) => {
      const had = ref.current.dest !== null;
      ref.current = initial;
      setState(initial);
      clearLastInstruction();
      if (!silent) speak(had ? 'Navigation stopped.' : 'No navigation is running.');
    },
    [],
  );

  const onCheckpoint = useCallback(
    async (loc: ConfirmedLocation): Promise<string | null> => {
      const { plan, dest, status, stepIndex } = ref.current;
      if (!dest || (status !== 'active' && status !== 'planning')) return null;
      if (loc.node_id === dest.node_id) {
        return arrive(plan, dest.label, false);
      }
      const steps = plan?.steps ?? [];
      const hit = steps.findIndex((s) => s.to_node_id === loc.node_id);
      if (plan && hit >= 0) {
        // On the planned route: this checkpoint is the end of step `hit`.
        const nextIdx = hit + 1;
        if (nextIdx >= steps.length) return arrive(plan, dest.label, false);
        commit({ stepIndex: nextIdx, notice: null });
        const txt = stepSpeech(plan, nextIdx);
        return hit === stepIndex ? `You are on the right route. ${txt}` : `This is on your route. ${txt}`;
      }
      // Different checkpoint (or start of the route): re-plan from where the user really is.
      const out = await planFrom(loc.node_id, 'You are at a different checkpoint, so I planned a new route.', true);
      return out;
    },
    [arrive, commit, planFrom],
  );

  // Live reroute: when any edge on the current route becomes blocked, re-plan from the last confirmed node.
  const active = state.status === 'active' || state.status === 'planning';
  useEffect(() => {
    if (!active) return;
    const channel = supabase
      .channel('nav-route-edges')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'route_edges' }, (payload) => {
        const row = payload.new as { id?: string; status?: string };
        const cur = ref.current;
        if (row.status !== 'blocked' || !row.id) return;
        if (cur.status !== 'active' || !cur.plan?.edge_ids?.includes(row.id)) return;
        const from = locRef.current?.node_id ?? cur.plan.steps?.[0]?.from_node_id;
        if (!from) return;
        haptic.warning();
        planFrom(from, 'A corridor on your route was just reported blocked. New route:');
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [active, planFrom]);

  const value = useMemo<NavApi>(
    () => ({
      ...state,
      selectDestination,
      planFromLocation,
      next,
      prev,
      repeat,
      stop,
      onCheckpoint,
      currentStep: state.plan?.steps?.[state.stepIndex] ?? null,
    }),
    [state, selectDestination, planFromLocation, next, prev, repeat, stop, onCheckpoint],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

