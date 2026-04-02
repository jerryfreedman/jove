// ── SESSION 2: TRUTHFUL REINFORCEMENT FEEDBACK ──────────────
// Generates feedback that ONLY reflects what actually happened.
//
// HARD RULE: Never say "Got it" if nothing meaningful happened.
//
// Feedback tiers:
//   HIGH VALUE (mutation occurred)  → confident confirmation
//   STRUCTURAL CHANGE               → specific change description
//   LOW VALUE (no mutation)          → honest, invites revisit
//   UNKNOWN (no signal)              → minimal / neutral

import type { ResolvedIntent } from './resolveIntent';
import type { ExecutionResult } from './executeIntent';

// ── FEEDBACK POOLS ──────────────────────────────────────────
// Multiple options per tier to avoid feeling robotic.

const HIGH_VALUE_FEEDBACK = [
  'Nice, that moves things forward.',
  "Got it — that's updated.",
  "Done — that's handled.",
  'Locked in.',
  'All set.',
];

const COMPLETE_FEEDBACK = [
  'Done — marked complete.',
  "That's handled.",
  'Nice — one less thing.',
  'Checked off.',
];

const RESCHEDULE_FEEDBACK_PREFIX = [
  'Moved to',
  'Rescheduled to',
  'Updated to',
  'Pushed to',
];

const UPDATE_FEEDBACK = [
  'Noted — status updated.',
  'Got it, flagged.',
  'Tracked.',
  'Noted.',
];

const NOTE_FEEDBACK = [
  'Captured.',
  'Noted.',
  'Logged.',
];

const LOW_VALUE_FEEDBACK = [
  'Still need more here.',
  "Let's come back to this.",
  'Noted — but still open.',
  'Sitting with this for now.',
];

const UNKNOWN_FEEDBACK = [
  '',  // Minimal — empty or very neutral
  'OK.',
];

// ── MAIN GENERATOR ──────────────────────────────────────────

export function generateFeedback(
  intent: ResolvedIntent,
  execution: ExecutionResult,
): string {
  // ── Mutation occurred → high value feedback ───────────────
  if (execution.mutated) {
    // Complete
    if (intent.type === 'complete') {
      return pick(COMPLETE_FEEDBACK);
    }

    // Reschedule — include target date
    if (intent.type === 'reschedule' && intent.entities?.date) {
      const prefix = pick(RESCHEDULE_FEEDBACK_PREFIX);
      const dateStr = formatFeedbackDate(intent.entities.date);
      return `${prefix} ${dateStr}.`;
    }

    // Update
    if (intent.type === 'update') {
      return pick(UPDATE_FEEDBACK);
    }

    // Generic high value
    return pick(HIGH_VALUE_FEEDBACK);
  }

  // ── Note (no mutation, but valid input) ───────────────────
  if (intent.type === 'note') {
    return pick(NOTE_FEEDBACK);
  }

  // ── Unknown (no signal) → minimal ─────────────────────────
  if (intent.type === 'unknown') {
    return pick(UNKNOWN_FEEDBACK);
  }

  // ── Low confidence (had intent but couldn't act) ──────────
  if (intent.confidence !== 'high') {
    return pick(LOW_VALUE_FEEDBACK);
  }

  // Fallback
  return pick(NOTE_FEEDBACK);
}

// ── HELPERS ─────────────────────────────────────────────────

function pick(pool: string[]): string {
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Format a date into a friendly string for feedback.
 * Uses day names for the current week, "tomorrow" when applicable.
 */
function formatFeedbackDate(date: Date): string {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (date.toDateString() === tomorrow.toDateString()) {
    return 'tomorrow';
  }

  // Within the next 7 days → use day name
  const diffMs = date.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays > 0 && diffDays <= 7) {
    return date.toLocaleDateString('en-US', { weekday: 'long' });
  }

  // Further out → use short date
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
