// ── SESSION 16B: NOISE CONTROL ──────────────────────────────
// Strict rules for what the environment is allowed to do:
//
// - No constant motion
// - No unnecessary animation
// - No flashing changes
//
// Environment should feel: alive → but calm
// If it distracts → it's wrong
//
// This module gates all environment changes through
// rate limiting and intensity capping.

import type { EnvironmentVisuals } from './mapping';
import type { ElementResponse } from './bird-behavior';

// ── RATE LIMITING ──────────────────────────────────────────

const MIN_RESPONSE_GAP_MS = 2000;    // Minimum 2s between element responses
const MAX_RESPONSES_PER_MINUTE = 6;   // Hard cap on visual responses per minute
const RESPONSE_COOLDOWN_MS = 60_000;  // 1 minute window for rate limiting

let _responseTimestamps: number[] = [];
let _lastResponseTime = 0;

/**
 * Check if an element response should be allowed.
 * Returns false if we're responding too frequently.
 */
export function shouldAllowResponse(): boolean {
  const now = Date.now();

  // Minimum gap between responses
  if (now - _lastResponseTime < MIN_RESPONSE_GAP_MS) {
    return false;
  }

  // Prune old timestamps
  _responseTimestamps = _responseTimestamps.filter(t => now - t < RESPONSE_COOLDOWN_MS);

  // Rate limit
  if (_responseTimestamps.length >= MAX_RESPONSES_PER_MINUTE) {
    return false;
  }

  return true;
}

/**
 * Record that a response was shown.
 * Call this AFTER shouldAllowResponse() returns true.
 */
export function recordResponse(): void {
  const now = Date.now();
  _responseTimestamps.push(now);
  _lastResponseTime = now;
}

// ── INTENSITY CAPPING ──────────────────────────────────────
// No visual parameter should ever jump dramatically.

const MAX_VISUAL_DELTA = 0.15; // Max change per evaluation cycle

/**
 * Cap the delta between previous and next visual state.
 * Prevents jarring transitions even when state changes dramatically.
 */
export function capVisualDelta(
  current: EnvironmentVisuals,
  target: EnvironmentVisuals,
): EnvironmentVisuals {
  const cap = (curr: number, tgt: number) => {
    const delta = tgt - curr;
    if (Math.abs(delta) <= MAX_VISUAL_DELTA) return tgt;
    return curr + Math.sign(delta) * MAX_VISUAL_DELTA;
  };

  return {
    brightnessModifier: cap(current.brightnessModifier, target.brightnessModifier),
    waveIntensity: cap(current.waveIntensity, target.waveIntensity),
    birdEnergy: cap(current.birdEnergy, target.birdEnergy),
    fishEnergy: cap(current.fishEnergy, target.fishEnergy),
    starTwinkle: cap(current.starTwinkle, target.starTwinkle),
    sunWarmth: cap(current.sunWarmth, target.sunWarmth),
    hazeDensity: cap(current.hazeDensity, target.hazeDensity),
  };
}

// ── RESPONSE GATING ───────────────────────────────────────
// Gate an element response through noise control.
// Returns the response if allowed, or a downgraded version.

/**
 * Gate an element response through noise control.
 * May suppress, downgrade, or pass through.
 */
export function gateResponse(response: ElementResponse): ElementResponse {
  // 'none' always passes
  if (response.type === 'none') return response;

  // Check rate limit
  if (!shouldAllowResponse()) {
    return { type: 'none', intensity: 0, durationMs: 0 };
  }

  // Record this response
  recordResponse();

  // Cap intensity — celebrate never above 0.6, acknowledge never above 0.4
  const maxIntensity = response.type === 'celebrate' ? 0.6 : 0.4;
  const cappedIntensity = Math.min(response.intensity, maxIntensity);

  return {
    ...response,
    intensity: cappedIntensity,
  };
}

// ── ANIMATION BUDGET ──────────────────────────────────────
// Track how many active animations are running.
// If too many, suppress new ones.

let _activeAnimations = 0;
const MAX_CONCURRENT_ANIMATIONS = 2;

export function canStartAnimation(): boolean {
  return _activeAnimations < MAX_CONCURRENT_ANIMATIONS;
}

export function startAnimation(): void {
  _activeAnimations = Math.min(_activeAnimations + 1, MAX_CONCURRENT_ANIMATIONS);
}

export function endAnimation(): void {
  _activeAnimations = Math.max(_activeAnimations - 1, 0);
}

// ── PERFORMANCE GUARD ────────────────────────────────────
// If environment is hurting performance, simplify.

let _performanceMode: 'normal' | 'reduced' = 'normal';

/**
 * Set reduced performance mode.
 * When active, all environment responses are suppressed
 * and visuals stay at their lowest energy state.
 */
export function setPerformanceMode(mode: 'normal' | 'reduced'): void {
  _performanceMode = mode;
}

export function getPerformanceMode(): 'normal' | 'reduced' {
  return _performanceMode;
}

/**
 * Check if environment effects should be running.
 * Returns false in reduced performance mode.
 */
export function isEnvironmentEnabled(): boolean {
  return _performanceMode === 'normal';
}
