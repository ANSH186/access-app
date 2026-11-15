# AccessAble AI — Project Handoff

**Status:** Concept, requirements and technical planning. **No implementation is confirmed yet.**  
**Last updated:** 15 November 2026  
**Primary objective:** Build a distinctive, functional, full-stack TechExpo project with a plausible path toward a real accessibility startup.  
**Current direction:** Blind and low-vision users first; map a **real college campus** for the pilot. Institutional accessibility and emergency response are integral to the platform.

> **Short pitch:** AccessAble AI is a voice-first assistive mobile application connected to a campus accessibility map and an institutional administration dashboard. It helps blind and low-vision users understand signs and surroundings, navigate verified mapped routes, report inaccessible paths, and request assistance. Authorized campus staff manage maps, accessibility issues, and incoming SOS alerts.

## 1. Decisions and scope agreed so far

- **Chosen project:** AccessAble AI (also called AccessAble / AccessAble Universal in brainstorming). **Not AgentOS**; AgentOS was only an alternative startup idea discussed and should not be included in this implementation.
- **Primary users for the first version:** Blind and low-vision students and visitors.
- **Pilot environment:** One college campus, starting with at least one well-mapped building and a few demonstrable destinations. Exact campus/building not yet selected.
- **Platform components:** Mobile assistive app, shared accessibility map/navigation service, community reports, institutional admin web dashboard.
- **Added decision:** Emergency assistance must appear **both as SOS in the mobile app and as a dedicated, real-time emergency response section in the admin dashboard.**
- **Full-stack expectation:** Real database, authenticated users, APIs, geospatial/graph routing, live alerts, admin permissions, AI vision/OCR/speech, issue lifecycle, and meaningful end-to-end demos.
- **Startup direction:** Eventually support multiple institutions (colleges, hospitals, malls, transit hubs) with institutional subscriptions; no business model or market validation is finalized.

### Explicit non-goals for first release

Do not try to launch nationwide routing, support every disability category, perfect obstacle avoidance, continuous centimeter-accurate indoor positioning, autonomous rescue dispatch, sign-language translation, or unvalidated medical/emergency guarantees. Keep these as later research/expansion tracks.

## 2. Product modules

### A. AccessAble Assist — mobile app for users

**Priority 0: core demo requirements**

1. **Voice-first interface:** Large, accessible controls; voice commands (e.g. "Take me to the library", "Read this sign", "Describe this scene", "I need help"). Confirm actions verbally and visually; support screen readers and accessible alternatives to speech.
2. **AI scene description:** Capture a still image or sampled camera frame; provide a concise scene description and answer questions. Communicate uncertainty. **Never claim reliable hazard detection or precise distance** without validated depth/location sensing.
3. **OCR/document and sign reader:** Read notices, room signs, menus, labels and documents; read aloud and answer questions grounded in extracted text.
4. **Campus destination search:** Search named buildings/rooms/facilities in the pilot map.
5. **Accessible route planner:** Calculate routes through manually mapped nodes/edges with accessibility constraints, e.g. avoid stairs, blocked connections; provide directions.
6. **Voice-guided instructions:** Output simple landmark-based directions along the route. First MVP can use manually confirmed QR checkpoints to anchor position rather than claiming continuous indoor localization.
7. **QR checkpoint positioning:** Each confirmed checkpoint maps to a verified graph node. User scans a marked QR code to establish location; scanning must have a nonvisual fallback (staff assistance, NFC/BLE later). Blind users may struggle to aim a camera at QR codes; usability tests must validate the method.
8. **Accessibility/obstacle reporting:** Report closed doors, broken elevators, blocked ramps/corridors and other issues with category, location, description, optionally photograph; show report status.
9. **Emergency SOS:** User can trigger through a large accessible control or voice, with clear confirmation and cancellation behavior, communicate urgency, share authorized user details and last known position, and request assistance. Calls to official services or emergency contacts must remain possible independently of app connectivity.
10. **Language accessibility:** English first with a plan for Hindi and Kannada, dependent on voice/OCR accuracy testing.

**Priority 1: useful enhancements**

- Accessibility preferences (speech rate, language, low-vision contrast, accessible routes).
- Currency/object identification with confidence warnings.
- Offline-cached campus graph, room names, basic instructions and fallback emergency contacts.
- Trusted contact and verified on-campus human assistance.
- Nearby accessible facility finder.
- More robust report verification/expiry and multi-source obstacle updates.

**Future expansion**

- Continuous indoor positioning using BLE/Wi-Fi/fused sensors where validated.
- Outdoor-to-indoor multimodal navigation, transit connections, route rehearsal.
- Hearing accessibility (captioning/audio announcements), mobility accessibility (ramp/elevator/width constraints), cognitive accessibility.
- Community map across multiple institutions and cities.

### B. AccessAble Map — shared accessibility data and navigation engine

- Institution > campus > building > floor > room/facility hierarchy.
- Upload a floor plan and **manually verify** graph nodes/edges on the plan.
- Graph nodes: entrances, corridor intersections, rooms, elevators, stair entrances, ramps, checkpoints, washrooms, help desks, emergency locations.
- Graph edges: length, type, stairs, ramp, lift, floor transitions, allowed travel modes, availability, last verified timestamp.
- Route solver: Dijkstra or A* with user accessibility constraints; exclude impassable edges; explain alternative route choices.
- Temporary obstacle reporting with verification, expiration and rerouting; raw unverified posts should not silently become authoritative routing data.
- Accessible facility search and status, with provenance and verification timestamps.
- For the first pilot, use a verified graph, not auto-extracted floor-plan topology as trusted ground truth.

### C. AccessAble Community — reporting/verification

- Authenticated issue submissions with photo (optional), category, location, time and description.
- Lifecycle: `submitted -> under_review -> verified -> assigned -> resolved -> closed` (with `rejected` and `reopened` as needed).
- Moderator/admin verification before serious routing consequences.
- Duplicate report detection later; stale reports auto-expire or request reconfirmation.
- User receives status notifications; public displays must not disclose personal information.

### D. AccessAble Institutions — admin web dashboard

Core dashboard sections:

1. **Overview:** Active incidents, accessibility issue counts, mapped buildings, recently updated routes, requests awaiting review.
2. **Campus/Building Manager:** Map institutions, floors, rooms, checkpoints, pathways, ramps, elevators, entrances and accessibility metadata. Graph editor/manual map upload.
3. **Accessibility Reports:** Review, verify, assign, prioritize and resolve obstacles; update route availability after verification.
4. **Maintenance Management:** Assign work to responsible staff and track evidence of resolution.
5. **Accessibility Audit & Analytics:** Transparent checklist of verified/missing/unknown facilities, recurring barriers and incident history. Avoid presenting self-assessment as official certification.
6. **Emergency Management (NEW, REQUIRED):** Live SOS queue, emergency details, campus location, responder assignment and status tracking.
7. **User/Role Management:** Admin, security/responder, maintenance, map editor; least-privilege access.
8. **Settings/Audit Log:** Alert routing configuration, role access, notification settings, immutable audit events.

## 3. Emergency Assistance — detailed requirements (latest addition)

### Goals

- A user in difficulty can ask for human help quickly and accessibly.
- The designated campus responder can see the request, acknowledge it and coordinate a response.
- Administrators can review incidents without exposing user/location data to unrelated people.
- The system should **not** claim to be emergency services or guarantee rescue.

### End-to-end workflow

1. **Trigger:** User presses the clearly labeled SOS control (large, screen-reader accessible) or uses a voice command such as "Emergency help". A short, accessible confirmation/cancel step prevents accidental alerts without introducing dangerous delay. Design/test separately for an urgent immediate-send gesture if appropriate.
2. **Collect context:** Create an alert with user ID, institution, optional emergency type, timestamp and best available location. Prefer a recently confirmed indoor QR checkpoint / mapped room; GPS may not work indoors. Record location source, precision and last-updated time; distinguish last-known vs real-time location.
3. **Server-side create:** Authenticated backend writes the alert first; emits real-time event to *authorized* campus security/admin subscribers. Use additional push/SMS/phone delivery where approved and available; WebSockets alone are not reliable emergency delivery.
4. **Admin alert:** Display urgent SOS banner/sound and an Emergency Management queue with assigned priority, user-provided context, last known location, timestamp and alert age. Do not require staff to keep a browser tab open as the sole alert channel.
5. **Acknowledge & respond:** Authorized responder accepts/claims the alert; backend records who, when and current status. Staff can contact the user and assign local response personnel.
6. **Updates:** Example statuses: `triggered -> acknowledged -> responding -> resolved`; support `cancelled` and an `unable_to_contact` escalation state. Track timeline and notes.
7. **Close & audit:** Record resolution and timestamps with access-controlled incident history. Prevent arbitrary deletion or retroactive manipulation of evidence.
8. **Fallback:** If mobile internet or campus server is unavailable, show/call emergency contacts and local official emergency numbers via the phone's native dialer. A failed submission must be unmistakable to the user; don't announce "help is coming" unless a human has acknowledged.

### Admin Emergency Management screen

- Active SOS count and newest/oldest unacknowledged alerts.
- Alerts table/cards: severity/priority, alert ID, time, last-known location + freshness, user identity as permitted, status, assigned responder.
- Campus map highlighting available position/checkpoint (with uncertainty).
- Acknowledge/assign/respond/resolve controls and internal notes.
- Contact user/trusted contact controls (based on consent and access policy).
- History, filters, escalation/response metrics, audit trail.
- Accessibility: keyboard navigation, visible labels, high-contrast alert states, not sound-only.

### Security/privacy/safety constraints

- User consent for location sharing, emergency contacts and sensitive data access.
- Role-based authorization; no public SOS feed; encrypt transit and stored sensitive data.
- Rate limiting and spam protections without making emergencies inaccessible.
- Configurable delivery escalation and human acknowledgment; consider fallback to calls/SMS, no silent WebSocket-only failure.
- Don't fabricate geolocation; report stale/unknown positions transparently.
- Threat model includes false alarms, malicious reports, disabled notifications, network outage and admin absence.
- Clearly state the pilot limitations and that the system is not a substitute for official emergency services.

## 4. Key user journeys

### Journey A: Reach library

1. User starts at confirmed building checkpoint.
2. Says "Take me to the library".
3. Backend gets destination and a route satisfying known constraints.
4. App reads concise audio directions and can request position re-confirmation at checkpoints.
5. User scans/uses landmarks to confirm progress.
6. If a verified obstacle blocks an edge, route recalculates and explains why.
7. User arrives; app confirms destination only when sufficient location evidence exists.

### Journey B: Read a sign

1. User opens camera or says "Read this sign".
2. OCR service extracts text; optionally LLM simplifies or translates it.
3. App speaks text and answers grounded follow-up questions.
4. If low confidence, request a clearer image; don't invent room numbers.

### Journey C: Report blocked corridor

1. User reports a problem with optional image and map location.
2. Backend stores issue as unverified.
3. Admin reviews and verifies.
4. Verified blockage marks graph edge unavailable; active route requests recompute.
5. Maintenance fixes; admin records evidence and reopens edge only once verified.

### Journey D: SOS to campus admin (must demo)

1. User triggers SOS; hears confirmation that the request was *submitted*.
2. Backend persists alert; dashboard immediately receives and shows it.
3. Authorized staff acknowledges and assigns a responder.
4. User receives acknowledgment update (not a rescue guarantee).
5. Responder updates `responding`; admin closes with resolution notes.
6. Timeline is auditable and available to authorized staff.

## 5. Suggested implementation stack (proposals, not final selections)

| Layer | Proposal | Notes |
|---|---|---|
| Mobile | React Native + Expo | Verify accessibility, camera, speech and background restrictions on Android |
| Admin | React + Vite + Tailwind | Accessible dashboard component library |
| Backend | Python FastAPI | REST endpoints, async jobs, WebSockets |
| DB | PostgreSQL + PostGIS | Roles, locations, buildings, graph, issues, incidents |
| Auth | Supabase Auth or JWT/OIDC | Institution-scoped RBAC |
| Routing | NetworkX or custom Dijkstra/A* | Deterministic route and constraints, no LLM navigation decisions |
| Vision | Vision-language model for scene Q&A | API or hosted model, with uncertainty handling |
| OCR | PaddleOCR | Evaluate accuracy on real campus signs, Hindi/Kannada as applicable |
| Object detection | Ultralytics YOLO *optional* | Commercial license review; detection is NOT safe obstacle avoidance by itself |
| Speech | Platform TTS/STT or vetted providers | Voice-first + accessible manual fallback |
| Real-time | WebSockets + reliable push/SMS fallback | Emergency state must persist before notification |
| Geomaps | Leaflet/MapLibre for maps | Indoor floor plans may use custom graph overlay |
| Queue/jobs | Redis + worker later | Not required on day one |
| Deployment | Docker; hosting TBD | HTTPS, backups, monitoring, cost limits |

### Proposed system flow

```text
React Native mobile app --- HTTPS / WebSockets --- FastAPI services --- PostgreSQL/PostGIS
       |                                               |
  Camera / mic / QR                             +--- Navigation graph engine
       |                                        +--- OCR / vision / speech adapters
       +--- Audio/TTS                           +--- Reporting / verification
                                                +--- Emergency alert dispatcher
                                                +--- Authentication / RBAC
                                                         |
React admin dashboard --- HTTPS / WebSockets ------------+
                                                         |
                                           Push/SMS/phone escalation (where configured)
```

## 6. Repository research / references

**Important:** These are *candidates mentioned during planning*, not a verified drop-in integration set. Repo quality, repository ownership, licenses, API compatibility, maintenance and actual implementation must be independently checked before reuse. Avoid cloning entire unrelated apps into the product.

### Application-level references

- SightBuddy — https://github.com/DrophouseLtd/SightBuddy — native Android assistive vision/UI reference.
- ARIA — https://github.com/DhruvalAnandkar/ARIA1 — React Native/Expo and FastAPI integration reference (check provenance/fork status).
- OpenCampus GIS — https://github.com/CampusMap-OpenLab/open-campus-map — campus map and accessibility routing concepts (verify actual repository and license).
- OpenIndoorMaps — https://github.com/openindoormaps/openindoormaps — indoor mapping reference.
- Interiora — https://github.com/geolang/interiora — indoor route graph reference.
- SightAssist — https://github.com/ArgonArnav/SightAssist — vision/OCR/TTS pipeline reference.

### Framework libraries

- FastAPI — https://github.com/fastapi/fastapi
- PaddleOCR — https://github.com/PaddlePaddle/PaddleOCR
- Ultralytics — https://github.com/ultralytics/ultralytics
- NetworkX — https://github.com/networkx/networkx
- React Native — https://github.com/facebook/react-native
- Expo — https://github.com/expo/expo
- PostGIS — https://github.com/postgis/postgis
- Leaflet — https://github.com/Leaflet/Leaflet
- MapLibre GL JS — https://github.com/maplibre/maplibre-gl-js

**Reuse policy:** Prefer adding audited dependencies/SDKs and implementing our own coherent app architecture. Check permissive vs copyleft/open-core license obligations before commercially reusing source code.

## 7. Proposed database entities

Minimal relational schema sketch:

```text
users(id, auth_subject, display_name, institution_id, created_at)
user_preferences(user_id, locale, speech_rate, route_constraints_json)
institutions(id, name, address, created_at)
buildings(id, institution_id, name, footprint_geom)
floors(id, building_id, level, floorplan_asset_url)
locations(id, floor_id, label, kind, geometry, verified_at)
route_nodes(id, floor_id, kind, geometry, qr_token, verified_at)
route_edges(id, from_node_id, to_node_id, length_m, stairs, ramp, elevator,
            step_free, availability_status, verified_at)
accessibility_features(id, location_id, type, state, last_verified_at)
obstacle_reports(id, reporter_id, institution_id, node_id, edge_id, category,
                 description, image_url, status, created_at, verified_by, verified_at)
maintenance_assignments(id, report_id, assignee_id, state, updated_at)
role_assignments(user_id, institution_id, role)

emergency_alerts(id, user_id, institution_id, emergency_type, status,
                 latitude, longitude, floor_id, node_id, location_source,
                 location_accuracy_m, location_observed_at, created_at,
                 acknowledged_at, acknowledged_by, assigned_responder_id,
                 resolved_at, resolution_notes)
emergency_events(id, alert_id, actor_id, event_type, event_payload_json, created_at)
notification_deliveries(id, alert_id, channel, recipient_role, state, attempts,
                        last_attempt_at, delivered_at)
audit_events(id, actor_id, institution_id, action, entity_type, entity_id, created_at)
```

Use migration tooling, database constraints, organization-scoped queries, server-side permission checks, and retention/deletion policies. The sample is a starting point, not ready-to-run SQL.

## 8. Initial API contract sketch

```text
# Assistive functions
POST /v1/vision/describe
POST /v1/ocr/read
POST /v1/assistant/command

# Campus and navigation
GET  /v1/institutions/{id}/buildings
GET  /v1/buildings/{id}/floors
GET  /v1/floors/{id}/map
GET  /v1/facilities?near=...
POST /v1/routes/plan
POST /v1/checkpoints/resolve

# Community and institutional management
POST  /v1/reports
GET   /v1/reports
PATCH /v1/admin/reports/{id}
POST  /v1/admin/buildings
PUT   /v1/admin/floors/{id}/graph
GET   /v1/admin/analytics

# SOS
POST /v1/emergencies                   # authenticated create; idempotency key
GET  /v1/emergencies/{id}              # own / authorized staff only
POST /v1/emergencies/{id}/cancel       # safely cancel with history
GET  /v1/admin/emergencies             # role-protected
POST /v1/admin/emergencies/{id}/acknowledge
POST /v1/admin/emergencies/{id}/assign
POST /v1/admin/emergencies/{id}/status
GET  /v1/admin/emergencies/{id}/events
WS   /v1/admin/emergencies/stream     # role-protected live event channel
```

Ensure authorization, validation, idempotency and audit trail on status changes. Accepting a WebSocket event is **not** evidence that an actual human acknowledged an emergency.

## 9. Suggested monorepo

```text
accessable-ai/
├── apps/
│   ├── mobile/                    # Expo/React Native user app
│   └── admin-web/                 # React dashboard
├── services/
│   └── api/                       # FastAPI app
│       ├── routes/                # auth, campus, vision, OCR, routing, reports, SOS
│       ├── core/                  # config, logging, access control
│       ├── models/                # domain/DB models
│       ├── navigation/            # graph construction, path solver
│       ├── ai/                    # OCR, vision, speech adapters
│       ├── emergencies/           # alerts, escalation, event log
│       └── notifications/
├── packages/
│   └── shared-contracts/          # API schemas / shared types where applicable
├── database/
│   ├── migrations/
│   └── seed/
├── data/
│   └── sample-campus/             # synthetic/demo map, real map later verified
├── infrastructure/
│   └── docker/
├── docs/
│   ├── product-requirements.md
│   ├── threat-model.md
│   └── test-plan.md
└── README.md
```

## 10. Implementation order and acceptance criteria

### Sprint 0 — Validation / foundation

- Identify pilot building; request permission for mapping/user testing, and identify at least one potential institutional responder.
- Interview actual blind/low-vision users about pain points, navigation patterns and accessible SOS expectations.
- Review competing products, repo licenses and model accuracy/latency requirements.
- Define privacy/consent and emergency escalation policies before live pilot.

### Sprint 1 — Functional full-stack foundation

- Build mobile shell, admin web shell, auth/roles, API and database.
- Map one building and 3–5 destinations manually; route engine can compute accessibility-aware paths.
- **Acceptance:** A user can select A to B and obtain the correct route; admin can edit and verify campus map.

### Sprint 2 — AI and voice

- Add scene description and OCR using adapters; text-to-speech and speech input.
- **Acceptance:** User can read a known campus sign accurately and issue at least one voice navigation command, with documented limitations.

### Sprint 3 — Reports and dynamic rerouting

- Allow issue submission; admin verification changes navigable edge state; route recomputes.
- **Acceptance:** Verified blocked corridor causes a documented alternative route or a clear 'no verified path' result.

### Sprint 4 — Emergency Assistance + Admin Response

- Implement SOS create, durable event, live dashboard view, acknowledge/assign/status, user acknowledgment notification, incident timeline, fallback contact pathway.
- **Acceptance:** Mobile-triggered SOS appears in authorized dashboard, is acknowledged by staff, updates the user, and maintains audit history. Disconnected and unacknowledged cases clearly show failure/uncertainty and fallback steps.

### Sprint 5 — Accessibility, testing and TechExpo demo

- Screen-reader audit; large button/high contrast/haptics; latency and offline failure testing; security test (authorization/role isolation); assisted user walkthroughs.
- **Acceptance:** Entire mobile-to-backend-to-dashboard experience works in a repeatable test scenario, while unsupported navigation and emergency claims are clearly excluded.

## 11. Recommended TechExpo demonstration (single coherent story)

1. A blind/low-vision student starts at a known campus checkpoint.
2. Asks through voice: "Take me to the library."
3. Platform creates a route over verified mapped graph and reads directions aloud.
4. Student points camera at room sign; AccessAble reads it.
5. Another user reports a blocked corridor; admin verifies it.
6. Student's route recalculates and explains the alternative.
7. Student triggers a **test-mode** SOS.
8. The admin's Emergency Management dashboard receives the alert; an authorized responder acknowledges/assigns it.
9. Student receives acknowledgment and sees/hears the status; admin resolves test incident with audit trail.
10. Show backend traces, database state, route graph, user permissions, and realistic performance metrics.

**Do not create real emergency calls or send a real SOS for the TechExpo demo.** Use a conspicuously labeled test/sandbox mode and dummy data unless explicitly authorized.

## 12. Outstanding decisions / unresolved questions

- Exact TechExpo timeline, team size, competition requirements and judging rubric.
- Pilot campus/building, accessibility data collection permissions, and availability of testers/response staff.
- Whether React Native + Expo is best for required camera/speech/BLE capabilities or native Android Kotlin is preferable.
- Which vision, OCR and speech providers deliver acceptable latency, privacy and Indian-language accuracy.
- Indoor positioning strategy for blind users (QR alone may be impractical): verify guided scan, NFC, BLE, tactile landmarks or human-assisted checkpoints.
- Reliable emergency notifications when admin browser is closed, responder coverage hours, official institutional approval and offline escalation.
- Data minimization, retention, encryption, consent and auditing requirements.
- Which features can be implemented in available time; avoid spreading effort across 27+ brainstormed ideas.

## 13. A note to the next assistant / developer

Treat this as the **current concept-level product handoff**. The sole active project is **AccessAble AI**, **not AgentOS**. The latest explicitly requested addition is **Emergency Assistance in the admin dashboard**, connected end to end to mobile SOS. Do not claim code is already written, integrations already work, repositories have been verified, judges will select it, or safety-critical functionality is proven. Implement the core path first, with accessibility, privacy, human response and real-world testing as design requirements.

The best near-term differentiator is not the number of features but an integrated, demonstrable loop: **accessible voice request → verified campus navigation → OCR/vision help → obstacle report/verification → dynamic reroute → authorized SOS response.**
