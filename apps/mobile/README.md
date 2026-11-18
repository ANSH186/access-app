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
- **Document and book reader.** Take one photo per page. Every line is read
  aloud, pages are kept on the phone, and you can move between pages, read all
  pages, delete pages, or ask questions about the current page or the whole
  document.
- **Continuous scene description.** The camera stays on and describes people,
  walls, doors, barriers, steps, vehicles, trees, furniture, signs, the ground
  and the sky every few seconds. It pauses while speaking.
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

## Run the installed Android app (needed for hands-free voice)

`npx expo run:android` needs an Android SDK, the matching NDK and Build-Tools,
and either a USB-connected phone or a running emulator.

This project must live at a **short path** because Windows still enforces a
260-character path limit for some native modules (`react-native-worklets` fails
with `mkdir ... No such file or directory` otherwise). On this machine it is at:

```text
C:\dev\accessable-ai
```

The Android SDK must be at a path **without spaces**, otherwise the C++ linker
fails with `undefined symbol: std::__ndk1...`:

```text
C:\Android\Sdk
```

The project currently uses:

```text
compileSdk 37
targetSdk  36
buildTools 37.0.0
NDK        27.1.12297006
```

Install the missing SDK parts in **Android Studio → SDK Manager → SDK Tools**
(enable “Show Package Details”):

- Android SDK Build-Tools **37.0.0**
- NDK (Side by side) **27.1.12297006**
- CMake if the SDK Manager offers it

Or, with `sdkmanager`:

```powershell
sdkmanager "build-tools;37.0.0" "ndk;27.1.12297006"
```

On this machine the Android SDK is installed at a path **without spaces**:

```text
C:\Android\Sdk
```

Set these in a **new** PowerShell window (or permanently in Windows Environment
Variables):

```powershell
$sdk = "C:\Android\Sdk"
$jdk = "C:\Program Files\Eclipse Adoptium\jdk-17.0.21.9-hotspot"
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
$env:JAVA_HOME = $jdk
$env:JAVA_TOOL_OPTIONS = "-Djava.net.preferIPv4Stack=true"
$env:Path = "$sdk\platform-tools;$sdk\emulator;$sdk\cmdline-tools\latest\bin;$jdk\bin;$env:Path"
```

Connect a phone with USB debugging enabled, or start the existing emulator:

```powershell
emulator -avd Medium_Phone_API_37.0
```

If `adb devices` says `offline`, reset it:

```powershell
adb kill-server
adb start-server
adb devices
```

Then build and install:

```powershell
cd C:\dev\accessable-ai\apps\mobile
npx expo run:android --device emulator-5554
```

For a real phone, use the id printed by `adb devices`.

> **Path rules:** keep the project at a short path (the current
> `C:\dev\accessable-ai` works) and keep the Android SDK/NDK at a path without
> spaces (`C:\Android\Sdk`). If either path changes, run
> `npx expo prebuild --clean` before building again, or use the EAS build below.

### Windows native build notes

- `plugins/with-cmake-object-path-max.js` adds
  `-DCMAKE_OBJECT_PATH_MAX=250` to the generated `android/app/build.gradle`.
  Without it, Ninja fails on gesture-handler codegen paths longer than 260
  characters.
- `react-native-reanimated` and `react-native-worklets` were removed. The app
  never imports them and Expo Router treats them as optional peers. Their C++
  source trees are the deepest in `node_modules` and hit the same Windows path
  limit. If you later need Reanimated, use the EAS cloud build or enable
  Windows long paths.

### Build an APK without Android Studio, NDK or USB

This is the quickest route for hands-free voice:

```powershell
npx eas-cli@latest login
npx eas-cli@latest build:configure
npx eas-cli@latest build --profile preview --platform android
```

Download the APK from the link EAS prints, copy it to the phone and install it.
`eas.json` already has a `preview` APK profile with the public Supabase/API
values baked in. EAS does the Android build in the cloud, so no local NDK is
needed.

`npx expo-doctor` needs access to `exp.host`. If it times out, the project is
still fine; retry on a stable network, or run:

```powershell
$env:NODE_OPTIONS="--dns-result-order=ipv4first"
npx expo-doctor
```

`npx tsc --noEmit` and `npx expo export --platform android` are the offline
checks.

## Hands-free voice — how to use it

1. Install AccessAble as a development or production build. Continuous
   on-device speech recognition does **not** run in Expo Go.
2. Open **More options → Hands-free voice** (or Settings → How to use
   hands-free voice).
3. Turn **Hands-free voice mode** on.
4. Wait until AccessAble finishes speaking, then say a command:
   - “Take me to the library”
   - “Where am I”
   - “Read this sign”
   - “Read a document or book”
   - “Continuous scene”
   - “Press two” (to activate the second button on the screen)
   - “Help”
5. Wait for the answer to finish, then speak your next command.
6. Say **“Stop listening”** to turn hands-free off.

In Expo Go, use the **Talk** button at the bottom; it records a clip and sends
it to the server for transcription.

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
