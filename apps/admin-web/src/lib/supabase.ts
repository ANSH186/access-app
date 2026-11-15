import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(url && key);

// When not configured the app shows the setup screen and never calls this client.
export const supabase = createClient(url || 'http://localhost:54321', key || 'not-configured', {
  auth: { persistSession: true, autoRefreshToken: true },
});

/** Turn any thrown value (Error, PostgrestError, string) into a sentence for the user. */
export function errMsg(e: unknown): string {
  if (!e) return 'Something went wrong.';
  if (typeof e === 'string') return e;
  if (typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
    return (e as { message: string }).message;
  }
  return 'Something went wrong.';
}
