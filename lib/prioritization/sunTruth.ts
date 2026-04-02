// ── SESSION 5: SUN TRUTH INTEGRATION ────────────────────────
// Sun state must reflect real truth, not generic positivity.
//
// Rules:
//   - If urgentTasks exist → Sun must NOT say "You're clear"
//   - If blockedItems exist → Sun should acknowledge tension
//   - If strong primaryAction exists → Sun reflects next move available
//   - If clearState is truly true → calm wording allowed
//   - Momentum influences tone ONLY, not truth

import type { TruthState } from './buildTruthState';
import type { PrioritizationResult } from './rankNextActions';
import type { MomentumState } from '@/lib/intelligence/momentum';

// ── SUN TRUTH OUTPUT ────────────────────────────────────────

export interface SunTruthState {
  /** Primary headline for the Sun surface */
  headline: string | null;
  /** Whether the day feels settled (affects Sun visual calm) */
  isSettled: boolean;
  /** Whether there is an active next move */
  hasNextMove: boolean;
  /** Compact state key for downstream use */
  stateKey: 'urgent' | 'tension' | 'next_move' | 'in_motion' | 'clear';
}

// ── HEADLINE POOLS ──────────────────────────────────────────
// Decisive. Not wordy. The system should feel like it knows.

const URGENT_HEADLINES = [
  "You've still got one thing to handle.",
  'Something needs your attention.',
  "There's something to take care of.",
] as const;

const TENSION_HEADLINES = [
  "There's a blocker worth addressing.",
  'Something is waiting on you.',
  'One thing is stuck.',
] as const;

const NEXT_MOVE_HEADLINES = [
  'There\u2019s a next move ready.',
  'One thing to focus on.',
  'You\u2019ve got a clear next step.',
] as const;

const IN_MOTION_HEADLINES = [
  'A few things are still in motion.',
  'Things are moving along.',
  'Some things are still open.',
] as const;

const CLEAR_HEADLINES = [
  'You\u2019re in a good spot.',
  'Nothing pressing right now.',
  'All clear.',
] as const;

// ── HEADLINE SELECTION ──────────────────────────────────────
// Deterministic rotation based on a simple hash of the day.

function todayIndex(): number {
  const d = new Date();
  return d.getFullYear() * 1000 + d.getMonth() * 31 + d.getDate();
}

function pickFromPool(pool: readonly string[]): string {
  return pool[todayIndex() % pool.length];
}

// ── MOMENTUM TONE MODIFIER ──────────────────────────────────
// Can soften or warm the headline, but never override truth.

function applyMomentumTone(
  headline: string,
  momentumState: MomentumState,
  stateKey: SunTruthState['stateKey'],
): string {
  // Only modify if momentum is high and state is not urgent/tension
  if (momentumState === 'clear' && stateKey === 'in_motion') {
    return 'Things are progressing well.';
  }
  if (momentumState === 'moving' && stateKey === 'clear') {
    return 'You moved things forward today.';
  }
  // Otherwise: truth headline stands
  return headline;
}

// ── BUILD SUN TRUTH ─────────────────────────────────────────

export function buildSunTruth(
  truthState: TruthState,
  prioritization: PrioritizationResult,
  momentumState: MomentumState,
): SunTruthState {
  // ── Priority 1: Urgent tasks exist → never say clear ──────
  if (truthState.urgentTasks.length > 0) {
    const headline = applyMomentumTone(
      pickFromPool(URGENT_HEADLINES),
      momentumState,
      'urgent',
    );
    return {
      headline,
      isSettled: false,
      hasNextMove: !!prioritization.primaryAction,
      stateKey: 'urgent',
    };
  }

  // ── Priority 2: Blocked items → acknowledge tension ───────
  if (truthState.blockedItems.length > 0) {
    const headline = applyMomentumTone(
      pickFromPool(TENSION_HEADLINES),
      momentumState,
      'tension',
    );
    return {
      headline,
      isSettled: false,
      hasNextMove: !!prioritization.primaryAction,
      stateKey: 'tension',
    };
  }

  // ── Priority 3: Strong primary action → reflect next move ─
  if (prioritization.primaryAction && prioritization.primaryAction.priorityScore >= 50) {
    const headline = applyMomentumTone(
      pickFromPool(NEXT_MOVE_HEADLINES),
      momentumState,
      'next_move',
    );
    return {
      headline,
      isSettled: false,
      hasNextMove: true,
      stateKey: 'next_move',
    };
  }

  // ── Priority 4: Some actions but nothing dominant ─────────
  if (prioritization.primaryAction) {
    const headline = applyMomentumTone(
      pickFromPool(IN_MOTION_HEADLINES),
      momentumState,
      'in_motion',
    );
    return {
      headline,
      isSettled: false,
      hasNextMove: true,
      stateKey: 'in_motion',
    };
  }

  // ── Priority 5: Truly clear ───────────────────────────────
  if (truthState.clearState) {
    const headline = applyMomentumTone(
      pickFromPool(CLEAR_HEADLINES),
      momentumState,
      'clear',
    );
    return {
      headline,
      isSettled: true,
      hasNextMove: false,
      stateKey: 'clear',
    };
  }

  // Fallback: some things open but nothing urgent
  const headline = applyMomentumTone(
    pickFromPool(IN_MOTION_HEADLINES),
    momentumState,
    'in_motion',
  );
  return {
    headline,
    isSettled: false,
    hasNextMove: false,
    stateKey: 'in_motion',
  };
}
