// ── INPUT HANDLER ────────────────────────────────────────────
// Pre-persistence gate for all input surfaces.
// Chat and bird share the same handler — one system, one decision model.
//
// Flow:
//   1. Classify intent (intent-router.ts)
//   2. Choose persistence mode
//   3. Choose response mode
//   4. Only then route to: create task / create interaction / answer only / ignore
//
// This module bridges intent classification with the existing persistence
// layer (capture-utils, task-persistence, universal-routing).
//
// Truthfulness rule: response text must reflect actual handling.
//   - persistenceMode = 'none'  → never say "I added that"
//   - persistenceMode = 'task'  → confirm clearly
//   - persistenceMode = 'interaction' → acknowledge context captured
//
// No LLM calls. No schema changes. No new tables.

import {
  routeInputIntent,
  type InputHandlingDecision,
  type InputIntent,
  type PersistenceMode,
  type ResponseMode,
  type IntentContext,
} from './intent-router';

// ── HANDLING RESULT ────────────────────────────────────────

export interface InputHandlingResult {
  /** The intent classification decision */
  decision: InputHandlingDecision;
  /** Whether persistence should proceed */
  shouldPersist: boolean;
  /** Suggested response text (personality-colored) */
  suggestedResponse: string | null;
  /** If persisting, what kind of record to create */
  persistAction: PersistAction;
}

export type PersistAction =
  | { kind: 'create_task' }
  | { kind: 'create_interaction'; interactionType: 'note' | 'debrief' | 'idea' }
  | { kind: 'update_existing' }
  | { kind: 'none' };

// ── MAIN HANDLER ───────────────────────────────────────────
// Single entry point for both chat and bird input surfaces.
// Returns a handling result that tells the caller exactly what to do.

export function handleInput(
  input: string,
  context?: IntentContext,
): InputHandlingResult {
  const trimmed = input.trim();

  // 1. Classify intent
  const decision = routeInputIntent(trimmed, context);

  // 2. Determine persistence action
  const persistAction = resolvePersistAction(decision);

  // 3. Determine if we should persist
  const shouldPersist = decision.persistenceMode !== 'none';

  // 4. Generate response suggestion
  const suggestedResponse = generateResponse(decision, trimmed);

  return {
    decision,
    shouldPersist,
    suggestedResponse,
    persistAction,
  };
}

// ── PERSISTENCE RESOLUTION ─────────────────────────────────
// Maps persistence mode to concrete action.

function resolvePersistAction(decision: InputHandlingDecision): PersistAction {
  switch (decision.persistenceMode) {
    case 'task':
      return { kind: 'create_task' };

    case 'interaction':
      return {
        kind: 'create_interaction',
        interactionType: resolveInteractionType(decision.intentType),
      };

    case 'update_existing':
      return { kind: 'update_existing' };

    case 'none':
      return { kind: 'none' };
  }
}

function resolveInteractionType(
  intent: InputIntent,
): 'note' | 'debrief' | 'idea' {
  switch (intent) {
    case 'context':
    case 'relationship_signal':
      return 'note';
    case 'reflection':
      return 'note';
    default:
      return 'note';
  }
}

// ── RESPONSE GENERATION ────────────────────────────────────
// Personality-colored responses that match the type of moment.
//
// Critical rule: response must reflect actual handling.
// If nothing was persisted, never say "I added that".
//
// Response pools are intentionally small and restrained.
// Playful must be brief, human, no cringe, no emojis by default.

const DECISIVE_RESPONSES: string[] = [
  'Got it. Tracking that.',
  'Locked in.',
  'On it.',
  'Got it.',
];

const DECISIVE_EVENT_RESPONSES: string[] = [
  'Got it. That\'s on the calendar.',
  'Locked in.',
  'Noted. Time is blocked.',
];

const CONTEXT_RESPONSES: string[] = [
  'Got it. That changes the picture.',
  'Noted. That\'s useful context.',
  'Good to know. Filed that away.',
  'Got it. That shifts things.',
];

const RELATIONSHIP_RESPONSES: string[] = [
  'Got it. That\'s a useful signal.',
  'Noted. Good to track that.',
  'Got it. That context matters.',
];

const REFLECTIVE_RESPONSES: string[] = [
  'A few things are competing for attention. Let\'s narrow it to one next move.',
  'That\'s worth acknowledging. What\'s the one thing that would help most right now?',
  'Let\'s untangle this. What\'s the highest-leverage thing to address first?',
];

const CONVERSATIONAL_RESPONSES: string[] = [
  'Got it.',
  'Yep.',
  'Makes sense.',
];

const PLAYFUL_RESPONSES: string[] = [
  'Handle that first.',
  'Probably not one for the system.',
  'You do you.',
  'All yours.',
];

const LIGHT_ACK_RESPONSES: string[] = [
  'Got it.',
  'Noted.',
];

function generateResponse(
  decision: InputHandlingDecision,
  input: string,
): string | null {
  const mode = decision.responseMode;

  switch (mode) {
    case 'decisive':
      return pickResponse(
        decision.intentType === 'event'
          ? DECISIVE_EVENT_RESPONSES
          : decision.intentType === 'context'
            ? CONTEXT_RESPONSES
            : decision.intentType === 'relationship_signal'
              ? RELATIONSHIP_RESPONSES
              : DECISIVE_RESPONSES,
        input,
      );

    case 'reflective':
      return pickResponse(REFLECTIVE_RESPONSES, input);

    case 'conversational':
      return pickResponse(CONVERSATIONAL_RESPONSES, input);

    case 'playful':
      return pickResponse(PLAYFUL_RESPONSES, input);

    case 'light_ack':
      return pickResponse(LIGHT_ACK_RESPONSES, input);

    default:
      return null;
  }
}

// ── RESPONSE PICKER ────────────────────────────────────────
// Simple deterministic selection based on input hash.
// Avoids randomness for testability, but varies with input.

function pickResponse(pool: string[], input: string): string {
  if (pool.length === 0) return 'Got it.';
  const hash = simpleHash(input);
  return pool[hash % pool.length];
}

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0; // Force 32-bit int
  }
  return Math.abs(hash);
}

// ── RESPONSE VALIDATION ────────────────────────────────────
// Ensures responses match actual handling. Critical for truthfulness.

export function validateResponseTruthfulness(
  result: InputHandlingResult,
): boolean {
  const response = result.suggestedResponse;
  if (!response) return true;

  const lower = response.toLowerCase();

  // If nothing was persisted, response must NOT claim persistence
  if (!result.shouldPersist) {
    const falseClaims = [
      'added', 'saved', 'created', 'stored', 'recorded',
      'tracking', 'logged', 'captured', 'filed',
    ];
    for (const claim of falseClaims) {
      // Allow "tracking" in task responses where persistence happened
      if (lower.includes(claim)) {
        return false;
      }
    }
  }

  return true;
}
