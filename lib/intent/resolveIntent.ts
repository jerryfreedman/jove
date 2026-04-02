// ── SESSION 2: INTENT RESOLUTION ────────────────────────────
// Deterministic, pattern-based intent classification.
// Input text + context → structured intent with confidence.
//
// No AI/ML. No overfit. Explicit, readable rules.
// Conservative: "unknown" when unsure.

import type { CaptureContextType, CaptureContextConfidence } from '@/lib/universal-capture-types';

// ── INTENT TYPES ────────────────────────────────────────────

export type IntentType = 'update' | 'complete' | 'reschedule' | 'note' | 'unknown';
export type IntentConfidence = 'high' | 'medium' | 'low';

export interface ResolvedIntent {
  type: IntentType;
  confidence: IntentConfidence;
  entities?: {
    date?: Date;
    time?: string;
    keywords?: string[];
  };
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

// ── MAIN RESOLVER ───────────────────────────────────────────

export function resolveIntent(input: ResolveIntentInput): ResolvedIntent {
  const { text, contextType, contextConfidence } = input;
  const trimmed = text.trim();

  // ── GUARD: empty / extremely short / pure whitespace ──────
  if (!trimmed || trimmed.length === 0) {
    return { type: 'unknown', confidence: 'high' };
  }

  // ── UNKNOWN detection (highest priority — blocks false positives) ──
  for (const pattern of UNKNOWN_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { type: 'unknown', confidence: 'high' };
    }
  }

  // ── COMPLETE detection ────────────────────────────────────
  for (const pattern of COMPLETE_PATTERNS) {
    if (pattern.test(trimmed)) {
      // High confidence only with strong context
      const confidence = resolveConfidence(contextType, contextConfidence, 'complete');
      return { type: 'complete', confidence };
    }
  }

  // ── RESCHEDULE detection ──────────────────────────────────
  for (const pattern of RESCHEDULE_PATTERNS) {
    if (pattern.test(trimmed)) {
      const date = parseRescheduleDate(trimmed);
      const time = parseTimeReference(trimmed);
      const confidence = resolveConfidence(contextType, contextConfidence, 'reschedule');
      return {
        type: 'reschedule',
        confidence,
        entities: {
          date,
          time,
          keywords: extractKeywords(trimmed),
        },
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
      const confidence = resolveConfidence(contextType, contextConfidence, 'reschedule');
      return {
        type: 'reschedule',
        confidence,
        entities: {
          date,
          time,
          keywords: extractKeywords(trimmed),
        },
      };
    }
  }

  // ── UPDATE detection ──────────────────────────────────────
  for (const pattern of UPDATE_PATTERNS) {
    if (pattern.test(trimmed)) {
      const confidence = resolveConfidence(contextType, contextConfidence, 'update');
      return {
        type: 'update',
        confidence,
        entities: {
          keywords: extractKeywords(trimmed),
        },
      };
    }
  }

  // ── NOTE detection (descriptive input — fallback) ─────────
  // Longer text with contextual detail defaults to "note"
  if (trimmed.length >= 15) {
    return {
      type: 'note',
      confidence: 'medium',
      entities: {
        keywords: extractKeywords(trimmed),
      },
    };
  }

  // ── Short but not matching anything → unknown ─────────────
  return { type: 'unknown', confidence: 'low' };
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
