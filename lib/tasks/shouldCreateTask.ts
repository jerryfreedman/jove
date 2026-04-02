// ── SESSION 15: TASK CREATION GUARD ─────────────────────────
// Single source of truth for whether input should become a task.
//
// A task MUST imply doing something specific.
// Notes are not tasks. Context is not a task.
//
// Returns { shouldCreate, reason } for transparency.
//
// Rules:
//   A. Explicit action intent ("call Monica tomorrow", "send proposal")
//   B. Strong derived action (deterministic follow-up that is clearly actionable)
//   C. Existing task mutation (user is updating/rescheduling an existing task)
//
// Rejects:
//   - Descriptive call notes / summaries
//   - Relationship/context updates
//   - Weak/no-progress input
//   - Ambiguous reflections
//   - Rich context with no explicit action

import { detectTaskIntent } from '@/lib/task-intent';

// ── RESULT TYPE ───────────────────────────────────────────────

export interface TaskCreationDecision {
  shouldCreate: boolean;
  reason: string;
  /** If true, the input is a task mutation (update/reschedule), not a new task */
  isMutation?: boolean;
}

// ── REJECT PATTERNS ───────────────────────────────────────────
// These patterns indicate the input is NOT task-worthy.

const NOTE_PATTERNS: RegExp[] = [
  // Call/meeting debrief
  /(?:call went|meeting went|demo went|presentation went|session went|just got off|just finished|after the call|debrief)/i,
  // Summaries / descriptions
  /(?:^(?:the|my|our|his|her|their)\s+(?:call|meeting|session|conversation|talk|chat)\b)/i,
  // Third-person narrative (notes about what happened)
  /^(?:they|he|she|we|the team|the client|the customer|the prospect|the partner)\s+(?:said|mentioned|asked|wants?|needs?|told|shared|presented|discussed|agreed|decided|confirmed|expressed|highlighted)/i,
  // Relationship/context updates
  /^(?:she|he|they)\s+(?:is|are|was|were|seems?|appears?|looks?|feels?)\b/i,
  // Past-tense recaps
  /^(?:we|they|i)\s+(?:discussed|talked about|went over|reviewed|covered|explored|had a good)\b/i,
  // Intelligence / notes
  /(?:key takeaway|takeaways|notes from|summary of|recap of|overview of|update on)/i,
];

const WEAK_INPUT_PATTERNS: RegExp[] = [
  /^idk\.?$/i,
  /^i don'?t know\.?$/i,
  /^nothing\.?$/i,
  /^nothing happened\.?$/i,
  /^not sure\.?$/i,
  /^no update\.?$/i,
  /^no progress\.?$/i,
  /^n\/a\.?$/i,
  /^nope\.?$/i,
  /^no\.?$/i,
  /^still waiting\.?$/i,
  /^waiting\.?$/i,
  /^same\.?$/i,
  /^\?+$/,
  /^\.+$/,
  /^-+$/,
  /^ok\.?$/i,
  /^okay\.?$/i,
  /^fine\.?$/i,
  /^sure\.?$/i,
  /^yep\.?$/i,
  /^yeah\.?$/i,
  /^got it\.?$/i,
  /^cool\.?$/i,
  /^thanks\.?$/i,
];

const QUESTION_PATTERNS: RegExp[] = [
  /^(what|who|how|why|when|where|which|can|should|could|would|is|are|do|does|did|has|have|tell me|summarize|give me|show me|explain)\b/i,
  /\?$/,
];

const VAGUE_REFLECTION_PATTERNS: RegExp[] = [
  /^i think\b/i,
  /^i feel like\b/i,
  /^i'm not sure\b/i,
  /^i wonder\b/i,
  /^i guess\b/i,
  /^maybe\s+(?:i\s+)?(?:should|could|might)\b/i,
  /^might\s+(?:need to|want to|be good to)\b/i,
  /^it would be nice\b/i,
  /^it might help\b/i,
];

// Multi-sentence detector: if input has 2+ sentences and no clear task verb, it's likely notes
const MULTI_SENTENCE = /[.!]\s+[A-Z]/;

// ── MAIN GUARD ────────────────────────────────────────────────

export function shouldCreateTask(
  text: string,
  options?: {
    /** If true, the input is in the context of an existing task */
    hasExistingTaskContext?: boolean;
    /** Confidence from intent resolution, if available */
    intentConfidence?: 'high' | 'medium' | 'low';
  },
): TaskCreationDecision {
  const trimmed = text.trim();

  // ── Empty / too short ───────────────────────────────────────
  if (trimmed.length < 4) {
    return { shouldCreate: false, reason: 'too_short' };
  }

  // ── Too long for a task (likely notes/narrative) ────────────
  if (trimmed.length > 200) {
    return { shouldCreate: false, reason: 'too_long_for_task' };
  }

  // ── Weak / no-progress input ────────────────────────────────
  for (const pattern of WEAK_INPUT_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { shouldCreate: false, reason: 'weak_input' };
    }
  }

  // ── Questions ───────────────────────────────────────────────
  for (const pattern of QUESTION_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { shouldCreate: false, reason: 'question' };
    }
  }

  // ── Note / debrief / summary patterns ───────────────────────
  for (const pattern of NOTE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { shouldCreate: false, reason: 'note_or_context' };
    }
  }

  // ── Vague reflections ───────────────────────────────────────
  for (const pattern of VAGUE_REFLECTION_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { shouldCreate: false, reason: 'vague_reflection' };
    }
  }

  // ── Multi-sentence input without explicit task intent ───────
  // If it has multiple sentences, it's likely notes unless it matches task patterns
  if (MULTI_SENTENCE.test(trimmed)) {
    // Only allow if detectTaskIntent finds a clear task
    const taskIntent = detectTaskIntent(trimmed);
    if (!taskIntent) {
      return { shouldCreate: false, reason: 'multi_sentence_notes' };
    }
    // Even with task intent in multi-sentence, only if short enough
    if (trimmed.length > 120) {
      return { shouldCreate: false, reason: 'multi_sentence_too_long' };
    }
  }

  // ── Rule C: Existing task mutation context ──────────────────
  if (options?.hasExistingTaskContext) {
    return { shouldCreate: false, reason: 'existing_task_mutation', isMutation: true };
  }

  // ── Rule A: Explicit action intent ──────────────────────────
  const taskIntent = detectTaskIntent(trimmed);
  if (taskIntent) {
    return { shouldCreate: true, reason: 'explicit_task_intent' };
  }

  // ── No task signal found ────────────────────────────────────
  return { shouldCreate: false, reason: 'no_task_signal' };
}

// ── DERIVED ACTION CHECK ──────────────────────────────────────
// For system-generated follow-ups: validates that a derived action
// is strong enough to become a task.

export function shouldCreateDerivedTask(
  suggestedTitle: string,
  confidence: 'high' | 'medium' | 'low' = 'medium',
): TaskCreationDecision {
  const trimmed = suggestedTitle.trim();

  if (trimmed.length < 4) {
    return { shouldCreate: false, reason: 'derived_too_short' };
  }

  // Only auto-create from high-confidence derived actions
  if (confidence !== 'high') {
    return { shouldCreate: false, reason: 'derived_low_confidence' };
  }

  // Must start with a verb-like word
  const firstWord = trimmed.split(/\s+/)[0]?.toLowerCase() ?? '';
  const ACTION_VERBS = new Set([
    'call', 'email', 'text', 'send', 'submit', 'follow', 'schedule',
    'book', 'cancel', 'prepare', 'prep', 'draft', 'review', 'check',
    'confirm', 'update', 'fix', 'resolve', 'complete', 'finish',
    'set', 'define', 'align', 'notify', 'share', 'provide',
  ]);

  if (!ACTION_VERBS.has(firstWord)) {
    return { shouldCreate: false, reason: 'derived_no_action_verb' };
  }

  return { shouldCreate: true, reason: 'strong_derived_action' };
}
