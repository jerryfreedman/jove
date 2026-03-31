# JOVE — FULL SYSTEM AUDIT
**Date:** 2026-03-29
**Scope:** READ-ONLY DIAGNOSTIC
**Goal:** Identify gaps in memory, feedback, hierarchy, and intelligence flow

---

## SECTION 1 — BIRD QUESTION SYSTEM (MEMORY + REPETITION)

### Current Behavior

Bird questions are generated via a `useMemo` in `app/home/page.tsx` (line ~862). The system uses a **priority hierarchy** to select the next question:

1. **P1 — Future meeting intent:** Upcoming meetings within 48 hours → asks "What's your goal for {title}?"
2. **P2 — Post-meeting debrief:** Meetings ended in last 2 hours with no debrief → asks "How did {title} go?"
3. **P3 — Stale deal gap-fill:** Walks deals stalest-to-freshest, checks for missing signal types (champion → next_action → budget) → asks targeted gap question
4. **P4 — Open fallback:** "What's on your mind?"

Questions have **no persistent identifier** — no `id`, no `hash`, no database key. They are generated dynamically from live data each time the `useMemo` recomputes.

### Data Flow

1. `birdQuestion` useMemo fires whenever `data` or `birdAnsweredCount` changes.
2. User taps bird → modal opens showing `birdQuestion.text`.
3. User submits → `handleBirdSubmit` runs:
   - Adds `q:{questionText}` and `deal:{dealId}` to `birdAnsweredRef` (a `useRef<Set<string>>`).
   - Increments `birdAnsweredCount` state to force useMemo recompute.
   - Saves interaction via `saveInteraction()` → fires extraction via `triggerExtraction()`.
4. `birdQuestion` useMemo recomputes → `wasAnswered()` helper checks the ref Set → skips answered questions → picks next priority.

### Suppression Logic That EXISTS

- **Session-only memory** via `birdAnsweredRef` (a `useRef<Set<string>>`). This Set tracks:
  - `q:{exact question text}` — prevents re-asking the same literal question.
  - `deal:{dealId}` — prevents re-asking about the same deal.
- The `wasAnswered()` helper checks this Set before returning a question candidate.

### Failure Points

**1. Navigation away + return (same session, no full reload):**
- React component unmounts on navigation (e.g., going to `/deals/[id]` then back).
- `birdAnsweredRef` is a `useRef` — it **survives re-renders but NOT unmount/remount**.
- When user navigates back to `/home`, the component remounts fresh → `birdAnsweredRef` reinitializes to `new Set()` → **all memory is lost** → same question appears again.

**2. Full page reload:**
- Same as above but worse — entire React tree destroyed → ref gone → question repeats.

**3. New session / app reopen:**
- No persistent storage is used (no localStorage, no sessionStorage, no database) for bird question history.
- Complete amnesia.

**4. Extraction latency:**
- After user answers, extraction runs async (fire-and-forget with 3s delayed re-fetch).
- If the extraction hasn't completed by the time useMemo recomputes, the underlying data (signals, deals) hasn't changed → the same gap still exists → same question is regenerated.
- The ref-based suppression *would* catch this, but only if the ref survived (see point 1).

### Root Cause

The suppression mechanism (`birdAnsweredRef`) uses **component-scoped memory** (useRef) that does not survive navigation or reload. There is zero persistent storage of answered bird questions. The system has memory, but that memory has the lifespan of a single continuous mount — which, in a navigation-based app, can be seconds.

### Minimal Viable Fix

**Option A (simplest, recommended):** Use `sessionStorage` to persist the answered Set.

- On mount: hydrate `birdAnsweredRef` from `sessionStorage.getItem('jove_bird_answered')`.
- On each submit: write updated Set to `sessionStorage`.
- `sessionStorage` survives navigation and re-mounts within the same browser session, but clears on tab close — which is correct behavior (fresh session = fresh questions).

**Option B (stronger):** Write a `bird_interactions` or `bird_prompts_answered` column/table to the database keyed by `(user_id, question_hash, date)`. Query on mount, filter in useMemo. This gives cross-device, cross-session suppression but is heavier.

**Recommendation:** Option A. It requires ~8 lines of code (hydrate on mount, persist on submit) and eliminates 100% of the reported repetition within a session.

---

## SECTION 2 — FEEDBACK + REINFORCEMENT LOOP

### Current Feedback Stack by Trigger

#### 1. Capture Submit (CaptureSheet)
| Layer | What fires | Timing | Visual |
|-------|-----------|--------|--------|
| Immediate | `setSaved(true)` | Synchronous after DB insert | "Got it." + Logo bloom animation + contextual subtitle |
| Background | Extraction fires (fire-and-forget) | Async, no await | None visible |
| Delayed | `onCaptureComplete()` callback → home re-fetches | After 2.2s auto-close | None in capture sheet |
| Streak | `updateStreak()` → sets `jove_bloom_trigger` in localStorage | After DB insert, before UI close | Logo bloom on home (if still mounted) |
| Cross-tab | `StorageEvent` listener on home picks up bloom trigger | Only if home is mounted in another context | Bird reaction + logo bloom |

**Feedback gap:** The capture sheet closes after 2.2s. The extraction completes ~2-5s later. The user is already back on the home screen. There is **no confirmation that extraction succeeded** within the capture sheet itself. The "Got it." message is a *receipt*, not a *result*.

#### 2. Chat "Save to Jove" (deals/[id]/chat)
| Layer | What fires | Timing | Visual |
|-------|-----------|--------|--------|
| Immediate | `setSavedMsgKeys` adds key | Synchronous | "Saved ✓" label appears |
| Transient | `setSaveConfirmKey` | 2s fade | "Saved — Jove is learning from this" |
| Background | Extraction fires (fire-and-forget) | Async | None |

**Feedback gap:** No post-extraction confirmation. No environment reaction. The "learning from this" text implies ongoing processing but never closes the loop with what was learned.

#### 3. Bird Interaction Submit (home/page.tsx handleBirdSubmit)
| Layer | What fires | Timing | Visual |
|-------|-----------|--------|--------|
| Immediate | Modal closes | Instant | Modal disappears |
| Simultaneous | Bird pulse + sun pulse | 0ms | Bird scales 1→1.08→1 (600ms), sun ping ring |
| Zen moment | `setZenCapture({ visible: true })` | 0ms | Checkmark animation + glow |
| Zen text | Waits for re-fetch → extraction feedback | ~3s | Updates zen overlay text if still visible |
| Feedback banner | `setFeedbackText` from signal diff | After re-fetch | Amber banner with extracted signal label |

**This is the BEST feedback path.** It layers: immediate (pulse) → warm (zen) → informational (banner with real extraction result). However, the zen moment fades after 2s and the re-fetch happens at 3s — so the informational layer often fires *after* the zen overlay is already gone, landing on a banner the user might not notice.

#### 4. Meeting Context Submit (meetings/page.tsx → CaptureSheet bridge)
| Layer | What fires | Timing | Visual |
|-------|-----------|--------|--------|
| Flow | User taps "Add context →" on meeting card | Opens CaptureSheet with `meetingContext` prop | Meeting title shown as "About: {title}" hint |
| Submit | Same as Capture Submit path | Same | Same "Got it." |

**Feedback gap:** After adding context to a meeting, no meeting-specific confirmation exists. User doesn't see "Context saved for {meeting title}" — they see generic "Got it."

### Failure Points

1. **Capture sheet closes before extraction completes.** The user never sees what Jove extracted. The feedback is "I received your input" not "I understood your input."

2. **Bird submit zen moment and extraction feedback are desynchronized.** Zen fades at 2s, re-fetch fires at 3s, feedback banner appears at ~3.5-4s. The zen overlay text update (`setZenCapture(prev => ...)`) often fires on an already-invisible element.

3. **Chat "Save to Jove" has no environment feedback.** No bird reaction, no pulse, no banner. It fires extraction in background but never reports the result.

4. **Meeting context submit uses generic capture feedback.** No meeting-aware messaging.

5. **Feedback is not tied to extraction success/failure.** The `preCaptureSignalCountRef` diffing approach (line ~738) works conceptually but depends on the 3s re-fetch timing. If extraction takes longer (API cold start, complex content), the diff is 0 → fallback message "Intelligence sharpening" which is vague.

### Root Cause

Feedback is designed around the **input event** (save), not the **output event** (extraction complete). The system fires visual rewards at submission time, but the meaningful confirmation (what was extracted) arrives asynchronously with no guaranteed delivery window.

### Minimal Viable Fix

1. **Move feedback banner trigger to a Supabase realtime subscription** on `interactions` table. When `extraction_status` changes from `processing` to `complete`, fire the feedback banner with real signal data. This decouples feedback from the arbitrary 3s re-fetch timer.

2. **For Chat "Save to Jove":** Add a localStorage trigger (like the existing `jove_bloom_trigger` pattern) that the home screen picks up, so the bird reacts even if the save happened on a different page.

3. **For meeting context:** Pass `meetingContext` string through to the saved confirmation message: "Context for {title} saved."

---

## SECTION 3 — HOME HIERARCHY + MOTION SYSTEM

### Elements Visible at Rest

| Element | Position | Animated | Interactive | Visual Weight |
|---------|----------|----------|-------------|---------------|
| SceneBackground (sky/water/mountains) | Full viewport | Subtle (waves, star twinkle, sun breath) | No | High (fills entire screen) |
| AmbientBird | Sky zone (8%-62%) | Continuous (horizontal drift + sine wave) | Yes (44px hitbox follows bird) | Low-medium (32x14px SVG, 60% opacity) |
| AmbientFish | Water zone (65%-92%) | Continuous (horizontal drift + sine wave) | No | Low (28x12px SVG, 25% opacity) |
| Sun/Moon | Varies by hour | Slow breathing (9s/12s cycle) | Yes (tap → briefing) | Medium (28-60px depending on time) |
| Logo | Top area | Only on bloom trigger | Yes (tap → calendar prompt) | Medium |
| StreakBadge | Near logo | Static | No | Low |
| Greeting text | Upper area | Fade-in on load | No | Medium |
| Weather | Below greeting | Fade-in on load | No | Low |
| "Do This First" hero card | Below greeting (conditional) | Fade-in, amber glow | Yes (tap opens action overlay) | HIGH when present |
| Intelligence lines (3x) | Mid-screen | Static (red dot blinks for urgent) | Yes (tap → route) | Medium |
| Debrief prompt | Above capture button | Fade-in (conditional) | Yes (Debrief Now / Dismiss) | Medium-high when present |
| Capture (+) button | Bottom | Static | Yes (tap → CaptureSheet) | HIGH (primary action) |
| Deals button | Bottom | Static | Yes (tap → /deals) | Medium |

### Current Attention Hierarchy (Ranked)

1. **"Do This First" card** — when present, it dominates. Large amber text, amber border glow, positioned in prime viewport real estate. This is intentional and correct.
2. **Capture (+) button** — fixed at bottom, high contrast amber gradient, always visible. Clear primary action.
3. **AmbientBird** — continuous motion draws the eye. Small but *moving*, which makes it disproportionately attention-grabbing relative to its importance.
4. **Intelligence lines** — especially when red dot is blinking. Competes with bird for mid-screen attention.
5. **Debrief prompt** — when present, competes with both the hero card and capture button.
6. **Sun/Moon** — slow breathing animation, medium size, interactive but purpose is unclear unless user discovers it.
7. **Scene background** — atmospheric, not competing for attention. Correct.
8. **Fish** — very subtle. Correct.

### Conflicts

1. **Bird motion vs. intelligence lines:** Both occupy the mid-screen zone. The bird is continuously moving, which naturally captures peripheral vision. The intel lines (which contain actionable information) are static text that the eye skips over because the bird is more visually stimulating.

2. **Debrief prompt vs. "Do This First":** When both are present, the user has two competing "what should I do" elements. The hero card says "do this first" while the debrief prompt says "debrief this meeting." No clear winner.

3. **Sun tap is discoverable only by accident.** There is no affordance (no label, no indicator) that the sun/moon is tappable. It competes with nothing — because nobody knows it's there.

### Whether Motion Supports or Distracts

**Bird motion is atmospheric and correct** in isolation — it creates a living-world feel. But it becomes a distraction when the user should be reading intel lines or responding to the hero card. The bird's continuous animation has no off-state; it moves identically whether the user has zero deals or ten urgent ones.

**Sun breathing is correct** — slow enough to be ambient, not distracting.

**Wave animation is correct** — very subtle, purely atmospheric.

### Minimal Adjustments

1. **Reduce bird motion when hero card or debrief prompt is visible.** Pass a prop like `subdued={true}` that halves speed and reduces opacity to 0.3. This lets the atmospheric element exist without competing with urgent UI.

2. **Add a subtle pulse or shimmer to intel lines on mount** — a 0.3s fade-in with slight translateY to give them a moment of motion that draws the eye once, then they become static. Currently they appear instantly and are easily ignored.

3. **Sun/moon discoverability:** Add a single soft pulse ring on first mount (only once per session, via localStorage flag) to signal interactivity. Not a label — just one visual cue.

---

## SECTION 4 — MEETINGS AS INTELLIGENCE INPUT

### Full Flow

1. **Import:** User goes to `/meetings` → taps "Import" button → selects calendar screenshot → `handleScreenshot` fires → sends base64 image to `/api/import-meetings` → Claude Vision extracts meeting data → returns JSON → shows confirmation screen with detected meetings.

2. **Confirmation:** User sees detected meetings with checkboxes and optional deal linking. Taps "Save selected" → `handleBulkSave` inserts rows into `meetings` table one-by-one. No extraction is triggered. No context is captured. **Meetings are saved as data objects, not intelligence.**

3. **Display:** Meetings appear as cards in `/meetings` with title, time, attendees, linked deal. Two sections: "Upcoming" and "Past" (togglable).

4. **Manual add:** User can also tap "+" to manually add a meeting with title, date, time, deal link, attendees.

5. **Add context:** Each meeting card has an "Add context →" link. Tapping it sets `captureMeeting` state → opens `CaptureSheet` with `meetingContext={meeting.title}` and `initialDealId={meeting.deal_id}`.

6. **Context capture:** CaptureSheet opens with "About: {meeting title}" hint and placeholder "What happened in this meeting?". User types → submits → goes through standard capture flow → extraction fires → signals generated.

7. **Post-context feedback:** Standard CaptureSheet "Got it." confirmation. No meeting-specific feedback. No visual change on the meeting card to indicate context was added.

8. **Debrief bridge (home):** On home screen, meetings that ended >1 hour ago with `debrief_completed === false` and no `debrief_prompted_at` appear as a debrief prompt. User can "Debrief Now" → opens CaptureSheet with pre-filled meeting info. After submit, `debrief_prompted_at` is set, but `debrief_completed` is never explicitly set to `true` anywhere in the code I read.

### Friction Points

1. **Import is screenshot-only.** No calendar API integration. User must take a screenshot of their calendar, then import it. This is a multi-step process (switch to calendar app → screenshot → switch back → tap Import → select photo → wait for OCR → confirm). High friction for initial data entry.

2. **"Add context →" is the only bridge from meeting to intelligence.** But it's styled as a small text link at the bottom of each card (12px, amber color). It's easy to miss and doesn't feel like a primary action.

3. **No visual state change after context is added.** The meeting card looks identical before and after the user adds context. There's no "context added" badge, no checkmark, no visual differentiation. The user gets no spatial feedback that their input was received for *this specific meeting*.

4. **`debrief_completed` is never set to `true`.** The home screen checks `debrief_completed === false` and `debrief_prompted_at IS NULL` to show the debrief prompt. After the user debriefs, `debrief_prompted_at` is set, which prevents re-prompting. But the actual `debrief_completed` field stays `false`. This is technically correct (the prompted_at check prevents re-ask), but semantically misleading — the meeting never shows as "debriefed" in the data model.

5. **Meetings don't feel like intelligence prompts.** They are rendered as informational cards (title, time, attendees). The only action is "Add context →" — which sounds optional. Compare this to the bird question system, which actively asks the user a specific question. Meetings are passive objects waiting for the user to remember to interact with them.

6. **No extraction on import.** When meetings are bulk-imported from screenshot, the meeting titles and attendees are saved but no extraction is triggered. The meeting metadata (attendees, title) is never processed for signals. A meeting titled "Budget review with Sarah Chen" contains two signals (budget_mentioned, stakeholder_mentioned) that are never extracted.

### Whether Meeting → Capture → Extraction is Seamless

**No.** The flow is: meetings page → tap "Add context" → CaptureSheet opens → user types → submit → extraction fires → auto-close → user is back on meetings page. The extraction result is invisible. The meeting card is unchanged. The user has no way to verify that their context was processed or what was extracted from it without navigating to the deal page and checking signals.

### Smallest Bridge to Improve

1. **After "Add context" submit, mark the meeting card visually.** Add a small "Context added ✓" indicator or change the card border to amber. This requires either a local state set or a realtime subscription on the meetings table.

2. **On import, auto-extract meeting titles.** When bulk-saving imported meetings, fire a lightweight extraction pass on each meeting's title + attendees. This would generate signals like `stakeholder_mentioned` from attendee names and `budget_mentioned` / `timeline_mentioned` from titles — for free, with no extra user effort.

---

## FINAL SUMMARY

### TOP 3 SYSTEM FAILURES (ranked by impact)

**1. Bird question repetition (CRITICAL)**
The bird asks the same question after any navigation event because suppression memory (`useRef`) does not survive component unmount. This is the most visible failure — the user answers a question, navigates away, comes back, and sees the same question. It makes the entire system feel amnesic. Impact: destroys trust in the system's intelligence.

**2. Feedback desynchronization (HIGH)**
Feedback fires at input time, not output time. The user sees "Got it" but never sees "Here's what I extracted." The zen moment fades before extraction results arrive. Chat "Save to Jove" has no environment feedback at all. Impact: the system feels like a black hole — things go in, nothing comes out.

**3. Meetings as passive data objects (MEDIUM)**
Meetings are stored but not treated as intelligence surfaces. No extraction on import. No visual state change after context is added. "Add context" is a small text link, not a prompted action. Impact: meetings — which are the richest source of deal intelligence — are underutilized.

### SINGLE HIGHEST-LEVERAGE FIX

**Persist `birdAnsweredRef` to `sessionStorage`.**

~8 lines of code. Hydrate on mount, persist on submit. Eliminates 100% of bird question repetition within a session. This single fix transforms the bird from "broken parrot" to "intelligent guide" in the user's perception. Everything else (feedback, meetings) can be tuned incrementally, but if the system keeps asking the same question, nothing else matters.

### WHAT SHOULD NOT BE CHANGED

- **Bird animation system.** The `requestAnimationFrame` loop, reaction types (acceleration/turn/soar), growth factor scaling, and pulse triggers are well-engineered and performant. Do not redesign.
- **Scene background.** Time-of-day sky/water/mountains/stars/sun logic is complete and atmospheric. Do not touch.
- **Extraction pipeline.** The `/api/extract` route with Claude extraction → signal dedup → deal score calculation → contact update is solid. The pipeline works; the problem is feedback, not extraction.
- **CaptureSheet UX flow.** The tile-based capture modes (debrief/email/draft/idea) and the two-step draft flow are clean. Do not add modes or redesign the sheet.
- **"Do This First" hero card gating logic.** The two-layer system (pre-fetch gate with conditions A/B/C + post-fetch session suppression) is well-considered. Do not simplify.

---

*End of audit.*
