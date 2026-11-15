# AccessAble AI — API (FastAPI)

Owns two things only: **route planning** (deterministic, NetworkX) and **Gemini calls** (OCR, scene description,
voice command). The SOS loop, reports and map edits never touch this service (see `docs/CONTRACT.md` section 0).

## Setup

```bash
cd services/api
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
cp .env.example .env                                   # then edit
```

## Environment variables

| Variable | Meaning |
|---|---|
| `SUPABASE_URL` | `https://<ref>.supabase.co`. Used to find the JWKS (`/auth/v1/.well-known/jwks.json`, cached 10 min). |
| `SUPABASE_JWT_SECRET` | Optional legacy HS256 secret. If set, HS256 tokens are verified with it; RS256/ES256 tokens always use JWKS. |
| `DATABASE_URL` | Supabase **session pooler** connection string (see below). Read-only use: floors, route_nodes, route_edges. |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Gemini REST. Model defaults to `gemini-flash-latest`. |
| `CORS_ORIGINS` | Comma list (admin dashboard origins). Empty = `*` in development, none in production. |
| `ENV` | `development` or `production`. |
| `DEV_AUTH` | `1` lets you send `X-Dev-User: <uuid>` instead of a JWT. **Ignored when `ENV=production`** (a warning is logged). |
| `MAP_SOURCE` | `db` (default) or `file:<path>` e.g. `file:../../data/sample-campus/lab_block.json` to run with no database. |

Extra optional knobs: `GEMINI_RETRY_DELAY_S` (2), `AI_RATE_LIMIT_CALLS` (20), `AI_RATE_LIMIT_WINDOW_S` (300),
`MAX_IMAGE_BYTES` (5 MB), `MAX_AUDIO_BYTES` (2 MB), `INSTITUTION_ID` (pilot id).

### Getting the Supabase session-pooler `DATABASE_URL`
Supabase dashboard > **Connect** > **Session pooler** (IPv4 compatible; the "Direct connection" is IPv6-only and
will not work from Render's free tier). Copy the URI, e.g.
`postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`, and put your database
password in. The app opens its pool with `statement_cache_size=0`, so the transaction pooler (port 6543) works too.

## Run

```bash
# local, no database, fake AI key:
DEV_AUTH=1 GEMINI_API_KEY=fake MAP_SOURCE=file:../../data/sample-campus/lab_block.json \
  uvicorn app.main:app --reload --port 8000
curl localhost:8000/health
```

## Test

```bash
pytest -q
```
No network needed: Gemini is mocked with `respx`, the map is injected via a FastAPI dependency override.
`tests/test_db_loader.py` is an optional integration test: it needs a local Postgres on host `/tmp`, port `54329`,
user `postgres` (it creates and drops a database called `aa_api_test`) and skips itself if none is running.
`tests/test_lab_block.py` runs against `data/sample-campus/lab_block.json` if it exists.

## Deploy on Render (free tier)

1. New > **Blueprint** and point it at the repo (uses `services/api/render.yaml`), or create a Web Service by hand:
   root directory `services/api`, build `pip install -r requirements.txt`,
   start `uvicorn app.main:app --host 0.0.0.0 --port $PORT`, health check path `/health`.
2. Set the secret env vars in the dashboard: `SUPABASE_URL`, `SUPABASE_JWT_SECRET` (optional), `DATABASE_URL`,
   `GEMINI_API_KEY`, `CORS_ORIGINS`. Leave `DEV_AUTH` unset.
3. **Cold starts:** the free tier sleeps after 15 minutes without traffic and needs about a minute to wake up.
   Before a demo, open `https://<service>.onrender.com/health` a couple of minutes early. The admin dashboard pings
   `/health` every 10 minutes while open; you can also add a free external pinger (for example UptimeRobot or
   cron-job.org, 10-minute interval) on `/health`. `/health` makes no database call.
4. The SOS loop does not depend on this server, so a sleeping API never blocks an emergency.

## Demo users

```bash
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service role key> \
  python scripts/seed_demo_users.py
```
Creates `student|admin|responder|maintenance|mapeditor@accessable.demo` (password `Demo@12345`) through the Auth
Admin API, then inserts `role_assignments` through PostgREST. Safe to re-run. Run it after the migrations (the
profile trigger and `role_assignments` table must exist). The service-role key is a secret: never commit it.

## Endpoints

All errors look like `{"error":{"code":"snake_case","message":"A sentence safe to speak aloud."}}`.
Everything except `/health` needs `Authorization: Bearer <supabase access token>` (or `X-Dev-User` in dev).

```bash
H='X-Dev-User: 11111111-1111-1111-1111-111111111111'     # dev only; otherwise -H "Authorization: Bearer $TOKEN"
API=http://localhost:8000

curl "$API/health"

curl -H "$H" "$API/v1/destinations/search?q=librery"

curl -H "$H" -H 'content-type: application/json' -X POST "$API/v1/routes/plan" \
  -d '{"from_node_id":"<uuid>","to_node_id":"<uuid>","avoid_stairs":false}'

curl -H "$H" -F image=@sign.jpg -F question="Which floor is this?" "$API/v1/ocr/read"
curl -H "$H" -F image=@hall.jpg "$API/v1/vision/describe"

curl -H "$H" -F text="take me to the library" "$API/v1/assistant/command"
curl -H "$H" -F audio=@command.m4a "$API/v1/assistant/command"
```

Status codes worth knowing: `401 unauthorized`, `404 node_not_found`, `413 file_too_large` (image 5 MB, audio 2 MB),
`415 unsupported_media_type`, `429 rate_limited` (20 AI calls per user per 5 min, with `Retry-After`),
`503 ai_busy` (Gemini 429 twice), `503 ai_unavailable`, `503 map_unavailable`, `504 ai_timeout`.

## Behaviour notes

* **Routing**: stairs edges cost length x 2, lift edges cost length + 20 (+0.01 so an exact tie prefers stairs),
  blocked edges are excluded, `avoid_stairs` excludes every `step_free=false` edge. The map is loaded fresh on
  every request. If a blocked edge sat on the best route that ignores blocks, `explanation` and
  `blocked_edges_avoided` say so and how many metres longer the new route is.
* **Directions** are built only from node coordinates: wing names from the corridor ring bounds, courtyard side from
  the cross product with the ring's centre, turn words from heading changes. Straight corridor edges merge into one
  step, split at QR checkpoints. Steps starting at the entrance assume the user faces north.
* **AI** never decides routes and never creates alerts. The `sos` intent only returns a reply; the app shows its own
  confirm screen. Replies for commands are fixed sentences chosen in code, not generated text. A local keyword check
  (emergency, sos, ambulance, ...) also forces `sos` so a Gemini outage cannot hide it.
* Logs are JSON lines. Images, audio, tokens and keys are never logged.
