export const SUPABASE_URL = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim();
export const SUPABASE_ANON_KEY = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? '').trim().replace(/\/+$/, '');

export const missingEnv: string[] = [
  ...(SUPABASE_URL ? [] : ['EXPO_PUBLIC_SUPABASE_URL']),
  ...(SUPABASE_ANON_KEY ? [] : ['EXPO_PUBLIC_SUPABASE_ANON_KEY']),
  ...(API_URL ? [] : ['EXPO_PUBLIC_API_URL']),
];
export const envOk = missingEnv.length === 0;
