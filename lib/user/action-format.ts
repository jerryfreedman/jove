// ── SESSION 16C: ACTION FORMAT ADAPTATION ───────────────────
// Learns preferred action phrasing and converges toward user style.
//
// Example:
//   "Call Monica" vs "Reach out to Monica"
//   System converges toward the user-preferred style.
//
// Rules:
//   - Track verb preferences from user-created actions
//   - Apply only after repeated patterns emerge
//   - Never change meaning, only phrasing
//   - Stability: require 3+ uses of a pattern before adopting

import { getBehaviorModel, type ActionStyle } from './behavior';

// ── TYPES ───────────────────────────────────────────────────

export interface VerbPreference {
  /** The canonical verb form the system uses */
  canonical: string;
  /** The user's preferred equivalent */
  preferred: string;
  /** Number of times the user chose this form */
  count: number;
}

// ── VERB EQUIVALENCE GROUPS ─────────────────────────────────
// Groups of verbs that mean roughly the same thing.
// System tracks which form in each group the user prefers.

const VERB_GROUPS: string[][] = [
  ['call', 'reach out to', 'phone', 'ring'],
  ['email', 'send email to', 'write to', 'message'],
  ['schedule', 'set up', 'book', 'arrange'],
  ['review', 'look over', 'check', 'go through'],
  ['prepare', 'prep', 'get ready for'],
  ['follow up', 'circle back', 'check in', 'touch base'],
  ['confirm', 'verify', 'double-check', 'make sure'],
  ['update', 'refresh', 'sync'],
  ['send', 'share', 'forward', 'pass along'],
  ['finish', 'complete', 'wrap up', 'close out'],
];

// Build lookup: verb → group index
const _verbToGroup = new Map<string, number>();
for (let i = 0; i < VERB_GROUPS.length; i++) {
  for (const verb of VERB_GROUPS[i]) {
    _verbToGroup.set(verb.toLowerCase(), i);
  }
}

// ── PREFERENCE STORAGE ──────────────────────────────────────

const STORAGE_KEY = 'jove_verb_preferences';
const MIN_COUNT_TO_APPLY = 3;

interface StoredVerbPreferences {
  /** Map from group index to preferred verb */
  preferences: Record<number, { verb: string; count: number }>;
  version: number;
}

function loadPreferences(): StoredVerbPreferences {
  if (typeof window === 'undefined') {
    return { preferences: {}, version: 1 };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { preferences: {}, version: 1 };
    return JSON.parse(raw) as StoredVerbPreferences;
  } catch {
    return { preferences: {}, version: 1 };
  }
}

function savePreferences(prefs: StoredVerbPreferences): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Silent
  }
}

// ── PUBLIC API ──────────────────────────────────────────────

/**
 * Record that the user used a particular verb in an action.
 * Tracks frequency to learn preferred phrasing.
 */
export function recordVerbUsage(actionText: string): void {
  const firstWords = extractLeadingVerb(actionText);
  if (!firstWords) return;

  const groupIdx = _verbToGroup.get(firstWords.toLowerCase());
  if (groupIdx === undefined) return;

  const prefs = loadPreferences();
  const existing = prefs.preferences[groupIdx];

  if (existing && existing.verb === firstWords.toLowerCase()) {
    existing.count++;
  } else if (existing && existing.count < MIN_COUNT_TO_APPLY) {
    // Not yet committed — switch to new preference
    prefs.preferences[groupIdx] = { verb: firstWords.toLowerCase(), count: 1 };
  } else if (!existing) {
    prefs.preferences[groupIdx] = { verb: firstWords.toLowerCase(), count: 1 };
  }
  // If existing preference is established (count >= MIN), don't switch easily
  // Stability rule: require the new verb to appear more

  savePreferences(prefs);
}

/**
 * Adapt an action's phrasing to match user preferences.
 * Only replaces the leading verb if user has a strong preference.
 *
 * Returns the original action text if no adaptation applies.
 */
export function adaptActionFormat(actionText: string): string {
  const firstWords = extractLeadingVerb(actionText);
  if (!firstWords) return actionText;

  const groupIdx = _verbToGroup.get(firstWords.toLowerCase());
  if (groupIdx === undefined) return actionText;

  const prefs = loadPreferences();
  const pref = prefs.preferences[groupIdx];

  // Only apply if user has shown consistent preference
  if (!pref || pref.count < MIN_COUNT_TO_APPLY) return actionText;

  // Don't replace if already using preferred form
  if (firstWords.toLowerCase() === pref.verb) return actionText;

  // Replace leading verb with preferred form
  const preferredCapitalized = pref.verb.charAt(0).toUpperCase() + pref.verb.slice(1);
  return actionText.replace(new RegExp(`^${escapeRegExp(firstWords)}`, 'i'), preferredCapitalized);
}

/**
 * Adapt action length based on style preference.
 * Direct: keep short. Descriptive: allow longer.
 */
export function adaptActionLength(actionText: string): string {
  const model = getBehaviorModel();

  if (model.actionStyle === 'direct') {
    // Trim to essential — remove trailing clauses after reasonable length
    const words = actionText.split(/\s+/);
    if (words.length > 6) {
      return words.slice(0, 5).join(' ');
    }
  }

  return actionText;
}

// ── HELPERS ─────────────────────────────────────────────────

/**
 * Extract the leading verb phrase from an action string.
 * Handles multi-word verbs like "follow up", "reach out to".
 */
function extractLeadingVerb(action: string): string | null {
  const trimmed = action.trim().toLowerCase();
  if (!trimmed) return null;

  // Try multi-word verbs first (longest match)
  for (const group of VERB_GROUPS) {
    for (const verb of group) {
      if (trimmed.startsWith(verb + ' ') || trimmed === verb) {
        return verb;
      }
    }
  }

  // Fall back to single first word
  const firstWord = trimmed.split(/\s+/)[0];
  return firstWord || null;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
