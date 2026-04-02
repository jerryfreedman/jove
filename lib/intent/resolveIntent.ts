// ── SESSION 2 + SESSION 3: INTENT RESOLUTION ───────────────
// Deterministic, pattern-based intent classification.
// Input text + context → structured intent with confidence.
//
// Session 2: Base patterns + confidence.
// Session 3: Context-aware boosting, entity extraction,
//            multi-intent handling, entity linking.
//
// No AI/ML. No overfit. Explicit, readable rules.
// Conservative: "unknown" when unsure.

import type { CaptureContextType, CaptureContextConfidence } from '@/lib/universal-capture-types';

// ── INTENT TYPES ────────────────────────────────────────────

export type IntentType = 'update' | 'complete' | 'reschedule' | 'note' | 'unknown';
export type IntentConfidence = 'high' | 'medium' | 'low';

// ── SESSION 3: ENTITY SIGNALS ──────────────────────────────

export type ReferenceType = 'call' | 'meeting' | 'deal' | 'task';

export interface EntitySignals {
  date?: Date;
  time?: string;
  keywords?: string[];
  /** Session 3: Extracted person name (basic matching) */
  personName?: string;
  /** Session 3: Detected status keyword */
  statusKeyword?: string;
  /** Session 3: Detected reference type */
  referenceType?: ReferenceType;
}

// ── SESSION 3: MULTI-INTENT ────────────────────────────────

export interface SecondaryIntent {
  type: IntentType;
  confidence: IntentConfidence;
}

// ── RESOLVED INTENT ─────────────────────────────────────────

export interface ResolvedIntent {
  type: IntentType;
  confidence: IntentConfidence;
  entities?: EntitySignals;
  /** Session 3: Secondary intent detected but not executed */
  secondaryIntent?: SecondaryIntent;
  /** Session 3: Whether contextId should be trusted for linking */
  entityLinkStrength: 'strong' | 'suggestive' | 'none';
  /** Session 3: Context adjustments applied (for logging) */
  contextBoostApplied?: string;
}

export interface ResolveIntentInput {
  text: string;
  contextType: CaptureContextType;
  contextId?: string;
  contextConfidence: CaptureContextConfidence;
}

// ── DETECTION PATTERNS ──────────────────────────────────────

const COMPLETE_PATTERNS: RegExp[] = [
  /^done\.?$/i,
  /^finished\.?$/i,
  /^sent\.?$/i,
  /^completed\.?$/i,
  /^shipped\.?$/i,
  /^handled\.?$/i,
  /^taken care of\.?$/i,
  /^all (done|good|set)\.?$/i,
  /^it'?s done\.?$/i,
  /^that'?s done\.?$/i,
  /^done with (it|this|that)\.?$/i,
];

const RESCHEDULE_PATTERNS: RegExp[] = [
  /^moved\b/i,
  /^rescheduled\b/i,
  /^pushed\b/i,
  /^postponed\b/i,
  /^shifted\b/i,
  /^bumped\b/i,
  /^moved to\b/i,
  /^pushed to\b/i,
  /^rescheduled (?:to|for)\b/i,
];

const UPDATE_PATTERNS: RegExp[] = [
  /\bblocked\b/i,
  /\bwaiting\b/i,
  /\bdelayed\b/i,
  /\bissue\b/i,
  /\bstuck\b/i,
  /\bon hold\b/i,
  /\bpending\b/i,
  /\bstalled\b/i,
  /\bno progress\b/i,
  /\bhit a wall\b/i,
  /\bneed(?:s)? (?:help|input|approval)\b/i,
  /\bpartially\b/i,
  /\bin progress\b/i,
  /\bhalf done\b/i,
  /\bstarted but\b/i,
];

const UNKNOWN_PATTERNS: RegExp[] = [
  /^idk\.?$/i,
  /^i don'?t know\.?$/i,
  /^nothing\.?$/i,
  /^n\/a\.?$/i,
  /^nope\.?$/i,
  /^no\.?$/i,
  /^not sure\.?$/i,
  /^\?+$/,
  /^\.+$/,
  /^-+$/,
];

// ── SESSION 3: REFERENCE TYPE PATTERNS ─────────────────────

const REFERENCE_PATTERNS: { pattern: RegExp; type: ReferenceType }[] = [
  { pattern: /\bcall(?:ed|ing|s)?\b/i, type: 'call' },
  { pattern: /\bmeeting(?:s)?\b/i, type: 'meeting' },
  { pattern: /\bdeal(?:s)?\b/i, type: 'deal' },
  { pattern: /\btask(?:s)?\b/i, type: 'task' },
  { pattern: /\bproposal(?:s)?\b/i, type: 'deal' },
];

// ── SESSION 3: STATUS KEYWORD PATTERNS ─────────────────────

const STATUS_KEYWORDS: string[] = [
  'blocker', 'blocked', 'waiting', 'delayed', 'stuck',
  'on hold', 'pending', 'stalled', 'done', 'complete',
  'in progress', 'started', 'shipped', 'sent', 'finished',
];

// ── SESSION 3: CONTEXT BIAS MAP ────────────────────────────
// Maps contextType to intent types that should be boosted.

const CONTEXT_INTENT_BIAS: Record<string, IntentType[]> = {
  task:    ['complete', 'update'],
  event:   ['reschedule', 'note'],
  meeting: ['reschedule', 'note'],
  item:    ['update', 'note'],
  person:  ['note'],
  deal:    ['update', 'note'],
};

// ── DATE/TIME PATTERNS FOR RESCHEDULE ───────────────────────

const DAY_NAMES: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

const TIME_REFERENCE_PATTERN =
  /\b(tomorrow|today|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|next week)\b/i;

/**
 * Parse a reschedule target date from text using user's local time.
 * Returns a Date in local time, or undefined if no date pattern found.
 */
function parseRescheduleDate(text: string): Date | undefined {
  const lower = text.toLowerCase().trim();
  const now = new Date();

  // "tomorrow"
  if (/\btomorrow\b/i.test(lower)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d;
  }

  // "next week" → next Monday
  if (/\bnext week\b/i.test(lower)) {
    const d = new Date(now);
    const daysUntilMonday = ((1 - d.getDay()) + 7) % 7 || 7;
    d.setDate(d.getDate() + daysUntilMonday);
    d.setHours(9, 0, 0, 0);
    return d;
  }

  // Weekday names
  for (const [name, targetDay] of Object.entries(DAY_NAMES)) {
    const pattern = new RegExp(`\\b${name}\\b`, 'i');
    if (pattern.test(lower)) {
      const d = new Date(now);
      const currentDay = d.getDay();
      let daysUntil = (targetDay - currentDay + 7) % 7;
      // If the target day is today, push to next week
      if (daysUntil === 0) daysUntil = 7;
      d.setDate(d.getDate() + daysUntil);
      d.setHours(9, 0, 0, 0);
      return d;
    }
  }

  return undefined;
}

/**
 * Extract time string from text (e.g., "at 3pm" → "3pm").
 */
function parseTimeReference(text: string): string | undefined {
  const timeMatch = text.match(/\bat\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i);
  if (timeMatch) return timeMatch[1];
  return undefined;
}

// ── SESSION 3: ENTITY EXTRACTION ────────────────────────────

/**
 * Extract entity signals from text (basic pattern matching, no NER).
 */
function extractEntitySignals(text: string): Pick<EntitySignals, 'personName' | 'statusKeyword' | 'referenceType'> {
  const result: Pick<EntitySignals, 'personName' | 'statusKeyword' | 'referenceType'> = {};

  // ── Status keyword extraction ────────────────────────────
  const lower = text.toLowerCase();
  for (const keyword of STATUS_KEYWORDS) {
    if (lower.includes(keyword)) {
      result.statusKeyword = keyword;
      break;
    }
  }

  // ── Reference type extraction ────────────────────────────
  for (const { pattern, type } of REFERENCE_PATTERNS) {
    if (pattern.test(text)) {
      result.referenceType = type;
      break;
    }
  }

  // ── Simple person name extraction ────────────────────────
  // Matches patterns like "with John", "from Sarah", "tell Mike"
  // Only matches capitalized single/two-word names after prepositions.
  const nameMatch = text.match(/\b(?:with|from|tell|ask|cc|for|to|by)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/);
  if (nameMatch) {
    result.personName = nameMatch[1];
  }

  return result;
}

// ── SESSION 3: MULTI-INTENT DETECTION ──────────────────────

/**
 * Detect if text contains multiple intent signals.
 * Returns a secondary intent if found (comma/and-separated clauses).
 */
function detectSecondaryIntent(
  text: string,
  primaryType: IntentType,
  contextType: CaptureContextType,
  contextConfidence: CaptureContextConfidence,
): SecondaryIntent | undefined {
  // Only attempt on longer, multi-clause inputs
  if (text.length < 20) return undefined;

  // Split on comma or "and" to look for a second clause
  const clauses = text.split(/,\s*|\s+and\s+/i).filter(c => c.trim().length > 3);
  if (clauses.length < 2) return undefined;

  // Check remaining clauses (skip first, as it produced the primary)
  for (let i = 1; i < clauses.length; i++) {
    const clause = clauses[i].trim();

    // Check for complete signals
    for (const pattern of COMPLETE_PATTERNS) {
      if (pattern.test(clause)) {
        if (primaryType !== 'complete') {
          return { type: 'complete', confidence: resolveConfidence(contextType, contextConfidence, 'complete') };
        }
      }
    }

    // Check for reschedule signals
    for (const pattern of RESCHEDULE_PATTERNS) {
      if (pattern.test(clause)) {
        if (primaryType !== 'reschedule') {
          return { type: 'reschedule', confidence: resolveConfidence(contextType, contextConfidence, 'reschedule') };
        }
      }
    }

    // Check for update signals
    for (const pattern of UPDATE_PATTERNS) {
      if (pattern.test(clause)) {
        if (primaryType !== 'update') {
          return { type: 'update', confidence: resolveConfidence(contextType, contextConfidence, 'update') };
        }
      }
    }

    // If the secondary clause is descriptive enough, flag as note
    if (clause.length >= 15 && primaryType !== 'note') {
      return { type: 'note', confidence: 'medium' };
    }
  }

  return undefined;
}

// ── SESSION 3: ENTITY LINK STRENGTH ─────────────────────────

/**
 * Determine how strongly the resolved intent should link to the contextId.
 * Based on contextConfidence and keyword validation.
 */
function resolveEntityLinkStrength(
  contextConfidence: CaptureContextConfidence,
  entitySignals: Pick<EntitySignals, 'personName' | 'statusKeyword' | 'referenceType'>,
): 'strong' | 'suggestive' | 'none' {
  // HIGH context confidence → trust contextId
  if (contextConfidence === 'high') {
    return 'strong';
  }

  // MEDIUM → prefer contextId but validate via keywords
  if (contextConfidence === 'medium') {
    // If we extracted meaningful entity signals, boost to suggestive
    if (entitySignals.statusKeyword || entitySignals.referenceType) {
      return 'suggestive';
    }
    return 'suggestive';
  }

  // LOW → do NOT link strongly
  return 'none';
}

// ── MAIN RESOLVER ───────────────────────────────────────────

export function resolveIntent(input: ResolveIntentInput): ResolvedIntent {
  const { text, contextType, contextConfidence } = input;
  const trimmed = text.trim();

  // ── GUARD: empty / extremely short / pure whitespace ──────
  if (!trimmed || trimmed.length === 0) {
    return { type: 'unknown', confidence: 'high', entityLinkStrength: 'none' };
  }

  // ── UNKNOWN detection (highest priority — blocks false positives) ──
  for (const pattern of UNKNOWN_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { type: 'unknown', confidence: 'high', entityLinkStrength: 'none' };
    }
  }

  // ── Session 3: Extract entity signals early ───────────────
  const entitySignals = extractEntitySignals(trimmed);
  const entityLinkStrength = resolveEntityLinkStrength(contextConfidence, entitySignals);

  // ── COMPLETE detection ────────────────────────────────────
  for (const pattern of COMPLETE_PATTERNS) {
    if (pattern.test(trimmed)) {
      const baseConfidence = resolveConfidence(contextType, contextConfidence, 'complete');
      // Session 3: Context-aware boost
      const confidence = applyContextBoost(baseConfidence, contextType, 'complete');
      const secondaryIntent = detectSecondaryIntent(trimmed, 'complete', contextType, contextConfidence);

      logIntentResolution(trimmed, 'complete', confidence, contextType, entitySignals, baseConfidence !== confidence ? 'context_boost_task→complete' : undefined);

      return {
        type: 'complete',
        confidence,
        entities: { ...entitySignals, keywords: extractKeywords(trimmed) },
        secondaryIntent,
        entityLinkStrength,
        contextBoostApplied: baseConfidence !== confidence ? 'context_boost_task→complete' : undefined,
      };
    }
  }

  // ── RESCHEDULE detection ──────────────────────────────────
  for (const pattern of RESCHEDULE_PATTERNS) {
    if (pattern.test(trimmed)) {
      const date = parseRescheduleDate(trimmed);
      const time = parseTimeReference(trimmed);
      const baseConfidence = resolveConfidence(contextType, contextConfidence, 'reschedule');
      const confidence = applyContextBoost(baseConfidence, contextType, 'reschedule');
      const secondaryIntent = detectSecondaryIntent(trimmed, 'reschedule', contextType, contextConfidence);

      logIntentResolution(trimmed, 'reschedule', confidence, contextType, entitySignals, baseConfidence !== confidence ? 'context_boost_event→reschedule' : undefined);

      return {
        type: 'reschedule',
        confidence,
        entities: {
          ...entitySignals,
          date,
          time,
          keywords: extractKeywords(trimmed),
        },
        secondaryIntent,
        entityLinkStrength,
        contextBoostApplied: baseConfidence !== confidence ? 'context_boost_event→reschedule' : undefined,
      };
    }
  }

  // Also catch inputs that contain time references even without explicit "moved/pushed"
  // but only in an active context (task/event/meeting)
  if (
    TIME_REFERENCE_PATTERN.test(trimmed) &&
    (contextType === 'task' || contextType === 'event' || contextType === 'meeting') &&
    trimmed.split(/\s+/).length <= 6 // Short phrase = likely reschedule
  ) {
    const date = parseRescheduleDate(trimmed);
    const time = parseTimeReference(trimmed);
    if (date) {
      const baseConfidence = resolveConfidence(contextType, contextConfidence, 'reschedule');
      const confidence = applyContextBoost(baseConfidence, contextType, 'reschedule');

      logIntentResolution(trimmed, 'reschedule', confidence, contextType, entitySignals, 'implicit_time_reference');

      return {
        type: 'reschedule',
        confidence,
        entities: {
          ...entitySignals,
          date,
          time,
          keywords: extractKeywords(trimmed),
        },
        entityLinkStrength,
        contextBoostApplied: 'implicit_time_reference',
      };
    }
  }

  // ── UPDATE detection ──────────────────────────────────────
  for (const pattern of UPDATE_PATTERNS) {
    if (pattern.test(trimmed)) {
      const baseConfidence = resolveConfidence(contextType, contextConfidence, 'update');
      const confidence = applyContextBoost(baseConfidence, contextType, 'update');
      const secondaryIntent = detectSecondaryIntent(trimmed, 'update', contextType, contextConfidence);

      logIntentResolution(trimmed, 'update', confidence, contextType, entitySignals, baseConfidence !== confidence ? 'context_boost→update' : undefined);

      return {
        type: 'update',
        confidence,
        entities: {
          ...entitySignals,
          keywords: extractKeywords(trimmed),
        },
        secondaryIntent,
        entityLinkStrength,
        contextBoostApplied: baseConfidence !== confidence ? 'context_boost→update' : undefined,
      };
    }
  }

  // ── NOTE detection (descriptive input — fallback) ─────────
  // Longer text with contextual detail defaults to "note"
  if (trimmed.length >= 15) {
    const secondaryIntent = detectSecondaryIntent(trimmed, 'note', contextType, contextConfidence);
    // Session 3: Person context biases toward note
    const noteConfidence: IntentConfidence = contextType === 'person' ? 'medium' : 'medium';

    logIntentResolution(trimmed, 'note', noteConfidence, contextType, entitySignals, contextType === 'person' ? 'context_bias_person→note' : undefined);

    return {
      type: 'note',
      confidence: noteConfidence,
      entities: {
        ...entitySignals,
        keywords: extractKeywords(trimmed),
      },
      secondaryIntent,
      entityLinkStrength,
      contextBoostApplied: contextType === 'person' ? 'context_bias_person→note' : undefined,
    };
  }

  // ── Short but not matching anything → unknown ─────────────
  logIntentResolution(trimmed, 'unknown', 'low', contextType, entitySignals, undefined);
  return { type: 'unknown', confidence: 'low', entityLinkStrength: 'none' };
}

// ── CONFIDENCE RESOLVER ─────────────────────────────────────
// Combines pattern match with context strength.
// Only HIGH when both pattern + context are strong.

function resolveConfidence(
  contextType: CaptureContextType,
  contextConfidence: CaptureContextConfidence,
  intentType: IntentType,
): IntentConfidence {
  // Strong context (task/event/meeting with high confidence) → high
  const hasStrongContext =
    contextConfidence === 'high' &&
    (contextType === 'task' || contextType === 'event' || contextType === 'meeting' || contextType === 'item');

  // Complete/reschedule need strong context to be high confidence
  if (intentType === 'complete' || intentType === 'reschedule') {
    if (hasStrongContext) return 'high';
    if (contextConfidence === 'medium') return 'medium';
    return 'low';
  }

  // Updates are lower stakes — medium context is enough for medium confidence
  if (intentType === 'update') {
    if (hasStrongContext) return 'high';
    return 'medium';
  }

  return 'medium';
}

// ── SESSION 3: CONTEXT-AWARE BOOST ──────────────────────────
// Upgrades confidence when context type aligns with intent type.
// NEVER upgrades to 'high' — only low→medium when context matches.
// This ensures the core safety rule (only mutate on HIGH) is preserved.

function applyContextBoost(
  baseConfidence: IntentConfidence,
  contextType: CaptureContextType,
  intentType: IntentType,
): IntentConfidence {
  // Never boost beyond what resolveConfidence already determined
  if (baseConfidence === 'high') return 'high';

  const biasedIntents = CONTEXT_INTENT_BIAS[contextType];
  if (!biasedIntents) return baseConfidence;

  // If this intent type is biased for this context, boost low → medium
  if (biasedIntents.includes(intentType) && baseConfidence === 'low') {
    return 'medium';
  }

  return baseConfidence;
}

// ── KEYWORD EXTRACTION ──────────────────────────────────────
// Simple stop-word filtered extraction. No NLP.

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been',
  'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
  'it', 'its', 'this', 'that', 'i', 'we', 'they', 'my', 'our',
  'and', 'or', 'but', 'not', 'so', 'if', 'as', 'do', 'did',
  'has', 'had', 'have', 'will', 'would', 'could', 'should',
  'just', 'still', 'also', 'very', 'really', 'quite',
]);

function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

// ── SESSION 3: INTENT RESOLUTION LOGGING ────────────────────
// Enhanced debug logging with context + entity info.

function logIntentResolution(
  text: string,
  intentType: IntentType,
  confidence: IntentConfidence,
  contextType: CaptureContextType,
  entitySignals: Pick<EntitySignals, 'personName' | 'statusKeyword' | 'referenceType'>,
  contextBoost: string | undefined,
): void {
  if (typeof console !== 'undefined') {
    console.debug('[intent-resolution]', {
      input: text.slice(0, 80),
      intentType,
      confidence,
      contextType,
      entitySignals: {
        personName: entitySignals.personName ?? null,
        statusKeyword: entitySignals.statusKeyword ?? null,
        referenceType: entitySignals.referenceType ?? null,
      },
      contextBoostApplied: contextBoost ?? 'none',
      timestamp: new Date().toISOString(),
    });
  }
}
