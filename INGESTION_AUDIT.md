# Jove Ingestion Architecture Audit

**Date:** 2026-03-29
**Scope:** Read-only analysis of every information entry point in the Jove system.

---

## 1. Full Ingestion Table

| # | Entry Point | Where user starts | What they type/click | Interaction row created? | Extraction triggered? | Signals created? | Deal state updates? | Home intelligence reflects it? | User gets visible confirmation? |
|---|---|---|---|---|---|---|---|---|---|
| 1 | CaptureSheet — Debrief tile | Home → + button → "After a call or meeting" | Free text about a call/meeting + optional deal selector | Yes — `saveCapture('debrief', ...)` inserts into `interactions` | Yes — fire-and-forget `fetch('/api/extract')` | Yes — via extraction pipeline | Yes — extraction updates `intel_score`, `momentum_score`, `signal_velocity`, `last_activity_at`, `next_action` | Yes — home re-fetches after 3s delay; signals/deals update intel lines | Yes — "Got it. Jove is reading and saving this now." + auto-close 2.2s |
| 2 | CaptureSheet — Email received tile | Home → + button → "Email I sent or received" | Pasted email text + optional deal selector | Yes — `saveCapture('email_received', ...)` | Yes — fire-and-forget | Yes — via extraction | Yes — via extraction | Yes | Yes — same confirmation as #1 |
| 3a | CaptureSheet — Draft email: context step | Home → + button → "Draft an email" → context textarea | Pasted context (email thread, notes) | Yes — `generateDraft()` inserts with type `email_received` or `note` | **NO** — extraction is never triggered for this interaction | **NO** — stuck at `extraction_status: 'pending'` forever | No | No | No — user sees draft loading, not a save confirmation |
| 3b | CaptureSheet — Draft email: intent step | Same flow → intent textarea | What the user wants to say | **NO** — intent is sent to `/api/draft` but never persisted | N/A | N/A | N/A | N/A | No — user sees draft output |
| 3c | CaptureSheet — Draft email: "I sent it" button | Same flow → confirm sent | Button tap | Yes — `handleConfirmSent()` → `saveCapture('email_sent', ...)` with `finalSentContent` | Yes — fire-and-forget | Yes — via extraction | Yes — via extraction | Yes | Yes — same confirmation as #1; also triggers voice profile update |
| 3d | CaptureSheet — Draft email: copy button | Same flow → copy draft | Button tap | **NO** — clipboard only | No | No | No | No | Yes — "✓ Copied" for 2s |
| 4 | CaptureSheet — Idea tile | Home → + button → "Idea or initiative" | Free text about an idea + optional deal selector | Yes — `saveCapture('idea', ...)` + also inserts into `ideas` table | Yes — fire-and-forget | Yes — via extraction | Yes — via extraction (if deal selected) | Yes | Yes — same confirmation as #1 |
| 5 | Hero card action overlay | Home → "Do this first" card → textarea | Free text about what they did | Yes — via `saveInteraction()` from `capture-utils.ts` | Yes — via `triggerExtraction()` from `capture-utils.ts` | Yes — via extraction | Yes — via extraction | Yes — home re-fetches | Yes — custom feedback banner ("Touchpoint logged — risk reduced" or "Signal captured — intelligence updated") |
| 6 | Deal page — Log Interaction | Deal detail → "Log" button → sheet | Free text + type selector (email/call/meeting/note) | Yes — `handleLogInteraction()` inserts into `interactions` | Yes — fire-and-forget `fetch('/api/extract')` | Yes — via extraction | Yes — extraction updates scores; `last_activity_at` updated directly | Yes — eventually (next home load) | Partial — log sheet closes, interaction appears in history list, but no explicit success toast |
| 7 | Deal page — Notes field | Deal detail → notes textarea | Free text notes | **NO** — writes directly to `deals.notes` via `saveDealField()` | No | No | Partial — `last_activity_at` updated, but no extraction, no signals | No — notes are not read by home intel lines | No — silent auto-save on 600ms debounce |
| 8 | Deal page — Name/Value/Next Action edits | Deal detail → tap field → edit | Inline text edits | **NO** — writes directly to `deals` table via `saveDealField()` | No | No | Partial — `last_activity_at` updated on each field save | No | No — inline save, no toast |
| 9 | Deal page — Close Deal | Deal detail → Close Deal → reason textarea | Close type (Won/Lost) + optional reason text | Partial — interaction created only if `closeReason.trim()` is truthy | **NO** — extraction never triggered | **NO** — interaction stuck at `pending` | Yes — `stage` and `last_activity_at` updated directly | Yes — deal removed from active pipeline, intel lines update | Partial — redirects to /deals; Closed Won triggers logo bloom |
| 10 | Deal chat — Send message | Deal → Chat → textarea | Conversational message to Claude | **NO** — messages stored in local React state only | No | No | Partial — `detectUpdates()` may suggest stage/next_action changes via chips | No — unless user confirms an update chip | No explicit save confirmation; streaming response is the feedback |
| 11 | Deal chat — Confirm update chip | Deal → Chat → tap chip | Tap to confirm a suggested update | Conditional — only if `chip.type === 'log_interaction'` (inserts `note` type) | **NO** — extraction never triggered | **NO** — interaction stuck at `pending` if created | Yes — directly updates `stage`, `next_action`, `value`, or `notes` on the deal | Yes — deal state changes propagate to home on next load | Yes — chip shows confirmed state for 1.5s then disappears |
| 12 | Deal chat — "Log as sent" on email draft | Deal → Chat → assistant email → "Log as sent" | Button tap | Yes — `logAsSent()` inserts `email_sent` interaction with `final_sent_content` | **NO** — extraction never triggered | **NO** — interaction stuck at `pending` | Partial — `last_activity_at` updated directly | No — signals never created | Partial — "Logged." text for 2s |
| 13 | Briefing page — Confirm deal action | Briefing → deal card → ✓ button | Button tap | **NO** — only adds to local `confirmedIds` Set | No | No | No | Partial — triggers logo bloom via localStorage | Yes — card visually marked as confirmed |
| 14 | Briefing page — Snooze deal | Briefing → deal card → snooze button | Button tap | **NO** | No | No | Yes — `snoozed_until` updated on deal (3 days) | Yes — deal hidden from attention list | Yes — card visually removed |
| 15 | Deal page — Add Contact | Deal detail → + Contact | Name, title, email, champion toggle | **NO** — writes to `contacts` table directly | No | No | No | No | Yes — contact appears in list |
| 16 | Briefing page — Capture shortcut | Briefing → + button | Opens CaptureSheet (same as #1-4) | Via CaptureSheet | Via CaptureSheet | Via CaptureSheet | Via CaptureSheet | Via CaptureSheet | Via CaptureSheet |

---

## 2. Analysis

### A — Canonical Path

**CaptureSheet debrief tile (#1)** is the most complete end-to-end path. It creates an interaction, triggers extraction, creates signals, updates deal scores (intel, momentum, velocity, last_activity_at, next_action), reflects in home intelligence lines, updates streak, triggers logo bloom, and gives the user visible confirmation. The hero card action overlay (#5) is equally complete but is only available when a "Do this first" suggestion exists.

### B — Fragmented Paths

These paths are partially broken — they start the pipeline but fail to complete it:

**1. CaptureSheet draft context (#3a) — extraction never triggered.** `generateDraft()` at line 282 of CaptureSheet.tsx inserts an interaction with `extraction_status: 'pending'` but never calls `/api/extract`. This interaction is permanently orphaned. The context the user provided (often a received email with rich signal content) is never analyzed. This is the single most damaging gap because draft context often contains the richest intelligence (full email threads, detailed meeting context).

**2. Deal page — Close Deal (#9) — extraction never triggered.** `handleCloseDeal()` at line 282 of `deals/[id]/page.tsx` inserts an interaction with the close reason but never triggers extraction. The close reason (which could contain valuable win/loss intelligence) is never processed into signals.

**3. Deal chat — Log as sent (#12) — extraction never triggered.** `logAsSent()` at line 353 of `deals/[id]/chat/page.tsx` inserts an `email_sent` interaction but never calls `/api/extract`. The email content is never analyzed for signals.

**4. Deal chat — Confirm chip log_interaction (#11) — extraction never triggered.** `confirmChip()` at line 306 of `deals/[id]/chat/page.tsx` inserts a `note` interaction when `chip.type === 'log_interaction'` but never triggers extraction.

**5. Deal page — Log Interaction (#6) — no user confirmation.** The pipeline is complete (interaction → extraction → signals → deal scores), but the user gets no explicit success feedback. The log sheet closes and the interaction appears in history, but there's no toast or banner confirming extraction happened. This is a minor gap but reduces trust.

### C — Orphaned Paths

These paths save data that never reaches the intelligence layer:

**1. Deal page — Notes field (#7).** Notes are written directly to `deals.notes` and never create an interaction or trigger extraction. A user could write detailed competitive intelligence in notes and it would never generate signals, never affect deal scores, and never appear in home intelligence. The notes field is effectively a dead-end text box.

**2. Deal page — Name/Value/Next Action inline edits (#8).** These update the deal directly but never create interactions. The value change is particularly notable — a user manually updating deal value from $10K to $100K generates no signal, no history entry, no intelligence.

**3. Briefing page — Confirm (#13).** Tapping confirm on a deal action creates no record. There is no interaction, no extraction, no signal. The confirmation is purely cosmetic (local state + logo bloom). The system doesn't learn that the user acknowledged and presumably acted on a recommendation. On the next briefing load, the same deal may surface again.

**4. Deal chat — All user messages (#10).** Conversational messages to Claude exist only in local React state. When the user leaves the chat page, `saveThread()` fires to save a summary to `thread_summaries`, but the individual messages and their content are lost. If a user discusses strategy, shares competitive intel, or reveals deal context in chat, none of it enters the intelligence pipeline.

### D — Duplicate Paths

**1. CaptureSheet debrief (#1) vs. Deal page Log Interaction of type "call" (#6).** Both capture post-call information and both create interactions that trigger extraction. The difference: CaptureSheet is deal-optional (user picks from a selector), while Log Interaction is deal-bound (already on a deal page). From the user's perspective, these are the same action entered from different places. This is acceptable — it's context-aware access to the same pipeline.

**2. CaptureSheet email received (#2) vs. Deal page Log Interaction of type "email" (#6).** Same situation as above. Both create interactions, both trigger extraction. Acceptable duplication via different entry points.

**3. CaptureSheet draft flow (#3a-3c) vs. Deal chat email drafting (#10-12).** Both let users draft emails. CaptureSheet goes through `/api/draft` and on "I sent it" creates a full canonical interaction. Deal chat goes through `/api/chat` with richer context but on "Log as sent" creates an interaction that is never extracted. The chat path is strictly worse from an intelligence perspective despite being the more sophisticated interface.

**4. Home "Do this first" overlay (#5) vs. Briefing page confirm (#13).** Both respond to AI-generated suggestions. The home overlay creates a full interaction with extraction. The briefing confirm creates nothing. The system treats acting on a suggestion differently depending on which screen the user is on.

### E — Trust Risk

Ranked by severity (highest first):

**1. Deal chat — Log as sent (#12).** SEVERITY: HIGH. The user asks Claude to draft an email, reviews it, copies it, sends it in their email client, comes back, taps "Log as sent" — and the system shows "Logged" but never extracts the content. The user explicitly told the system "I sent this" and the system silently dropped the intelligence. This is the highest trust risk because the user took a deliberate, multi-step action to record their work.

**2. CaptureSheet draft context (#3a).** SEVERITY: HIGH. The user pastes an entire email thread or meeting context into the draft flow. This is often the richest information they'll ever provide — full conversations, names, commitments, objections. The system ingests it into an interaction row but never extracts it. The user assumes pasting context means Jove is learning from it. It isn't.

**3. Deal page — Notes field (#7).** SEVERITY: MEDIUM. Users treat notes as a "tell the system" input. They write things like "VP mentioned Q3 budget approval" or "Competitor demo scheduled for Friday." None of this reaches the intelligence layer. The notes field looks like an input to the system but is actually a personal scratchpad with no downstream effect.

**4. Deal page — Close Deal reason (#9).** SEVERITY: MEDIUM. A user closing a deal as lost writes "Lost to Competitor X — they had a better integration story." This is high-value intelligence that should generate signals (competitor_mentioned, negative_sentiment, risk_identified). Instead, it sits as an unprocessed interaction forever.

**5. Briefing page — Confirm (#13).** SEVERITY: LOW-MEDIUM. The user taps confirm thinking "I did this" — but the system doesn't record it. On the next briefing, the same deal may reappear. Over time this erodes trust in the briefing's relevance. Lower severity because the user may not notice immediately.

**6. Deal chat messages (#10).** SEVERITY: LOW. Users may not expect chat messages to feed intelligence directly, but the conversational context they share often contains implicit signals. The thread summary saved on unmount partially mitigates this, but summaries are lossy and don't enter the extraction pipeline.

---

## 3. Unified Ingestion Model Recommendation

### 1. Primary path

Every piece of information a user gives Jove should flow through one pipeline: **create an interaction row, trigger extraction, let extraction create signals and update deal state.**

### 2. Secondary paths (keep as context-aware shortcuts)

These should remain as entry points that all funnel into the primary pipeline:

- **CaptureSheet** (home screen) — the mobile-first quick capture for on-the-go input. Keep all four tiles.
- **Deal page Log Interaction** — context-bound capture when the user is already looking at a deal. Already canonical.
- **Hero card action overlay** — AI-prompted capture. Already canonical.
- **Deal chat "Log as sent"** — should become a shortcut into the primary pipeline (currently broken).

### 3. Paths to merge

- **CaptureSheet draft context (#3a) and confirm-sent (#3c) should be a single pipeline pass.** Currently the context is saved without extraction and the sent email is saved with extraction. The context interaction should also trigger extraction — it often contains richer intelligence than the outbound email itself. Fix: add `fetch('/api/extract')` after the context interaction insert in `generateDraft()` (CaptureSheet.tsx line 287-293).

- **Deal chat "Log as sent" (#12) should use the same `triggerExtraction()` pattern as CaptureSheet.** It already creates the right interaction shape — it just needs the extraction call added.

### 4. Paths to hide or remove

- **None should be removed.** Every entry point serves a valid user intent. The problem is not too many doors — it's that some doors lead to dead hallways.

### 5. Paths to fix

In priority order:

1. **CaptureSheet `generateDraft()` — add extraction trigger after context interaction insert.** File: `components/capture/CaptureSheet.tsx`, after line 293. Add the same `fetch('/api/extract')` pattern used in `saveCapture()`. This is a one-line fix that unlocks the richest intelligence source in the app.

2. **Deal chat `logAsSent()` — add extraction trigger.** File: `app/deals/[id]/chat/page.tsx`, after line 363. Add `fetch('/api/extract', { method: 'POST', ... })` with the interaction ID. Requires returning the interaction ID from the insert (currently not captured via `.select('id').single()`).

3. **Deal chat `confirmChip()` for `log_interaction` type — add extraction trigger.** File: `app/deals/[id]/chat/page.tsx`, after line 313. Same pattern.

4. **Deal page `handleCloseDeal()` — add extraction trigger.** File: `app/deals/[id]/page.tsx`, after line 297. The close reason often contains win/loss intelligence. Requires capturing the interaction ID from the insert.

5. **Briefing page `handleConfirm()` — record the confirmation.** File: `app/briefing/page.tsx`, line 381. At minimum, update `last_activity_at` on the deal. Ideally, create a lightweight interaction (type `note`, content like "Acknowledged briefing action") so the system records that the user engaged. This prevents the same deal from resurfacing as stale the next day.

6. **Deal page notes field — consider periodic extraction.** This is a longer-term consideration. The notes field's auto-save-to-deal pattern is fine for quick notes, but substantive notes should ideally enter the pipeline. One approach: when notes exceed a threshold length change (e.g., 50+ characters added in one session), create an interaction from the delta. This is lower priority than the above fixes.

### 6. The default mental model

**"If I tell Jove something, Jove learns from it."** Every input — capture, draft, chat, notes, close reason — should enter the same intelligence pipeline. The user should never have to think about which input method "counts."

---

## 4. Priority Order for Fixes

| Priority | Fix | File | Effort | Impact |
|---|---|---|---|---|
| P0 | Add extraction trigger to `generateDraft()` context insert | `components/capture/CaptureSheet.tsx` ~line 293 | 5 min | High — unlocks richest intel source |
| P0 | Add extraction trigger to `logAsSent()` | `app/deals/[id]/chat/page.tsx` ~line 363 | 10 min | High — fixes trust violation |
| P1 | Add extraction trigger to `confirmChip()` log_interaction | `app/deals/[id]/chat/page.tsx` ~line 313 | 5 min | Medium — completes chat pipeline |
| P1 | Add extraction trigger to `handleCloseDeal()` | `app/deals/[id]/page.tsx` ~line 297 | 10 min | Medium — captures win/loss intel |
| P2 | Record briefing confirm as interaction | `app/briefing/page.tsx` ~line 381 | 15 min | Medium — prevents stale re-surfacing |
| P3 | Notes field periodic extraction | `app/deals/[id]/page.tsx` ~line 261 | 30 min | Low-medium — notes are secondary input |

All P0 and P1 fixes are single-function changes. None require new tables, columns, or API routes. All reuse the existing `fetch('/api/extract')` fire-and-forget pattern.
