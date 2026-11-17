import type { Session } from '@supabase/supabase-js';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { setSpeechRate } from '../lib/speech';
import { supabase } from '../lib/supabase';
import {
  loadLocation,
  loadHandsFree,
  saveHandsFree,
  saveLocation,
  takePendingProfile,
} from '../lib/storage';
import { ACTIVE_ALERT_STATUSES, type ConfirmedLocation, type EmergencyAlert, type Profile } from '../lib/types';

type AppState = {
  ready: boolean;
  session: Session | null;
  profile: Profile | null;
  location: ConfirmedLocation | null;
  activeAlert: EmergencyAlert | null;
  reduceMotion: boolean;
  handsFree: boolean;
  setLocation: (loc: ConfirmedLocation | null) => void;
  setHandsFree: (v: boolean) => void;
  updateProfile: (patch: Partial<Profile>) => Promise<string | null>;
  refreshProfile: () => Promise<void>;
  refreshActiveAlert: () => Promise<EmergencyAlert | null>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [location, setLocationState] = useState<ConfirmedLocation | null>(null);
  const [activeAlert, setActiveAlert] = useState<EmergencyAlert | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [handsFree, setHandsFreeState] = useState(false);
  const sessionRef = useRef<Session | null>(null);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    let mounted = true;
    loadLocation().then((l) => mounted && l && setLocationState(l));
    loadHandsFree().then((v) => mounted && setHandsFreeState(v));
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      sessionRef.current = data.session;
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      sessionRef.current = s;
      setSession(s);
      if (!s) {
        setProfile(null);
        setActiveAlert(null);
      }
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const refreshProfile = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return;
    const { data } = await supabase.from('profiles').select('*').eq('id', s.user.id).maybeSingle();
    if (data) {
      // Apply fields captured at sign-up if email confirmation delayed the first update.
      const pending = await takePendingProfile(s.user.email);
      if (pending) {
        const { data: updated } = await supabase
          .from('profiles')
          .update(pending)
          .eq('id', s.user.id)
          .select('*')
          .maybeSingle();
        if (updated) {
          setProfile(updated as Profile);
          setSpeechRate((updated as Profile).speech_rate ?? 1);
          return;
        }
      }
      setProfile(data as Profile);
      setSpeechRate((data as Profile).speech_rate ?? 1);
    }
  }, []);

  const refreshActiveAlert = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return null;
    const { data } = await supabase
      .from('emergency_alerts')
      .select('*')
      .eq('user_id', s.user.id)
      .in('status', ACTIVE_ALERT_STATUSES)
      .order('created_at', { ascending: false })
      .limit(1);
    const row = ((data ?? [])[0] as EmergencyAlert | undefined) ?? null;
    setActiveAlert(row);
    return row;
  }, []);

  useEffect(() => {
    if (session) {
      refreshProfile();
      refreshActiveAlert();
    }
  }, [session?.user.id, refreshProfile, refreshActiveAlert]);

  const setLocation = useCallback((loc: ConfirmedLocation | null) => {
    setLocationState(loc);
    saveLocation(loc);
  }, []);

  const setHandsFree = useCallback((v: boolean) => {
    setHandsFreeState(v);
    saveHandsFree(v);
  }, []);

  const updateProfile = useCallback(async (patch: Partial<Profile>) => {
    const s = sessionRef.current;
    if (!s) return 'You are not signed in.';
    const { data, error } = await supabase
      .from('profiles')
      .update(patch)
      .eq('id', s.user.id)
      .select('*')
      .maybeSingle();
    if (error) return error.message;
    if (data) setProfile(data as Profile);
    return null;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value = useMemo<AppState>(
    () => ({
      ready,
      session,
      profile,
      location,
      activeAlert,
      reduceMotion,
      handsFree,
      setLocation,
      setHandsFree,
      updateProfile,
      refreshProfile,
      refreshActiveAlert,
      signOut,
    }),
    [ready, session, profile, location, activeAlert, reduceMotion, handsFree, setLocation, setHandsFree, updateProfile, refreshProfile, refreshActiveAlert, signOut],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
