// ── SESSION 2 + SESSION 3: TRUTHFUL REINFORCEMENT FEEDBACK ──
// Generates feedback that ONLY reflects what actually happened.
//
// HARD RULE: Never say "Got it" if nothing meaningful happened.
//
// Session 3 upgrade: Context-aware feedback.
// Uses contextType to produce more specific, natural responses.
//
// Feedback tiers:
//   HIGH VALUE (mutation occurred)  → confident confirmation
//   STRUCTURAL CHANGE               → specific change description
//   LOW VALUE (no mutation)          → honest, invites revisit
//   UNKNOWN (no signal)              → minimal / neutral

import type { ResolvedIntent } from './resolveIntent';
import type { ExecutionResult } from './executeIntent';
import type { CaptureContextType } from '@/lib/universal-capture-types';

// ── FEEDBACK POOLS ──────────────────────────────────────────
// Multiple options per tier to avoid feeling robotic.

const HIGH_VALUE_FEEDBACK = [
  'Nice, that moves things forward.',
  "Got it — that's updated.",
  "Done — that's handled.",
  'Locked in.',
  'All set.',
];

// ── SESSION 3: CONTEXT-AWARE COMPLETE FEEDBACK ─────────────

const COMPLETE_FEEDBACK_TASK = [
  "Nice — that task's done.",
  'Task handled.',
  'Checked off — one less thing.',
  "Done — that's off your plate.",
];

const COMPLETE_FEEDBACK_ITEM = [
  'Item wrapped up.',
  "That's handled.",
  'Nice — closed out.',
];

const COMPLETE_FEEDBACK_GENERIC = [
  'Done — marked complete.',
  "That's handled.",
  'Nice — one less thing.',
  'Checked off.',
];

// ── SESSION 3: CONTEXT-AWARE RESCHEDULE FEEDBACK ───────────

const RESCHEDULE_FEEDBACK_EVENT_PREFIX = [
  'Moved — you\'re set for',
  'Rescheduled to',
  'Updated — now on',
];

const RESCHEDULE_FEEDBACK_TASK_PREFIX = [
  'Pushed to',
  'Moved to',
  'Rescheduled to',
];

const RESCHEDULE_FEEDBACK_PREFIX = [
  'Moved to',
  'Rescheduled to',
  'Updated to',
  'Pushed to',
];

// ── SESSION 3: CONTEXT-AWARE UPDATE FEEDBACK ───────────────

const UPDATE_FEEDBACK_TASK = [
  'Got it — task updated.',
  'Noted, status flagged.',
  'Tracked on that task.',
];

const UPDATE_FEEDBACK_ITEM = [
  'That helps move things forward.',
  'Noted on that item.',
  'Got it, tracked.',
];

const UPDATE_FEEDBACK_GENERIC = [
  'Noted — status updated.',
  'Got it, flagged.',
  'Tracked.',
  'Noted.',
];

// ── SESSION 3: CONTEXT-AWARE NOTE FEEDBACK ─────────────────

const NOTE_FEEDBACK_PERSON = [
  'Captured — added to their context.',
  'Noted on them.',
  'Logged for reference.',
];

const NOTE_FEEDBACK_EVENT = [
  'Noted for that event.',
  'Captured — attached to the event.',
  'Logged.',
];

const NOTE_FEEDBACK_GENERIC = [
  'Captured.',
  'Noted.',
  'Logged.',
];

const LOW_VALUE_FEEDBACK = [
  'Still need a bit more here.',
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
  contextType?: CaptureContextType,
): string {
  // ── Mutation occurred → high value feedback ───────────────
  if (execution.mutated) {
    // Complete — context-aware
    if (intent.type === 'complete') {
      if (contextType === 'task') return pick(COMPLETE_FEEDBACK_TASK);
      if (contextType === 'item') return pick(COMPLETE_FEEDBACK_ITEM);
      return pick(COMPLETE_FEEDBACK_GENERIC);
    }

    // Reschedule — include target date, context-aware prefix
    if (intent.type === 'reschedule' && intent.entities?.date) {
      let prefix: string;
      if (contextType === 'event' || contextType === 'meeting') {
        prefix = pick(RESCHEDULE_FEEDBACK_EVENT_PREFIX);
      } else if (contextType === 'task') {
        prefix = pick(RESCHEDULE_FEEDBACK_TASK_PREFIX);
      } else {
        prefix = pick(RESCHEDULE_FEEDBACK_PREFIX);
      }
      const dateStr = formatFeedbackDate(intent.entities.date);
      return `${prefix} ${dateStr}.`;
    }

    // Update — context-aware
    if (intent.type === 'update') {
      if (contextType === 'task') return pick(UPDATE_FEEDBACK_TASK);
      if (contextType === 'item') return pick(UPDATE_FEEDBACK_ITEM);
      return pick(UPDATE_FEEDBACK_GENERIC);
    }

    // Generic high value
    return pick(HIGH_VALUE_FEEDBACK);
  }

  // ── Note (no mutation, but valid input) — context-aware ───
  if (intent.type === 'note') {
    if (contextType === 'person') return pick(NOTE_FEEDBACK_PERSON);
    if (contextType === 'event' || contextType === 'meeting') return pick(NOTE_FEEDBACK_EVENT);
    return pick(NOTE_FEEDBACK_GENERIC);
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
  return pick(NOTE_FEEDBACK_GENERIC);
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
