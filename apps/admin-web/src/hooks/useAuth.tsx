import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Institution, Profile, RoleAssignment, RoleName } from '../types';

interface AuthCtx {
  session: Session | null;
  userId: string | null;
  email: string | null;
  profile: Profile | null;
  institution: Institution | null;
  institutionId: string | null;
  roles: RoleName[];
  /** true until session AND roles have been resolved */
  loading: boolean;
  hasRole: (...r: RoleName[]) => boolean;
  signOut: () => Promise<void>;
  reloadInstitution: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [institution, setInstitution] = useState<Institution | null>(null);
  const [roleRows, setRoleRows] = useState<RoleAssignment[]>([]);
  const [rolesReady, setRolesReady] = useState(false);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id ?? null;

  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      setProfile(null);
      setInstitution(null);
      setRoleRows([]);
      setRolesReady(true);
      return;
    }
    setRolesReady(false);
    void (async () => {
      const [roles, prof] = await Promise.all([
        supabase.from('role_assignments').select('*').eq('user_id', userId),
        supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
      ]);
      if (cancelled) return;
      const rows = (roles.data ?? []) as RoleAssignment[];
      const p = (prof.data ?? null) as Profile | null;
      setRoleRows(rows);
      setProfile(p);
      const instId = rows[0]?.institution_id ?? p?.institution_id ?? null;
      if (instId) {
        const { data } = await supabase.from('institutions').select('*').eq('id', instId).maybeSingle();
        if (!cancelled) setInstitution((data ?? null) as Institution | null);
      }
      if (!cancelled) setRolesReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const instId = roleRows[0]?.institution_id ?? profile?.institution_id ?? null;
  const roles = useMemo(
    () => [...new Set(roleRows.filter((r) => r.institution_id === instId).map((r) => r.role))],
    [roleRows, instId],
  );

  const hasRole = useCallback((...r: RoleName[]) => r.some((x) => roles.includes(x)), [roles]);
  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);
  const reloadInstitution = useCallback(async () => {
    if (!instId) return;
    const { data } = await supabase.from('institutions').select('*').eq('id', instId).maybeSingle();
    setInstitution((data ?? null) as Institution | null);
  }, [instId]);

  const value: AuthCtx = {
    session,
    userId,
    email: session?.user.email ?? null,
    profile,
    institution,
    institutionId: instId,
    roles,
    loading: !sessionReady || !rolesReady,
    hasRole,
    signOut,
    reloadInstitution,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
