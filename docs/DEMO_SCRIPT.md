# TechExpo demo script (about 6 minutes)

**Cast:**
- **Student**: the phone with the app, logged in as `student@accessable.demo`.
- **Reporter**: a second phone or the same one, used to file the blocked-corridor report.
- **Admin**: the laptop with the dashboard, logged in as `admin@accessable.demo`. A second browser window is logged in as
  `responder@accessable.demo`.

**Setup:**
- The Floor 2 north corridor is **open**.
- The "Ground floor — Near the lift" QR is stuck up (or held in hand).
- The dashboard is on the **Emergency** page with sound enabled.

Everything is in **TEST MODE**. No real emergency service is contacted.

| # | Who | Do / say | What the audience sees |
|---|---|---|---|
| 1 | Student | Tap **Where am I**, then scan the *Ground floor — Near the lift* code. (If aiming is hard, use "I can't scan — choose my location" or the "Demo: I'm at the ground-floor lift checkpoint" button.) | Phone says "Checkpoint confirmed: Ground floor, near the lift." |
| 2 | Student | Press the **Talk** bar: "Take me to the library." (You can also say “press one” to use a numbered button.) | The phone finds the Department Library on Floor 2 and plans about 53 m. It reads step 1 aloud: "Face along the north corridor with the courtyard railing on your right…" |
| 3 | Student | Tap **Next** through a couple of steps. Point out the courtyard railing as a touch guide, and the checkpoint prompt. | Big text plus speech for every step. |
| 4 | Student | Tap **Read sign** and point at a printed room sign (bring one, e.g. "Lab 201"). | Phone reads the sign. Ask a follow-up ("Which room is this?") and it answers only from the sign's text. |
| 5 | Reporter | **Report a problem**, then **Blocked path**, add a photo and "Chairs stacked across the corridor". The location is the last checkpoint (scan *Floor 2 — Outside the Department Library* first). | Report appears in the dashboard's **Reports** page, live. |
| 6 | Admin | Open the report and choose **Verify + block corridor**. Pick the **Floor 2 north corridor** edge (between the stairs and the library) and confirm. | The Map shows that corridor in red. |
| 7 | Student | (Already navigating.) | The phone announces: "A corridor on your route was just reported blocked…" The new route goes around the courtyard: about 151 m, with the explanation spoken. |
| 8 | Student | Press the red **SOS**, then **Send SOS** (optionally choose "Lost"). | Phone: "Alert sent. Waiting for campus staff to respond. Help is not confirmed yet." |
| 9 | Admin | The dashboard shows a red banner and alarm with name, "Ground floor, near the lift", "QR checkpoint, confirmed N min before alert", TEST badge. Click **Acknowledge**, then **Assign** Ravi (responder), then **Mark responding**. | Phone updates live: "Campus staff have seen your alert." then "A responder is on the way." |
| 10 | Admin | **Resolve** with the note "Test: student escorted to library". Open the **timeline**. | Who did what and when. Internal notes are marked and never shown to the student. |
| 11 | Admin | Resolve the corridor report. | The corridor turns open again and the route goes back to normal. |

**Talking points:**
- **Why the SOS never touches our API server:** the free server sleeps, so emergencies go straight to the database and
  live channel. The student is only told "staff have seen your alert" after a human clicks Acknowledge.
- **Location is never faked:** it says *where* and *how old* (a QR checkpoint confirmed N minutes ago), or "Location
  unknown".
- **Routing is plain code, not AI:** the same map always gives the same route. AI is only used to read and describe.
- **Privacy:** responders can only see the profiles of people who raised an SOS. The evidence log can't be edited, even
  by an admin (show the error if a judge asks).
- **Honest limits:** QR checkpoints, not continuous indoor positioning. In-app alerts only, with SMS/phone escalation
  as the next step. The map is a placeholder until verified on site.

**If something fails live:**
- API slow ("Waking up the server…"): keep talking for 30–60 s. SOS still works because it doesn't use the API.
- Gemini busy: skip Read Sign and show the recorded clip.
- Realtime stuck: the dashboard also polls every 15 s, so just wait.
