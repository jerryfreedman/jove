// ── SESSION 16B: BEHAVIOR → ENVIRONMENT MAPPING ────────────
// Maps environment state to concrete visual parameters.
// These drive how the scene, bird, fish, sun, and water feel.
//
// KEY RULES:
// - Changes are noticeable over time, not jarring
// - All values transition smoothly — never snap
// - If it distracts, it's wrong

import type { EnvironmentState, ActivityLevel, ClarityState } from './state';

// ── ENVIRONMENT VISUAL PARAMS ──────────────────────────────
// These are continuous dials. Components read them and
// smoothly interpolate toward the target values.

export interface EnvironmentVisuals {
  /** 0–1: overall scene brightness modifier */
  brightnessModifier: number;
  /** 0–1: wave motion intensity */
  waveIntensity: number;
  /** 0–1: bird movement energy (speed, flap frequency) */
  birdEnergy: number;
  /** 0–1: fish movement energy */
  fishEnergy: number;
  /** 0–1: star twinkle intensity (night only) */
  starTwinkle: number;
  /** 0–1: sun glow warmth modifier */
  sunWarmth: number;
  /** 0–1: haze density (low clarity = more haze) */
  hazeDensity: number;
}

// ── MAPPING FUNCTIONS ──────────────────────────────────────

/**
 * LOW ACTIVITY: Quiet environment.
 * Minimal movement. Calm visuals. Settled.
 */
function mapLowActivity(): Partial<EnvironmentVisuals> {
  return {
    waveIntensity: 0.2,
    birdEnergy: 0.15,
    fishEnergy: 0.15,
    starTwinkle: 0.3,
  };
}

/**
 * ACTIVE / WORKING: Subtle motion.
 * Gentle activity. Small dynamic elements respond.
 */
function mapMediumActivity(): Partial<EnvironmentVisuals> {
  return {
    waveIntensity: 0.45,
    birdEnergy: 0.4,
    fishEnergy: 0.35,
    starTwinkle: 0.5,
  };
}

/**
 * HIGH MOMENTUM: Slightly richer environment.
 * More life — birds more active, light more dynamic.
 */
function mapHighActivity(): Partial<EnvironmentVisuals> {
  return {
    waveIntensity: 0.65,
    birdEnergy: 0.65,
    fishEnergy: 0.55,
    starTwinkle: 0.7,
  };
}

/**
 * Map clarity state to brightness and haze.
 * Clear = bright, stable. Uncertain = softer, hazier.
 */
function mapClarity(clarity: ClarityState): Pick<EnvironmentVisuals, 'brightnessModifier' | 'hazeDensity' | 'sunWarmth'> {
  switch (clarity) {
    case 'clear':
      return { brightnessModifier: 1.0, hazeDensity: 0.0, sunWarmth: 0.85 };
    case 'active':
      return { brightnessModifier: 0.9, hazeDensity: 0.1, sunWarmth: 0.65 };
    case 'uncertain':
      return { brightnessModifier: 0.8, hazeDensity: 0.25, sunWarmth: 0.4 };
  }
}

/**
 * Map activity level to motion values.
 */
function mapActivity(level: ActivityLevel): Partial<EnvironmentVisuals> {
  switch (level) {
    case 'high':
      return mapHighActivity();
    case 'medium':
      return mapMediumActivity();
    case 'low':
      return mapLowActivity();
  }
}

// ── MAIN MAPPER ───────────────────────────────────────────

/**
 * Derive complete visual parameters from environment state.
 * Components should smoothly transition toward these target values.
 */
export function mapEnvironmentToVisuals(state: EnvironmentState): EnvironmentVisuals {
  const activityVisuals = mapActivity(state.activityLevel);
  const clarityVisuals = mapClarity(state.clarityState);

  return {
    brightnessModifier: clarityVisuals.brightnessModifier,
    waveIntensity: activityVisuals.waveIntensity ?? 0.3,
    birdEnergy: activityVisuals.birdEnergy ?? 0.2,
    fishEnergy: activityVisuals.fishEnergy ?? 0.2,
    starTwinkle: activityVisuals.starTwinkle ?? 0.4,
    sunWarmth: clarityVisuals.sunWarmth,
    hazeDensity: clarityVisuals.hazeDensity,
  };
}

// ── INTERPOLATION HELPER ──────────────────────────────────
// Environment changes must NEVER snap. Always lerp over time.

const TRANSITION_SPEED = 0.02; // per tick — ~1.2s to full change at 60fps

/**
 * Smoothly interpolate current visuals toward target.
 * Call this every animation frame or on a slow timer.
 */
export function lerpVisuals(current: EnvironmentVisuals, target: EnvironmentVisuals): EnvironmentVisuals {
  const l = (a: number, b: number) => a + (b - a) * TRANSITION_SPEED;

  return {
    brightnessModifier: l(current.brightnessModifier, target.brightnessModifier),
    waveIntensity: l(current.waveIntensity, target.waveIntensity),
    birdEnergy: l(current.birdEnergy, target.birdEnergy),
    fishEnergy: l(current.fishEnergy, target.fishEnergy),
    starTwinkle: l(current.starTwinkle, target.starTwinkle),
    sunWarmth: l(current.sunWarmth, target.sunWarmth),
    hazeDensity: l(current.hazeDensity, target.hazeDensity),
  };
}

/**
 * Check if current visuals are "close enough" to target
 * that we can stop interpolating.
 */
export function visualsConverged(current: EnvironmentVisuals, target: EnvironmentVisuals): boolean {
  const EPSILON = 0.005;
  return (
    Math.abs(current.brightnessModifier - target.brightnessModifier) < EPSILON &&
    Math.abs(current.waveIntensity - target.waveIntensity) < EPSILON &&
    Math.abs(current.birdEnergy - target.birdEnergy) < EPSILON &&
    Math.abs(current.fishEnergy - target.fishEnergy) < EPSILON &&
    Math.abs(current.starTwinkle - target.starTwinkle) < EPSILON &&
    Math.abs(current.sunWarmth - target.sunWarmth) < EPSILON &&
    Math.abs(current.hazeDensity - target.hazeDensity) < EPSILON
  );
}
