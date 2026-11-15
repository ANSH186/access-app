# AccessAble AI

A voice-first assistive platform for blind and low-vision students on a college campus:

- **AccessAble Assist** (`apps/mobile`): an Expo app that takes voice commands, gives step-by-step spoken navigation
  over a mapped building, reads signs, describes scenes, uses QR checkpoints to confirm position, files obstacle
  reports, and has a test-mode **SOS** with honest live status.
- **AccessAble Institutions** (`apps/admin-web`): a staff dashboard with live **Emergency Management**, report
  verification, map editing, roles and an audit trail.
- **API** (`services/api`): FastAPI for deterministic route planning (NetworkX) and Gemini Flash for
  OCR, scene description and voice-command understanding.
- **Database** (`supabase/`): Postgres with row-level security, emergency/report state machines as database
  functions, an append-only event log, and Realtime.
- **Map** (`data/sample-campus`): a G+3 lab block around a courtyard, built from one photo. It is a **placeholder
  until verified on site**.

```
phone app ──► Supabase (DB · Auth · Realtime · Storage) ◄── dashboard
    └────────► FastAPI on Render (routes + Gemini) ◄────────┘
SOS: phone → database function → realtime → dashboard   (never through the API server)
```

## Start here
1. `docs/DEPLOY.md`: set everything up on free tiers, step by step.
2. `docs/DEMO_SCRIPT.md`: the 6-minute TechExpo story.
3. `docs/CONTRACT.md`: the exact tables, functions and API shapes every part follows.
4. `docs/project-handoff.md`: the original product brief.

## Tests

| What | Command | Status at handoff |
|---|---|---|
| Database (RLS, SOS + report state machines, privacy, append-only log) | `supabase/tests/run_tests.sh` (needs a local Postgres) | 8 suites pass |
| API (routing, directions, search, AI endpoints with Gemini mocked, auth) | `cd services/api && pytest -q` | 69 pass |
| End-to-end demo flow (real migrations + seed + running API) | `supabase/tests/e2e_demo_flow.py` | pass |
| Map validity | `python3 data/sample-campus/validate_map.py` | pass |
| Dashboard | `cd apps/admin-web && npm run build` | type-checks and builds |
| Phone app | `cd apps/mobile && npx tsc --noEmit` | type-checks; Android bundle builds |

## Not verified yet (needs real accounts or a real phone)
- The dashboard and app have never run against a live Supabase project, been opened in a browser, or been installed on a phone.
- Gemini behaviour with a real key (the request format follows the REST docs; responses are mocked in tests).
- Expo Go behaviour of recording, camera, QR scanning and TalkBack on a real Android phone.
- Supabase Storage policies (tested against a stand-in for Supabase's storage schema).

## Safety statement
AccessAble is **not an emergency service** and does not guarantee rescue. In this pilot, alerts reach staff only
through the dashboard (no SMS or phone escalation yet). The app always offers direct calls to 112 and the user's
emergency contact. Test mode is forced on at the institution level. Location is the last *confirmed* checkpoint
with its age, never an estimate presented as fact. Navigation uses QR checkpoints, not continuous positioning, and
cannot detect obstacles.
