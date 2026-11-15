# AccessAble AI — mobile app (Expo)

Voice-first app for blind and low-vision students: campus navigation over a mapped building, sign reading,
scene description, obstacle reports and SOS. Expo SDK 58, TypeScript (strict), expo-router. Runs in **Expo Go**
on Android (no custom native modules). **TEST MODE** is shown on every screen.

## Install

```bash
cd apps/mobile
npm install
cp .env.example .env     # then edit
```

`.env` (see `.env.example`):

| variable | value |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon (public) key |
| `EXPO_PUBLIC_API_URL` | FastAPI base URL, e.g. `https://accessable-api.onrender.com` (no trailing slash) |

If any value is missing the app shows a setup screen naming it.

## Run

```bash
npx expo start -c        # -c clears the cache after changing .env
```

Scan the QR code with Expo Go on the phone. The phone does not need to be on the same Wi-Fi as the API (it is on
Render), but it does need to reach the Metro dev server (same Wi-Fi, or `npx expo start --tunnel`).
Checks: `npx tsc --noEmit`, `npx expo export --platform android`.

Demo accounts (CONTRACT §5): `student@accessable.demo` / `Demo@12345`.

## Demo walkthrough (handoff §11)

1. Sign in as the student. Home shows "Location not confirmed — scan a checkpoint".
2. Scan the ground-floor lift QR (`AA-CP-G-LIFT`), or Navigate > "Demo: I'm at the ground-floor lift checkpoint".
   The location line becomes "Last confirmed: Ground floor, near the lift — just now".
3. Hold the big button and say "Take me to the library" (or use Tap to talk / type it). The route is read aloud,
   one instruction per screen: Next / Repeat / Previous / Stop. Steps ending at a QR show "Scan checkpoint".
4. Read sign: point at a room sign, Take photo; the text is spoken and shown large. Use "Ask about this".
5. On the dashboard (or via another account) report and verify a blocked corridor on the route
   (`LB-2-N1__LB-2-N2`). The app speaks "A corridor on your route was just reported blocked. New route: …".
6. Press SOS, leave the type empty or pick one, press **Send SOS** (test mode). The status screen speaks
   "Alert sent. Waiting for campus staff to respond. Help is not confirmed yet." and updates live as the
   responder acknowledges, responds and resolves. Cancel alert is on the same screen.
7. Failure demo: turn on airplane mode and press Send SOS. After retries the full-screen
   "Your alert was NOT sent" appears with Call 112 / Call my emergency contact / Try again.

## TalkBack tips

- Holding a button is awkward with TalkBack: use **Tap to talk** (tap, speak, tap again) instead of Hold to talk.
- Every control has a label and hint; status text is a live region so changes are announced.
- The red SOS button is always at the bottom of the screen. It only opens a confirmation screen;
  nothing is sent until you double-tap **Send SOS**.
- If the speech engine is silent, check Android Settings > Text-to-speech output.

## Known limitations

- Expo Go only: no background location, no push notifications, no wake-word. Voice commands are recorded clips sent
  to the server, so **voice needs the server and internet**. Typed commands and all buttons also need the server for
  routing; SOS, reports and checkpoint resolution go straight to Supabase.
- The first server request after idle can take up to a minute (Render free tier). The app says so after 5 s.
- QR aiming is hard without sight. The scanner vibrates when a code enters view, and there is a
  "I can't scan — choose my location" list (recorded as `staff_confirmed`, spoken as less certain).
- Location is only "last confirmed checkpoint"; the app never claims live position. Arrival is never stated as certain.
- The map is a placeholder derived from one photo. Lift position is unverified.
- Emergency calls open the dialer (`tel:`); the user must press call. SOS needs internet; when it fails the
  app says so loudly and offers the phone calls.
- Speech uses the phone's text-to-speech voice; English only.
