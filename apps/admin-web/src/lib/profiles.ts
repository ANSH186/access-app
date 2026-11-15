import { supabase } from './supabase';
import type { Profile } from '../types';

const cache = new Map<string, Profile>();

/** Loads profiles not yet cached. Silently returns what RLS allows. */
export async function loadProfiles(ids: (string | null | undefined)[], force = false): Promise<Record<string, Profile>> {
  const want = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  const missing = force ? want : want.filter((id) => !cache.has(id));
  if (missing.length > 0) {
    const { data } = await supabase.from('profiles').select('*').in('id', missing);
    for (const p of (data ?? []) as Profile[]) cache.set(p.id, p);
  }
  const out: Record<string, Profile> = {};
  for (const id of want) {
    const p = cache.get(id);
    if (p) out[id] = p;
  }
  return out;
}

export function nameOf(profiles: Record<string, Profile>, id: string | null | undefined, fallback = 'Unknown user'): string {
  if (!id) return fallback;
  return profiles[id]?.display_name || fallback;
}
