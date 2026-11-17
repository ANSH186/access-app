import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from './env';

const KEY = 'aa.apiBaseUrl';
let cached: string | null = null;

export const DEFAULT_API_URL = API_URL;

export async function getServerUrl(): Promise<string> {
  if (cached != null) return cached;
  try {
    const saved = (await AsyncStorage.getItem(KEY))?.trim();
    cached = (saved || DEFAULT_API_URL).replace(/\/+$/, '');
  } catch {
    cached = DEFAULT_API_URL.replace(/\/+$/, '');
  }
  return cached ?? DEFAULT_API_URL.replace(/\/+$/, '');
}

export async function setServerUrl(url: string): Promise<string> {
  const clean = url.trim().replace(/\/+$/, '');
  cached = clean || DEFAULT_API_URL.replace(/\/+$/, '');
  try {
    if (clean) await AsyncStorage.setItem(KEY, clean);
    else await AsyncStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  return cached ?? DEFAULT_API_URL.replace(/\/+$/, '');
}

export async function resetServerUrl(): Promise<string> {
  cached = DEFAULT_API_URL.replace(/\/+$/, '');
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  return cached ?? DEFAULT_API_URL.replace(/\/+$/, '');
}
