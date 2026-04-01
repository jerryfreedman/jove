// ── SESSION 16B: SUN INTEGRATION ────────────────────────────
// Sun = emotional state of the system.
// Not decorative. Not data. Feeling.
//
// If cluttered → softer / dimmer tone
// If clear → brighter / stable
// If active → subtle dynamic energy
//
// Works WITH the existing sun-state.ts (15C.1) and
// scene system — this adds a behavior-aware overlay.

import type { EnvironmentState, ClarityState } from './state';

// ── SUN ENVIRONMENT MODIFIERS ──────────────────────────────
// These modify the existing sun rendering, not replace it.
// Applied as subtle overlays by the SceneBackground component.

export interface SunEnvironmentModifier {
  /** Opacity multiplier (0.85–1.0). Lower when cluttered. */
  opacityModifier: number;
  /** Scale modifier (0.96–1.04). Slightly larger when clear. */
  scaleModifier: number;
  /** Glow intensity modifier (0.7–1.0). Warmer when momentum high. */
  glowModifier: number;
  /** Breath animation speed multiplier. Faster when active. */
  breathSpeedModifier: number;
}

/**
 * Derive sun modifiers from environment state.
 * All values are subtle — max ±5% change from baseline.
 */
export function getSunModifier(state: EnvironmentState): SunEnvironmentModifier {
  const clarity = mapClarityToSun(state.clarityState);
  const energy = mapEnergyToSun(state.energyScore);

  return {
    opacityModifier: clarity.opacityModifier,
    scaleModifier: clarity.scaleModifier,
    glowModifier: energy.glowModifier,
    breathSpeedModifier: energy.breathSpeedModifier,
  };
}

// ── CLARITY → SUN ─────────────────────────────────────────

function mapClarityToSun(clarity: ClarityState): Pick<SunEnvironmentModifier, 'opacityModifier' | 'scaleModifier'> {
  switch (clarity) {
    case 'clear':
      // Bright, stable, slightly larger — things are good
      return { opacityModifier: 1.0, scaleModifier: 1.03 };
    case 'active':
      // Normal — neither bright nor dim
      return { opacityModifier: 0.95, scaleModifier: 1.0 };
    case 'uncertain':
      // Softer, slightly smaller — things are unsettled
      return { opacityModifier: 0.88, scaleModifier: 0.97 };
  }
}

// ── ENERGY → SUN ──────────────────────────────────────────

function mapEnergyToSun(energy: number): Pick<SunEnvironmentModifier, 'glowModifier' | 'breathSpeedModifier'> {
  // Energy 0–1 maps to glow and breath speed
  // Low energy: dim glow, slow breath (restful)
  // High energy: warm glow, slightly faster breath (alive)
  return {
    glowModifier: 0.7 + energy * 0.3,         // 0.7–1.0
    breathSpeedModifier: 0.9 + energy * 0.15,  // 0.9–1.05
  };
}

// ── MOON MODIFIER ────────────────────────────────────────
// At night, the moon takes the sun's role.
// Moon is always calmer — but still reflects state.

export interface MoonEnvironmentModifier {
  /** Opacity modifier (0.85–1.0) */
  opacityModifier: number;
  /** Glow radius modifier */
  glowModifier: number;
}

export function getMoonModifier(state: EnvironmentState): MoonEnvironmentModifier {
  // Moon is gentler — less responsive than sun
  const clarity = state.clarityState;

  return {
    opacityModifier: clarity === 'clear' ? 1.0 : clarity === 'active' ? 0.95 : 0.9,
    glowModifier: clarity === 'clear' ? 1.0 : clarity === 'active' ? 0.92 : 0.85,
  };
}
