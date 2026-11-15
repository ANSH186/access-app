import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ConfirmedLocation } from './types';

const LOC_KEY = 'aa.confirmedLocation';
const PENDING_PROFILE_KEY = 'aa.pendingProfile';
const ALERT_KEY = 'aa.lastAlertId';

export async function loadLocation(): Promise<ConfirmedLocation | null> {
  try {
    const raw = await AsyncStorage.getItem(LOC_KEY);
    return raw ? (JSON.parse(raw) as ConfirmedLocation) : null;
  } catch {
    return null;
  }
}
export async function saveLocation(loc: ConfirmedLocation | null) {
  try {
    if (loc) await AsyncStorage.setItem(LOC_KEY, JSON.stringify(loc));
    else await AsyncStorage.removeItem(LOC_KEY);
  } catch {
    /* ignore */
  }
}

export async function savePendingProfile(userEmail: string, fields: Record<string, unknown>) {
  await AsyncStorage.setItem(PENDING_PROFILE_KEY, JSON.stringify({ email: userEmail.toLowerCase(), fields }));
}
export async function takePendingProfile(userEmail: string | undefined) {
  try {
    const raw = await AsyncStorage.getItem(PENDING_PROFILE_KEY);
    if (!raw || !userEmail) return null;
    const parsed = JSON.parse(raw) as { email: string; fields: Record<string, unknown> };
    if (parsed.email !== userEmail.toLowerCase()) return null;
    await AsyncStorage.removeItem(PENDING_PROFILE_KEY);
    return parsed.fields;
  } catch {
    return null;
  }
}

export async function saveLastAlertId(id: string | null) {
  try {
    if (id) await AsyncStorage.setItem(ALERT_KEY, id);
    else await AsyncStorage.removeItem(ALERT_KEY);
  } catch {
    /* ignore */
  }
}
export async function loadLastAlertId() {
  try {
    return await AsyncStorage.getItem(ALERT_KEY);
  } catch {
    return null;
  }
}
