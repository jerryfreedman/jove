// ============================================================
// JOVE — Scene Interpolation Engine
// Smooth, continuous transitions between time-of-day scenes.
// Interpolates gradients, colors, and numeric properties
// so the environment flows through time instead of snapping.
// ============================================================

import { type SceneConfig, getSceneForHour } from './design-system';

// ── SCENE SCHEDULE ──────────────────────────────────────────
// Each entry defines the hour a scene BEGINS.
// Order matters — must be chronological across a 24h cycle.
// This mirrors the boundaries in getSceneForHour exactly.
const SCENE_BOUNDARIES = [
  { hour: 0,  label: 'deepNight'  },
  { hour: 5,  label: 'preDawn'    },
  { hour: 6,  label: 'sunrise'    },
  { hour: 8,  label: 'morning'    },
  { hour: 11, label: 'midday'     },
  { hour: 16, label: 'goldenHour' },
  { hour: 19, label: 'dusk'       },
  { hour: 22, label: 'deepNight2' },
] as const;

// ── TIME NORMALIZATION ──────────────────────────────────────
/** Returns fractional hour: 14.5 = 2:30 PM */
export function getFractionalHour(): number {
  const now = new Date();
  return now.getHours() + now.getMinutes() / 60;
}

// ── SCENE PAIR + INTERPOLATION FACTOR ───────────────────────
type ScenePair = {
  from: SceneConfig;
  to: SceneConfig;
  t: number;           // 0..1 interpolation factor
  fromHour: number;    // boundary hour of "from" scene
  toHour: number;      // boundary hour of "to" scene
};

/**
 * Given a fractional hour, determine the two bounding scenes
 * and how far we are between them (0 = fully "from", 1 = fully "to").
 */
export function getScenePair(fractionalHour: number): ScenePair {
  const fh = ((fractionalHour % 24) + 24) % 24; // normalize to 0..24

  // Find which boundary we're in
  let fromIdx = SCENE_BOUNDARIES.length - 1; // default: last boundary
  for (let i = SCENE_BOUNDARIES.length - 1; i >= 0; i--) {
    if (fh >= SCENE_BOUNDARIES[i].hour) {
      fromIdx = i;
      break;
    }
  }

  const toIdx = (fromIdx + 1) % SCENE_BOUNDARIES.length;
  const fromHour = SCENE_BOUNDARIES[fromIdx].hour;
  const toHour = SCENE_BOUNDARIES[toIdx].hour;

  // Compute duration of this scene segment (handle midnight wrap)
  const duration = toHour > fromHour
    ? toHour - fromHour
    : (24 - fromHour) + toHour;

  // How far into this segment are we?
  const elapsed = fh >= fromHour
    ? fh - fromHour
    : (24 - fromHour) + fh;

  const t = Math.max(0, Math.min(1, elapsed / duration));

  // Get the actual SceneConfig for each boundary hour
  const from = getSceneForHour(fromHour);
  const to = getSceneForHour(toHour);

  return { from, to, t, fromHour, toHour };
}

// ── COLOR PARSING & INTERPOLATION ───────────────────────────

/** Parse hex color "#RRGGBB" to [r, g, b] */
function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

/** Convert [r, g, b] back to "#RRGGBB" */
function toHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return '#' + [clamp(r), clamp(g), clamp(b)]
    .map(v => v.toString(16).padStart(2, '0'))
    .join('');
}

/** Linearly interpolate two hex colors */
function lerpColor(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parseHex(a);
  const [br, bg, bb] = parseHex(b);
  return toHex(
    ar + (br - ar) * t,
    ag + (bg - ag) * t,
    ab + (bb - ab) * t,
  );
}

/** Linearly interpolate a number */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ── GRADIENT INTERPOLATION ──────────────────────────────────

type GradientStop = { color: string; percent: number };

/** Parse "color percent%" gradient stop string */
function parseStop(stop: string): GradientStop {
  const match = stop.match(/^(#[0-9a-fA-F]{6})\s+([\d.]+)%$/);
  if (!match) return { color: '#000000', percent: 0 };
  return { color: match[1], percent: parseFloat(match[2]) };
}

/** Convert back to gradient stop string */
function stopToString(stop: GradientStop): string {
  return `${stop.color} ${stop.percent}%`;
}

/**
 * Sample a color from a gradient at a given percentage position.
 * The gradient is an array of parsed stops sorted by percent.
 */
function sampleGradient(stops: GradientStop[], percent: number): string {
  if (stops.length === 0) return '#000000';
  if (stops.length === 1) return stops[0].color;

  // Clamp to gradient bounds
  if (percent <= stops[0].percent) return stops[0].color;
  if (percent >= stops[stops.length - 1].percent) return stops[stops.length - 1].color;

  // Find the two surrounding stops
  for (let i = 0; i < stops.length - 1; i++) {
    if (percent >= stops[i].percent && percent <= stops[i + 1].percent) {
      const range = stops[i + 1].percent - stops[i].percent;
      const localT = range === 0 ? 0 : (percent - stops[i].percent) / range;
      return lerpColor(stops[i].color, stops[i + 1].color, localT);
    }
  }

  return stops[stops.length - 1].color;
}

/**
 * Blend two gradient stop arrays.
 * Strategy: use the LONGER gradient's stop positions as the target structure,
 * sample the shorter gradient at those positions, then interpolate colors.
 * This preserves the fidelity of the richer gradient.
 */
function blendGradients(fromStops: string[], toStops: string[], t: number): string[] {
  const parsedFrom = fromStops.map(parseStop);
  const parsedTo = toStops.map(parseStop);

  // Use whichever has more stops as the "master" structure
  const useTo = parsedTo.length >= parsedFrom.length;
  const master = useTo ? parsedTo : parsedFrom;
  const other = useTo ? parsedFrom : parsedTo;

  // For each stop position in the master, sample the other gradient at that position
  return master.map(masterStop => {
    const otherColor = sampleGradient(other, masterStop.percent);
    // Interpolate: if master is "to", we go from other→master as t increases
    const blended = useTo
      ? lerpColor(otherColor, masterStop.color, t)
      : lerpColor(masterStop.color, otherColor, t);
    return stopToString({ color: blended, percent: masterStop.percent });
  });
}

// ── RGBA / TRANSPARENT COLOR INTERPOLATION ──────────────────

/** Interpolate haze or any CSS color including "transparent" and "rgba(...)" */
function lerpCssColor(a: string, b: string, t: number): string {
  // Both transparent — stay transparent
  if (a === 'transparent' && b === 'transparent') return 'transparent';

  // If one is transparent, treat it as rgba(0,0,0,0) and blend with the other
  if (a === 'transparent') a = 'rgba(0,0,0,0)';
  if (b === 'transparent') b = 'rgba(0,0,0,0)';

  // Try to parse rgba
  const rgbaRe = /rgba?\((\d+),\s*(\d+),\s*(\d+),?\s*([\d.]+)?\)/;
  const am = a.match(rgbaRe);
  const bm = b.match(rgbaRe);

  if (am && bm) {
    const ar = +am[1], ag = +am[2], ab = +am[3], aa = am[4] !== undefined ? +am[4] : 1;
    const br = +bm[1], bg = +bm[2], bb = +bm[3], ba = bm[4] !== undefined ? +bm[4] : 1;
    const r = Math.round(lerp(ar, br, t));
    const g = Math.round(lerp(ag, bg, t));
    const bl = Math.round(lerp(ab, bb, t));
    const al = lerp(aa, ba, t);
    if (al === 0) return 'transparent';
    return `rgba(${r},${g},${bl},${al.toFixed(2)})`;
  }

  // Hex colors
  if (a.startsWith('#') && b.startsWith('#')) {
    return lerpColor(a, b, t);
  }

  // Fallback: snap at midpoint
  return t < 0.5 ? a : b;
}

// ── FULL SCENE BLENDING ─────────────────────────────────────

/**
 * Produce a blended SceneConfig between two scenes at factor t.
 * t=0 → fully `from`, t=1 → fully `to`.
 */
export function blendScenes(from: SceneConfig, to: SceneConfig, t: number): SceneConfig {
  return {
    sky:   blendGradients(from.sky, to.sky, t),
    water: blendGradients(from.water, to.water, t),
    sun: {
      top:     lerp(from.sun.top, to.sun.top, t),
      opacity: lerp(from.sun.opacity, to.sun.opacity, t),
    },
    moon:      t < 0.5 ? from.moon : to.moon,
    stars:     lerp(from.stars, to.stars, t),
    mf:        lerpColor(from.mf, to.mf, t),
    mn:        lerpColor(from.mn, to.mn, t),
    haze:      lerpCssColor(from.haze, to.haze, t),
    lightText: t < 0.5 ? from.lightText : to.lightText,
  };
}

// ── MAIN ENTRY POINT ────────────────────────────────────────

/**
 * Get the interpolated scene for the current moment.
 * Call this every tick (e.g. every 60s) for smooth transitions.
 */
export function getInterpolatedScene(fractionalHour?: number): SceneConfig {
  const fh = fractionalHour ?? getFractionalHour();
  const { from, to, t } = getScenePair(fh);
  return blendScenes(from, to, t);
}

/**
 * React hook-friendly: returns the fractional hour as a rounded value
 * suitable for use as a dependency (avoids unnecessary re-renders).
 * Rounds to nearest minute (1/60 = 0.0167).
 */
export function getFractionalHourRounded(): number {
  const now = new Date();
  return now.getHours() + Math.floor(now.getMinutes()) / 60;
}
