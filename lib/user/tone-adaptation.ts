// ── SESSION 16C: TONE ADAPTATION ────────────────────────────
// Adapts response tone gradually based on user behavior model.
//
// Rules:
//   - Changes must be subtle
//   - No abrupt tone shifts
//   - Maintain clarity at all times
//   - Tone shapes HOW things are shown, not WHAT is true
//
// Tone modes:
//   DIRECT    → shorter responses, sharper phrasing
//   REFLECTIVE → slightly more context
//   ACTION_ORIENTED → emphasize next step clearly
//   NEUTRAL   → default balanced tone (no adaptation)

import { getBehaviorModel, type TonePreference } from './behavior';

// ── TYPES ───────────────────────────────────────────────────

export interface ToneModifiers {
  /** Preferred max sentence count for responses */
  maxSentences: number;
  /** Whether to include brief context before actions */
  includeContext: boolean;
  /** Whether to lead with the next step */
  leadWithAction: boolean;
  /** Subtle phrasing adjustments */
  phrasingStyle: 'concise' | 'contextual' | 'action_first' | 'balanced';
}

// ── TONE → MODIFIER MAPPING ────────────────────────────────

const TONE_MODIFIERS: Record<TonePreference, ToneModifiers> = {
  direct: {
    maxSentences: 2,
    includeContext: false,
    leadWithAction: false,
    phrasingStyle: 'concise',
  },
  reflective: {
    maxSentences: 4,
    includeContext: true,
    leadWithAction: false,
    phrasingStyle: 'contextual',
  },
  action_oriented: {
    maxSentences: 3,
    includeContext: false,
    leadWithAction: true,
    phrasingStyle: 'action_first',
  },
  neutral: {
    maxSentences: 3,
    includeContext: true,
    leadWithAction: false,
    phrasingStyle: 'balanced',
  },
};

// ── PUBLIC API ──────────────────────────────────────────────

/**
 * Get current tone modifiers based on behavior model.
 * Returns neutral modifiers if insufficient data.
 */
export function getToneModifiers(): ToneModifiers {
  const model = getBehaviorModel();
  return TONE_MODIFIERS[model.tonePreference];
}

/**
 * Get the current tone preference label.
 */
export function getCurrentTone(): TonePreference {
  const model = getBehaviorModel();
  return model.tonePreference;
}

/**
 * Apply tone adaptation to a response string.
 * Trims or adjusts based on modifiers.
 *
 * This is a soft filter — it guides generation, not hard-truncates.
 * The caller (chat system, Sun) uses these modifiers to shape output.
 */
export function adaptResponseTone(
  response: string,
  modifiers?: ToneModifiers,
): string {
  const mods = modifiers ?? getToneModifiers();

  // For concise tone: trim trailing elaboration
  if (mods.phrasingStyle === 'concise') {
    const sentences = response.split(/(?<=[.!?])\s+/);
    if (sentences.length > mods.maxSentences) {
      return sentences.slice(0, mods.maxSentences).join(' ');
    }
  }

  return response;
}

/**
 * Get a tone-aware prompt modifier for the LLM system prompt.
 * Returns empty string if no adaptation needed (neutral).
 */
export function getTonePromptBlock(): string {
  const tone = getCurrentTone();

  switch (tone) {
    case 'direct':
      return 'Keep responses brief and direct. Use short sentences. Skip preamble.';
    case 'reflective':
      return 'Include brief context before recommendations. Be slightly more conversational.';
    case 'action_oriented':
      return 'Lead with the next action. Make the recommended step immediately clear.';
    case 'neutral':
      return '';
  }
}
