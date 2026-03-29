'use client';

import { useEffect, useRef, useCallback, useMemo } from 'react';
import { SCENE_HORIZON_PERCENT } from '@/lib/constants';

// ── FISH SVG ──────────────────────────────────────────────
// Minimal silhouette, ~28px wide, facing right
const FISH_WIDTH = 28;
const FISH_HEIGHT = 12;

// ── MOTION CONSTANTS ──────────────────────────────────────
const SPEED_BASE = 0.3;              // px per frame (~18px/s at 60fps)
const SINE_AMPLITUDE_BASE = 8;       // vertical drift amplitude in px
const SINE_PERIOD = 4000;            // ms for one full vertical sine cycle
const DIR_CHANGE_MIN = 8000;         // min ms before direction change
const DIR_CHANGE_MAX = 15000;        // max ms before direction change
const TURN_DURATION = 1200;          // ms for smooth direction transition

// Water zone: from SCENE_HORIZON_PERCENT% to 95% of viewport
const WATER_TOP_PERCENT = SCENE_HORIZON_PERCENT + 3;   // 65% — small margin below horizon
const WATER_BOTTOM_PERCENT = 92;                        // don't go to very bottom

// ── EVOLUTION CONSTANTS ───────────────────────────────────
const SCALE_MIN = 0.95;
const SCALE_MAX = 1.1;
const SCALE_RANGE = SCALE_MAX - SCALE_MIN;             // 0.15

// Edge margin: how far from edges the fish prefers to stay
// Low growth → large margin (stays near edges), high growth → small margin (more central)
const EDGE_MARGIN_MAX = 0.35;   // fraction of viewport width reserved on each side at growth 0
const EDGE_MARGIN_MIN = 0.10;   // fraction at max growth

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

interface AmbientFishProps {
  signalCount?: number;
}

export default function AmbientFish({ signalCount = 0 }: AmbientFishProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Position ref — shared with future prompts for hitbox placement
  const fishPositionRef = useRef({ x: 0, y: 0 });

  // ── DERIVED GROWTH FACTOR ─────────────────────────────────
  // Continuous 0→1 based on signal accumulation. log curve = fast early gains, slow later.
  const growthFactor = useMemo(
    () => Math.min(Math.log(signalCount + 1) / 3, 1),
    [signalCount],
  );

  // Derived values from growthFactor
  const scale = SCALE_MIN + growthFactor * SCALE_RANGE;

  // Motion smoothing: lower amplitude at higher growth (smoother, more direct)
  const sineAmplitude = SINE_AMPLITUDE_BASE * (1 - growthFactor * 0.5); // 8 → 4

  // Speed barely increases — more confident glide
  const speed = SPEED_BASE + growthFactor * 0.05; // 0.3 → 0.35

  // Store growth-derived values in a ref so the animation loop can read them
  // without causing re-mounts
  const growthRef = useRef({ scale, sineAmplitude, speed, growthFactor });
  growthRef.current = { scale, sineAmplitude, speed, growthFactor };

  // Internal animation state (not React state — no re-renders)
  const stateRef = useRef({
    x: 0,
    y: 0,
    baseY: 0,
    direction: 1,          // 1 = right, -1 = left
    targetDirection: 1,
    turnProgress: 1,       // 0..1; 1 = turn complete
    turnStartTime: 0,
    sineOffset: 0,
    startTime: 0,
    nextDirChange: 0,
    viewW: 0,
    viewH: 0,
    waterTopPx: 0,
    waterBottomPx: 0,
  });

  const frameRef = useRef<number>(0);
  const fishElRef = useRef<HTMLDivElement>(null);

  // ── INIT ────────────────────────────────────────────────
  const init = useCallback(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const waterTop = (WATER_TOP_PERCENT / 100) * vh;
    const waterBottom = (WATER_BOTTOM_PERCENT / 100) * vh;
    const startDir = Math.random() > 0.5 ? 1 : -1;

    // Position tendency: low growth → near edges, high growth → more central
    const gf = growthRef.current.growthFactor;
    const edgeMargin = EDGE_MARGIN_MAX - gf * (EDGE_MARGIN_MAX - EDGE_MARGIN_MIN);
    const xMin = vw * edgeMargin;
    const xMax = vw * (1 - edgeMargin);
    const startX = randomBetween(Math.max(FISH_WIDTH, xMin), Math.min(xMax, vw - FISH_WIDTH));
    const startY = randomBetween(waterTop + 10, waterBottom - 10);

    const s = stateRef.current;
    s.x = startX;
    s.y = startY;
    s.baseY = startY;
    s.direction = startDir;
    s.targetDirection = startDir;
    s.turnProgress = 1;
    s.sineOffset = Math.random() * SINE_PERIOD;
    s.startTime = performance.now();
    s.nextDirChange = performance.now() + randomBetween(DIR_CHANGE_MIN, DIR_CHANGE_MAX);
    s.viewW = vw;
    s.viewH = vh;
    s.waterTopPx = waterTop;
    s.waterBottomPx = waterBottom;
  }, []);

  // ── ANIMATION LOOP ──────────────────────────────────────
  const tick = useCallback((now: number) => {
    const s = stateRef.current;
    const el = fishElRef.current;
    const g = growthRef.current;
    if (!el) {
      frameRef.current = requestAnimationFrame(tick);
      return;
    }

    // Smooth direction transition
    if (s.turnProgress < 1) {
      const elapsed = now - s.turnStartTime;
      s.turnProgress = Math.min(elapsed / TURN_DURATION, 1);
      // Ease in-out
      const ease = s.turnProgress < 0.5
        ? 2 * s.turnProgress * s.turnProgress
        : 1 - Math.pow(-2 * s.turnProgress + 2, 2) / 2;
      s.direction = s.direction + (s.targetDirection - s.direction) * ease;
    }

    // Check if time for a direction change
    if (now >= s.nextDirChange) {
      s.targetDirection = s.targetDirection === 1 ? -1 : 1;
      s.turnProgress = 0;
      s.turnStartTime = now;
      s.nextDirChange = now + randomBetween(DIR_CHANGE_MIN, DIR_CHANGE_MAX);
    }

    // Horizontal movement — slightly faster at higher growth
    s.x += g.speed * s.direction;

    // Positioning tendency: gently drift toward allowed zone
    const edgeMargin = EDGE_MARGIN_MAX - g.growthFactor * (EDGE_MARGIN_MAX - EDGE_MARGIN_MIN);
    const xMin = s.viewW * edgeMargin;
    const xMax = s.viewW * (1 - edgeMargin);

    // Soft nudge toward preferred zone (very subtle, not a hard clamp)
    if (s.x < xMin && s.direction < 0) {
      // Moving away from center while near edge — slightly increase chance to turn
      if (Math.random() < 0.002 * g.growthFactor) {
        s.targetDirection = 1;
        s.turnProgress = 0;
        s.turnStartTime = now;
        s.nextDirChange = now + randomBetween(DIR_CHANGE_MIN, DIR_CHANGE_MAX);
      }
    } else if (s.x > xMax && s.direction > 0) {
      if (Math.random() < 0.002 * g.growthFactor) {
        s.targetDirection = -1;
        s.turnProgress = 0;
        s.turnStartTime = now;
        s.nextDirChange = now + randomBetween(DIR_CHANGE_MIN, DIR_CHANGE_MAX);
      }
    }

    // Wrap around edges (still allowed — just less likely at high growth)
    if (s.x > s.viewW + FISH_WIDTH) {
      s.x = -FISH_WIDTH;
    } else if (s.x < -FISH_WIDTH) {
      s.x = s.viewW + FISH_WIDTH;
    }

    // Vertical sine wave drift — amplitude decreases with growth (smoother motion)
    const sineTime = (now + s.sineOffset) / SINE_PERIOD;
    const sineY = Math.sin(sineTime * Math.PI * 2) * g.sineAmplitude;
    s.y = s.baseY + sineY;

    // Clamp to water zone — reflect if hitting horizon
    if (s.y < s.waterTopPx) {
      s.y = s.waterTopPx;
      s.baseY = s.waterTopPx + g.sineAmplitude;
    }
    if (s.y > s.waterBottomPx) {
      s.y = s.waterBottomPx;
      s.baseY = s.waterBottomPx - g.sineAmplitude;
    }

    // Update position ref for Prompt 4
    fishPositionRef.current.x = s.x;
    fishPositionRef.current.y = s.y;

    // Apply transform directly (no React state)
    // Scale evolves continuously — scaleX flips for direction, uniform scale for growth
    const scaleX = s.direction >= 0 ? -1 : 1;
    el.style.transform = `translate(${s.x}px, ${s.y}px) scaleX(${scaleX}) scale(${g.scale})`;

    frameRef.current = requestAnimationFrame(tick);
  }, []);

  // ── LIFECYCLE ───────────────────────────────────────────
  useEffect(() => {
    init();
    frameRef.current = requestAnimationFrame(tick);

    const handleResize = () => {
      const s = stateRef.current;
      s.viewW = window.innerWidth;
      s.viewH = window.innerHeight;
      s.waterTopPx = (WATER_TOP_PERCENT / 100) * s.viewH;
      s.waterBottomPx = (WATER_BOTTOM_PERCENT / 100) * s.viewH;
    };

    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(frameRef.current);
      window.removeEventListener('resize', handleResize);
    };
  }, [init, tick]);

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 overflow-hidden"
      style={{ zIndex: 6, pointerEvents: 'none' }}
      aria-hidden="true"
    >
      <div
        ref={fishElRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: FISH_WIDTH,
          height: FISH_HEIGHT,
          willChange: 'transform',
        }}
      >
        <svg
          width={FISH_WIDTH}
          height={FISH_HEIGHT}
          viewBox="0 0 28 12"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Minimal fish silhouette — body + tail */}
          <ellipse cx="12" cy="6" rx="10" ry="5" fill="rgba(247,243,236,0.25)" />
          <polygon points="22,6 28,2 28,10" fill="rgba(247,243,236,0.25)" />
          {/* Eye dot */}
          <circle cx="7" cy="5" r="1" fill="rgba(247,243,236,0.35)" />
        </svg>
      </div>
    </div>
  );
}
