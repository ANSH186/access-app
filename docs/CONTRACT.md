# AccessAble AI — Shared Build Contract (v1)

Every part of the codebase MUST follow this file exactly: table names, column names, function names,
argument names, API paths and JSON shapes. If something you need is missing, choose the smallest
addition, write it down in your final report under "Contract additions", and do not rename anything here.

Background product spec: `docs/project-handoff.md` (read sections 2–4 and 11). This contract overrides it
where they differ.

## 0. Architecture (decided)

```
Expo app (Expo Go, Android) ──supabase-js──► Supabase: Postgres + Auth + Realtime + Storage
        │                                          ▲
        └──HTTPS (Bearer = Supabase access token)──► FastAPI on Render (free tier, sleeps after 15 min)
                                                   │   - route planning (NetworkX)
React admin dashboard (Vercel) ──supabase-js──────►│   - Gemini Flash: OCR, scene description, voice command
        └──HTTPS──► FastAPI (route preview + /health keep-alive ping every 10 min)
```

Hard rules:
1. **The emergency (SOS) loop never touches FastAPI.** Create, cancel, acknowledge, assign, status, notes
   all go through Postgres functions (RPC) called with supabase-js; live updates use Supabase Realtime.
   Reason: the free Render server can take ~1 minute to wake up.
2. **Reports and map edits also go through Supabase** (table writes guarded by RLS, or RPC).
3. **FastAPI owns computation and secrets only:** routing and Gemini calls. The Gemini key never reaches clients.
4. Route choice is deterministic code. AI never decides routes.
5. Never claim help is coming until a human acknowledged. Never fabricate location. Test mode is on by default.
6. English only for v1.

Repo layout:
```
accessable-ai/
├── apps/mobile/          # Expo SDK (latest stable), TypeScript, expo-router
├── apps/admin-web/       # React + Vite + TypeScript + Tailwind
├── services/api/         # FastAPI (Python 3.11+)
├── supabase/migrations/  # ordered SQL files, plain Postgres + Supabase conventions
├── supabase/seed.sql     # map seed (generated) + demo data
├── data/sample-campus/   # map generator + lab_block.json
└── docs/
```

## 1. Fixed IDs

- Pilot institution id: `00000000-0000-0000-0000-000000000001`, name `NIE Mysore (pilot)`.
- Building, floor, node and edge ids are deterministic UUIDv5 values:
  namespace `6f1c2a1e-7d1b-4c5e-9a43-2b8f0d7e4a10`, name = the object's `code` string (see §3).
  Building code `LB`. Floor codes `LB-G`, `LB-1`, `LB-2`, `LB-3`. Edge code = `"<from_code>__<to_code>"`.

## 2. Database (schema `public`)

Enum-like values are `text` columns with CHECK constraints (simpler to evolve than Postgres enums).

### Tables

```
institutions(id uuid pk, name text not null, address text, test_mode_only boolean not null default true,
             created_at timestamptz default now())

profiles(id uuid pk references auth.users on delete cascade,
         institution_id uuid not null references institutions default '00000000-0000-0000-0000-000000000001',
         display_name text, phone text,
         emergency_contact_name text, emergency_contact_phone text,
         share_location_in_sos boolean not null default true,
         speech_rate real not null default 1.0,
         avoid_stairs boolean not null default false,
         created_at timestamptz default now(), updated_at timestamptz default now())
  -- row auto-created by trigger on auth.users insert (display_name from raw_user_meta_data->>'display_name', else email prefix)

role_assignments(user_id uuid references auth.users on delete cascade, institution_id uuid references institutions,
                 role text check (role in ('admin','responder','maintenance','map_editor')),
                 created_at timestamptz default now(), primary key (user_id, institution_id, role))
  -- users with no row are ordinary app users ("student")

buildings(id uuid pk, institution_id uuid references institutions, code text unique not null, name text not null,
          lat double precision, lng double precision, is_placeholder boolean not null default true, notes text)

floors(id uuid pk, building_id uuid references buildings, code text unique not null, level int not null, name text not null)

route_nodes(id uuid pk, floor_id uuid references floors, code text unique not null,
            kind text check (kind in ('corridor','entrance','room','lab','office','library','washroom',
                                      'help_desk','stairs','lift','emergency_point')),
            label text not null,              -- spoken name, e.g. "Department Library"
            aliases text[] not null default '{}',  -- lowercase search words
            x double precision not null, y double precision not null,  -- metres, building frame (§3)
            searchable boolean not null default false,   -- true for destinations
            qr_token text unique,             -- non-null => it is a QR checkpoint
            verified boolean not null default false, verified_at timestamptz,
            notes text, updated_at timestamptz default now())

route_edges(id uuid pk, code text unique not null,
            from_node_id uuid references route_nodes, to_node_id uuid references route_nodes,
            kind text check (kind in ('corridor','door','stairs','lift','outdoor')),
            length_m double precision not null check (length_m > 0),
            step_free boolean not null,
            status text not null default 'open' check (status in ('open','blocked')),
            blocked_reason text, blocked_by_report_id uuid,   -- fk to obstacle_reports added after that table
            verified boolean not null default false, verified_at timestamptz,
            updated_at timestamptz default now())
  -- all edges are bidirectional

obstacle_reports(id uuid pk default gen_random_uuid(), reporter_id uuid references auth.users,
                 institution_id uuid references institutions,
                 node_id uuid references route_nodes, edge_id uuid references route_edges,
                 category text check (category in ('blocked_path','closed_door','broken_lift','wet_floor',
                                                   'missing_sign','construction','other')),
                 description text, photo_path text,          -- path inside storage bucket 'report-photos'
                 status text not null default 'submitted' check (status in
                    ('submitted','under_review','verified','assigned','resolved','closed','rejected','reopened')),
                 assignee_id uuid references auth.users,
                 created_at timestamptz default now(), updated_at timestamptz default now(),
                 verified_by uuid, verified_at timestamptz, resolution_notes text)

report_events(id bigserial pk, report_id uuid references obstacle_reports, actor_id uuid,
              from_status text, to_status text, note text, created_at timestamptz default now())

emergency_alerts(id uuid pk default gen_random_uuid(), user_id uuid not null references auth.users,
                 institution_id uuid not null references institutions,
                 client_request_id text not null,            -- idempotency key from the app
                 emergency_type text not null default 'unspecified' check (emergency_type in
                    ('unspecified','medical','lost','fall','unsafe','other')),
                 message text,
                 is_test boolean not null default true,
                 status text not null default 'triggered' check (status in
                    ('triggered','acknowledged','responding','unable_to_contact','resolved','cancelled')),
                 node_id uuid references route_nodes,        -- last confirmed checkpoint / room, may be null
                 location_source text not null default 'unknown' check (location_source in
                    ('qr_checkpoint','staff_confirmed','route_progress','gps','unknown')),
                 location_label text,                        -- human text, e.g. "Floor 2, near lift (QR)"
                 location_observed_at timestamptz,           -- when that location was confirmed (NOT now())
                 lat double precision, lng double precision, accuracy_m double precision,
                 created_at timestamptz default now(), updated_at timestamptz default now(),
                 acknowledged_at timestamptz, acknowledged_by uuid,
                 assigned_responder_id uuid, resolved_at timestamptz, resolution_notes text,
                 unique (user_id, client_request_id))

emergency_events(id bigserial pk, alert_id uuid references emergency_alerts, actor_id uuid,
                 event_type text,   -- 'triggered','acknowledged','assigned','status_changed','note','cancelled','deduplicated'
                 from_status text, to_status text, note text,
                 visible_to_user boolean not null default true,   -- internal notes = false
                 created_at timestamptz default now())
  -- APPEND-ONLY: trigger raises exception on UPDATE or DELETE

audit_events(id bigserial pk, actor_id uuid, institution_id uuid, action text, entity_type text,
             entity_id text, details jsonb, created_at timestamptz default now())
  -- append-only as well
```

### Helper functions
- `public.has_role(p_institution uuid, p_roles text[]) returns boolean` — SECURITY DEFINER, `auth.uid()` holds any of the roles.
- `public.my_institution() returns uuid` — caller's profiles.institution_id.

### RLS summary (enable RLS on every table above)
- institutions, buildings, floors, route_nodes, route_edges: SELECT for `authenticated`.
  UPDATE/INSERT/DELETE on nodes/edges/buildings/floors only if `has_role(inst, '{admin,map_editor}')`.
  Trigger writes `audit_events` on every node/edge change and bumps updated_at.
- profiles: user selects/updates own row. Admins of the institution SELECT all; responders SELECT only staff and users
  who raised an SOS in the last 30 days (emergency contacts are not browsable).
- role_assignments: user selects own rows; admin of that institution selects/inserts/deletes.
- obstacle_reports: reporter selects own; INSERT by authenticated with reporter_id = auth.uid(), status 'submitted'
  (trigger forces status='submitted', institution from profile). Staff (admin, maintenance, map_editor) of the
  institution select all. No direct UPDATE by anyone — status changes only via RPC `report_transition`.
- report_events: reporter selects events of own reports; staff select all for institution.
- emergency_alerts: user selects own; admin/responder of institution select all. **No direct INSERT/UPDATE/DELETE** — RPC only.
- emergency_events: user selects rows of own alerts where visible_to_user; admin/responder select all.
- audit_events: admin selects.

### RPC functions (all SECURITY DEFINER, `set search_path = public`, validate `auth.uid()` and roles, raise
### exceptions with clear messages; callable via `supabase.rpc(name, args)` — argument names must match)

Emergency:
- `create_emergency(p_client_request_id text, p_emergency_type text default 'unspecified', p_message text default null,
   p_node_id uuid default null, p_location_source text default 'unknown', p_location_label text default null,
   p_location_observed_at timestamptz default null, p_lat double precision default null,
   p_lng double precision default null, p_accuracy_m double precision default null, p_is_test boolean default true)
   returns emergency_alerts`
   - idempotent: same (user, client_request_id) returns the existing row.
   - if the user already has an active alert (triggered/acknowledged/responding/unable_to_contact) returns that one
     and logs event 'deduplicated' (prevents spam without ever refusing help).
   - if institution.test_mode_only, forces is_test = true.
   - if profile.share_location_in_sos is false, stores no node/lat/lng (location_source 'unknown').
   - writes event 'triggered'.
- `cancel_emergency(p_alert_id uuid, p_reason text default null) returns emergency_alerts` — owner only, active alerts only.
- `emergency_acknowledge(p_alert_id uuid) returns emergency_alerts` — admin/responder; only from 'triggered'.
- `emergency_assign(p_alert_id uuid, p_responder_id uuid) returns emergency_alerts` — admin/responder; target must hold
   responder or admin role; if still 'triggered' it is acknowledged at the same time.
- `emergency_set_status(p_alert_id uuid, p_status text, p_note text default null) returns emergency_alerts` — admin/responder.
   Allowed: acknowledged→responding|unable_to_contact|resolved; responding→unable_to_contact|resolved;
   unable_to_contact→responding|resolved. 'resolved' requires a non-empty note (stored in resolution_notes).
- `emergency_add_note(p_alert_id uuid, p_note text, p_visible_to_user boolean default false) returns emergency_events`.

Reports:
- `report_transition(p_report_id uuid, p_to_status text, p_note text default null, p_block_edge boolean default false,
   p_assignee_id uuid default null, p_edge_id uuid default null) returns obstacle_reports` — staff (admin/maintenance/map_editor) only.
   `p_edge_id` picks which path to block when verifying (phone reports carry only node_id); it is stored on the report.
   Allowed: submitted→under_review|verified|rejected; under_review→verified|rejected; verified→assigned|resolved;
   assigned→resolved; resolved→closed|reopened; closed→reopened; rejected→reopened; reopened→under_review|verified.
   - to 'verified' with p_block_edge and report has edge_id ⇒ edge.status='blocked', blocked_reason=category+description,
     blocked_by_report_id=report.id. (Only admin/map_editor may block edges.)
   - to 'resolved' ⇒ any edge blocked_by this report goes back to 'open'.
   - to 'assigned' requires p_assignee_id.
   - writes report_events and audit_events.

Staff:
- `list_staff(p_roles text[] default null) returns table(user_id uuid, display_name text, phone text, roles text[])` —
  any staff member; used by assign pickers.

Map:
- `set_edge_status(p_edge_id uuid, p_status text, p_reason text default null) returns route_edges` — admin/map_editor.
- `resolve_checkpoint(p_qr_token text) returns table(node_id uuid, node_code text, label text, kind text,
   floor_id uuid, floor_level int, floor_name text, building_name text, verified boolean)` — any authenticated user.

Realtime: add `emergency_alerts`, `emergency_events`, `obstacle_reports`, `route_edges` to publication
`supabase_realtime` (guarded: only if the publication exists).

Storage: bucket `report-photos` (private). Authenticated users upload to `<auth.uid()>/<uuid>.jpg`;
staff of the institution and the owner can read. Put storage SQL in its own migration guarded by
`if exists (select 1 from pg_namespace where nspname='storage')`.

Migrations file names: `supabase/migrations/0001_schema.sql`, `0002_rls.sql`, `0003_functions.sql`,
`0004_realtime_storage.sql`. Seed: `supabase/seed.sql` (map, generated by `data/sample-campus/build_map.py`).

## 3. The lab-building map (placeholder, from one courtyard photo)

The reference photo `data/sample-campus/lab-block-reference.jpg` shows a ground + 3 floor block built around a
rectangular lawn courtyard. Open corridors (with railings on the courtyard side) run around the courtyard on
every floor; rooms open off the outer side of each corridor. A staircase is visible in the back (north) wing
left of centre, and another in the front-right (south-east) of the east wing. No lift is visible — we include
a lift placeholder that MUST be marked unverified with a note "Position not confirmed — check on site".

Building frame: metres. x: 0 (west) → 30 (east). y: 0 (south, photo side) → 45 (north, back wing).
Courtyard centre (15, 22.5).

Per floor L ∈ {G,1,2,3} (level 0..3), corridor ring nodes (code `LB-<L>-<name>`, kind 'corridor'):
`SW(0,0) S1(10,0) SM(15,0) S2(20,0) SE(30,0) E0(30,6) E1(30,11) E2(30,22) E3(30,34) NE(30,45)
 N2(20,45) N1(10,45) NW(0,45) W3(0,34) W2(0,22) W1(0,11)` connected in that ring order back to SW,
kind 'corridor', step_free true, length = euclidean distance.

Vertical cores (each floor has its own node, connected floor-to-floor):
- North staircase `LB-<L>-NSTAIR` (10,48) kind 'stairs', door edge to N1 (3 m, step_free false).
  Stair edges between consecutive floors: kind 'stairs', length 12, step_free false.
- South-east staircase `LB-<L>-SESTAIR` (33,6) kind 'stairs', door edge to E0 (3 m, step_free false).
- Lift `LB-<L>-LIFT` (-3,45) kind 'lift', door edge to NW (3 m, step_free true).
  Lift edges between consecutive floors: kind 'lift', length 4, step_free true.

Rooms: node 3 m outward from its corridor node (west wing → x-3, east → x+3, north → y+3, south → y-3),
door edge 3 m step_free true, searchable true. Washrooms attach to NE and sit at (33,45).
- G: `ENTRANCE` "Main entrance (assumed position)" kind entrance at (15,-4) attached to SM (4 m);
  `HELPDESK` "Help desk" help_desk @S1; `LABG01` "Lab G01" @W1; `LABG02` "Lab G02" @W2; `LABG03` "Lab G03" @W3;
  `WORKSHOP` "Workshop" @E2; `LABG04` "Lab G04" @E3; `WASHROOM` "Ground floor washroom" @NE;
  `COURTYARD` "Courtyard assembly area" kind emergency_point at (15,22.5), single outdoor edge from W2
  (15 m, step_free false) — it is a dead end on purpose so routes never cut across the lawn.
- 1: `LAB101`@W1 `LAB102`@W2 `LAB103`@W3 `CSEOFFICE` "CSE Department Office" office @N2 `LAB104`@E3 `LAB105`@E2 `LAB106`@E1 `WASHROOM`@NE
- 2: `LIBRARY` "Department Library" library @N2 `LAB201`@W1 `LAB202`@W2 `LAB203`@W3 `SEMINAR` "Seminar Hall" room @E2 `LAB204`@E3 `WASHROOM`@NE
- 3: `RESEARCH` "Research Lab" lab @N2 `STAFFROOM` "Staff Room" office @W2 `LAB301`@W1 `LAB302`@W3 `LAB303`@E2 `LAB304`@E3 `WASHROOM`@NE

Labels for labs: "Lab 101" etc. Washroom labels "Floor N washroom". Aliases lowercase, include label words plus
synonyms (washroom: toilet, restroom, bathroom; library: library, reading room; help desk: reception, security;
CSE office: department office, cse office, hod office).

QR checkpoints (set qr_token on these nodes): G ENTRANCE `AA-CP-G-ENTRANCE`, G NW `AA-CP-G-LIFT`,
1 E0 `AA-CP-1-SESTAIR`, 2 NW `AA-CP-2-LIFT`, 2 N2 `AA-CP-2-LIBRARY`, 3 NW `AA-CP-3-LIFT`.

Everything is `verified=false`, building `is_placeholder=true`, notes "Placeholder layout derived from one
courtyard photo — correct on site". Demo story: start at the ground-floor lift checkpoint (QR `AA-CP-G-LIFT`,
node `LB-G-NW`) → "Take me to the library" (Floor 2). Blocking edge `LB-2-N1__LB-2-N2` forces the route the long way
round the ring in both modes (stairs allowed: 53 m → 151 m; step-free: 37 m → 147 m). From the main entrance the
stairs-allowed route uses the south-east staircase and never touches that edge, so don't start the demo there.

## 4. FastAPI service (`services/api`)

Env: `SUPABASE_URL`, `SUPABASE_JWT_SECRET` (optional, HS256 legacy), `DATABASE_URL` (Supabase *session pooler*
connection string, IPv4), `GEMINI_API_KEY`, `GEMINI_MODEL` (default `gemini-flash-latest`),
`CORS_ORIGINS` (comma list), `ENV` (`development`|`production`), `DEV_AUTH` (`1` allows header
`X-Dev-User: <uuid>` instead of a JWT; refused when ENV=production).

Auth: `Authorization: Bearer <supabase access token>`. Verify locally with HS256 if `SUPABASE_JWT_SECRET` set,
else via JWKS at `${SUPABASE_URL}/auth/v1/.well-known/jwks.json` (cache 10 min). `sub` = user id.

Errors: JSON `{"error": {"code": "snake_case", "message": "Plain sentence safe to speak aloud."}}`.

Endpoints (all JSON unless noted, all require auth except /health):

`GET /health` → `{"status":"ok","time":"<iso>"}` (no DB call; used as keep-alive ping)

`POST /v1/routes/plan`
```
request:  {"from_node_id": "uuid", "to_node_id": "uuid", "avoid_stairs": bool (default false)}
response: {
  "found": true,
  "total_length_m": 87.0,
  "node_ids": ["uuid", ...],
  "edge_ids": ["uuid", ...],
  "steps": [ {"index":0, "instruction":"Walk about 34 metres along the west corridor. The courtyard railing is on your right.",
              "from_node_id":"uuid","to_node_id":"uuid","floor_level":0,"length_m":34.0,"kind":"corridor",
              "checkpoint_qr": null | "AA-CP-..."} ],
  "explanation": null | "The usual route through the north corridor on Floor 2 is blocked (blocked path: ...). This route goes around instead and is about 110 metres longer.",
  "blocked_edges_avoided": [{"edge_id":"uuid","label":"North corridor, Floor 2","reason":"..."}],
  "warnings": ["This route uses the lift. Its position has not been verified yet."],
  "arrival_message": "The Department Library should be on your left. Use Read Sign or a checkpoint to confirm before going in."
}
not found: {"found": false, "explanation": "There is no verified step-free path right now. ...", ...rest empty}
```
Routing rules: weight = length_m; stairs ×2.0; lift +20 (waiting); exclude status='blocked'; if avoid_stairs exclude
step_free=false. Explanation compares with the best route ignoring blocked edges. Merge consecutive collinear
corridor edges into one instruction. Turn words from geometry (left/right/straight). Corridor names from wing
(west/east/north/south corridor). Courtyard side from cross product with courtyard centre (railing = tactile
guide). Floor changes: "Take the lift up to Floor 2." / "Take the north staircase down to the Ground floor. Hold the
handrail." Steps include `checkpoint_qr` when the step ends at a QR node ("Scan the checkpoint here to confirm").
Warnings for any unverified node/edge kinds used (lift, stairs, entrance), deduplicated.

`GET /v1/destinations/search?q=library&floor_level=` → `{"results":[{"node_id","code","label","kind","floor_level","floor_name","score"}]}`
(fuzzy match on label + aliases; searchable nodes only)

`POST /v1/ocr/read` (multipart: `image` file ≤ 5 MB jpeg/png, optional `question` text)
→ `{"text":"<exact text as printed>", "language":"en", "confidence":"high|medium|low",
    "spoken":"<short text to read aloud>", "answer": null | "<answer grounded only in the text>",
    "advice": null | "The sign is blurry. Hold the phone closer and try again."}`
Prompt must forbid inventing text; if unreadable → empty text, confidence low, advice set.

`POST /v1/vision/describe` (multipart: `image`, optional `question`)
→ `{"description":"<2–3 short sentences>", "answer": null | "...", "confidence":"high|medium|low",
    "caution":"I can't judge distances or confirm the path is safe."}` — caution always present.

`POST /v1/assistant/command` (multipart: `audio` file (m4a/aac/wav/webm ≤ 2 MB) OR form field `text`)
→ `{"transcript":"take me to the library", "intent":"navigate|read_sign|describe_scene|report_problem|sos|where_am_i|repeat|cancel|help|unknown",
    "destination_query": null | "library", "destination": null | {node_id,label,floor_level,floor_name},
    "reply":"Finding a route to the Department Library."}`
`sos` intent NEVER creates an alert — the app must show its SOS confirm screen.

Gemini: REST `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` with header
`x-goog-api-key`, inline base64 image/audio, `generationConfig.responseMimeType="application/json"` +
`responseSchema`. On HTTP 429 retry once after 2 s, then return 503 `{"error":{"code":"ai_busy","message":"The AI service is busy. Please try again in a minute."}}`.
Per-user limit: 20 AI calls / 5 min (in-memory) → 429 with a speakable message.

## 5. Demo accounts (created by `services/api/scripts/seed_demo_users.py` using the Supabase Admin API)
| email | password | role |
|---|---|---|
| student@accessable.demo | Demo@12345 | (none) |
| admin@accessable.demo | Demo@12345 | admin |
| responder@accessable.demo | Demo@12345 | responder |
| maintenance@accessable.demo | Demo@12345 | maintenance |
| mapeditor@accessable.demo | Demo@12345 | map_editor |

## 6. Client config
Mobile (`apps/mobile/.env`): `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_API_URL`.
Dashboard (`apps/admin-web/.env`): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL`.
Provide `.env.example` files. Never commit real keys.

## 7. Accessibility & UI rules (both clients)
- Function before ornament: WCAG AA contrast minimum (AAA for the mobile app's main text), visible focus rings,
  never colour-only or sound-only status, respect reduced motion.
- Mobile: every control ≥ 64 dp tall, screen-reader labels and hints on everything, everything spoken is also
  shown as large text, haptics on key actions, one primary action per screen. High-contrast dark theme
  (near-black background, white text, one bright accent — e.g. #FFD60A yellow — plus red only for SOS).
- Dashboard: dark navy/charcoal base, restrained luminous accent, soft tactile (clay/neumorphic) primary buttons,
  frosted-glass only for overlays/side panels, bento-style overview grid. No clutter, no nested cards.
  Emergency states: high-contrast red banner + text + sound (sound has a visible mute toggle).
- Every screen that is test-mode shows a visible "TEST MODE" badge.
