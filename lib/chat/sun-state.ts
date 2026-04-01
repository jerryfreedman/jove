// ── SESSION 15C.1: SUN STATE CORRECTION ─────────────────────
// Sun must never contradict reality.
//
// If there are tasks, blockers, or upcoming events needing prep:
// → Replace neutral state with active guidance.
//
// "You're set for the day" only when actually set.
// "You've got a few things to handle" when there's real work.

import { onReflection, type ReflectionEvent } from '@/lib/chat/reflection';
import { getMomentumTone } from '@/lib/intelligence/momentum';

// ── SUN EVALUATION ──────────────────────────────────────────

export type SunGuidanceLevel = 'clear' | 'active' | 'urgent';

export interface SunState {
  /** Guidance level for UI intensity */
  level: SunGuidanceLevel;
  /** Headline message shown in sun area */
  headline: string;
  /** Whether the sun should show a neutral/settled state */
  isSettled: boolean;
}

export interface SunEvalInput {
  pendingTaskCount: number;
  urgentTaskCount: number;
  upcomingPrepCount: number;
  hasBlockers: boolean;
  completedTodayCount: number;
}

/**
 * Evaluate sun state based on current reality.
 * Never returns "settled" when there are actionable items.
 *
 * Session 16A: Momentum-aware tone adaptation.
 * When task-level signals are clear/neutral, momentum state
 * can influence the headline to reflect real progress.
 */
export function evaluateSunState(input: SunEvalInput): SunState {
  const { pendingTaskCount, urgentTaskCount, upcomingPrepCount, hasBlockers, completedTodayCount } = input;

  // ── URGENT: Blockers or urgent tasks ──────────────────────
  if (hasBlockers || urgentTaskCount > 0) {
    const count = urgentTaskCount + (hasBlockers ? 1 : 0);
    return {
      level: 'urgent',
      headline: count === 1
        ? 'One thing needs your attention.'
        : `${count} things need your attention.`,
      isSettled: false,
    };
  }

  // ── ACTIVE: Pending tasks, prep needed ────────────────────
  if (upcomingPrepCount > 0) {
    return {
      level: 'active',
      headline: upcomingPrepCount === 1
        ? 'You have a meeting to prep for.'
        : `${upcomingPrepCount} meetings need prep.`,
      isSettled: false,
    };
  }

  if (pendingTaskCount > 0) {
    // Session 16A: Let momentum tone influence active state headlines
    const tone = getMomentumTone();
    if (tone.headline && pendingTaskCount <= 3) {
      // Momentum is progressing — reflect that even with pending items
      return {
        level: 'active',
        headline: tone.headline,
        isSettled: false,
      };
    }

    // Vary language based on count
    if (pendingTaskCount === 1) {
      return {
        level: 'active',
        headline: 'One thing to handle.',
        isSettled: false,
      };
    }
    if (pendingTaskCount <= 3) {
      return {
        level: 'active',
        headline: 'A few things to handle.',
        isSettled: false,
      };
    }
    return {
      level: 'active',
      headline: `You've got ${pendingTaskCount} things on your plate.`,
      isSettled: false,
    };
  }

  // ── CLEAR: Nothing pending ────────────────────────────────
  // Session 16A: Use momentum tone when available
  const tone = getMomentumTone();

  if (completedTodayCount > 0) {
    return {
      level: 'clear',
      headline: tone.headline ?? 'You\'re clear for now.',
      isSettled: true,
    };
  }

  return {
    level: 'clear',
    headline: tone.headline ?? 'You\'re set for the day.',
    isSettled: true,
  };
}

// ── HOOK HELPER: Subscribe to sun-relevant events ───────────
// Returns unsubscribe function.

export function onSunRelevantChange(callback: () => void): () => void {
  const events: ReflectionEvent[] = [
    'task:created',
    'task:updated',
    'task:completed',
    'event:created',
    'blocker:detected',
    'interaction:created',
    'momentum:changed',
    'data:changed',
  ];

  const unsubs = events.map(event => onReflection(event, callback));
  return () => unsubs.forEach(u => u());
}
