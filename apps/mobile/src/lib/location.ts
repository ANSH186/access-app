import * as Location from 'expo-location';

export type MyCoords = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  timestamp: number;
};

export type MyAddress = {
  short: string;
  street: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  formatted: string | null;
};

export async function ensureLocationPermission(): Promise<{ granted: boolean; canAskAgain: boolean }> {
  const current = await Location.getForegroundPermissionsAsync();
  if (current.granted) return { granted: true, canAskAgain: true };
  if (!current.canAskAgain) return { granted: false, canAskAgain: false };
  const asked = await Location.requestForegroundPermissionsAsync();
  return { granted: asked.granted, canAskAgain: asked.canAskAgain };
}

export async function getMyLocation(): Promise<MyCoords | null> {
  const services = await Location.hasServicesEnabledAsync().catch(() => false);
  if (!services) return null;
  const last = await Location.getLastKnownPositionAsync({ maxAge: 120_000 }).catch(() => null);
  const pos =
    last ??
    (await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
      mayShowUserSettingsDialog: true,
    }).catch(() => null));
  if (!pos) return null;
  return {
    latitude: pos.coords.latitude,
    longitude: pos.coords.longitude,
    accuracy: pos.coords.accuracy ?? null,
    heading: pos.coords.heading ?? null,
    speed: pos.coords.speed ?? null,
    timestamp: pos.timestamp,
  };
}

export async function reverseGeocode(coords: MyCoords): Promise<MyAddress | null> {
  try {
    const rows = await Location.reverseGeocodeAsync({
      latitude: coords.latitude,
      longitude: coords.longitude,
    });
    const a = rows[0];
    if (!a) return null;
    const parts = [a.name, a.street, a.district, a.city, a.region].filter(Boolean) as string[];
    return {
      short: parts.slice(0, 3).join(', ') || 'an unnamed place',
      street: a.street ?? null,
      district: a.district ?? null,
      city: a.city ?? null,
      state: a.region ?? null,
      country: a.country ?? null,
      formatted: a.formattedAddress ?? null,
    };
  } catch {
    return null;
  }
}

export function accuracyText(accuracy: number | null): string {
  if (accuracy == null) return 'accuracy unknown';
  if (accuracy <= 10) return 'accurate to about 10 metres';
  if (accuracy <= 30) return `accurate to about ${Math.round(accuracy)} metres`;
  if (accuracy <= 100) return 'not very accurate, within about 100 metres';
  return 'very approximate, possibly more than 100 metres off';
}

export function watchMyLocation(cb: (coords: MyCoords) => void): { remove: () => void } | null {
  let sub: Location.LocationSubscription | null = null;
  let cancelled = false;
  Location.watchPositionAsync(
    { accuracy: Location.Accuracy.High, distanceInterval: 5, timeInterval: 4000 },
    (pos) => {
      if (cancelled) return;
      cb({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy ?? null,
        heading: pos.coords.heading ?? null,
        speed: pos.coords.speed ?? null,
        timestamp: pos.timestamp,
      });
    },
  )
    .then((s) => {
      if (cancelled) s.remove();
      else sub = s;
    })
    .catch(() => undefined);
  return {
    remove: () => {
      cancelled = true;
      sub?.remove();
    },
  };
}
