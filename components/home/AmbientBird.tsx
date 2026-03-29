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
  positionRef?: React.MutableRefObject<{ x: number; y: number }>;
  pulseTrigger?: number;
}

export default function AmbientBird({
  signalCount = 0,
  reactionTrigger = 0,
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

  // ── PULSE STATE (bird scale pulse after capture) ──────
  const pulseAnimRef = useRef({ active: false, startTime: 0 });
  const prevPulseTriggerRef = useRef(pulseTrigger);

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

    // Vertical sine wave drift
    const sineTime = (now + s.sineOffset) / SINE_PERIOD;
    const sineY = Math.sin(sineTime * Math.PI * 2) * g.sineAmplitude;
    s.y = s.baseY + sineY;

    // Clamp to sky zone
    if (s.y < s.skyTopPx) {
      s.y = s.skyTopPx;
      s.baseY = s.skyTopPx + g.sineAmplitude;
    }
    if (s.y > s.skyBottomPx) {
      s.y = s.skyBottomPx;
      s.baseY = s.skyBottomPx - g.sineAmplitude;
    }

    // ── REACTION OVERLAY ─────────────────────────────────
    const rx = reactionRef.current;
    if (rx.active) {
      const elapsed = now - rx.startTime;
      const progress = Math.min(elapsed / rx.duration, 1);

      if (rx.type === 'acceleration') {
        // Brief speed boost — sine curve peaks mid-reaction
        const boost = Math.sin(progress * Math.PI);
        s.x += g.speed * s.direction * boost * 1.8;
      } else if (rx.type === 'soar') {
        // Gentle upward arc within sky zone
        const arc = Math.sin(progress * Math.PI);
        const height = rx.soarStartY - rx.soarPeakY;
        s.y = rx.soarStartY - height * arc;
      }
      // 'turn' reaction handled by existing direction transition system

      if (progress >= 1) {
        if (rx.type === 'soar') {
          s.y = rx.soarStartY;
          s.baseY = rx.soarStartY;
        }
        rx.active = false;
        rx.type = null;
      }
    }

    // Update position refs
    birdPositionRef.current.x = s.x;
    birdPositionRef.current.y = s.y;
    if (positionRef) {
      positionRef.current.x = s.x;
      positionRef.current.y = s.y;
    }

    // Pulse boost: 1 → 1.08 → 1 over 600ms (sine curve)
    let pulseBoost = 1;
    const pa = pulseAnimRef.current;
    if (pa.active) {
      const elapsed = now - pa.startTime;
      const progress = Math.min(elapsed / 600, 1);
      pulseBoost = 1 + 0.08 * Math.sin(progress * Math.PI);
      if (progress >= 1) pa.active = false;
    }

    // Apply transform — bird faces direction of travel
    // SVG faces right by default; scaleX(-1) mirrors for leftward flight
    const scaleX = s.direction >= 0 ? 1 : -1;
    el.style.transform = `translate(${s.x}px, ${s.y}px) scaleX(${scaleX}) scale(${g.scale * pulseBoost})`;

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

    const s = stateRef.current;
    const now = performance.now();

    // Weighted random: A=50%, B=35%, C=15%
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
      // Rise higher within sky zone, ~40px upward arc
      const peakY = Math.max(s.skyTopPx, s.y - 40);
      reactionRef.current = {
        active: true,
        type: 'soar',
        startTime: now,
        duration: 800,
        soarStartY: s.y,
        soarPeakY: peakY,
      };
    }
  }, [reactionTrigger]);

  // ── PULSE TRIGGER ───────────────────────────────────────
  useEffect(() => {
    if (pulseTrigger > prevPulseTriggerRef.current) {
      pulseAnimRef.current = { active: true, startTime: performance.now() };
    }
    prevPulseTriggerRef.current = pulseTrigger;
  }, [pulseTrigger]);

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
          <path
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
