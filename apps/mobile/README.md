# AccessAble AI — mobile app (Expo)

Voice-first app for blind and low-vision students: campus navigation, GPS location,
sign reading, general scene description, general news, obstacle reports and SOS.
Expo SDK 58, TypeScript (strict), expo-router. **TEST MODE** is shown on every
screen.

## Install and run

```bash
cd apps/mobile
npm install
cp .env.example .env     # then edit
npx expo start -c
```

`.env` (see `.env.example`):

| variable | value |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase publishable/anon key |
| `EXPO_PUBLIC_API_URL` | FastAPI base URL, e.g. `https://accessable-ai-api.onrender.com` (no trailing slash) |

The server address can also be changed at runtime in **Settings → Server
connection**, then checked with **Test server connection**.

## What is new in this version

- **Talk bar on every screen.** Press it and speak. Say “press one”, “press two”,
  a button name, “help”, “take me to the library”, “where am I”, “read this sign”,
  “describe the scene”, “news”, “next”, “previous”, “repeat”, or “stop”.
- **Hands-free mode** in Settings. It listens again after the app stops speaking.
  This needs an installed development/production build because the on-device
  recognizer (`expo-speech-recognition`) is a native module. In Expo Go the app
  falls back to recording a clip and sending it to the server.
- **Offline-safe navigation.** The Lab Block and NIE North Campus graphs are
  bundled. The app reads live edge statuses from Supabase when it can, caches
  them, and falls back to the bundled graph. The server API is used for AI, news
  and location context; routing itself is deterministic and local.
- **NIE North Campus** outdoor map, QR checkpoints and GPS auto-advance.
- **GPS Where am I** with nearest landmarks, GPS accuracy, Photon/OSM reverse
  geocoding and an optional AI place description.
- **News** with AI briefing, categories, story-by-story reading and “ask about
  this story”.
- **General scene description** with location context, plus “Tell me about this
  place”.
- **Server health banner** and a real connection/AI/map diagnostic in Settings.
- **Demo sign-in** button on the auth screen.

## Checks

```bash
npx tsc --noEmit
npx expo export --platform android
```

Demo account: `student@accessable.demo` / `Demo@12345` (or press “Sign in as demo
student”).

## TalkBack tips

- Every control has a label and hint; status changes use live regions and are
  also spoken by the app's own text-to-speech.
- The red SOS button is always at the bottom. It only opens a confirmation
  screen; nothing is sent until you double-tap **Send SOS**.
- If the speech engine is silent, check Android Settings > Text-to-speech output.
- “Read this screen” in Settings and on the Voice help screen lists the current
  actions and the number trick.

## Known limitations

- **Hands-free voice** needs an installed build; Expo Go can record-and-send but
  cannot run continuous on-device recognition.
- The NIE North Campus layout is a **schematic traced from satellite imagery**
  and is not verified on site. All campus nodes are marked unverified.
- GPS is approximate, especially indoors and between buildings. The app says the
  accuracy. Automatic step advancement only runs outdoors.
- The first Render request after idle can take up to a minute. The app says so
  after 5 seconds.
- QR aiming is hard without sight. The scanner vibrates when a code enters view,
  and there is a “choose my location” list. Campus QR tokens resolve from the
  bundled map even if they are not in the database.
- Location is the last confirmed checkpoint or a GPS estimate; the app never
  claims continuous indoor positioning. Arrival is never stated as certain.
- Emergency calls open the dialer (`tel:`); the user must press call. SOS needs
  internet; when it fails the app says so loudly and offers the phone calls.
- Speech is English only for now.
