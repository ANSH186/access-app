# AccessAble AI — Voice-Autonomous Assistive Platform for Blind Students
## Comprehensive Product Architecture & Functional Specification

> **Primary Objective:** Build a single, unified, fully autonomous assistive application tailored exclusively for blind and visually impaired (BVI) students by integrating and adapting proven, specialized open-source repositories one by one into a cohesive platform.
>
> **Core Accessibility Philosophy:** A blind person cannot visually locate or click touch buttons. Therefore, **every action, button, reading task, and mode transition must be 100% executable and controllable via voice commands**, accompanied by instantaneous auditory confirmation.

---

## 1. System Overview & Integration Architecture

The platform combines modular engines into a unified React Native / Expo mobile client paired with a FastAPI backend and Supabase cloud infrastructure:

```
Blind Student (Voice & Audio)
        │
        ▼
Unified AccessAble Mobile App
├── Module 1: Voice-to-Action UI Engine (Zero-touch voice execution of every button/mode)
├── Module 2: Live Scene Descriptor (Walking aid via camera stream; plug-and-play repo)
├── Module 3: Document & Book Reader (High-accuracy OCR + expressive TTS audiobook)
├── Module 4: AI Knowledge Companion (News, Q&A, study facts via Gemini/LLM API)
└── Module 5: Emergency SOS & Audio Listener (Dispatches location + speaks incoming admin alerts)
        │
        ▼
Cloud & Admin Infrastructure
├── FastAPI AI & Routing Gateway
├── Supabase Database & Realtime Sync
└── Admin Dashboard Web Console (Live student location map, SOS alerts, audio broadcasts)
```

---

## 2. Deep Dive: The 5 Core Functional Modules

### Module 1: The Voice-to-Action Autonomous UI Engine
*A blind person cannot hunt for buttons on a flat sheet of glass. The interface must act as an autonomous voice assistant that clicks and navigates on their behalf.*

* **Visual Consistency with Full Voice Automation:**
  - The UI retains the clean, large, high-contrast visual design for low-vision users, teachers, and sighted companions.
  - However, **no action requires a physical finger press**. Every on-screen button is paired with a direct speech command.
* **Continuous Voice Command Parsing:**
  - The app maintains an active speech listening engine (or single full-screen tap-to-talk trigger).
  - Speaking any button name or intention instantly triggers that action:
    - *"Open book reader"* &rarr; Switches to Document Mode.
    - *"Describe scene"* &rarr; Launches walking vision guide.
    - *"Where am I?"* &rarr; Reads out current location.
    - *"Go home"* / *"Back"* &rarr; Navigates to previous screen.
    - *"Send SOS"* &rarr; Dispatches emergency alert immediately.
* **Total Auditory Feedback (The Hearing-Only Principle):**
  - Because blind users rely 100% on hearing, **no action ever happens silently**.
  - Every voice command, mode change, network status, or background event is confirmed with an auditory earcon (chime/tone) followed by natural speech output (*"Opening document reader"*, *"Camera ready"*).

---

### Module 2: Live Walking Scene Descriptor (Camera-Based Vision)
*Helps blind students walk safely across campus hallways, roads, and classrooms by continuously describing what is directly ahead.*

* **Plug-and-Play Repository Architecture:**
  - Designed as a modular engine where code from a specialized computer-vision repository (provided by you) will be imported and wired directly into the camera feed.
* **Autonomous Walking Assistance:**
  - Operates continuously without requiring the user to press a shutter button.
  - Samples video frames every 1 to 2 seconds and evaluates spatial geometry:
    - **Path & Doorways:** *"Clear path ahead. Open double doors 10 paces in front of you."*
    - **Hazards & Obstacles:** *"Caution: Chairs stacked on your right side."*
    - **People & Dynamics:** *"Two people approaching from the opposite direction."*
    - **Floor Transitions:** *"Staircase descending ahead in approximately 5 paces."*
* **Dynamic Audio Feedback:**
  - Speaks concise, high-priority warnings first, using short sentences so as not to overwhelm the user’s hearing.

---

### Module 3: Document & Book Reader for Auditory Learning
*Blind students cannot read physical print; their education depends entirely on hearing and auditory memory. This module transforms any physical textbook, syllabus, or handout into an audiobook.*

* **Autonomous Page Capture & Audio Stream:**
  - When the student places a book or paper beneath the camera, the app continuously detects document borders.
  - Audio positioning guidance helps align the page:
    - *"Move phone slightly higher"*, *"Page aligned, reading now..."*
  - Automatically captures the frame when stable—no shutter button needed.
* **Sentence-by-Sentence OCR & Expressive Read-Aloud:**
  - High-accuracy optical character recognition extracts headings, paragraphs, and footnotes.
  - Uses expressive neural Text-to-Speech (TTS) to read content aloud with natural cadence and punctuation pauses.
* **Voice-Controlled Study Controls:**
  - While reading, the student controls playback purely by voice:
    - *"Pause"* / *"Resume"*
    - *"Repeat last paragraph"*
    - *"Next page"*
    - *"Summarize this section"* (provides a 3-bullet spoken summary of what was read)
    - *"Explain what this diagram is"* (describes charts and diagrams using multimodal vision)

---

### Module 4: General Knowledge, News & Study Companion (LLM API)
*An intelligent conversational agent providing the blind student instant access to real-time information, study assistance, and daily campus news.*

* **Hands-Free AI Interaction:**
  - Activated by a voice command (*"Ask AccessAble..."* or *"Hey Assistant..."*) or a single full-screen tap.
  - Connected directly to Google Gemini / OpenAI LLM APIs via our FastAPI gateway.
* **Core Capabilities for the Student:**
  - **Daily News & Weather:** *"What is the top news today?"*, *"Will it rain on campus this afternoon?"*
  - **Academic & Fact Lookup:** *"Explain the difference between a resistor and capacitor"*, *"What is the capital of Australia?"*
  - **Study Summarization:** Answers complex homework questions with clear, spoken audio explanations.
* **Speech-Optimized Responses:**
  - Prompted specifically to return concise, spoken-friendly paragraphs (avoiding markdown asterisks, raw URLs, or complex visual formatting that confuses speech synthesizers).

---

### Module 5: Emergency SOS & Staff Admin Dashboard
*A dual-sided safety ecosystem: instantaneous emergency broadcasting from the student's phone, combined with a centralized campus monitoring dashboard for university administration and security.*

#### A. Mobile SOS Client (Student App):
* **Voice & Gesture Triggers:** Triggered either by voice (*"Help me"* / *"Send SOS"*) or by a physical gesture (firm phone shake or holding volume buttons for 3 seconds).
* **Location Attachment:** Immediately attaches the last confirmed QR checkpoint or GPS coordinate and how long ago it was verified.
* **Direct Database Write:** Bypasses sleeping API servers, going straight to Supabase Realtime so campus security is notified in under 1 second.
* **Spoken Incoming Notifications:** Any reply or message sent by the administrator is **immediately read aloud by the phone** at high priority.

#### B. Campus Admin Dashboard Website:
* **Live Campus Student Map:**
  - Displays a visual map of the campus and buildings.
  - Plots the active location of students using the app (with privacy-first access controls).
* **Realtime Emergency SOS Queue:**
  - When an SOS is triggered, the dashboard sounds an audible repeating alarm.
  - Displays the student's name, last confirmed location, age of location data, and status (*Triggered*, *Acknowledged*, *Responding*, *Resolved*).
* **Two-Way Emergency Messaging & Broadcast System:**
  - **Direct Message:** The admin can select an individual student and send a direct update (e.g., *"Stay where you are, assistance is outside Room 204"*).
  - **Campus-Wide Broadcast:** The admin can broadcast announcements (e.g., *"Elevator B in the Science Block is currently undergoing maintenance. Please use the East ramp"*).
  - The mobile app intercepts these messages and **speaks them aloud automatically**.

---

## 3. Integration Blueprint: Modular Code Structure

```
apps/mobile/src/
├── modules/
│   ├── voice_nav/       <-- Module 1: Voice-to-Action command listener
│   ├── scene_desc/      <-- Module 2: Code adapted from walking vision repo
│   ├── doc_reader/      <-- Module 3: Code adapted from OCR document reader repo
│   ├── ai_assistant/    <-- Module 4: Conversational LLM API companion
│   └── emergency/       <-- Module 5: SOS dispatcher & real-time audio listener
├── lib/
│   ├── speech.ts        <-- High-priority Text-to-Speech manager
│   ├── earcons.ts       <-- Sound cues (listening, thinking, alert)
│   └── supabase.ts      <-- Realtime event channels
```

### Next Steps for Implementation:
1. **Provide the Scene Descriptor repository link:** We will extract and adapt its vision pipeline into `modules/scene_desc/`.
2. **Implement Voice Command Interceptor:** Bind speech recognition to trigger existing navigation, reading, and SOS functions without button clicks.
3. **Connect Gemini API to Chat Assistant:** Add the Q&A / News conversation endpoint in `services/api/app/routers/ai.py`.
4. **Extend Admin Dashboard:** Add student location plotting and the two-way broadcast message interface in `apps/admin-web/src/pages/Emergency.tsx`.
