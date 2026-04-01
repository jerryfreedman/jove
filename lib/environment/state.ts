// ── SESSION 16B: ENVIRONMENT STATE ──────────────────────────
// Core state that represents how the environment should feel.
// Derived from real user behavior — never random, never decorative.
//
// activity_level:  how active the user has been recently
// momentum_state:  from 16A momentum system
// clarity_state:   uncertain → active → clear
//
// All derived. Never set directly.

import { getMomentum, type MomentumState } from '@/lib/intelligence/momentum';

// ── TYPES ──────────────────────────────────────────────────

export type ActivityLevel = 'low' | 'medium' | 'high';
export type ClarityState = 'uncertain' | 'active' | 'clear';

export interface EnvironmentState {
  /** User activity level based on recent inputs */
  activityLevel: ActivityLevel;
  /** Momentum state from 16A system */
  momentumState: MomentumState;
  /** Clarity of the system — are things resolved or open? */
  clarityState: ClarityState;
  /** Score 0–1 representing overall environment energy */
  energyScore: number;
  /** Timestamp of last state evaluation */
  evaluatedAt: number;
}

// ── ACTIVITY TRACKING ──────────────────────────────────────
// Track recent inputs with timestamps. Activity decays over time.
// This is a rolling window — not cumulative.

const ACTIVITY_WINDOW_MS = 10 * 60 * 1000;  // 10 minutes
const ACTIVITY_HIGH_THRESHOLD = 6;            // actions in window
const ACTIVITY_MEDIUM_THRESHOLD = 2;

let _recentActions: number[] = [];

/**
 * Record a user action timestamp.
 * Call this when meaningful user activity occurs:
 * captures, task actions, chat inputs.
 */
export function recordActivity(): void {
  _recentActions.push(Date.now());
  // Prune old entries
  pruneActivity();
}

function pruneActivity(): void {
  const cutoff = Date.now() - ACTIVITY_WINDOW_MS;
  _recentActions = _recentActions.filter(t => t > cutoff);
}

function deriveActivityLevel(): ActivityLevel {
  pruneActivity();
  const count = _recentActions.length;
  if (count >= ACTIVITY_HIGH_THRESHOLD) return 'high';
  if (count >= ACTIVITY_MEDIUM_THRESHOLD) return 'medium';
  return 'low';
}

// ── CLARITY DERIVATION ────────────────────────────────────
// Clarity reflects: are there open items, or is everything handled?
// Maps from momentum + task context.

function deriveClarityState(momentumState: MomentumState, activityLevel: ActivityLevel): ClarityState {
  // Clear momentum = clear system
  if (momentumState === 'clear') return 'clear';

  // Active work = active state
  if (momentumState === 'moving' || activityLevel === 'high') return 'active';
  if (momentumState === 'in_progress' || activityLevel === 'medium') return 'active';

  // Stalled or low activity = uncertain
  return 'uncertain';
}

// ── ENERGY SCORE ──────────────────────────────────────────
// 0–1 composite score for how much "life" the environment should have.
// Used as a continuous dial, not buckets.

function computeEnergyScore(activityLevel: ActivityLevel, momentumState: MomentumState): number {
  // Activity contribution (0–0.5)
  const activityScore = activityLevel === 'high' ? 0.5
    : activityLevel === 'medium' ? 0.3
    : 0.1;

  // Momentum contribution (0–0.5)
  const momentumScore = momentumState === 'clear' ? 0.5
    : momentumState === 'moving' ? 0.4
    : momentumState === 'in_progress' ? 0.25
    : 0.05;

  return Math.min(activityScore + momentumScore, 1);
}

// ── EVALUATE CURRENT STATE ────────────────────────────────

/**
 * Evaluate the full environment state right now.
 * Pure derivation — reads momentum + activity, produces state.
 */
export function evaluateEnvironmentState(): EnvironmentState {
  const momentum = getMomentum();
  const activityLevel = deriveActivityLevel();
  const clarityState = deriveClarityState(momentum.state, activityLevel);
  const energyScore = computeEnergyScore(activityLevel, momentum.state);

  return {
    activityLevel,
    momentumState: momentum.state,
    clarityState,
    energyScore,
    evaluatedAt: Date.now(),
  };
}

// ── CONVENIENCE READERS ──────────────────────────────────

/** Quick check: is the environment in a calm/settled state? */
export function isEnvironmentSettled(): boolean {
  const state = evaluateEnvironmentState();
  return state.clarityState === 'clear' && state.activityLevel === 'low';
}

/** Quick check: is there meaningful activity happening? */
export function isEnvironmentActive(): boolean {
  const state = evaluateEnvironmentState();
  return state.activityLevel !== 'low' || state.momentumState !== 'stalled';
}
