# AccessAble AI

A voice-first assistive app for blind and low-vision students on a college
campus. It gives spoken navigation, reads signs, describes any scene, tells you
where you are, reads general news with an AI briefing, files accessibility
reports, and has a test-mode **SOS** with honest live status.

```
phone app ──► Supabase (DB · Auth · Realtime · Storage) ◄── dashboard
    └────────► FastAPI on Render (maps + Gemini AI + news) ◄──┘
SOS: phone → database function → realtime → dashboard   (never through the API server)
```

## What works now

- **Voice control everywhere.** The Talk bar at the bottom of every screen takes
  a spoken command. You can also say **“press one”**, **“press two”**, or a
  button's name to activate it. Hands-free mode listens again after the reply
  (best in an installed build; Expo Go falls back to recording + server
  transcription).
- **Navigation that survives outages.** The Lab Block and NIE North Campus
  graphs are bundled in the app. It reads the live map from Supabase when
  available and falls back to a cached/bundled graph, so “take me to the library”
  still plans a route when the API or database is down.
- **NIE North Campus.** Outdoor graph + own schematic map + optional SQL
  seed. See `docs/NIE_NORTH_CAMPUS.md`. The layout is a
  schematic and is **not yet verified on site**.
- **GPS “Where am I”.** Uses phone GPS, campus graph matching, Photon/OSM
  reverse geocoding, nearest landmarks, and an optional AI place description.
- **Read sign / describe scene.** Camera uploads use `expo/fetch` + `File`
  (reliable on the New Architecture). Scene descriptions are general-purpose,
  with location context supplied when available. A 45-second server AI timeout
  and a 50–75 second client timeout cover slow cold starts.
- **News updates.** India + world + science RSS feeds from The Hindu, BBC, NDTV,
  Al Jazeera and Indian Express, mixed so one feed cannot crowd out the others.
  An AI briefing summarises the top stories without inventing facts. The phone
  also has a direct RSS fallback and a saved-headlines cache.
- **Accessibility.** Large 72 px targets, high contrast, spoken status, live
  regions, haptics, reduced-motion support, speech-rate control, screen-reader
  hints, a “Read this screen” action, and a one-tap demo sign-in.

## Repository layout

```
apps/mobile/           Expo/React Native assistive app
apps/admin-web/        Staff dashboard (emergency, reports, map, roles, audit)
services/api/          FastAPI: maps, routing, Gemini OCR/vision, news, location
data/campus/           NIE North Campus generator + schematic/annotated images
data/sample-campus/    Lab Block placeholder building map
supabase/              Migrations, seed, SQL tests, campus seed
docs/                  Deployment, contract, demo script, campus map notes
```

## Start here

1. `docs/DEPLOY.md` — set up Supabase, Render and the phone app on free tiers.
2. `docs/NIE_NORTH_CAMPUS.md` — what is mapped, what is still a schematic, and
   how to verify it.
3. `docs/DEMO_SCRIPT.md` — the 6-minute TechExpo story.
4. `docs/CONTRACT.md` — tables, functions and API shapes.

## Environment

`apps/mobile/.env`:

```env
EXPO_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=YOUR-PUBLISHABLE-KEY
EXPO_PUBLIC_API_URL=https://YOUR-SERVICE.onrender.com
```

`services/api/.env` (see `.env.example`):

```env
ENV=development
DEV_AUTH=1
SUPABASE_URL=https://YOUR-PROJECT.supabase.co
DATABASE_URL=                 # optional; REST fallback works without it
GEMINI_API_KEY=               # required for OCR, vision, voice and news briefing
GEMINI_MODEL=gemini-flash-lite-latest
GEMINI_FALLBACK_MODELS=gemini-3.1-flash-lite,gemini-3.8-flash,gemini-flash-latest
CAMPUS_MAP_ENABLED=1
CAMPUS_MAP_PATH=app/data/nie_north_campus.json
MAP_SOURCE=db                 # or file:../../data/sample-campus/lab_block.json
CORS_ORIGINS=*
```

The phone's **Settings → Server connection** can override the server URL at
runtime and run a health/map/AI check. This is useful when testing a local API
tunnel.

## Tests

| What | Command | Status |
|---|---|---|
| API (routing, directions, search, AI mocked, auth, news parser) | `cd services/api && pytest -q` | 67 pass, 2 skip |
| Phone app type-check | `cd apps/mobile && npx tsc --noEmit` | pass |
| Phone app Android bundle | `cd apps/mobile && npx expo export --platform android` | pass |
| Dashboard build | `cd apps/admin-web && npm run build` | see below |
| Map validity | `python data/sample-campus/validate_map.py` | pass |
| Database suites | `supabase/tests/run_tests.sh` (needs Postgres) | 8 suites |

## Safety statement

AccessAble is **not an emergency service** and does not guarantee rescue. In this
pilot, alerts reach staff only through the dashboard (no SMS or phone escalation
yet). The app always offers direct calls to 112 and the user's emergency contact.
Test mode is forced on at the institution level. Location is the last *confirmed*
checkpoint or a GPS estimate with accuracy, never an estimate presented as fact.
Navigation uses a graph and QR checkpoints/GPS, not continuous indoor
positioning, and cannot detect obstacles. The NIE North Campus layout is a
schematic traced from satellite imagery until verified on site.
