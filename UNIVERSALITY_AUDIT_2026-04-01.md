# JOVE — UNIVERSALITY AUDIT

**Date:** 2026-04-01
**Scope:** Language, Logic, Structure
**Method:** Full source code review of all 70+ files
**Verdict:** Still domain-biased

---

## SECTION 1 — LANGUAGE AUDIT

Every user-facing term was traced through the codebase. The semantic layer (Session 3) was designed to solve this problem but has two critical failures: the default is sales, and the internal system still uses sales vocabulary everywhere.

### Hardcoded Sales/Business Terms Found

| Term | Location | Why It Narrows Audience | Neutral Replacement |
|------|----------|------------------------|-------------------|
| **deal** | `types.ts` (DealRow, DealStage, DealWithAccount), `task-engine.ts`, `chat-intelligence.ts`, `module-priority.ts`, `ControlSurface.tsx`, all `/deals/*` routes, `capture-utils.ts` | "Deal" is a sales transaction. A student doesn't have deals. A parent doesn't have deals. | **item**, **focus**, or **thread** |
| **DealStage: Prospect, Discovery, POC, Proposal, Negotiation, Closed Won, Closed Lost** | `types.ts` lines 61-68 | These are a literal sales pipeline. No other domain uses these stages. | Generic statuses: **new, active, in-progress, waiting, done, dropped** |
| **account** | `types.ts` (AccountRow), `semantic-labels.ts`, `chat-intelligence.ts` | CRM concept. A student doesn't have "accounts." | **group**, **context**, or **organization** |
| **contact** | `types.ts` (ContactRow), `semantic-labels.ts` | Implies external business relationship. | **person** or **connection** |
| **is_champion** | `types.ts` line 49 | Sales-specific concept (internal advocate at a prospect company). | Remove or generalize to **is_key_person** |
| **relationship_temperature** | `types.ts` line 51 | CRM/sales metric. | Remove or rename to **status** |
| **intel_score** | `types.ts` line 82, `extract/route.ts` | "Intel" implies competitive intelligence gathering. | **context_score** or **richness_score** |
| **momentum_score** | `types.ts` line 83 | Sales pipeline momentum. | **activity_score** |
| **signal_velocity** | `types.ts` line 84 | Sales analytics term. | **activity_rate** |
| **pipeline** | `chat-intelligence.ts` line 118 (`new pipeline`) | Explicit sales funnel language. | Remove from detection keywords |
| **prospect** | `types.ts` line 63, `chat-intelligence.ts` line 113 | Sales-specific lead stage. | **lead** or remove |
| **new deal**, **new opportunity**, **new prospect**, **new lead** | `chat-intelligence.ts` lines 113-118 | All deal-detection keywords are sales-oriented. | Add neutral: **new project**, **new task**, **new item** |
| **follow-up** / **follow up** | `chat-intelligence.ts` lines 106-107, `task-types.ts` | While general, the system only generates follow-ups in deal/meeting context. | Keep term, expand context |
| **debrief** | `types.ts` line 92, `chat-intelligence.ts` line 131 | Military/sales term for post-meeting review. | **recap**, **notes**, **review** |
| **What do you sell?** | `onboarding/page.tsx` line 94 | Onboarding question assumes user sells something. | **What do you work on?** or remove |
| **What company do you sell for?** | `onboarding/page.tsx` line 91 | Same — assumes sales role. | **Where do you work?** or **What's your organization?** |
| **What's one deal you're working on?** | `onboarding/page.tsx` line 93 | Same — assumes deals exist. | **What's something you're focused on right now?** |
| **WHAT YOU SELL** | `chat-home/route.ts` line 225 | Context block header in system prompt. | **WHAT YOU WORK ON** or **PRODUCT/SERVICE CONTEXT** |
| **value_type: 'mrr' / 'arr' / 'one_time'** | `types.ts` line 77 | SaaS revenue metrics. Meaningless outside B2B. | Remove or generalize to **amount_type** |
| **knowledge_base: product_name, target_use_cases, is_active_deal** | `types.ts` lines 238-246 | Assumes user has a product they're selling. | Rename to general context store |

### Semantic Layer Assessment

The `semantic-labels.ts` file provides label swapping, but:

1. **Default is `sales`** — line 39: `domain: 'sales'`. Every new user sees sales vocabulary until manually changed.
2. **Domain selection is not wired to UI** — `domain_key` on `UserRow` is typed but never persisted to the database (line 24: "not yet persisted to DB").
3. **Only relabels 3 nouns** — primary entity, contact, account. Doesn't touch stages, scores, signals, onboarding questions, or system prompt language.
4. **Internal system names are sales** — comment on line 4: "Internal system names (deals, contacts, accounts) never change." The abstraction is cosmetic, not structural.
5. **Fallback is always sales** — lines 59, 65, 67: every fallback returns "Deals", "Contacts", "Accounts".

---

## SECTION 2 — INPUT FLEXIBILITY TEST

### Test 1: "study for exam tomorrow"

- **Classification:** `classifyMessage()` checks `isQuestion()` → no. `isEmailIntent()` → no. `isNewDealSignal()` → no. `isMeetingContext()` → no. No deal name match. Falls to **general_intel** bucket.
- **Structure created:** Saved as an `InteractionRow` with `type: 'note'`, `deal_id: null`.
- **Tasks generated:** Zero. The task engine only generates tasks from meetings and deals. There is no concept of a standalone task.
- **Bias:** The input is captured but orphaned. No task is created. No reminder is set. The system doesn't understand "tomorrow" as a deadline. A student would expect this to create a task with a due date. **The system has no standalone task concept — everything must attach to a deal or meeting.**

### Test 2: "call my mom"

- **Classification:** No question, no email, no new deal signal, no meeting context. Falls to **general_intel**.
- **Structure created:** Saved as a note with no linkage.
- **Tasks generated:** Zero.
- **Bias:** The system cannot represent a personal relationship (mom) because `ContactRow` requires an `account_id` (a business organization). There's no way to create a person without a company. **The data model makes personal contacts impossible.**

### Test 3: "gym at 6"

- **Classification:** Falls to **general_intel**.
- **Structure created:** Saved as a note.
- **Tasks generated:** Zero. No meeting created because the system only creates meetings through calendar import or explicit meeting-context language ("meeting went", "call with", etc.).
- **Bias:** The system doesn't recognize this as a time-bound event. A universal system should create a calendar-like entry. **Events that aren't "meetings" don't exist in the data model.**

### Test 4: "finish project proposal"

- **Classification:** If user has a deal with "project proposal" in the name, it matches as `existing_deal_update`. Otherwise, falls to **general_intel**.
- **Structure created:** Note, possibly linked to a deal.
- **Tasks generated:** Zero (unless the deal is stale, which generates a reengage task).
- **Bias:** Moderate. This works better than the others because it resembles business language. But the system still can't create a to-do from this. **"Finish" implies a task, but no task is created.**

---

## SECTION 3 — TASK GENERATION AUDIT

### How Tasks Are Created

The task engine (`task-engine.ts`) derives tasks from exactly two sources:

1. **Meetings** → `meeting_prep` or `meeting_followup`
2. **Deals** → `deal_next_step` or `reengage`

That's it. There is no mechanism to create a task from:
- A user's direct request ("remind me to...")
- A personal commitment ("call my mom")
- A time-based event ("gym at 6")
- A standalone to-do ("finish the proposal")
- An academic deadline ("exam tomorrow")

### Specific Gaps

| Gap | Evidence | Impact |
|-----|----------|--------|
| No user-created tasks | `task-types.ts` line 2: "Tasks are NEVER user-created" | Users cannot add their own tasks |
| No standalone tasks | Every `SystemTask` requires a `contextId` linking to a meeting or deal | Personal tasks have nowhere to live |
| Follow-up bias | 2 of 4 task types are follow-ups (meeting_followup, reengage) | System assumes work is about following up with others |
| Deal-centric priorities | `deal_next_step` priority uses deal stage and monetary value (`deal.value >= 10000`) | Priority logic is meaningless outside sales |
| No deadline concept | No field for due date or target date on any task | Can't represent "exam tomorrow" or "report due Friday" |

### Task Types Breakdown

- `meeting_prep` — universal (anyone has meetings)
- `meeting_followup` — mostly universal but uses "debrief" language
- `deal_next_step` — sales-specific (assumes deals with stages)
- `reengage` — sales-specific (assumes stale external relationships to re-engage)

**2 of 4 task types are sales-only.**

---

## SECTION 4 — DATA MODEL AUDIT

### Core Objects

| Object | Domain-Specific? | Issues |
|--------|-------------------|--------|
| **DealRow** | Yes — entirely | Name, stages (Prospect→Closed Won), value/MRR/ARR, intel_score, momentum_score, signal_velocity, snoozed_until. This is a CRM record. |
| **AccountRow** | Yes | Exists solely to represent a company/organization in a sales context. Has industry, website. |
| **ContactRow** | Yes | Requires `account_id` (must belong to a company). Has `is_champion`, `relationship_temperature`, `linkedin_url`. |
| **MeetingRow** | Mostly neutral | Meetings are universal. But `deal_id` foreign key assumes meetings relate to deals. |
| **InteractionRow** | Partially neutral | Good general structure, but types are limited: debrief, email_received, email_sent, draft, idea, note, meeting_log. Missing: task, reminder, event, habit. |
| **SignalRow** | Yes — entirely | Signal types: champion_identified, budget_mentioned, competitor_mentioned, objection_raised. These are all sales signals. |
| **KnowledgeBaseRow** | Yes | Fields: product_name, target_use_cases, is_active_deal. Assumes user sells a product. |
| **IdeaRow** | Neutral | Simple: content, status, optional deal_id. Works for anyone. |

### Can These Map to Universal Concepts?

| Universal Concept | Current Mapping | Fit |
|-------------------|-----------------|-----|
| **Event** (gym, dinner, class) | MeetingRow | Poor — requires deal linkage, has prep/debrief assumptions |
| **Task** (study, call mom, buy groceries) | None | **No mapping exists** |
| **Person** (mom, friend, professor) | ContactRow | Poor — requires AccountRow parent |
| **Context** (school, home, work project) | AccountRow / DealRow | Poor — AccountRow has industry/website fields; DealRow has sales stages |
| **Note** (thought, observation) | InteractionRow | Adequate — works as general capture |
| **Reminder** (take medicine, pay bill) | None | **No mapping exists** |

### Structural Mismatches

1. **ContactRow requires account_id** — Cannot represent people without organizations.
2. **DealStage is an enum of 7 sales stages** — Cannot represent project phases, academic terms, or life categories.
3. **SignalType is 100% sales** — 15 signal types, every one is a sales signal. Zero personal or academic signals.
4. **No standalone task entity** — The system philosophically rejects user-created tasks.
5. **No date/deadline field on any item** — Deals have `last_activity_at` but nothing has a target/due date.

---

## SECTION 5 — CONTROL PANEL AUDIT

### "What Matters" Section

- Works for sales: shows stale deals and upcoming prep tasks.
- Fails for non-work: cannot show personal tasks, deadlines, reminders, or life events.
- The section title ("What matters") is universal, but its contents are entirely deal-derived.

### Module Priority System

The `module-priority.ts` evaluates 5 modules: `system_tasks`, `needs_attention`, `upcoming_meetings`, `top_deals`, `deep_links`.

- `needs_attention` is defined as "deals stale > X days." Personal items can never trigger this.
- `top_deals` ranks by deal stage, monetary value, and momentum score. Meaningless for a student.
- `system_tasks` only contains deal and meeting tasks (see Section 3).
- `upcoming_meetings` is universal.
- `deep_links` hardcodes: All deals, Meetings, Ideas, Briefing, Settings.

### Deep Links

The deep links section shows: "All deals", "Meetings", "Ideas", "Briefing", "Settings". The semantic layer relabels "All deals" but the underlying page is still `/deals` with DealStage filters.

### Empty State

`isLowDataState` message: "Your world is taking shape." — Good, neutral.
Low data guidance: "Add [deals] and meetings to get started." — Biased. A student shouldn't be told to add deals.

### Dashboard Feel

The control panel feels like a **sales dashboard** because:
- Every card shows deal names with stage badges and monetary values
- Attention scoring uses deal-specific metrics (staleness, deal value, pipeline stage)
- Color coding follows CRM conventions (amber for stale, green for active)
- The "Everything else" section is literally a deals list sorted by revenue relevance

---

## SECTION 6 — ASSISTANT BEHAVIOR AUDIT

### System Prompt Analysis

From `chat-home/route.ts` line 249:

> "You are Jove, a personal intelligence assistant. You help the user manage deals, relationships, and decisions using their real data."

This opening line tells the LLM that Jove is about **deals and relationships.** A universal system would say something like "You help the user organize what matters to them."

### Context Blocks

- `ACTIVE DEALS:` — header in the system prompt context block
- `FOCUSED DEAL:` — header when a specific deal is referenced
- `WHAT YOU SELL:` — knowledge base header
- `VOICE PROFILE:` — used for email drafting (neutral)
- `RECENT SIGNALS:` — shows sales signals (champion_identified, etc.)

### Domain Prompt Block

`getDomainPromptBlock()` injects domain language but defaults to sales. The instruction says: "Always prefer these terms over internal system names like 'deals', 'contacts', or 'accounts'." But the context data still uses internal names.

### Tone

The 14 response rules (lines 271-293) are well-written and universal. Tone is neutral. No sales jargon in the rules themselves.

### Classification Bias

`chat-intelligence.ts` new-deal detection keywords:
- "new deal", "new opportunity", "new prospect", "new lead", "got a lead", "potential deal", "new pipeline", "inbound from", "referred to me"

Every keyword assumes sales context. Missing: "new project", "new class", "new goal", "starting something", "working on something new".

### Acknowledgment Messages

`getAcknowledgment()` returns: "Got it — added to [deal name]." / "Saved that." / "Saved." — Neutral language. This is fine.

---

## SECTION 7 — SUMMARY

### Top 10 Non-Universal Elements

| # | Element | Severity | Location |
|---|---------|----------|----------|
| 1 | **DealRow is the primary entity** — stages, value, MRR/ARR all hardcoded to sales | Critical | `types.ts` |
| 2 | **No standalone task concept** — tasks are system-derived from deals/meetings only | Critical | `task-engine.ts`, `task-types.ts` |
| 3 | **ContactRow requires account_id** — personal contacts impossible | Critical | `types.ts` |
| 4 | **Onboarding asks sales questions** — "What do you sell?", "What company do you sell for?" | Critical | `onboarding/page.tsx` |
| 5 | **DealStage enum is a sales pipeline** — Prospect through Closed Won/Lost | High | `types.ts` |
| 6 | **SignalType is 100% sales** — 15 signals, all sales-specific | High | `types.ts` |
| 7 | **System prompt declares deal/relationship focus** — "You help the user manage deals, relationships, and decisions" | High | `chat-home/route.ts` |
| 8 | **Semantic layer defaults to sales and isn't persisted** — domain_key never saved to DB | High | `semantic-labels.ts`, `types.ts` |
| 9 | **Task priority uses deal value ($10k thresholds)** — meaningless outside sales | Medium | `task-engine.ts` |
| 10 | **Classification keywords are all sales** — "new deal", "pipeline", "prospect", "lead" | Medium | `chat-intelligence.ts` |

### Required Changes

**Language:**
- Replace all onboarding questions with universal alternatives
- Rename system prompt identity from deal-focused to general
- Add non-sales keywords to classification engine
- Change context block headers (ACTIVE DEALS → ACTIVE ITEMS, WHAT YOU SELL → WHAT YOU DO)

**Logic:**
- Allow user-created tasks (break the "tasks are NEVER user-created" rule)
- Make contact creation independent of accounts
- Add deadline/due-date concept to tasks
- Expand classification to recognize personal inputs
- Remove monetary value from task prioritization (or make it optional)

**Structure:**
- Generalize DealRow into a flexible primary entity with configurable stages
- Make AccountRow optional (not required for contacts)
- Add generic signal types alongside sales-specific ones
- Persist domain_key to database and wire it to onboarding
- Add a standalone Task table separate from system-derived tasks

### Universality Verdict

**Still domain-biased.**

The semantic layer (Session 3) was a step in the right direction but only scratches the surface. It relabels 3 nouns while the data model, task engine, classification logic, onboarding flow, system prompt, and scoring algorithms all remain structurally bound to sales workflows.

A student opening Jove today would be asked what they sell, shown an empty deals pipeline, and have no way to create a task, add a personal contact, or track a deadline.

The system works for sales professionals. It does not work equally well for anyone else.

---

*End of audit. Ready for Session 11 — Universal Abstraction Layer Fix.*
