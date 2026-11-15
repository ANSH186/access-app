import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';
import { SUPABASE_ANON_KEY, SUPABASE_URL, envOk } from './env';

// When env is missing the setup screen is shown and the client is never used;
// placeholder values just keep createClient from throwing at import time.
export const supabase = createClient(
  envOk ? SUPABASE_URL : 'https://placeholder.invalid',
  envOk ? SUPABASE_ANON_KEY : 'placeholder',
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  },
);

if (envOk) {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
