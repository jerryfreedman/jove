// ── SESSION 7: VOICE APPLICATION LAYER ──────────────────────
// Normalizes any generated text into product voice.
//
// Applied after compression, after feedback generation,
// and anywhere text is rendered to the user.
//
// Purpose:
//   - Strip filler and banned phrases
//   - Enforce mode-specific sentence limits
//   - Remove AI-sounding language
//   - Ensure consistent tone across all surfaces

import {
  type VoiceMode,
  getVoiceModeRules,
  BANNED_PHRASES,
  FILLER_PATTERNS,
  containsBannedPhrase,
} from './voice';

// ── REPLACEMENT MAP ─────────────────────────────────────────
// Common AI-isms mapped to voice-appropriate alternatives.

const PHRASE_REPLACEMENTS: ReadonlyArray<[RegExp, string]> = [
  [/\babsolutely\b/gi, ''],
  [/\bi'?ve gone ahead and\s*/gi, ''],
  [/\bthanks for sharing\b/gi, ''],
  [/\bgreat job!?\b/gi, ''],
  [/\bi understand\b[.,]?\s*/gi, ''],
  [/\bno worries\b/gi, ''],
  [/\bhappy to help\b/gi, ''],
  [/\bsure thing\b/gi, ''],
  [/\bhope that helps\b/gi, ''],
  [/\bfeel free to\b/gi, ''],
  [/\bdon'?t hesitate to\b/gi, ''],
  [/\bjust wanted to let you know\b/gi, ''],
  [/\bas mentioned\b/gi, ''],
  [/\bgoing forward\b/gi, ''],
  [/\bat the end of the day\b/gi, ''],
  [/\bto be honest\b/gi, ''],
  [/\bthat being said\b/gi, ''],
  [/\bit'?s worth noting\b/gi, ''],
  [/\bi appreciate you sharing\b/gi, ''],
  [/\bthat'?s a great question\b/gi, ''],
  // Exclamation dampening — replace with period
  [/!{2,}/g, '.'],
];

// ── CORE FUNCTIONS ──────────────────────────────────────────

/**
 * Strip filler openings from text.
 */
function stripFiller(text: string): string {
  let result = text;
  for (const pattern of FILLER_PATTERNS) {
    result = result.replace(pattern, '');
  }
  return result;
}

/**
 * Remove banned and AI-sounding phrases.
 */
function removeBannedPhrases(text: string): string {
  let result = text;
  for (const [pattern, replacement] of PHRASE_REPLACEMENTS) {
    result = result.replace(pattern, replacement);
  }
  // Clean up double spaces and leading/trailing whitespace
  result = result.replace(/\s{2,}/g, ' ').trim();
  return result;
}

/**
 * Enforce sentence limit for a given mode.
 */
function enforceSentenceLimit(text: string, maxSentences: number): string {
  // Split on sentence boundaries (period, exclamation, question followed by space or end)
  const sentences = text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
  if (sentences.length <= maxSentences) return text;
  return sentences.slice(0, maxSentences).join(' ');
}

/**
 * Dampen excessive enthusiasm.
 * Single exclamation points are allowed sparingly; multiples are not.
 */
function dampenEnthusiasm(text: string): string {
  // Multiple exclamation marks → single period
  let result = text.replace(/!{2,}/g, '.');
  // Count remaining exclamation marks — allow at most one
  const exclamations = (result.match(/!/g) || []).length;
  if (exclamations > 1) {
    let count = 0;
    result = result.replace(/!/g, () => {
      count++;
      return count === 1 ? '!' : '.';
    });
  }
  return result;
}

/**
 * Ensure verb-first phrasing for action mode.
 * If text doesn't start with a verb-like word, leave it alone
 * (we can't reliably rewrite it without NLP).
 */
function enforceVerbFirst(text: string): string {
  // Already starts with a common action verb — good
  const verbFirstPattern = /^(log|prep|follow|send|review|check|call|email|schedule|update|create|fix|set|draft|move|close|open|start|finish|plan|write|read|share|assign|submit|resolve|confirm|cancel|book|track|push|file|add|remove|mark|handle|ping|reach|sync|wrap|clear|complete)\b/i;
  if (verbFirstPattern.test(text.trim())) return text;
  // Don't force-rewrite — just return as-is
  return text;
}

/**
 * Clean up punctuation and whitespace artifacts.
 */
function cleanArtifacts(text: string): string {
  let result = text;
  // Remove leading punctuation
  result = result.replace(/^[.,;:\s]+/, '');
  // Remove double punctuation
  result = result.replace(/([.!?])\1+/g, '$1');
  // Period-space-period → single period
  result = result.replace(/\.\s*\./g, '.');
  // Trim
  result = result.trim();
  // Capitalize first letter if present
  if (result.length > 0) {
    result = result.charAt(0).toUpperCase() + result.slice(1);
  }
  return result;
}

// ── MAIN API ────────────────────────────────────────────────

/**
 * Apply product voice to any text.
 *
 * @param text - Raw text to normalize
 * @param mode - Voice mode context (determines sentence limits, verb-first, etc.)
 * @returns Text conforming to product voice standards
 *
 * Usage:
 *   applyVoice('So, I\'ve gone ahead and updated that for you!', 'reinforcement')
 *   → "Updated."
 *
 *   applyVoice('Follow up with Monica about the proposal', 'action')
 *   → "Follow up with Monica about the proposal."
 */
export function applyVoice(text: string, mode: VoiceMode = 'reinforcement'): string {
  if (!text || text.trim().length === 0) return '';

  const rules = getVoiceModeRules(mode);
  let result = text.trim();

  // 1. Strip filler openings
  if (rules.stripFiller) {
    result = stripFiller(result);
  }

  // 2. Remove banned / AI-sounding phrases
  result = removeBannedPhrases(result);

  // 3. Dampen enthusiasm
  result = dampenEnthusiasm(result);

  // 4. Enforce verb-first for action mode
  if (rules.verbFirst) {
    result = enforceVerbFirst(result);
  }

  // 5. Enforce sentence limit
  result = enforceSentenceLimit(result, rules.maxSentences);

  // 6. Clean artifacts
  result = cleanArtifacts(result);

  return result;
}

/**
 * Quick check: does this text pass voice standards?
 * Returns true if no banned phrases and within limits.
 */
export function passesVoiceCheck(text: string, mode: VoiceMode = 'reinforcement'): boolean {
  if (containsBannedPhrase(text)) return false;
  const rules = getVoiceModeRules(mode);
  const sentences = text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
  if (sentences.length > rules.maxSentences) return false;
  return true;
}
