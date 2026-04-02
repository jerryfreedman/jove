// ── SESSION 6: COMPRESSION LAYER ────────────────────────────
// Transforms truth + prioritization into scannable output.
//
// Rules:
//   - headline: 3–8 words, required
//   - subline: 1 sentence max, optional
//   - bullets: max 2, optional
//   - NO paragraphs. NO multi-sentence explanations.
//
// This is display/output only. No logic changes.

import type { TruthState } from '@/lib/prioritization/buildTruthState';
import type { RankedAction } from '@/lib/prioritization/rankNextActions';

// ── COMPRESSED OUTPUT ──────────────────────────────────────

export interface CompressedOutput {
  /** Short headline: 3–8 words. Required. */
  headline: string;
  /** Optional single-sentence subline. */
  subline?: string;
  /** Optional bullet points. Max 2. */
  bullets?: string[];
}

// ── COMPRESSION CONSTANTS ──────────────────────────────────

const MAX_HEADLINE_WORDS = 8;
const MAX_SUBLINE_CHARS = 80;
const MAX_BULLETS = 2;
const MAX_BULLET_CHARS = 60;

// ── HELPERS ────────────────────────────────────────────────

function truncateWords(text: string, maxWords: number): string {
  const words = text.split(/\s+/);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(' ');
}

function truncateChars(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 1).trim() + '…';
}

/** Ensure text ends with a period if it doesn't already have terminal punctuation. */
function ensureTerminal(text: string): string {
  if (/[.!?]$/.test(text)) return text;
  return text + '.';
}

// ── HEADLINE COMPRESSION ───────────────────────────────────

export function compressHeadline(text: string): string {
  let h = text.trim();
  // Strip filler openings
  h = h.replace(/^(you know,?\s*|so\s+|well\s+|okay\s+)/i, '');
  h = truncateWords(h, MAX_HEADLINE_WORDS);
  h = ensureTerminal(h);
  // Capitalize first letter
  if (h.length > 0) {
    h = h.charAt(0).toUpperCase() + h.slice(1);
  }
  return h;
}

// ── SUBLINE COMPRESSION ────────────────────────────────────

export function compressSubline(text: string): string {
  let s = text.trim();
  // Take only the first sentence
  const sentenceEnd = s.search(/[.!?]\s/);
  if (sentenceEnd !== -1) {
    s = s.slice(0, sentenceEnd + 1);
  }
  s = truncateChars(s, MAX_SUBLINE_CHARS);
  return s;
}

// ── BULLET COMPRESSION ─────────────────────────────────────

export function compressBullets(items: string[]): string[] {
  return items
    .slice(0, MAX_BULLETS)
    .map(item => truncateChars(item.trim(), MAX_BULLET_CHARS));
}

// ── MAIN: COMPRESS STATE ───────────────────────────────────
// Takes truth state + primary/secondary actions and returns
// a scannable compressed output.

export function compressState(
  truthState: TruthState,
  primaryAction: RankedAction | null,
  secondaryActions: RankedAction[],
): CompressedOutput {
  // ── Headline: derive from truth state ────────────────────
  let headline: string;
  let subline: string | undefined;
  const bullets: string[] = [];

  // Priority 1: Urgent tasks
  if (truthState.urgentTasks.length > 0) {
    const count = truthState.urgentTasks.length;
    headline = count === 1
      ? 'One urgent task.'
      : `${count} urgent tasks.`;
    if (primaryAction) {
      subline = compressSubline(primaryAction.title);
    }
  }
  // Priority 2: Blocked items
  else if (truthState.blockedItems.length > 0) {
    headline = truthState.blockedItems.length === 1
      ? 'One thing is blocked.'
      : `${truthState.blockedItems.length} items blocked.`;
    if (primaryAction) {
      subline = compressSubline(primaryAction.title);
    }
  }
  // Priority 3: Active primary action
  else if (primaryAction && primaryAction.priorityScore >= 50) {
    headline = compressHeadline(primaryAction.title);
    if (primaryAction.subtitle) {
      subline = compressSubline(primaryAction.subtitle);
    }
  }
  // Priority 4: Some actions exist
  else if (primaryAction) {
    headline = 'A few things open.';
    subline = compressSubline(primaryAction.title);
  }
  // Priority 5: Clear
  else if (truthState.clearState) {
    headline = 'All clear.';
  }
  // Fallback
  else {
    headline = 'Things are in motion.';
  }

  // ── Bullets: from secondary actions ──────────────────────
  for (const action of secondaryActions.slice(0, MAX_BULLETS)) {
    bullets.push(truncateChars(action.title, MAX_BULLET_CHARS));
  }

  return {
    headline,
    subline,
    bullets: bullets.length > 0 ? bullets : undefined,
  };
}

// ── UTILITY: COMPRESS ANY TEXT FOR UI ──────────────────────
// Hard limit for any text rendered in UI surfaces.

export function compressText(text: string, maxChars: number = 80): string {
  return truncateChars(text.trim(), maxChars);
}

// ── UTILITY: COMPRESS REASON STRING ────────────────────────
// Reasons/subtitles should be short and scannable.

export function compressReason(reason: string): string {
  let r = reason.trim();
  // Strip verbose openings
  r = r.replace(/^(this is because|the reason is|note that|because)\s+/i, '');
  r = truncateChars(r, 50);
  return r;
}
