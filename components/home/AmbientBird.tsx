'use client';

import { useEffect, useRef, useCallback, useMemo } from 'react';
import { SCENE_HORIZON_PERCENT } from '@/lib/constants';

// ── BIRD SVG DIMENSIONS ──────────────────────────────────
const BIRD_WIDTH = 32;
const BIRD_HEIGHT = 14;

// ── MOTION CONSTANTS ──────────────────────────────────────
const SPEED_BASE = 0.25;              // px per frame (~15px/s at 60fps)
const SINE_AMPLITUDE_BASE = 6;        // vertical drift amplitude in px
const SINE_PERIOD = 5000;             // ms for one full vertical sine cycle
const DIR_CHANGE_MIN = 10000;         // min ms before direction change
const DIR_CHANGE_MAX = 18000;         // max ms before direction change
const TURN_DURATION = 1400;           // ms for smooth direction transition

// ── SOAR CONSTANTS ───────────────────────────────────────
// Single smooth arc using sin²(πt) — zero velocity at takeoff, peak, and landing
const SOAR_HEIGHT = 65;               // px upward
const SOAR_DURATION_MS = 2200;        // total arc duration — unhurried, long glide down

// ── WING FLAP CONSTANTS ─────────────────────────────────
const FLAP_CYCLE_MS = 480;            // one full flap cycle — slower, calmer
const FLAP_BURST_CYCLES = 2;          // 2 flap cycles per burst
const FLAP_BURST_MS = FLAP_CYCLE_MS * FLAP_BURST_CYCLES;
const FLAP_MIN_INTERVAL = 4000;       // min ms between bursts
const FLAP_MAX_INTERVAL = 9000;       // max ms between bursts

// SVG path control points for wing animation:
// Rest:  M0,11 Q7,1  16,8 Q25,1  32,11  (wings up — normal M-shape)
// Flap:  M0,11 Q7,5  16,8 Q25,5  32,11  (wings gently dipped — subtle)
// Small range = gentle breath, not mechanical pump
const WING_CP_REST = 1;
const WING_CP_FLAP = 5;

// Sky zone: from 8% to SCENE_HORIZON_PERCENT% of viewport
const SKY_TOP_PERCENT = 8;
const SKY_BOTTOM_PERCENT = SCENE_HORIZON_PERCENT; // 62%

// ── EVOLUTION CONSTANTS ───────────────────────────────────
const SCALE_MIN = 0.95;
const SCALE_MAX = 1.1;
const SCALE_RANGE = SCALE_MAX - SCALE_MIN; // 0.15

// Edge margin: how far from edges the bird prefers to stay
const EDGE_MARGIN_MAX = 0.30;  // fraction at growth 0
const EDGE_MARGIN_MIN = 0.08;  // fraction at max growth

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

interface AmbientBirdProps {
  signalCount?: number;
  reactionTrigger?: number;
  reactionSourceRef?: React.MutableRefObject<'save' | 'ambient'>;
  positionRef?: React.MutableRefObject<{ x: number; y: number }>;
  pulseTrigger?: number;
}

export default function AmbientBird({
  signalCount = 0,
  reactionTrigger = 0,
  reactionSourceRef,
  positionRef,
  pulseTrigger = 0,
}: AmbientBirdProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const birdPositionRef = useRef({ x: 0, y: 0 });

  // ── DERIVED GROWTH FACTOR ─────────────────────────────────
  const growthFactor = useMemo(
    () => Math.min(Math.log(signalCount + 1) / 3, 1),
    [signalCount],
  );

  const scale = SCALE_MIN + growthFactor * SCALE_RANGE;
  const sineAmplitude = SINE_AMPLITUDE_BASE * (1 - growthFactor * 0.4); // 6 → 3.6
  const speed = SPEED_BASE + growthFactor * 0.04; // 0.25 → 0.29

  const growthRef = useRef({ scale, sineAmplitude, speed, growthFactor });
  growthRef.current = { scale, sineAmplitude, speed, growthFactor };

  // ── REACTION STATE ──────────────────────────────────────
  const reactionRef = useRef({
    active: false,
    type: null as 'acceleration' | 'turn' | 'soar' | null,
    startTime: 0,
    duration: 0,
    soarStartY: 0,
    soarPeakY: 0,
  });
  const prevTriggerRef = useRef(reactionTrigger);

  // ── WING FLAP STATE ───────────────────────────────────
  const wingFlapRef = useRef({
    active: false,
    startTime: 0,
    nextBurstTime: performance.now() + randomBetween(FLAP_MIN_INTERVAL, FLAP_MAX_INTERVAL),
  });

  // ── DRIFT MICRO-RANDOMNESS STATE ──────────────────────
  const driftVarianceRef = useRef({
    amplitudeMult: 1.0,
    targetAmplitudeMult: 1.0,
    amplitudeTransitionStart: 0,
    amplitudeTransitionDuration: 2000,
    nextAmplitudeChange: performance.now() + randomBetween(15000, 25000),
    speedMult: 1.0,
    targetSpeedMult: 1.0,
    speedTransitionStart: 0,
    speedTransitionDuration: 2000,
    nextSpeedChange: performance.now() + randomBetween(20000, 35000),
  });

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
    skyTopPx: 0,
    skyBottomPx: 0,
  });

  const frameRef = useRef<number>(0);
  const birdElRef = useRef<HTMLDivElement>(null);
  const pathElRef = useRef<SVGPathElement>(null);

  // ── INIT ────────────────────────────────────────────────
  const init = useCallback(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const skyTop = (SKY_TOP_PERCENT / 100) * vh;
    const skyBottom = (SKY_BOTTOM_PERCENT / 100) * vh;
    const startDir = Math.random() > 0.5 ? 1 : -1;

    const gf = growthRef.current.growthFactor;
    const edgeMargin = EDGE_MARGIN_MAX - gf * (EDGE_MARGIN_MAX - EDGE_MARGIN_MIN);
    const xMin = vw * edgeMargin;
    const xMax = vw * (1 - edgeMargin);
    const startX = randomBetween(
      Math.max(BIRD_WIDTH, xMin),
      Math.min(xMax, vw - BIRD_WIDTH),
    );
    const startY = randomBetween(skyTop + 10, skyBottom - 10);

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
    s.skyTopPx = skyTop;
    s.skyBottomPx = skyBottom;
  }, []);

  // ── ANIMATION LOOP ──────────────────────────────────────
  const tick = useCallback((now: number) => {
    const s = stateRef.current;
    const el = birdElRef.current;
    const g = growthRef.current;
    if (!el) {
      frameRef.current = requestAnimationFrame(tick);
      return;
    }

    // Smooth direction transition
    if (s.turnProgress < 1) {
      const elapsed = now - s.turnStartTime;
      s.turnProgress = Math.min(elapsed / TURN_DURATION, 1);
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

    // Horizontal movement
    s.x += g.speed * s.direction;

    // Positioning tendency: gently drift toward allowed zone
    const edgeMargin = EDGE_MARGIN_MAX - g.growthFactor * (EDGE_MARGIN_MAX - EDGE_MARGIN_MIN);
    const xMin = s.viewW * edgeMargin;
    const xMax = s.viewW * (1 - edgeMargin);

    if (s.x < xMin && s.direction < 0) {
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

    // Wrap around edges
    if (s.x > s.viewW + BIRD_WIDTH) {
      s.x = -BIRD_WIDTH;
    } else if (s.x < -BIRD_WIDTH) {
      s.x = s.viewW + BIRD_WIDTH;
    }

    // ── DRIFT MICRO-RANDOMNESS ────────────────────────────
    const dv = driftVarianceRef.current;

    // Amplitude variation
    if (now >= dv.nextAmplitudeChange) {
      dv.targetAmplitudeMult = 0.85 + Math.random() * 0.3; // 0.85–1.15
      dv.amplitudeTransitionStart = now;
      dv.amplitudeTransitionDuration = 2000;
      dv.nextAmplitudeChange = now + randomBetween(15000, 25000);
    }
    if (dv.amplitudeMult !== dv.targetAmplitudeMult) {
      const t = Math.min((now - dv.amplitudeTransitionStart) / dv.amplitudeTransitionDuration, 1);
      dv.amplitudeMult += (dv.targetAmplitudeMult - dv.amplitudeMult) * Math.min(t * 0.05, 1);
      if (Math.abs(dv.amplitudeMult - dv.targetAmplitudeMult) < 0.001) {
        dv.amplitudeMult = dv.targetAmplitudeMult;
      }
    }

    // Speed variation
    if (now >= dv.nextSpeedChange) {
      dv.targetSpeedMult = 0.88 + Math.random() * 0.24; // 0.88–1.12
      dv.speedTransitionStart = now;
      dv.speedTransitionDuration = 2000;
      dv.nextSpeedChange = now + randomBetween(20000, 35000);
    }
    if (dv.speedMult !== dv.targetSpeedMult) {
      const t = Math.min((now - dv.speedTransitionStart) / dv.speedTransitionDuration, 1);
      dv.speedMult += (dv.targetSpeedMult - dv.speedMult) * Math.min(t * 0.05, 1);
      if (Math.abs(dv.speedMult - dv.targetSpeedMult) < 0.001) {
        dv.speedMult = dv.targetSpeedMult;
      }
    }

    // ── REACTION OVERLAY ─────────────────────────────────
    const rx = reactionRef.current;
    const isSoaring = rx.active && rx.type === 'soar';

    // Vertical sine wave drift — SKIP during soar to prevent fighting
    if (!isSoaring) {
      const effectiveAmplitude = g.sineAmplitude * dv.amplitudeMult;
      const sineTime = (now + s.sineOffset) / SINE_PERIOD;
      const sineY = Math.sin(sineTime * Math.PI * 2) * effectiveAmplitude;
      s.y = s.baseY + sineY;

      // Clamp to sky zone
      if (s.y < s.skyTopPx) {
        s.y = s.skyTopPx;
        s.baseY = s.skyTopPx + effectiveAmplitude;
      }
      if (s.y > s.skyBottomPx) {
        s.y = s.skyBottomPx;
        s.baseY = s.skyBottomPx - effectiveAmplitude;
      }
    }

    if (rx.active) {
      const elapsed = now - rx.startTime;

      if (rx.type === 'acceleration') {
        const progress = Math.min(elapsed / rx.duration, 1);
        // Brief speed boost — sine curve peaks mid-reaction
        const boost = Math.sin(progress * Math.PI);
        s.x += g.speed * s.direction * boost * 1.8;
        if (progress >= 1) {
          rx.active = false;
          rx.type = null;
        }
      } else if (rx.type === 'soar') {
        // ── ASYMMETRIC SMOOTH ARC ──────────────────────────
        // sin²(πt) but with time-warped so the bird reaches apex at 35%
        // of duration, then drifts down slowly over the remaining 65%.
        // This makes the ascent feel quick/purposeful and the descent
        // feel like a gentle glide back into the drift.
        const t = elapsed / SOAR_DURATION_MS;
        if (t < 1) {
          const height = rx.soarStartY - rx.soarPeakY;
          // Time warp: remap t so apex occurs at t=0.35 instead of t=0.5
          // Use a power curve to skew: t < apex maps to 0–0.5, t > apex maps to 0.5–1
          const apex = 0.35;
          const warped = t < apex
            ? 0.5 * (t / apex)                       // fast rise to midpoint
            : 0.5 + 0.5 * ((t - apex) / (1 - apex)); // slow descent from midpoint
          const sinW = Math.sin(Math.PI * warped);
          const arc = sinW * sinW;
          s.y = rx.soarStartY - height * arc;
        } else {
          // Return to drift: seamless handoff from current position
          s.baseY = rx.soarStartY;
          s.y = rx.soarStartY;
          s.sineOffset = -now; // reset sine so drift starts at zero offset
          rx.active = false;
          rx.type = null;
        }
      } else {
        // 'turn' reaction handled by existing direction transition system
        const progress = Math.min(elapsed / rx.duration, 1);
        if (progress >= 1) {
          rx.active = false;
          rx.type = null;
        }
      }
    }

    // Apply speed micro-randomness to horizontal movement
    // (override the earlier s.x += g.speed * s.direction with variance)
    // Already applied above, but we add the variance delta here
    s.x += g.speed * s.direction * (dv.speedMult - 1);

    // Update position refs
    birdPositionRef.current.x = s.x;
    birdPositionRef.current.y = s.y;
    if (positionRef) {
      positionRef.current.x = s.x;
      positionRef.current.y = s.y;
    }

    // ── WING FLAP (SVG path animation) ────────────────
    const wf = wingFlapRef.current;
    if (!wf.active && now >= wf.nextBurstTime) {
      wf.active = true;
      wf.startTime = now;
    }

    let wingCpY = WING_CP_REST;  // control point Y for wing arcs
    if (wf.active) {
      const flapElapsed = now - wf.startTime;
      if (flapElapsed >= FLAP_BURST_MS) {
        wf.active = false;
        wf.nextBurstTime = now + randomBetween(FLAP_MIN_INTERVAL, FLAP_MAX_INTERVAL);
        wingCpY = WING_CP_REST;
      } else {
        // Full sine oscillation per cycle: wings dip down then back up
        const cycleT = (flapElapsed % FLAP_CYCLE_MS) / FLAP_CYCLE_MS;
        // sin(2πt) gives one full oscillation per cycle
        // abs() keeps it always positive (dip below rest, never above)
        const wave = Math.abs(Math.sin(cycleT * Math.PI * 2));
        // Envelope: fade out the burst so it doesn't end abruptly
        const burstT = flapElapsed / FLAP_BURST_MS;
        const envelope = 1 - burstT * burstT; // quadratic fadeout
        wingCpY = WING_CP_REST + (WING_CP_FLAP - WING_CP_REST) * wave * envelope;
      }
    }

    // Update SVG path d attribute for wing animation
    const pathEl = pathElRef.current;
    if (pathEl) {
      pathEl.setAttribute('d', `M0,11 Q7,${wingCpY} 16,8 Q25,${wingCpY} 32,11`);
    }

    // Apply transform — bird faces direction of travel
    // SVG faces right by default; scaleX(-1) mirrors for leftward flight
    // No pulseBoost during soar to prevent weird size changes
    const scaleX = s.direction >= 0 ? 1 : -1;
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
      s.skyTopPx = (SKY_TOP_PERCENT / 100) * s.viewH;
      s.skyBottomPx = (SKY_BOTTOM_PERCENT / 100) * s.viewH;
    };

    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(frameRef.current);
      window.removeEventListener('resize', handleResize);
    };
  }, [init, tick]);

  // ── REACTION TRIGGER ──────────────────────────────────
  useEffect(() => {
    if (reactionTrigger <= prevTriggerRef.current) {
      prevTriggerRef.current = reactionTrigger;
      return;
    }
    prevTriggerRef.current = reactionTrigger;

    // Stacking prevention — ignore if reaction already in progress
    if (reactionRef.current.active) return;

    // Read and consume the reaction source
    const source = reactionSourceRef?.current ?? 'ambient';
    if (reactionSourceRef) reactionSourceRef.current = 'ambient';

    const s = stateRef.current;
    const now = performance.now();

    if (source === 'save') {
      // ── SAVE-CONFIRMED: deterministic soar (65px arc, smooth 3-phase) ──
      const peakY = Math.max(s.skyTopPx, s.y - SOAR_HEIGHT);
      reactionRef.current = {
        active: true,
        type: 'soar',
        startTime: now,
        duration: SOAR_DURATION_MS,
        soarStartY: s.y,
        soarPeakY: peakY,
      };
      // Trigger wing flap burst at start of soar
      wingFlapRef.current.active = true;
      wingFlapRef.current.startTime = now;
    } else {
      // ── AMBIENT: weighted random A=50%, B=35%, C=15% ──
      const roll = Math.random();

      if (roll < 0.50) {
        // Reaction A — Speed burst (300–500ms)
        reactionRef.current = {
          active: true,
          type: 'acceleration',
          startTime: now,
          duration: 300 + Math.random() * 200,
          soarStartY: 0,
          soarPeakY: 0,
        };
      } else if (roll < 0.85) {
        // Reaction B — Directional shift (~400ms)
        reactionRef.current = {
          active: true,
          type: 'turn',
          startTime: now,
          duration: 400,
          soarStartY: 0,
          soarPeakY: 0,
        };
        // Force confident direction change
        s.targetDirection = s.targetDirection === 1 ? -1 : 1;
        s.turnProgress = 0;
        s.turnStartTime = now;
        s.nextDirChange = now + randomBetween(DIR_CHANGE_MIN, DIR_CHANGE_MAX);
      } else {
        // Reaction C — Soar (~15%, rare, special)
        // Rise higher within sky zone, ~40px upward arc, smooth 3-phase
        const peakY = Math.max(s.skyTopPx, s.y - 40);
        reactionRef.current = {
          active: true,
          type: 'soar',
          startTime: now,
          duration: SOAR_DURATION_MS,
          soarStartY: s.y,
          soarPeakY: peakY,
        };
        // Trigger wing flap burst at start of soar
        wingFlapRef.current.active = true;
        wingFlapRef.current.startTime = now;
      }
    }
  }, [reactionTrigger, reactionSourceRef]);

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 overflow-hidden"
      style={{ zIndex: 22, pointerEvents: 'none' }}
      aria-hidden="true"
    >
      <div
        ref={birdElRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: BIRD_WIDTH,
          height: BIRD_HEIGHT,
          willChange: 'transform',
        }}
      >
        <svg
          width={BIRD_WIDTH}
          height={BIRD_HEIGHT}
          viewBox="0 0 32 14"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Minimal bird silhouette — M-shape, two gentle arcs */}
          {/* Wing control points animated by rAF loop via pathElRef */}
          <path
            ref={pathElRef}
            d="M0,11 Q7,1 16,8 Q25,1 32,11"
            stroke="rgba(247,243,236,0.6)"
            strokeWidth="1.8"
            fill="none"
            strokeLinecap="round"
          />
        </svg>
      </div>
    </div>
  );
}
