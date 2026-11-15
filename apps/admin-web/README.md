# AccessAble Admin (apps/admin-web)

Institution dashboard for AccessAble AI: live SOS queue, accessibility reports, campus map, roles, settings.
React + Vite + TypeScript (strict) + Tailwind + react-router + supabase-js v2. It follows `docs/CONTRACT.md`.

## Setup

```bash
cd apps/admin-web
cp .env.example .env      # then fill in the three values
npm install
npm run dev               # http://localhost:5173
```

| Variable | What it is |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL (Project settings, API) |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon (public) key. Never put the service-role key here |
| `VITE_API_URL` | FastAPI base URL on Render, no trailing slash |

If `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY` is missing the app shows a setup screen instead of a fake backend.
If `VITE_API_URL` is missing everything works except route preview and the API status light.

Demo staff accounts (from CONTRACT section 5): `admin@accessable.demo`, `responder@accessable.demo`,
`maintenance@accessable.demo`, `mapeditor@accessable.demo`, all with password `Demo@12345`.

## Build

```bash
npm run build      # tsc --noEmit (strict) + vite build -> dist/
npm run preview    # serve dist/ locally
```

## Deploy to Vercel

1. Push the repo to GitHub.
2. In Vercel: Add New, Project, import the repo.
3. Set **Root Directory** to `apps/admin-web`. Framework preset: Vite (build `npm run build`, output `dist`).
4. Under Environment Variables add `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL`.
5. Deploy. `vercel.json` rewrites every path to `index.html` so deep links such as `/emergency` work.
6. Add the Vercel URL to `CORS_ORIGINS` of the FastAPI service (needed for `/health` and route preview), and to
   the Supabase Auth allowed URLs if you use email links.

## Who sees what

| Role | Pages |
|---|---|
| `admin` | Everything, including Users & Roles |
| `responder` | Overview, Emergency, Map (read-only), Settings |
| `maintenance` | Overview, Reports, Map (read-only), Settings |
| `map_editor` | Overview, Reports (can verify + block corridors), Map (edit), Settings |
| no role | "This dashboard is for campus staff." and a sign-out button |

Roles come from `role_assignments` for the signed-in user. The database (RLS and RPC checks) is the real
gatekeeper; the UI only hides what a role cannot do. The assignee pickers use the `list_staff` RPC, so any staff role
can see the other staff it may assign.

## Alert sound: why a click is needed

Browsers refuse to play audio until the user has interacted with the page (autoplay policy). The tone is generated
with the Web Audio API (no audio files). Until someone presses **Enable sound alerts** (top bar, SOS banner and the
Emergency page) the browser keeps the audio context suspended, so the dashboard says so and shows the red banner,
flashes the tab title and announces the alert to screen readers anyway. After unlocking, a repeating three-note tone
plays while any alert is `triggered` (faster and louder once it has been unacknowledged for 2 minutes) and stops when it is acknowledged or when you press the mute toggle (the choice
is remembered in the browser). Browser notifications are only requested when you press the button, never on load.
After a page reload, sound must be enabled again.

## How live updates work

The dashboard subscribes to Supabase Realtime `postgres_changes` on `emergency_alerts` (filtered by institution)
and `emergency_events`, refetches on any change, and also polls every 15 s. The top bar says **Live** only when the
realtime channel is subscribed and the last poll worked; otherwise **Reconnecting...**. The map subscribes to
`route_edges` so blocked corridors appear live. The SOS loop never calls FastAPI.

A keep-alive `GET /health` to `VITE_API_URL` runs every 10 minutes while any dashboard tab is open (Render free
tier sleeps after 15 minutes). The top bar shows "API waking up..." if the request takes over 3 seconds.

## Honest limits

- Alerts reach people only while a dashboard tab is open. SMS and push are not configured (see Settings).
- The map is a placeholder derived from one photo until verified on site.
- Test mode is read-only in the UI; change `institutions.test_mode_only` in the database.
