# AccessAble AI — Next-Gen Assistive Product Blueprint

> **Vision:** A voice-first, touch-accessible Orientation & Mobility (O&M) platform designed specifically for blind and visually impaired (BVI) students on college campuses.  
> **Core Tenet:** Blind individuals do not navigate with visual maps or small on-screen buttons. The system must operate completely through audio, speech, haptic feedback, tactile landmarks, and non-visual interaction.

---

## 1. Core Principles & User Need Analysis

### The Fundamental Shift: Visual Maps vs. O&M Guidance
1. **Never use visual driving instructions:** Phrases like *"Head North for 40 meters"* or *"Turn 90 degrees left"* are meaningless to a blind user indoors.
2. **Use Relative Tactile Anchors:** Real-world Orientation & Mobility (O&M) specialists teach navigation based on what the body touches, hears, and senses:
   - *Corridor walls & handrails:* *"Keep the railing on your right."*
   - *Doorways & surface changes:* *"Walk until the flooring changes from tile to carpet."*
   - *Paces instead of meters:* *"Walk forward approximately 22 paces."* (1 step $\approx$ 0.75 m).
   - *Reassurance anchors:* *"You will feel the corridor widen on your left."*

---

## 2. Comprehensive Inventory of Your Ideas & Features

### A. Non-Visual User Interface (UI/UX)
* **Screen-Wide Touch Targets:** No small buttons. The screen is divided into 2 or 3 massive touch areas, or allows a single tap anywhere on screen.
* **TalkBack / VoiceOver First:** Full semantic ARIA/accessibility attributes on every element (`accessibilityRole`, `accessibilityLabel`, `accessibilityHint`).
* **Continuous Audio Earcons (Sound Language):**
  - **Start Listening Earcon:** Quick ascending beep.
  - **Thinking / Processing Earcon:** Soft tick tone.
  - **Success / Arrival Earcon:** Harmonious chime.
  - **Warning / Off-Path Earcon:** Low dual-tone vibration buzz.
* **Hardware & Physical Triggers:**
  - **SOS Trigger:** Firm 3-second phone shake or triple-press volume button to activate SOS without looking at the screen.
  - **Voice Command Trigger:** Single tap anywhere on screen or hold volume-up to talk.

### B. Intelligent Landmark Navigation (Indoor O&M Guide)
* **Checkpoint Anchors:** QR codes mounted at consistent waist height (1.2 m) at key doorways and staircase landings to instantly lock ground truth position.
* **Step-Free / Accessible Route Discovery:** Prioritizes elevators over stairs, avoids construction zones or blocked corridors automatically.
* **Live Dynamic Rerouting:** If campus staff blocks a hallway (e.g. water leakage, stacked chairs), the app immediately recalculates an alternative accessible detour around the courtyard and speaks the reason aloud.
* **Turn-by-Turn Spoken Walkthrough:**
  - *"Step 1: Face the open hallway. Keep the courtyard wall on your right for about 18 paces."*
  - *"Step 2: At the corner, turn right. The Department Library double door is directly on your left."*

### C. Hands-Free Vision & Environmental Awareness
* **Auto-Framing Camera (No Shutter Button):** Instead of forcing a blind user to frame a room sign visually and tap a shutter, the camera streams frames continuously:
  - Audio aiming feedback: *"Tilt phone up slightly"*, *"Move back two steps"*, *"Sign found: Lab 204"*.
* **Grounded Sign Reader:** Gemini Flash OCR strictly reads only text printed on the sign, answering follow-up questions (*"What room is this?"*) without fabricating unseen campus information.
* **Corridor Scene Description:** Summarizes lighting, door positions, and obstacles in 2 concise sentences, ending with standard safety limitations.

### D. Emergency SOS with Honest Status
* **Direct Database Write:** Bypasses slow or sleeping cloud API servers so emergency alerts arrive at campus security instantly via Supabase Realtime.
* **Honest Psychological Feedback:** The app never falsely claims *"Help is coming"* until an actual human responder clicks **Acknowledge** on the staff dashboard.
* **Offline Failure Path:** If the student is completely out of cell/Wi-Fi coverage, the app immediately switches to a high-contrast emergency screen offering direct offline calling to **112** and designated family contacts.

---

## 3. Benchmark Repositories & Open-Source Projects to Build On

Instead of reinventing every algorithm from scratch, we can leverage and build on top of these battle-tested open-source assistive systems:

| Project | Description / Core Value | Key Technology | Repository / Reference |
|---|---|---|---|
| **Microsoft Soundscape** *(Open Source Fork)* | 3D spatial audio navigation for blind people. Uses stereo audio cues so users "hear" destinations in 3D space. | C#, Swift, OpenStreetMap, Spatial Audio | [github.com/soundscape-community/soundscape](https://github.com/soundscape-community/soundscape) |
| **Clew** *(AR Assistive Navigation)* | ARKit/ARCore path recording and retracing for blind users without beacons or pre-mapped floor plans. | Swift, React Native, ARCore / Point Cloud | [github.com/ocad-clew/clew](https://github.com/ocad-clew/clew) |
| **NavCog (CMU & IBM Research)** | High-precision indoor turn-by-turn navigation system designed specifically for visually impaired pedestrians using Bluetooth LE & smartphone IMU. | TypeScript, Swift, ROS / Topological Graphs | [github.com/hulop/NavCog](https://github.com/hulop/NavCog) |
| **Lazarillo App Core** | Accessible navigation platform for blind and visually impaired people with accessible POI audio notifications. | React Native / Flutter, Accessible Maps | [lazarillo.app](https://lazarillo.app/) / Open APIs |
| **Google Project Guideline** | On-device machine learning system that uses computer vision to guide visually impaired runners and pedestrians along guidelines using sound. | Python, Android NDK, TensorFlow Lite | [github.com/google/project-guideline](https://github.com/google/project-guideline) |

---

## 4. Phased Implementation Roadmap

### Phase 1: Zero-Vision Touch & Gesture Overhaul
- Replace small buttons with full-screen gesture detectors (tap to talk, double-tap to stop, two-finger tap to repeat).
- Add audio earcons for listening, thinking, arrival, and warning states.
- Implement hardware volume key shortcut for instant SOS / voice activation.

### Phase 2: O&M Tactile Navigation Refactor
- Update the route planner in `services/api/app/navigation/directions.py` to translate meters into approximate paces ($\text{paces} = \text{round}(\text{meters} / 0.75)$).
- Enrich direction generation with structural touch anchors (railings, wall orientation, door handles, floor transitions).

### Phase 3: Continuous Smart Camera (Hands-Free Vision)
- Remove manual shutter button on the camera screen.
- Stream video frames every 1.5 seconds to the vision model with conversational voice guidance helping the user align the phone with room signs.

### Phase 4: Integration with Soundscape Spatial Audio
- Integrate spatial 3D audio cues (audio beacons) so the student can simply walk towards the sound source in their headphones.
