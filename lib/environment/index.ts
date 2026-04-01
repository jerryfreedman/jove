// ── SESSION 16B: ENVIRONMENT EVOLUTION ──────────────────────
// Public API for the environment system.
//
// The environment reflects user behavior through:
//   1. Activity tracking → energy levels
//   2. Momentum integration → clarity state
//   3. Time-of-day combination → natural rhythm
//   4. Bird/fish behavior → responsive elements
//   5. Sun/moon modifiers → emotional state
//   6. Noise control → never distracting
//
// Usage:
//   import { initEnvironment, getEnvironmentSnapshot } from '@/lib/environment';

import { evaluateEnvironmentState, recordActivity, isEnvironmentSettled, isEnvironmentActive } from './state';
import type { EnvironmentState, ActivityLevel, ClarityState } from './state';
import { mapEnvironmentToVisuals, lerpVisuals, visualsConverged } from './mapping';
import type { EnvironmentVisuals } from './mapping';
import {
  getElementResponse,
  getBirdBehavior,
  getFishBehavior,
  onElementResponse,
} from './bird-behavior';
import type {
  ElementResponse,
  ElementResponseType,
  BirdBehaviorParams,
  FishBehaviorParams,
} from './bird-behavior';
import { getSunModifier, getMoonModifier } from './sun-integration';
import type { SunEnvironmentModifier, MoonEnvironmentModifier } from './sun-integration';
import { combineTimeAndState, applyTimeDampening, getTimePeriod } from './time-state';
import type { TimeAwareEnvironment, TimePeriod } from './time-state';
import { onEnvironmentFeedback, initEnvironmentFeedback } from './feedback';
import type { EnvironmentFeedback } from './feedback';
import {
  gateResponse,
  capVisualDelta,
  isEnvironmentEnabled,
  setPerformanceMode,
  canStartAnimation,
  startAnimation,
  endAnimation,
} from './noise-control';

// ── FULL ENVIRONMENT SNAPSHOT ──────────────────────────────
// Everything a component needs to render environment effects.

export interface EnvironmentSnapshot {
  /** Core state */
  state: EnvironmentState;
  /** Target visual parameters (components should lerp toward these) */
  visuals: EnvironmentVisuals;
  /** Time-aware combined state */
  timeAware: TimeAwareEnvironment;
  /** Sun modifier overlay */
  sunModifier: SunEnvironmentModifier;
  /** Moon modifier overlay */
  moonModifier: MoonEnvironmentModifier;
  /** Current time period */
  timePeriod: TimePeriod;
  /** Whether environment effects are active */
  isEnabled: boolean;
}

/**
 * Get a complete snapshot of the current environment state.
 * Call this periodically (every few seconds) or on state changes.
 * Components use this to know how to render.
 */
export function getEnvironmentSnapshot(fractionalHour?: number): EnvironmentSnapshot {
  const enabled = isEnvironmentEnabled();

  // Evaluate core state
  const state = evaluateEnvironmentState();

  // Map to visuals
  let visuals = mapEnvironmentToVisuals(state);

  // Combine with time
  const timeAware = combineTimeAndState(state, fractionalHour);

  // Apply time dampening
  visuals = applyTimeDampening(visuals, timeAware);

  // Get celestial modifiers
  const sunModifier = getSunModifier(state);
  const moonModifier = getMoonModifier(state);

  return {
    state,
    visuals,
    timeAware,
    sunModifier,
    moonModifier,
    timePeriod: timeAware.period,
    isEnabled: enabled,
  };
}

// ── INITIALIZATION ────────────────────────────────────────

let _initialized = false;
let _cleanupFeedback: (() => void) | null = null;

/**
 * Initialize the environment evolution system.
 * Sets up feedback loop, activity tracking, and event listeners.
 * Idempotent. Returns cleanup function.
 */
export function initEnvironment(): () => void {
  if (_initialized) {
    return () => {
      _cleanupFeedback?.();
      _initialized = false;
    };
  }

  _initialized = true;
  _cleanupFeedback = initEnvironmentFeedback();

  return () => {
    _cleanupFeedback?.();
    _cleanupFeedback = null;
    _initialized = false;
  };
}

// ── RE-EXPORTS ─────────────────────────────────────────────
// Selective re-exports for component consumption.

export {
  // State
  evaluateEnvironmentState,
  recordActivity,
  isEnvironmentSettled,
  isEnvironmentActive,
  type EnvironmentState,
  type ActivityLevel,
  type ClarityState,

  // Visuals
  mapEnvironmentToVisuals,
  lerpVisuals,
  visualsConverged,
  type EnvironmentVisuals,

  // Bird / Fish behavior
  getElementResponse,
  getBirdBehavior,
  getFishBehavior,
  onElementResponse,
  type ElementResponse,
  type ElementResponseType,
  type BirdBehaviorParams,
  type FishBehaviorParams,

  // Sun / Moon
  getSunModifier,
  getMoonModifier,
  type SunEnvironmentModifier,
  type MoonEnvironmentModifier,

  // Time
  combineTimeAndState,
  applyTimeDampening,
  getTimePeriod,
  type TimeAwareEnvironment,
  type TimePeriod,

  // Feedback
  onEnvironmentFeedback,
  type EnvironmentFeedback,

  // Noise control
  gateResponse,
  capVisualDelta,
  isEnvironmentEnabled,
  setPerformanceMode,
  canStartAnimation,
  startAnimation,
  endAnimation,
};
