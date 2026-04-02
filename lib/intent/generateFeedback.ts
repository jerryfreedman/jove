// ── SESSION 2–4 + SESSION 7: VOICE-AWARE REINFORCEMENT ──────
// Generates feedback that ONLY reflects what actually happened.
//
// HARD RULE: Never say "Got it" if nothing meaningful happened.
// HARD RULE: Never reward low-value input like it was progress.
//
// Sessions 2–4 established: truthful, consequence-aware feedback.
// Session 7 upgrade: Voice system integration.
//   - Reinforcement is proportional to actual outcome
//   - No fake praise, no empty positivity
//   - Calm, concise, direct — one voice everywhere
//   - Input quality determines response tone
//
// Feedback tiers:
//   COMPLETED (mutation + done)     → brief, satisfying confirmation
//   STRUCTURAL (reschedule/reorg)   → specific change only
//   PROGRESS (update with signal)   → proportional acknowledgment
//   BLOCKER (risk surfaced)         → calm attention flag
//   CONTEXT (note/info captured)    → minimal confirmation
//   WEAK (no real signal)           → no praise, honest status
//   NO_PROGRESS (explicit nothing)  → truthful, no closure
//   UNKNOWN (no signal at all)      → minimal or empty

import type { ResolvedIntent } from './resolveIntent';
import type { ExecutionResult } from './executeIntent';
import type { CaptureContextType } from '@/lib/universal-capture-types';
import { applyVoice } from '@/lib/output/applyVoice';
import { type VoiceMode } from '@/lib/output/voice';

// ── FEEDBACK POOLS ──────────────────────────────────────────
// Each pool: short, truthful, proportional.
// No filler. No enthusiasm. No AI-isms.

// ── COMPLETED ───────────────────────────────────────────────

const COMPLETE_TASK = [
  'Done — that moves this forward.',
  'Handled.',
  'Task done.',
  'Off your plate.',
];

const COMPLETE_ITEM = [
  'Handled.',
  'Wrapped up.',
  'Done.',
];

const COMPLETE_GENERIC = [
  'Done.',
  'Handled.',
  'Marked complete.',
];

const COMPLETE_WITH_PROGRESS = [
  'Done — that moves this forward.',
  'Completed, progress tracked.',
  'Done and logged.',
];

// ── STRUCTURAL (RESCHEDULE) ─────────────────────────────────

const RESCHEDULE_EVENT_PREFIX = [
  'Moved to',
  'Rescheduled to',
];

const RESCHEDULE_TASK_PREFIX = [
  'Pushed to',
  'Moved to',
];

const RESCHEDULE_GENERIC_PREFIX = [
  'Moved to',
  'Rescheduled to',
];

const RESCHEDULE_PREP_SUFFIX = [
  ' Prep stays open.',
  ' Related tasks still active.',
];

// ── PROGRESS (UPDATE WITH SIGNAL) ───────────────────────────

const UPDATE_TASK = [
  'Updated.',
  'Noted on that task.',
  'Tracked.',
];

const UPDATE_ITEM = [
  'That helps.',
  'Noted.',
  'Tracked.',
];

const UPDATE_GENERIC = [
  'Updated.',
  'Noted.',
  'Tracked.',
];

// ── BLOCKER ─────────────────────────────────────────────────

const BLOCKER = [
  'Noted — that needs attention.',
  'Flagged.',
  'Blocker tracked.',
];

// ── CONTEXT (NOTE / INFO) ───────────────────────────────────

const CONTEXT_PERSON = [
  'Helpful — kept in context.',
  'Noted on them.',
  'Logged.',
];

const CONTEXT_EVENT = [
  'Noted for that event.',
  'Captured.',
  'Logged.',
];

const CONTEXT_GENERIC = [
  'Context captured.',
  'Noted.',
  'Logged.',
];

// ── WEAK INPUT ──────────────────────────────────────────────

const WEAK = [
  'Still need a clearer update.',
  'Still open.',
  'Need more here.',
];

// ── NO PROGRESS ─────────────────────────────────────────────

const NO_PROGRESS = [
  'Nothing changed yet.',
  'Still where it was.',
  'No movement.',
];

// ── UNKNOWN ─────────────────────────────────────────────────

const UNKNOWN = [
  '',
  'OK.',
];

// ── LOW CONFIDENCE ──────────────────────────────────────────

const LOW_CONFIDENCE = [
  'Still need more here.',
  'Nothing changed yet.',
  'Still open.',
];

// ── MAIN GENERATOR ──────────────────────────────────────────

export function generateFeedback(
  intent: ResolvedIntent,
  execution: ExecutionResult,
  contextType?: CaptureContextType,
): string {
  let feedback: string;
  let mode: VoiceMode;

  // ── Mutation occurred → proportional confirmation ─────────
  if (execution.mutated) {
    // Complete
    if (intent.type === 'complete') {
      mode = 'reinforcement';
      if (execution.secondaryActionsExecuted && execution.secondaryActionsExecuted > 1) {
        if (contextType === 'task') {
          feedback = pick(COMPLETE_WITH_PROGRESS);
          return applyVoice(feedback, mode);
        }
      }
      if (contextType === 'task') { feedback = pick(COMPLETE_TASK); return applyVoice(feedback, mode); }
      if (contextType === 'item') { feedback = pick(COMPLETE_ITEM); return applyVoice(feedback, mode); }
      feedback = pick(COMPLETE_GENERIC);
      return applyVoice(feedback, mode);
    }

    // Reschedule — structural confirmation with date
    if (intent.type === 'reschedule' && intent.entities?.date) {
      mode = 'reinforcement';
      let prefix: string;
      if (contextType === 'event' || contextType === 'meeting') {
        prefix = pick(RESCHEDULE_EVENT_PREFIX);
      } else if (contextType === 'task') {
        prefix = pick(RESCHEDULE_TASK_PREFIX);
      } else {
        prefix = pick(RESCHEDULE_GENERIC_PREFIX);
      }
      const dateStr = formatFeedbackDate(intent.entities.date);
      feedback = `${prefix} ${dateStr}.`;

      // Append prep-open suffix if secondary actions preserved related tasks
      if (execution.secondaryActionsExecuted && execution.secondaryActionsExecuted > 1) {
        feedback = feedback.slice(0, -1) + '.' + pick(RESCHEDULE_PREP_SUFFIX);
      }

      return applyVoice(feedback, mode);
    }

    // Update — check for blocker first
    if (intent.type === 'update') {
      mode = 'reinforcement';
      if (execution.stateSummary?.includes('Blocker') || execution.stateSummary?.includes('Risk')) {
        feedback = pick(BLOCKER);
        return applyVoice(feedback, mode);
      }
      if (contextType === 'task') { feedback = pick(UPDATE_TASK); return applyVoice(feedback, mode); }
      if (contextType === 'item') { feedback = pick(UPDATE_ITEM); return applyVoice(feedback, mode); }
      feedback = pick(UPDATE_GENERIC);
      return applyVoice(feedback, mode);
    }

    // Generic mutation — short confirmation
    mode = 'reinforcement';
    feedback = pick(UPDATE_GENERIC);
    return applyVoice(feedback, mode);
  }

  // ── No mutation paths ─────────────────────────────────────

  // Explicit no progress
  if (execution.stateSummary?.includes('No progress')) {
    mode = 'reflective';
    feedback = pick(NO_PROGRESS);
    return applyVoice(feedback, mode);
  }

  // Context-only capture
  if (execution.stateSummary?.includes('Context captured') || execution.stateSummary?.includes('context captured')) {
    mode = 'reinforcement';
    if (contextType === 'person') { feedback = pick(CONTEXT_PERSON); return applyVoice(feedback, mode); }
    if (contextType === 'event' || contextType === 'meeting') { feedback = pick(CONTEXT_EVENT); return applyVoice(feedback, mode); }
    feedback = pick(CONTEXT_GENERIC);
    return applyVoice(feedback, mode);
  }

  // Note intent without mutation — context capture
  if (intent.type === 'note') {
    mode = 'reinforcement';
    if (contextType === 'person') { feedback = pick(CONTEXT_PERSON); return applyVoice(feedback, mode); }
    if (contextType === 'event' || contextType === 'meeting') { feedback = pick(CONTEXT_EVENT); return applyVoice(feedback, mode); }
    feedback = pick(CONTEXT_GENERIC);
    return applyVoice(feedback, mode);
  }

  // Unknown intent → minimal
  if (intent.type === 'unknown') {
    mode = 'light';
    feedback = pick(UNKNOWN);
    return feedback; // Already minimal, no processing needed
  }

  // Low confidence → honest about lack of progress
  if (intent.confidence !== 'high') {
    mode = 'reflective';
    feedback = pick(LOW_CONFIDENCE);
    return applyVoice(feedback, mode);
  }

  // Fallback — context capture
  mode = 'reinforcement';
  feedback = pick(CONTEXT_GENERIC);
  return applyVoice(feedback, mode);
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
