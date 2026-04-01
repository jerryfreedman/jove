// ── SESSION 16B: TIME + STATE COMBINATION ───────────────────
// Combines time-of-day with user activity to produce
// the final environment feel.
//
// Examples:
//   Morning + active → light energy
//   Evening + clear → calm, settled
//   Night + idle → deep quiet
//
// RULES:
// - No over-complex rules
// - No too many variations
// - Time provides base, state provides overlay

import { getFractionalHour } from '@/lib/scene-interpolation';
import type { EnvironmentState } from './state';
import type { EnvironmentVisuals } from './mapping';

// ── TIME PERIOD ────────────────────────────────────────────

export type TimePeriod = 'night' | 'dawn' | 'morning' | 'midday' | 'afternoon' | 'evening' | 'dusk';

export function getTimePeriod(fractionalHour?: number): TimePeriod {
  const h = fractionalHour ?? getFractionalHour();
  if (h >= 22 || h < 5) return 'night';
  if (h < 6) return 'dawn';
  if (h < 9) return 'morning';
  if (h < 12) return 'midday';
  if (h < 16) return 'afternoon';
  if (h < 19) return 'evening';
  return 'dusk';
}

// ── TIME-BASED MODIFIERS ──────────────────────────────────
// Time provides a baseline energy that state modifies.
// Morning is naturally more energetic than night.

interface TimeModifier {
  /** Base energy multiplier for this time of day */
  energyBase: number;
  /** How responsive environment should be to activity */
  responsiveness: number;
  /** Natural brightness (independent of state) */
  naturalBrightness: number;
}

function getTimeModifier(period: TimePeriod): TimeModifier {
  switch (period) {
    case 'night':
      return { energyBase: 0.15, responsiveness: 0.4, naturalBrightness: 0.3 };
    case 'dawn':
      return { energyBase: 0.35, responsiveness: 0.6, naturalBrightness: 0.5 };
    case 'morning':
      return { energyBase: 0.55, responsiveness: 0.85, naturalBrightness: 0.8 };
    case 'midday':
      return { energyBase: 0.5, responsiveness: 0.8, naturalBrightness: 0.95 };
    case 'afternoon':
      return { energyBase: 0.45, responsiveness: 0.75, naturalBrightness: 0.85 };
    case 'evening':
      return { energyBase: 0.35, responsiveness: 0.6, naturalBrightness: 0.6 };
    case 'dusk':
      return { energyBase: 0.25, responsiveness: 0.5, naturalBrightness: 0.45 };
  }
}

// ── COMBINED STATE ────────────────────────────────────────

export interface TimeAwareEnvironment {
  /** The time period */
  period: TimePeriod;
  /** Final energy 0–1 (time base + state influence) */
  combinedEnergy: number;
  /** Final brightness 0–1 (time natural + clarity influence) */
  combinedBrightness: number;
  /** How much element responses should be dampened by time */
  responseDampening: number;
}

/**
 * Combine time of day with environment state.
 * Time provides base, state overlays onto it.
 */
export function combineTimeAndState(
  state: EnvironmentState,
  fractionalHour?: number,
): TimeAwareEnvironment {
  const period = getTimePeriod(fractionalHour);
  const timeMod = getTimeModifier(period);

  // Combined energy: time base, modulated by state energy
  // At night, even high activity produces less environment energy
  const combinedEnergy = timeMod.energyBase + (state.energyScore * timeMod.responsiveness * 0.5);

  // Combined brightness: time natural base + clarity influence
  // Clear state adds brightness, uncertain reduces slightly
  const clarityBrightness = state.clarityState === 'clear' ? 0.05
    : state.clarityState === 'uncertain' ? -0.05
    : 0;
  const combinedBrightness = Math.min(1, Math.max(0, timeMod.naturalBrightness + clarityBrightness));

  // Response dampening: how much to reduce element reactions at this time
  // Night = more dampened (quieter), morning = least dampened (responsive)
  const responseDampening = 1 - timeMod.responsiveness;

  return {
    period,
    combinedEnergy: Math.min(1, combinedEnergy),
    combinedBrightness,
    responseDampening,
  };
}

/**
 * Apply time-aware dampening to visual parameters.
 * At night, visuals are naturally quieter even during activity.
 */
export function applyTimeDampening(
  visuals: EnvironmentVisuals,
  timeEnv: TimeAwareEnvironment,
): EnvironmentVisuals {
  const dampen = 1 - timeEnv.responseDampening * 0.4; // max 40% dampening

  return {
    ...visuals,
    waveIntensity: visuals.waveIntensity * dampen,
    birdEnergy: visuals.birdEnergy * dampen,
    fishEnergy: visuals.fishEnergy * dampen,
    brightnessModifier: Math.min(1, visuals.brightnessModifier * (0.85 + timeEnv.combinedBrightness * 0.15)),
  };
}
