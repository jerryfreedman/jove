// ── SESSION 7: VOICE SYSTEM ─────────────────────────────────
// Defines the product voice for all surfaces.
//
// One voice. One standard. One assistant.
//
// The voice is:
//   calm, concise, direct, confident, slightly human,
//   understated, never salesy, never robotic,
//   never overly cheerful, never verbose.
//
// This is expression only. No logic changes.

// ── VOICE MODE ──────────────────────────────────────────────

export type VoiceMode =
  | 'state'
  | 'action'
  | 'reinforcement'
  | 'reflective'
  | 'light';

// ── VOICE RULES ─────────────────────────────────────────────

export interface VoiceModeRules {
  /** Max sentence count for this mode */
  maxSentences: number;
  /** Whether verb-first phrasing is enforced */
  verbFirst: boolean;
  /** Whether filler words should be aggressively stripped */
  stripFiller: boolean;
  /** Short description of the mode's purpose */
  purpose: string;
}

const MODE_RULES: Record<VoiceMode, VoiceModeRules> = {
  state: {
    maxSentences: 1,
    verbFirst: false,
    stripFiller: true,
    purpose: 'Sun headlines, control panel summaries',
  },
  action: {
    maxSentences: 1,
    verbFirst: true,
    stripFiller: true,
    purpose: 'Next actions, task labels, capture titles',
  },
  reinforcement: {
    maxSentences: 1,
    verbFirst: false,
    stripFiller: true,
    purpose: 'Feedback after meaningful input',
  },
  reflective: {
    maxSentences: 2,
    verbFirst: false,
    stripFiller: true,
    purpose: 'Weak input, ambiguous updates, unclear moments',
  },
  light: {
    maxSentences: 1,
    verbFirst: false,
    stripFiller: true,
    purpose: 'Casual input, immediate nonpersistent moments',
  },
};

export function getVoiceModeRules(mode: VoiceMode): VoiceModeRules {
  return MODE_RULES[mode];
}

// ── BANNED PHRASES ──────────────────────────────────────────
// Phrases that sound generic, templated, or AI-generated.
// These must never appear in any output surface.

export const BANNED_PHRASES: readonly string[] = [
  'absolutely',
  'i\'m here to help',
  'i\'ve gone ahead and',
  'thanks for sharing',
  'great job',
  'great job!',
  'i understand',
  'no worries',
  'sounds good',
  'you\'re welcome',
  'happy to help',
  'sure thing',
  'of course',
  'let me know if you need anything',
  'hope that helps',
  'feel free to',
  'don\'t hesitate to',
  'just wanted to let you know',
  'as mentioned',
  'going forward',
  'at the end of the day',
  'to be honest',
  'that being said',
  'it\'s worth noting',
  'i appreciate you sharing',
  'that\'s a great question',
  'excellent',
  'wonderful',
  'fantastic',
  'perfect',
  'amazing',
] as const;

// Pre-compiled for fast matching
const BANNED_PATTERN = new RegExp(
  BANNED_PHRASES.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
  'gi',
);

export function containsBannedPhrase(text: string): boolean {
  BANNED_PATTERN.lastIndex = 0;
  return BANNED_PATTERN.test(text);
}

// ── FILLER PATTERNS ─────────────────────────────────────────
// Opening filler to strip from any output.

export const FILLER_PATTERNS: readonly RegExp[] = [
  /^(so,?\s+)/i,
  /^(well,?\s+)/i,
  /^(okay,?\s+)/i,
  /^(alright,?\s+)/i,
  /^(you know,?\s+)/i,
  /^(i think\s+)/i,
  /^(basically,?\s+)/i,
  /^(honestly,?\s+)/i,
  /^(just\s+)/i,
  /^(actually,?\s+)/i,
  /^(like,?\s+)/i,
];

// ── INPUT QUALITY ───────────────────────────────────────────
// Classification of input value for proportional response.

export type InputQuality =
  | 'meaningful'   // Real progress, clear update
  | 'structural'   // Reschedule, reorganization
  | 'weak'         // Vague, no real info
  | 'no_progress'  // Explicit non-update
  | 'casual';      // Chat, not actionable

export interface InputQualitySignals {
  hasConcreteAction: boolean;
  hasDateOrTime: boolean;
  hasNamedEntity: boolean;
  hasProgressVerb: boolean;
  isVague: boolean;
  isExplicitNoProgress: boolean;
  isCasual: boolean;
}

/**
 * Classify input quality from signals.
 * Used to select voice mode and reinforcement level.
 */
export function classifyInputQuality(signals: InputQualitySignals): InputQuality {
  if (signals.isCasual) return 'casual';
  if (signals.isExplicitNoProgress) return 'no_progress';
  if (signals.isVague && !signals.hasConcreteAction) return 'weak';
  if (signals.hasDateOrTime && !signals.hasConcreteAction) return 'structural';
  if (signals.hasConcreteAction || signals.hasProgressVerb) return 'meaningful';
  if (signals.hasNamedEntity) return 'meaningful';
  return 'weak';
}

/**
 * Select the appropriate voice mode given input quality and outcome.
 */
export function selectVoiceMode(
  inputQuality: InputQuality,
  mutationOccurred: boolean,
): VoiceMode {
  if (inputQuality === 'casual') return 'light';
  if (inputQuality === 'no_progress' || inputQuality === 'weak') return 'reflective';
  if (inputQuality === 'structural') return mutationOccurred ? 'reinforcement' : 'reflective';
  // meaningful
  return mutationOccurred ? 'reinforcement' : 'state';
}
